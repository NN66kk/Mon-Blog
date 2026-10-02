import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

// This test writes one local draft and leaves it available for manual review.
// API keys and browser cookies stay in process memory and are never logged.
const target = new URL(
  process.env.PUBLISHER_TEST_URL || 'http://localhost:5173',
);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !['http:', 'https:'].includes(target.protocol) ||
  target.username ||
  target.password ||
  target.search ||
  target.hash
)
  throw new Error('Local MCP acceptance tests must use a loopback URL.');
const origin = target.origin;

async function localFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  assert.equal(
    new URL(request.url).origin,
    origin,
    'Acceptance requests must stay on the configured loopback origin.',
  );
  return fetch(request, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
}

function data(result: {
  structuredContent?: unknown;
  content?: unknown;
}): Record<string, unknown> {
  return (result.structuredContent ||
    JSON.parse((result.content as { text: string }[])[0].text)) as Record<
    string,
    unknown
  >;
}

void test(
  'local HTTP: URL + Key edits shared drafts, rejects stale saves and stops working after revocation',
  { timeout: 60_000 },
  async (t) => {
    const login = await localFetch(`${origin}/signin-with-chatgpt?return_to=/`);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.equal(login.status, 302);
    assert.ok(
      cookie,
      'Start the local development server with Sites test sign-in enabled.',
    );
    const browserHeaders = {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
    };
    const browser = (path: string, init?: RequestInit) =>
      localFetch(`${origin}${path}`, {
        ...init,
        headers: browserHeaders,
      });

    const client = new Client(
      { name: 'mon-blog-local-acceptance', version: '1.0.0' },
      { versionNegotiation: { mode: 'legacy' } },
    );
    const issuedResponse = await browser('/api/mcp-keys', {
      method: 'POST',
      body: JSON.stringify({ name: '本机 MCP 集成验收（自动撤销）' }),
    });
    assert.equal(issuedResponse.status, 201);
    const issued = (await issuedResponse.json()) as {
      key: string;
      record: { id: string; scopes: string[] };
    };
    const keyId = issued.record.id;
    let revoked = false;
    const revoke = async () => {
      if (revoked) return;
      const response = await browser(`/api/mcp-keys/${keyId}/revoke`, {
        method: 'POST',
        body: '{}',
      });
      assert.equal(response.status, 200, 'The local test key must be revoked.');
      revoked = true;
    };
    t.after(async () => {
      try {
        await revoke();
      } finally {
        await client.close();
      }
    });
    assert.equal(typeof keyId, 'string');
    // Use boolean assertions so a failing assertion cannot print the secret.
    assert.equal(/^mon_[a-f0-9]{64}$/.test(issued.key), true);
    assert.deepEqual(issued.record.scopes, ['content:read', 'drafts:write']);

    let lastMcpStatus = 0;
    let mcpRequests = 0;
    const transport = new StreamableHTTPClientTransport(
      new URL(`${origin}/api/mcp`),
      {
        requestInit: { headers: { Authorization: `Bearer ${issued.key}` } },
        fetch: async (url, init) => {
          const request = new Request(url, init);
          assert.equal(request.headers.has('cookie'), false);
          assert.equal(
            request.headers.get('authorization') === `Bearer ${issued.key}`,
            true,
            'MCP requests must authenticate with the test API Key.',
          );
          const response = await localFetch(request);
          mcpRequests++;
          lastMcpStatus = response.status;
          return response;
        },
      },
    );
    await client.connect(transport);
    const available = (await client.listTools()).tools;
    assert.ok(available.some((tool) => tool.name === 'create_draft'));
    assert.equal(
      available.some((tool) => tool.name === 'publish_draft'),
      false,
      'The default key must not have permission to publish.',
    );

    const createdResult = await client.callTool({
      name: 'create_draft',
      arguments: {
        title: '本机 MCP 与网页互通验收草稿',
        collection: 'B-Notes',
        body: '由本机 MCP 创建，仅用于验收。',
        metadata: 'tags: [MCP验收]\ncustom: preserve-me\n',
      },
    });
    assert.notEqual(createdResult.isError, true);
    const created = data(createdResult);
    assert.equal(created.revision, 1);
    const draftId = created.id;
    assert.equal(typeof draftId, 'string');
    if (typeof draftId !== 'string') throw new Error('Missing draft ID.');

    const updatedResult = await client.callTool({
      name: 'update_draft',
      arguments: {
        id: created.id,
        expected_revision: created.revision,
        body: 'MCP 修改后的正文，网页应能读取。',
      },
    });
    assert.notEqual(updatedResult.isError, true);
    const updated = data(updatedResult);
    assert.equal(updated.revision, 2);
    assert.equal(updated.metadata, created.metadata);

    const readResponse = await browser(`/api/drafts/${draftId}`);
    assert.equal(readResponse.status, 200);
    const fromBrowser = (await readResponse.json()) as Record<string, unknown>;
    assert.equal(fromBrowser.body, 'MCP 修改后的正文，网页应能读取。');
    assert.equal(fromBrowser.revision, 2);
    assert.equal(fromBrowser.source_path, null);
    assert.equal(fromBrowser.first_published_at, null);

    const browserBody = '网页保存的新正文，旧版 MCP 修改不得覆盖。';
    const browserSave = await browser('/api/drafts', {
      method: 'POST',
      body: JSON.stringify({
        id: fromBrowser.id,
        title: fromBrowser.title,
        collection: fromBrowser.collection,
        metadata: fromBrowser.metadata,
        revision: fromBrowser.revision,
        body: browserBody,
      }),
    });
    assert.equal(browserSave.status, 200);
    assert.equal(
      ((await browserSave.json()) as { revision: number }).revision,
      3,
    );

    const stale = await client.callTool({
      name: 'update_draft',
      arguments: {
        id: created.id,
        expected_revision: updated.revision,
        body: '过期版本，不应写入。',
      },
    });
    assert.equal(stale.isError, true);
    assert.equal(data(stale).status, 409);
    const reread = await client.callTool({
      name: 'get_draft',
      arguments: { id: created.id },
    });
    assert.notEqual(reread.isError, true);
    assert.equal(data(reread).body, browserBody);
    assert.equal(data(reread).revision, 3);

    await revoke();
    await assert.rejects(client.listTools(), () => {
      assert.equal(lastMcpStatus, 401, 'A revoked key must receive HTTP 401.');
      return true;
    });
    assert.ok(
      mcpRequests > 0,
      'The test must exercise real MCP HTTP requests.',
    );
  },
);
