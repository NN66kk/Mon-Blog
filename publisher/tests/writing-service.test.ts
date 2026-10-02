import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createWritingService, type DraftInput } from '../lib/writing-service';
import { ApiError, type GitCall } from '../lib/github';

const owner = 'writer-service-owner';
const draftId = '11111111-1111-4111-8111-111111111111';
const articlePath = 'docs/D-Orginals/260922120000.md';
const source = '---\ntitle: 云端文章\ntags: [写作, MCP]\ncustom: preserved\n---\n正文\n';
const article = (content = source, sha = 'article-blob') => ({ sha, size: Buffer.byteLength(content), encoding: 'base64', content: Buffer.from(content).toString('base64') });
const freshDraft = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  id: draftId, title: '中文标题', collection: 'D-Orginals', body: '# 内容\n正文',
  metadata: 'custom: preserved\ntags: [写作]\n', revision: 0, ...overrides,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(t: TestContext, call: GitCall = async () => { throw new Error('Unexpected GitHub request'); }) {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`${migrations}/${file}`, 'utf8'));
  }
  t.after(() => sqlite.close());
  const hooks: { beforeBatch?: () => Promise<void>; beforeAccount?: () => Promise<void>; request?: typeof fetch } = {};
  const db = {
    failNextBatch: false,
    prepare(sql: string) {
      let bindings: SQLInputValue[] = [];
      const statement = {
        bind(...values: SQLInputValue[]) { bindings = values; return statement; },
        async first() { return sqlite.prepare(sql).get(...bindings) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
        execute() { return { meta: { changes: sqlite.prepare(sql).run(...bindings).changes } }; },
        async run() { return statement.execute(); },
      };
      return statement;
    },
    async batch(statements: { execute(): unknown }[]) {
      await hooks.beforeBatch?.();
      if (db.failNextBatch) { db.failNextBatch = false; throw new Error('Synthetic database connection detail'); }
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  let accountReads = 0;
  const service = createWritingService({
    db: db as unknown as D1Database,
    getAccount: async (requestedOwner) => { assert.equal(requestedOwner, owner); accountReads++; await hooks.beforeAccount?.(); return call; },
    storage: { get: async () => null },
    request: async (...args) => hooks.request ? hooks.request(...args) : new Response('', { status: 404 }),
  });
  return { sqlite, db, service, hooks, accountReads: () => accountReads };
}

void test('shared draft writes preserve metadata, snapshots and filenames while rejecting stale or foreign access', async (t) => {
  const h = setup(t);
  const saved = await h.service.saveDraft(owner, freshDraft());
  assert.equal(saved.revision, 1);
  assert.match(saved.filename || '', /^\d{12}\.md$/);
  const next = await h.service.saveDraft(owner, freshDraft({ title: '新标题', body: '新正文', revision: 1 }));
  assert.equal(next.filename, saved.filename);
  await assert.rejects(h.service.saveDraft(owner, freshDraft({ revision: 1 })), (error: unknown) => error instanceof ApiError && error.status === 409);
  await assert.rejects(h.service.getDraft('another-owner', draftId), (error: unknown) => error instanceof ApiError && error.status === 404);
  const draft = await h.service.getDraft(owner, draftId);
  assert.equal(draft.body, '新正文');
  assert.equal(draft.metadata, freshDraft().metadata);
  assert.equal(draft.revision, 2);
  assert.deepEqual(h.sqlite.prepare('SELECT revision FROM draft_versions ORDER BY revision').all().map((row) => row.revision), [1, 2]);
  assert.equal(h.accountReads(), 0, 'saving and reading private drafts must not publish or call GitHub');
});

void test('draft listings paginate owned active drafts and treat query punctuation literally', async (t) => {
  const h = setup(t);
  for (let index = 1; index <= 3; index++) {
    await h.service.saveDraft(owner, freshDraft({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, title: index === 1 ? '100% 完成' : `文章 ${index}` }));
  }
  await h.service.saveDraft('another-owner', freshDraft({ title: '100% foreign' }));
  h.sqlite.prepare('UPDATE drafts SET deleted_at=? WHERE title=?').run('2026-10-01', '文章 3');
  const first = await h.service.listDrafts(owner, { limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.drafts.length, 1);
  assert.equal(first.has_more, true);
  const exact = await h.service.listDrafts(owner, { query: '%' });
  assert.equal(exact.total, 1);
  assert.equal(exact.drafts[0].title, '100% 完成');
  await assert.rejects(h.service.listDrafts(owner, { limit: 101 }), (error: unknown) => error instanceof ApiError && error.status === 400);
});

void test('reading published content is read-only; explicit import preserves metadata and reuses a matching draft', async (t) => {
  const calls: string[] = [];
  const h = setup(t, async (path, method = 'GET') => {
    assert.equal(method, 'GET');
    calls.push(path);
    return article();
  });
  const read = await h.service.getArticle(owner, articlePath);
  assert.equal(read.title, '云端文章');
  assert.match(read.metadata, /custom: preserved/);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM drafts').get()?.count, 0);
  const imported = await h.service.importArticle(owner, articlePath);
  const repeated = await h.service.importArticle(owner, articlePath);
  assert.equal(imported.id, repeated.id);
  assert.equal(imported.base_sha, 'article-blob');
  assert.equal(imported.metadata, read.metadata);
  assert.equal(imported.source_path, articlePath);
  await assert.rejects(h.service.getArticle(owner, '../private.md'), (error: unknown) => error instanceof ApiError && error.status === 400);
  assert.equal(calls.length, 3);
});

void test('concurrent imports share one active draft and a trashed draft allows a fresh import', async (t) => {
  const h = setup(t, async () => article());
  const [first, second] = await Promise.all([
    h.service.importArticle(owner, articlePath),
    h.service.importArticle(owner, articlePath),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM drafts').get()?.count, 1);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM draft_versions').get()?.count, 1);
  h.sqlite.prepare('UPDATE drafts SET deleted_at=? WHERE id=?').run('2026-10-02', first.id);
  const replacement = await h.service.importArticle(owner, articlePath);
  assert.notEqual(replacement.id, first.id);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM drafts WHERE deleted_at IS NULL').get()?.count, 1);
});

void test('MCP can refresh and search metadata without opening the website, reusing unchanged blob indexes', async (t) => {
  let blobReads = 0;
  let sha = 'a'.repeat(40);
  const h = setup(t, async (path, method = 'GET') => {
    assert.equal(method, 'GET');
    if (path.includes('/git/trees/')) return { tree: [
      { type: 'blob', path: articlePath, sha },
      { type: 'blob', path: 'docs/index.md', sha: 'b'.repeat(40) },
    ] };
    if (path.includes('/git/blobs/')) { blobReads++; return article(source, sha); }
    throw new Error(`Unexpected path ${path}`);
  });
  const before = await h.service.searchArticles(owner, { query: '云端' });
  assert.equal(before.total, 0);
  assert.equal(before.index_complete, false);
  assert.equal(before.unindexed_count, 1);
  const refreshed = await h.service.refreshArticleIndex(owner);
  assert.deepEqual(refreshed, { indexed: 1, remaining: 0, complete: true, errors: [] });
  const after = await h.service.searchArticles(owner, { query: 'MCP', collection: 'D-Orginals', limit: 1 });
  assert.equal(after.total, 1);
  assert.equal(after.articles[0].title, '云端文章');
  assert.equal(after.index_complete, true);
  assert.equal(after.has_more, false);
  assert.equal((await h.service.refreshArticleIndex(owner)).indexed, 0);
  assert.equal(blobReads, 1);
  sha = 'c'.repeat(40);
  assert.equal((await h.service.searchArticles(owner)).index_complete, false);
  assert.equal((await h.service.refreshArticleIndex(owner)).indexed, 1);
  assert.equal(blobReads, 2);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM drafts').get()?.count, 0);
});

void test('an acknowledged Git write survives failed database confirmation and retries never submit twice', async (t) => {
  let markdown = '';
  let path = '';
  let submitted = false;
  let writes = 0;
  const call: GitCall = async (url, method, input) => {
    const value = input as { tree: { content: string; path: string }[]; force: boolean };
    if (url.includes('/compare/')) return { status: 'identical' };
    if (url.includes('/actions/')) return { workflow_runs: [] };
    if (url.includes('/contents/')) {
      if (!submitted) throw new ApiError(404, 'Missing');
      return article(markdown, 'published-blob');
    }
    if (url.endsWith('/git/ref/heads/main')) return { object: { sha: 'parent-commit' } };
    if (url.endsWith('/git/commits/parent-commit')) return { tree: { sha: 'parent-tree' } };
    if (url.endsWith('/git/trees') && method === 'POST') {
      markdown = value.tree[0].content;
      path = value.tree[0].path;
      return { sha: 'new-tree', tree: [{ path, sha: 'published-blob' }] };
    }
    if (url.endsWith('/git/commits') && method === 'POST') return { sha: 'published-commit' };
    if (url.endsWith('/git/refs/heads/main') && method === 'PATCH') {
      const stored = h.sqlite.prepare('SELECT state,commit_sha FROM publications').get();
      assert.equal(stored?.state, 'verifying');
      assert.equal(stored?.commit_sha, 'published-commit');
      assert.equal(value.force, false);
      writes++;
      submitted = true;
      h.db.failNextBatch = true;
      return {};
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url}`);
  };
  const h = setup(t, call);
  await h.service.saveDraft(owner, freshDraft());
  const first = await h.service.publish(owner, { id: draftId, revision: 1 });
  assert.equal(first.state, 'verifying');
  assert.equal(first.commit_sha, 'published-commit');
  assert.doesNotMatch(first.error || '', /Synthetic|connection detail/);
  const retry = await h.service.publish(owner, { id: draftId, revision: 1 });
  assert.equal(retry.id, first.id);
  assert.equal(writes, 1);
  const recovered = await h.service.getPublication(owner, first.id);
  assert.equal(recovered.state, 'submitted');
  const draft = await h.service.getDraft(owner, draftId);
  assert.equal(draft.base_sha, 'published-blob');
  assert.equal(draft.source_path, path);
  assert.ok(draft.first_published_at);
  assert.equal(writes, 1);
});

void test('a first publication claim rejects a draft moved after the initial read', async (t) => {
  const h = setup(t);
  await h.service.saveDraft(owner, freshDraft());
  const reading = deferred();
  const release = deferred();
  h.hooks.beforeAccount = async () => { reading.resolve(); await release.promise; };
  const publishing = h.service.publish(owner, { id: draftId, revision: 1 });
  const rejected = assert.rejects(publishing, (error: unknown) => error instanceof ApiError && error.status === 409);
  await reading.promise;
  await h.service.saveDraft(owner, freshDraft({ collection: 'B-Notes', revision: 1 }));
  release.resolve();
  await rejected;
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM publications').get()?.count, 0);
  assert.equal((await h.service.getDraft(owner, draftId)).collection, 'B-Notes');
});

void test('a publication inserted during a collection edit prevents the stale SQL update', async (t) => {
  const h = setup(t);
  await h.service.saveDraft(owner, freshDraft());
  const updating = deferred();
  const release = deferred();
  h.hooks.beforeBatch = async () => { updating.resolve(); await release.promise; };
  const saving = h.service.saveDraft(owner, freshDraft({ collection: 'B-Notes', revision: 1 }));
  const rejected = assert.rejects(saving, (error: unknown) => error instanceof ApiError && error.status === 409);
  await updating.promise;
  h.sqlite.prepare('INSERT INTO publications(id,owner,draft_id,revision,state,target_path,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('first-publication', owner, draftId, 1, 'preparing', articlePath, new Date().toISOString());
  release.resolve();
  await rejected;
  delete h.hooks.beforeBatch;
  assert.equal((await h.service.getDraft(owner, draftId)).collection, 'D-Orginals');
  await assert.rejects(h.service.saveDraft(owner, freshDraft({ collection: 'B-Notes', revision: 1 })), (error: unknown) => error instanceof ApiError && error.status === 409);
  const edited = await h.service.saveDraft(owner, freshDraft({ body: '继续编辑原栏目', revision: 1 }));
  assert.equal(edited.revision, 2);
});

void test('a slow publication poll cannot regress a concurrent live confirmation', async (t) => {
  const h = setup(t, async () => ({ workflow_runs: [{ status: 'in_progress' }] }));
  const id = 'publication-status-race';
  h.sqlite.prepare('INSERT INTO publications(id,owner,draft_id,revision,state,commit_sha,url,target_path,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, owner, draftId, 1, 'submitted', 'published-commit', 'https://blog.test/article/', articlePath, new Date().toISOString());
  const reading = deferred();
  const release = deferred();
  let requests = 0;
  h.hooks.request = async () => {
    if (++requests === 1) {
      reading.resolve();
      await release.promise;
      return new Response('', { status: 404 });
    }
    return new Response(`<!-- publisher-release:${id} -->`);
  };
  const slow = h.service.getPublication(owner, id);
  await reading.promise;
  assert.equal((await h.service.getPublication(owner, id)).state, 'live');
  release.resolve();
  assert.equal((await slow).state, 'live');
  assert.equal(h.sqlite.prepare('SELECT state FROM publications WHERE id=?').get(id)?.state, 'live');
});
