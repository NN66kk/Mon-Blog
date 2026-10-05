import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  createBlogMcpEndpoint,
  createSitesBlogMcpEndpoint,
} from '../lib/mcp-server';
import { createMcpKeyStore } from '../lib/mcp-keys';
import { createWritingService } from '../lib/writing-service';

const endpoint = 'https://blog.example/api/mcp';
function setup(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  const folder = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(new URL(file, folder), 'utf8'));
  t.after(() => sqlite.close());
  const db = {
    prepare(sql: string) {
      let bindings: SQLInputValue[] = [];
      const stmt = {
        bind(...values: SQLInputValue[]) {
          bindings = values;
          return stmt;
        },
        async first() {
          return sqlite.prepare(sql).get(...bindings) || null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...bindings) };
        },
        execute() {
          return {
            meta: { changes: sqlite.prepare(sql).run(...bindings).changes },
          };
        },
        async run() {
          return stmt.execute();
        },
      };
      return stmt;
    },
    async batch(statements: { execute(): unknown }[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((stmt) => stmt.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  let remoteCalls = 0;
  const writing = createWritingService({
    db,
    storage: { get: async () => null },
    getAccount: async () => {
      remoteCalls++;
      throw new Error('PRIVATE_SYNTHETIC_CONNECTION_DETAIL');
    },
  });
  const keys = createMcpKeyStore(db);
  const fetch = createBlogMcpEndpoint({
    authenticate: (key) => keys.authenticate(key),
    writing,
  });
  async function client(key: string, mode: 'legacy' | 'auto' = 'legacy') {
    const client = new Client(
      { name: 'mon-blog-test', version: '1.0.0' },
      { versionNegotiation: { mode } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
      fetch: (url, init) => fetch(new Request(url, init)),
    });
    await client.connect(transport);
    t.after(() => client.close());
    return client;
  }
  return {
    sqlite,
    keys,
    writing,
    fetch,
    sitesFetch: createSitesBlogMcpEndpoint(writing),
    client,
    remoteCalls: () => remoteCalls,
  };
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
function raw(
  key?: string,
  body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  extra: Record<string, string> = {},
) {
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...extra,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

for (const mode of ['legacy', 'auto'] as const) {
  void test(`official client (${mode}) connects with URL + Key and edits a draft without browser login`, async (t) => {
    const h = setup(t);
    const issued = await h.keys.create('alice', { name: 'Test' });
    const client = await h.client(issued.key, mode);
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some((tool) => tool.name === 'create_draft'));
    assert.equal(
      tools.some((tool) => tool.name === 'publish_draft'),
      false,
    );
    const created = data(
      await client.callTool({
        name: 'create_draft',
        arguments: {
          title: '测试文章',
          body: '原正文',
          collection: 'B-Notes',
          metadata: 'custom: keep\ntags: [MCP]\n',
        },
      }),
    );
    assert.equal(created.revision, 1);
    assert.equal('owner' in created, false);
    const changed = data(
      await client.callTool({
        name: 'update_draft',
        arguments: {
          id: created.id,
          expected_revision: 1,
          body: '修改后的正文',
        },
      }),
    );
    assert.equal(changed.revision, 2);
    assert.equal(changed.metadata, created.metadata);
    assert.equal(changed.title, created.title);
    assert.equal(
      (await h.writing.getDraft('alice', created.id as string)).body,
      '修改后的正文',
    );
    const stale = await client.callTool({
      name: 'update_draft',
      arguments: { id: created.id, expected_revision: 1, title: '不能覆盖' },
    });
    assert.equal(stale.isError, true);
    assert.equal(data(stale).status, 409);
    const preview = data(
      await client.callTool({
        name: 'prepare_publish',
        arguments: { id: created.id, expected_revision: 2 },
      }),
    );
    assert.equal(preview.content_checked, true);
    assert.equal(preview.remote_checked, false);
    assert.equal(
      h.sqlite.prepare('SELECT count(*) AS n FROM publications').get()!.n,
      0,
    );
    assert.equal(h.remoteCalls(), 0);
  });
}

void test('scope-filtered tools cannot be invoked by name, owners cannot be overridden, and revocation works on the next call', async (t) => {
  const h = setup(t);
  const writer = await h.keys.create('alice', { name: 'Writer' });
  const c = await h.client(writer.key);
  const created = data(
    await c.callTool({
      name: 'create_draft',
      arguments: { title: 'Alice', body: 'Secret draft', collection: 'A-Life' },
    }),
  );
  const reader = await h.keys.create('bob', {
    name: 'Reader',
    scopes: ['content:read'],
  });
  const r = await h.client(reader.key);
  const toolNames = (await r.listTools()).tools.map((tool) => tool.name);
  assert.equal(toolNames.includes('update_draft'), false);
  assert.equal(toolNames.includes('publish_draft'), false);
  const denied = await r.callTool({
    name: 'get_draft',
    arguments: { id: created.id },
  });
  assert.equal(denied.isError, true);
  assert.equal(data(denied).status, 404);
  const smuggled = await r.callTool({
    name: 'get_draft',
    arguments: { id: created.id, owner: 'alice' },
  });
  assert.equal(smuggled.isError, true);
  await assert.rejects(
    r.callTool({
      name: 'update_draft',
      arguments: { id: created.id, expected_revision: 1, body: 'overwrite' },
    }),
    /Tool update_draft not found/,
  );
  assert.equal(
    (await h.writing.getDraft('alice', created.id as string)).body,
    'Secret draft',
  );
  await h.keys.revoke('alice', writer.record.id);
  await assert.rejects(c.listTools());
});

void test('transport rejects anonymous, invalid, expired, query and cross-origin credentials before returning tools', async (t) => {
  const h = setup(t);
  const issued = await h.keys.create('alice', { name: 'Guard' });
  assert.equal((await h.fetch(raw())).status, 401);
  assert.equal((await h.fetch(raw(`mon_${'0'.repeat(64)}`))).status, 401);
  assert.equal(
    (
      await h.fetch(
        raw(undefined, undefined, {
          Cookie: 'session=synthetic',
          'oai-authenticated-user-id': 'alice',
        }),
      )
    ).status,
    401,
  );
  const cross = await h.fetch(
    raw(issued.key, undefined, { Origin: 'https://evil.example' }),
  );
  assert.equal(cross.status, 403);
  assert.equal(cross.headers.get('access-control-allow-origin'), null);
  assert.equal(
    (
      await h.fetch(
        new Request(`${endpoint}?api_key=redacted`, raw(issued.key)),
      )
    ).status,
    400,
  );
  const response = await h.fetch(raw(issued.key));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('mcp-session-id'), null);
  assert.equal(
    (
      await h.fetch(
        new Request(endpoint, {
          headers: { Authorization: `Bearer ${issued.key}` },
        }),
      )
    ).status,
    405,
  );
  assert.equal(
    (await h.fetch(raw(issued.key, '{}', { 'Content-Type': 'text/plain' })))
      .status,
    415,
  );
  assert.equal(
    (await h.fetch(raw(issued.key, 'a'.repeat(1500001)))).status,
    413,
  );
  h.sqlite
    .prepare('UPDATE mcp_keys SET expires_at=? WHERE id=?')
    .run('2000-01-01T00:00:00.000Z', issued.record.id);
  assert.equal((await h.fetch(raw(issued.key))).status, 401);
});

void test('unexpected upstream failures are sanitized and publishing permission is separate', async (t) => {
  const h = setup(t);
  const issued = await h.keys.create('alice', {
    name: 'Publisher',
    scopes: ['content:read', 'publications:write'],
  });
  const c = await h.client(issued.key);
  const names = (await c.listTools()).tools.map((tool) => tool.name);
  assert.ok(names.includes('publish_draft'));
  assert.equal(names.includes('create_draft'), false);
  const result = await c.callTool({ name: 'search_articles', arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(data(result).status, 500);
  assert.equal(
    JSON.stringify(result).includes('PRIVATE_SYNTHETIC_CONNECTION_DETAIL'),
    false,
  );
});

for (const mode of ['legacy', 'auto'] as const) {
  void test(`Sites OAuth (${mode}) shares the web owner and enforces account isolation`, async (t) => {
    const h = setup(t);
    async function connect(owner?: string) {
      const client = new Client(
        { name: 'sites-oauth-test', version: '1.0.0' },
        {
          versionNegotiation: { mode },
        },
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL('https://blog.example/mcp'), {
          requestInit: {
            headers: owner
              ? {
                  'oai-authenticated-user-id': owner,
                  'oai-authenticated-user-email': `${owner}@example.test`,
                }
              : {},
          },
          fetch: (url, init) => h.sitesFetch(new Request(url, init)),
        }),
      );
      t.after(() => client.close());
      return client;
    }
    const alice = await connect('alice');
    assert.equal((await alice.listTools()).tools.length, 12);
    const draft = data(
      await alice.callTool({
        name: 'create_draft',
        arguments: {
          title: 'OAuth private draft',
          body: 'Only Alice can read this.',
          collection: 'B-Notes',
        },
      }),
    );
    assert.equal(
      (await h.writing.getDraft('alice', draft.id as string)).title,
      draft.title,
    );
    const bob = await connect('bob');
    const forbidden = await bob.callTool({
      name: 'get_draft',
      arguments: { id: draft.id },
    });
    assert.equal(forbidden.isError, true);
    assert.equal(data(forbidden).status, 404);
    const key = await h.keys.create('alice', { name: 'Same owner' });
    const keyedClient = await h.client(key.key, mode);
    assert.equal(
      data(
        await keyedClient.callTool({
          name: 'get_draft',
          arguments: { id: draft.id },
        }),
      ).title,
      draft.title,
    );
    const anonymous = await connect();
    assert.equal((await anonymous.listTools()).tools.length, 12);
    await assert.rejects(
      () => anonymous.callTool({ name: 'list_drafts', arguments: {} }),
      /授权连接写作室/,
    );
    assert.equal(h.remoteCalls(), 0);
  });
}

void test('Sites service access, API keys and partial identity never manufacture an OAuth owner', async (t) => {
  const h = setup(t);
  const issued = await h.keys.create('alice', { name: 'API only' });
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'list_drafts', arguments: {} },
  };
  const headersToReject: Record<string, string>[] = [
    {},
    { 'OAI-Sites-Authorization': 'Bearer synthetic-platform-credential' },
    { Authorization: `Bearer ${issued.key}` },
    { 'oai-authenticated-user-id': 'alice' },
    { 'oai-authenticated-user-email': 'alice@example.test' },
  ];
  for (const headers of headersToReject) {
    const response = await h.sitesFetch(raw(undefined, body, headers));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(h.remoteCalls(), 0);
});

void test('Sites discovery rejects cross-origin and oversized anonymous requests', async (t) => {
  const h = setup(t);
  assert.equal(
    (
      await h.sitesFetch(
        raw(undefined, undefined, { origin: 'https://untrusted.example' }),
      )
    ).status,
    403,
  );
  assert.equal((await h.sitesFetch(raw(undefined, '{'))).status, 400);
  assert.equal(
    (await h.sitesFetch(raw(undefined, ' '.repeat(1500001)))).status,
    413,
  );
  assert.equal(h.remoteCalls(), 0);
});
