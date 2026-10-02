import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createMcpKeyStore, readMcpBearerKey } from '../lib/mcp-keys';
import { createMcpKeyRoutes } from '../lib/mcp-key-routes';
import { ApiError } from '../lib/github';

function setup(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(
      new URL('../drizzle/0004_mcp_keys.sql', import.meta.url),
      'utf8',
    ),
  );
  t.after(() => sqlite.close());
  const db = {
    prepare(sql: string) {
      let values: (string | number | null)[] = [];
      const query = {
        bind(...args: (string | number | null)[]) {
          values = args;
          return query;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        },
        async run() {
          return {
            meta: { changes: sqlite.prepare(sql).run(...values).changes },
          };
        },
      };
      return query;
    },
  } as unknown as D1Database;
  const store = createMcpKeyStore(db);
  let identityCalls = 0;
  const routes = createMcpKeyRoutes({
    database: () => db,
    identity: async (request) => {
      identityCalls++;
      const owner = request.headers.get('x-test-owner');
      if (!owner) throw new ApiError(401, '请先登录。');
      if (
        request.method !== 'GET' &&
        request.headers.get('origin') !== new URL(request.url).origin
      )
        throw new ApiError(403, '请求来源无效。');
      return owner;
    },
  });
  const request = (
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request('https://test.local/api/mcp-keys', {
      method,
      headers: {
        'x-test-owner': 'alice',
        Origin: 'https://test.local',
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { sqlite, store, routes, request, identityCalls: () => identityCalls };
}

void test('new keys have 256 bits of random material and only their hash is stored', async (t) => {
  const { sqlite, store } = setup(t);
  const first = await store.create('alice', { name: ' Codex ' });
  const second = await store.create('alice', { name: 'Cursor' });
  assert.match(first.key, /^mon_[a-f0-9]{64}$/);
  assert.notEqual(first.key, second.key);
  assert.equal(first.record.name, 'Codex');
  assert.deepEqual(first.record.scopes, ['content:read', 'drafts:write']);
  assert.equal(
    Date.parse(first.record.expires_at) - Date.parse(first.record.created_at),
    90 * 86400000,
  );
  const stored = sqlite
    .prepare('SELECT * FROM mcp_keys WHERE id=?')
    .get(first.record.id)!;
  assert.equal(JSON.stringify(stored).includes(first.key), false);
  assert.match(stored.hash as string, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.hash, first.key.slice(4));
  assert.equal(stored.prefix, first.key.slice(0, 12));
  const listed = await store.list('alice');
  assert.equal(listed.length, 2);
  assert.equal(JSON.stringify(listed).includes(first.key), false);
  assert.equal('hash' in listed[0], false);
  assert.equal('owner' in listed[0], false);
});

void test('identity, owner isolation, soft revocation and expiration are enforced', async (t) => {
  const { sqlite, store } = setup(t);
  const { key, record } = await store.create('alice', {
    name: 'Publishing',
    scopes: ['content:read', 'publications:write'],
    expiresInDays: 1,
  });
  assert.deepEqual(await store.authenticate(key), {
    owner: 'alice',
    keyId: record.id,
    scopes: ['content:read', 'publications:write'],
  });
  assert.ok((await store.list('alice'))[0].last_used_at);
  assert.deepEqual(await store.list('bob'), []);
  await assert.rejects(
    store.revoke('bob', record.id),
    (error: ApiError) => error.status === 404,
  );
  assert.equal((await store.authenticate(key)).owner, 'alice');
  const revoked = await store.revoke('alice', record.id);
  assert.ok(revoked.revoked_at);
  assert.equal(
    (await store.revoke('alice', record.id)).revoked_at,
    revoked.revoked_at,
  );
  await assert.rejects(
    store.authenticate(key),
    (error: ApiError) => error.status === 401,
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM mcp_keys').get()!.count,
    1,
  );
  const expired = await store.create('alice', { name: 'Expired' });
  sqlite
    .prepare('UPDATE mcp_keys SET expires_at=? WHERE id=?')
    .run(new Date(0).toISOString(), expired.record.id);
  await assert.rejects(
    store.authenticate(expired.key),
    (error: ApiError) => error.status === 401,
  );
  assert.equal(
    (await store.list('alice')).find((row) => row.id === expired.record.id)!
      .last_used_at,
    null,
  );
  await assert.rejects(
    store.authenticate(`mon_${'0'.repeat(64)}`),
    (error: ApiError) => error.status === 401,
  );
});

void test('key settings reject invalid scopes, expiry, names, types and unknown fields', async (t) => {
  const { sqlite, store } = setup(t);
  const invalid = [
    null,
    [],
    {},
    { name: '' },
    { name: 'a'.repeat(81) },
    { name: 'a\nb' },
    { name: 'a', scopes: [] },
    { name: 'a', scopes: ['drafts:write'] },
    { name: 'a', scopes: ['admin'] },
    { name: 'a', scopes: ['content:read', 'content:read'] },
    { name: 'a', scopes: null },
    { name: 'a', expiresInDays: 0 },
    { name: 'a', expiresInDays: 366 },
    { name: 'a', expiresInDays: 1.5 },
    { name: 'a', expiresInDays: '90' },
    { name: 'a', owner: 'bob' },
  ];
  for (const value of invalid)
    await assert.rejects(
      store.create('alice', value),
      (error: ApiError) => error.status === 400,
    );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM mcp_keys').get()!.count,
    0,
  );
});

void test('Bearer parsing rejects query credentials and noncanonical authentication', () => {
  const key = `mon_${'a'.repeat(64)}`;
  assert.equal(
    readMcpBearerKey(
      new Request('https://test.local/api/mcp', {
        headers: { Authorization: `Bearer ${key}` },
      }),
    ),
    key,
  );
  for (const value of [
    '',
    key,
    `Basic ${key}`,
    `Bearer  ${key}`,
    `Bearer ${key}, Bearer ${key}`,
    `Bearer ${key}suffix`,
  ]) {
    assert.throws(
      () =>
        readMcpBearerKey(
          new Request('https://test.local/api/mcp', {
            headers: { Authorization: value },
          }),
        ),
      (error: ApiError) => error.status === 401,
    );
  }
  for (const query of [
    '?apiKey=secret',
    '?token=secret',
    '?access_token=secret',
  ])
    assert.throws(
      () =>
        readMcpBearerKey(
          new Request(`https://test.local/api/mcp${query}`, {
            headers: { Authorization: `Bearer ${key}` },
          }),
        ),
      (error: ApiError) => error.status === 400,
    );
});

void test('management routes require website identity, refuse Bearer and never cache secrets', async (t) => {
  const { routes, request, identityCalls } = setup(t);
  const created = await routes.POST(request('POST', { name: 'Browser key' }));
  assert.equal(created.status, 201);
  assert.match(created.headers.get('cache-control')!, /no-store/);
  const secret = (await created.json()) as {
    key: string;
    record: { id: string };
  };
  const before = identityCalls();
  const denied = await routes.GET(
    request('GET', undefined, { Authorization: `Bearer ${secret.key}` }),
  );
  assert.equal(denied.status, 403);
  assert.equal(identityCalls(), before);
  assert.match(denied.headers.get('cache-control')!, /no-store/);
  assert.equal(
    (await routes.GET(new Request('https://test.local/api/mcp-keys'))).status,
    401,
  );
  assert.equal(
    (
      await routes.POST(
        request('POST', { name: 'Forged' }, { Origin: 'https://other.test' }),
      )
    ).status,
    403,
  );
  const list = await routes.GET(request());
  assert.equal((await list.text()).includes(secret.key), false);
  assert.equal(
    (await routes.revoke(request('POST', {}), secret.record.id)).status,
    200,
  );
});

void test('key request bodies are bounded even without Content-Length and malformed JSON fails', async (t) => {
  const { routes, request } = setup(t);
  const oversized = await routes.POST(
    request('POST', { name: 'x'.repeat(5000) }),
  );
  assert.equal(oversized.status, 413);
  const declared = await routes.POST(
    request('POST', { name: 'short' }, { 'Content-Length': '999999999' }),
  );
  assert.equal(declared.status, 413);
  const malformed = new Request('https://test.local/api/mcp-keys', {
    method: 'POST',
    headers: {
      'x-test-owner': 'alice',
      Origin: 'https://test.local',
      'Content-Type': 'application/json',
    },
    body: '{broken',
  });
  assert.equal((await routes.POST(malformed)).status, 400);
  assert.equal(
    (
      await routes.POST(
        request('POST', { name: 'type' }, { 'Content-Type': 'text/plain' }),
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await routes.revoke(
        request('POST', { owner: 'bob' }),
        crypto.randomUUID(),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await routes.revoke(
        request('POST', { value: 'x'.repeat(5000) }),
        crypto.randomUUID(),
      )
    ).status,
    413,
  );
});
