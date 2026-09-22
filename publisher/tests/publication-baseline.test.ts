import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const owner = 'baseline-test-owner';
const draftId = '11111111-1111-4111-8111-111111111111';
const articlePath = 'docs/D-Orginals/260922120000.md';
const publishedAt = '2026-09-22T00:00:00.000Z';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  }
  t.after(() => sqlite.close());
  const db = {
    prepare(sql: string) {
      let bindings: any[] = [];
      const statement = {
        bind(...values: any[]) { bindings = values; return statement; },
        async first() { return sqlite.prepare(sql).get(...bindings) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
        execute() { return { meta: { changes: sqlite.prepare(sql).run(...bindings).changes } }; },
        async run() { return statement.execute(); },
      };
      return statement;
    },
    async batch(statements: { execute(): unknown }[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const article = (sha: string) => ({
    sha,
    encoding: 'base64',
    content: Buffer.from(`---\ntitle: Test\npublished_at: "${publishedAt}"\n---\nBody`).toString('base64'),
  });
  const remote = {
    currentBlob: 'blob-zero',
    readCurrent: async () => article(remote.currentBlob),
    afterAdvance: new Map<number, () => Promise<void>>(),
  };
  const call = async (url: string) => {
    if (url.includes('/compare/')) return { status: 'ahead' };
    if (url.includes('/contents/')) {
      const ref = new URL(url, 'https://api.github.test').searchParams.get('ref');
      return ref === 'main' ? remote.readCurrent() : article(`blob-${ref?.replace('commit-', '')}`);
    }
    if (url.includes('/actions/')) return { workflow_runs: [] };
    throw new Error(`Unexpected GitHub read: ${url}`);
  };
  const server = {
    database: () => db,
    identity: async () => owner,
    account: async () => call,
    files: () => ({}),
    jsonBody: (request: Request) => request.json(),
    ownedDraft: async (user: string, id: string) => sqlite.prepare('SELECT * FROM drafts WHERE id=? AND owner=?').get(id, user),
    response: (data: unknown, status = 200) => Response.json(data, { status }),
  };
  const mocks: Record<string, unknown> = {
    '@/lib/server': server,
    '@/lib/draft-filename': { ensureDraftFilename: server.ownedDraft },
    '@/lib/management-server': {
      managementRequest: async () => null,
      snapshotDraft: () => db.prepare('SELECT 1'),
    },
    '@/lib/publish': {
      async publishDraft(draft: { revision: number }, _path: string, _release: string, _call: unknown, _load: unknown, beforeAdvance: (sha: string) => Promise<void>) {
        await beforeAdvance(`commit-${draft.revision}`);
        remote.currentBlob = `blob-${draft.revision}`;
        await remote.afterAdvance.get(draft.revision)?.();
        return { blobSha: `blob-${draft.revision}`, firstPublishedAt: publishedAt };
      },
    },
  };
  // Execute the real API handlers and publication checker. Only worker bindings,
  // authentication, unrelated management routes and GitHub writes are replaced.
  const modules = new Map<string, { exports: any }>();
  function load(file: string): any {
    if (modules.has(file)) return modules.get(file)!.exports;
    const module = { exports: {} };
    modules.set(file, module);
    const source = transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const require = (name: string) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/')) return load(path.join(root, `${name.slice(2)}.ts`));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.ts`));
      return nodeRequire(name);
    };
    new Function('require', 'module', 'exports', source)(require, module, module.exports);
    return module.exports;
  }
  const routes = load(path.join(root, 'app/api/[...path]/route.ts'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  t.after(() => { globalThis.fetch = originalFetch; });
  sqlite.prepare('INSERT INTO drafts(id,owner,title,collection,body,metadata,source_path,base_sha,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(draftId, owner, 'Test', 'D-Orginals', 'Body', 'title: Test', articlePath, 'blob-zero', 1, publishedAt);
  const post = (route: string, value: unknown): Promise<Response> => routes.POST(new Request(`https://test.local/api/${route}`, { method: 'POST', body: JSON.stringify(value) }));
  const get = (id: string): Promise<Response> => routes.GET(new Request(`https://test.local/api/publication/${id}`));
  const draft = () => sqlite.prepare('SELECT revision,base_sha,source_path,first_published_at FROM drafts WHERE id=?').get(draftId)!;
  const save = () => post('drafts', { id: draftId, title: 'New text', collection: 'D-Orginals', body: 'New body', metadata: 'title: New text', revision: 1 });
  function verifyingJob() {
    const id = 'old-publication';
    sqlite.prepare('INSERT INTO publications(id,owner,draft_id,revision,state,commit_sha,url,target_path,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, owner, draftId, 1, 'verifying', 'commit-1', 'https://blog.test/article/', articlePath, publishedAt);
    remote.currentBlob = 'blob-1';
    return id;
  }
  return { sqlite, remote, article, post, get, draft, save, verifyingJob };
}

test('a late publish POST cannot replace a newer confirmed baseline', async (t) => {
  const h = setup(t);
  const advanced = deferred();
  const release = deferred();
  h.remote.afterAdvance.set(1, async () => { advanced.resolve(); await release.promise; });
  const first = h.post('publish', { id: draftId, revision: 1 });
  await advanced.promise;
  const oldJob = h.sqlite.prepare('SELECT id FROM publications WHERE revision=1').get()!;
  assert.equal((await h.get(String(oldJob.id))).status, 200);
  assert.equal(h.draft().base_sha, 'blob-1');
  assert.equal((await h.save()).status, 200);
  assert.equal((await h.post('publish', { id: draftId, revision: 2 })).status, 200);
  assert.equal(h.draft().base_sha, 'blob-2');
  release.resolve();
  assert.equal((await first).status, 200);
  assert.equal(h.draft().base_sha, 'blob-2');
});

test('an old verification starting after a newer confirmation does not adopt its stale blob', async (t) => {
  const h = setup(t);
  const job = h.verifyingJob();
  h.sqlite.prepare('UPDATE drafts SET revision=2,base_sha=?,first_published_at=?').run('blob-2', publishedAt);
  h.remote.currentBlob = 'blob-2';
  assert.equal((await h.get(job)).status, 200);
  assert.equal(h.draft().base_sha, 'blob-2');
});

test('a newer confirmation arriving during an old verification read wins the CAS', async (t) => {
  const h = setup(t);
  const job = h.verifyingJob();
  const reading = deferred();
  const release = deferred();
  let reads = 0;
  h.remote.readCurrent = async () => {
    const current = h.article(h.remote.currentBlob);
    if (++reads === 1) { reading.resolve(); await release.promise; }
    return current;
  };
  const staleCheck = h.get(job);
  await reading.promise;
  assert.equal((await h.get(job)).status, 200);
  assert.equal(h.draft().base_sha, 'blob-1');
  assert.equal((await h.save()).status, 200);
  assert.equal((await h.post('publish', { id: draftId, revision: 2 })).status, 200);
  release.resolve();
  assert.equal((await staleCheck).status, 200);
  assert.equal(h.draft().base_sha, 'blob-2');
  assert.equal(h.draft().source_path, articlePath);
  assert.equal(h.draft().first_published_at, publishedAt);
});

test('editing during publication still accepts its confirmation when the baseline has not changed', async (t) => {
  const h = setup(t);
  const advanced = deferred();
  const release = deferred();
  h.remote.afterAdvance.set(1, async () => { advanced.resolve(); await release.promise; });
  const first = h.post('publish', { id: draftId, revision: 1 });
  await advanced.promise;
  assert.equal((await h.save()).status, 200);
  release.resolve();
  assert.equal((await first).status, 200);
  assert.equal(h.draft().revision, 2);
  assert.equal(h.draft().base_sha, 'blob-1');
});
