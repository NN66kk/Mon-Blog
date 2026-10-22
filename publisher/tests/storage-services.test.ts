import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { createArticleIndex } from '../lib/article-index';
import { createDraftStore } from '../lib/draft-store';
import * as github from '../lib/github';
import * as content from '../lib/content';
import * as management from '../lib/management';
import * as templates from '../lib/article-templates';
import * as backupRestore from '../lib/backup-restore';

const owner = 'storage-owner';
const path = 'docs/B-Notes/260922120000.md';
const draftId = '11111111-1111-4111-8111-111111111111';
const sha = 'a'.repeat(40);
const markdown =
  '---\ntitle: 缓存文章\ntags: [索引, 测试]\ndescription: 简介\n---\n正文';
const blob = (source = markdown) => ({
  encoding: 'base64',
  content: Buffer.from(source).toString('base64'),
  size: Buffer.byteLength(source),
});

function setup(
  t: TestContext,
  call: github.GitCall = async () => {
    throw new Error('Unexpected GitHub request');
  },
) {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(`${migrations}/${file}`, 'utf8'));
  t.after(() => sqlite.close());
  const db = {
    prepare(sql: string) {
      let bindings: SQLInputValue[] = [];
      const statement = {
        bind(...values: SQLInputValue[]) {
          bindings = values;
          return statement;
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
          return statement.execute();
        },
      };
      return statement;
    },
    async batch(statements: { execute(): unknown }[]) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (failure) {
        sqlite.exec('ROLLBACK');
        throw failure;
      }
    },
  };
  const accounts: string[] = [];
  const typedDb = db as unknown as D1Database;
  const getAccount = async (requestedOwner: string) => {
    accounts.push(requestedOwner);
    return call;
  };
  const index = createArticleIndex({ db: typedDb, getAccount });
  const drafts = createDraftStore(typedDb);
  // Execute the real management adapter while replacing only its Worker
  // bindings. The shared business services and SQL run unmodified.
  const modules: Record<string, unknown> = {
    './article-index': { createArticleIndex },
    './draft-store': { createDraftStore },
    './github': github,
    './content': content,
    './management': management,
    './article-templates': templates,
    './backup-restore': backupRestore,
    './server': {
      database: () => typedDb,
      account: getAccount,
      files: () => {
        throw new Error('Unexpected R2 access');
      },
      ownedDraft: drafts.ownedDraft,
      jsonBody: (request: Request) => request.json(),
      response: (value: unknown, status = 200) =>
        Response.json(value, { status }),
    },
  };
  const source = transpileModule(
    readFileSync(
      new URL('../lib/management-server.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const module = { exports: {} as any };
  new Function('require', 'exports', 'module', source)(
    (name: string) => {
      if (!Object.hasOwn(modules, name))
        throw new Error(`Unmocked binding ${name}`);
      return modules[name];
    },
    module.exports,
    module,
  );
  const request = async (
    route: string,
    input?: unknown,
    requestedOwner = owner,
  ) => {
    const response = (await module.exports.managementRequest(
      route,
      new Request(`https://writer.test/api/${route}`, {
        method: input === undefined ? 'GET' : 'POST',
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      }),
      requestedOwner,
    )) as Response;
    return (await response.json()) as any;
  };
  function insertDraft(
    id = draftId,
    requestedOwner = owner,
    sourcePath: string | null = null,
  ) {
    sqlite
      .prepare(
        'INSERT INTO drafts (id,owner,title,collection,body,metadata,source_path,revision,updated_at) VALUES (?,?,?,?,?,?,?,1,?)',
      )
      .run(
        id,
        requestedOwner,
        '草稿标题',
        'B-Notes',
        '原始正文',
        'custom: keep',
        sourcePath,
        '2026-10-01T00:00:00Z',
      );
  }
  return {
    sqlite,
    db,
    index,
    drafts,
    accounts,
    request,
    insertDraft,
    management: module.exports,
  };
}

test('web and shared catalog retain cached fields, stale flags, managed paths and owned draft links', async (t) => {
  let treeSha = sha;
  let reads = 0;
  const h = setup(t, async (url, method = 'GET') => {
    assert.equal(method, 'GET');
    if (url.includes('/git/trees/'))
      return {
        tree: [
          { type: 'blob', path, sha: treeSha },
          {
            type: 'blob',
            path: 'docs/D-Orginals/260922120001.md',
            sha: 'b'.repeat(40),
          },
          { type: 'blob', path: 'docs/index.md', sha },
          { type: 'tree', path: 'docs/B-Notes/folder.md', sha },
        ],
      };
    reads++;
    return blob();
  });
  await h.index.details(owner, [{ path, sha }]);
  h.insertDraft(draftId, owner, path);
  h.insertDraft('22222222-2222-4222-8222-222222222222', 'another-owner', path);
  const web = await h.request('articles');
  assert.equal(web.articles.length, 2);
  const article = web.articles.find((item: any) => item.path === path);
  assert.equal(article.draft_id, draftId);
  assert.equal(article.indexed, true);
  assert.deepEqual(article.tags, ['索引', '测试']);
  assert.equal(article.description, '简介');
  assert.ok(Number.isFinite(Date.parse(web.synced_at)));
  assert.equal(reads, 1, 'catalog listing must not read article blobs');
  treeSha = 'c'.repeat(40);
  const stale = await h.index.list(owner, 'B-Notes');
  assert.equal(stale.length, 1);
  assert.equal(stale[0].title, '缓存文章');
  assert.equal(stale[0].indexed, false);
  const foreign = await h.index.list('another-owner', 'B-Notes');
  assert.equal(foreign[0].indexed, false);
  assert.notEqual(foreign[0].title, '缓存文章');
});

test('web article-details preserves fresh and cached response contracts without refetching unchanged blobs', async (t) => {
  let reads = 0;
  const h = setup(t, async (url, method = 'GET') => {
    assert.equal(method, 'GET');
    assert.match(url, /\/git\/blobs\//);
    reads++;
    return blob();
  });
  const first = (
    await h.request('article-details', { articles: [{ path, sha }] })
  ).articles[0];
  assert.deepEqual(
    Object.keys(first).sort(),
    [
      'collection',
      'description',
      'indexed',
      'path',
      'published_at',
      'sha',
      'tags',
      'title',
      'updated_at',
      'url',
    ].sort(),
  );
  const cached = (
    await h.request('article-details', { articles: [{ path, sha }] })
  ).articles[0];
  assert.equal(cached.owner, owner);
  assert.equal(cached.sha, sha);
  assert.deepEqual(cached.tags, first.tags);
  assert.equal(cached.url, first.url);
  assert.equal(cached.indexed, true);
  assert.ok(cached.id && cached.synced_at);
  assert.equal(reads, 1);
  await h.index.details('another-owner', [{ path, sha }]);
  assert.equal(reads, 2, 'a foreign cache is never reused');
  await assert.rejects(
    h.request('article-details', {
      articles: [{ path: '../private.md', sha }],
    }),
    (error: unknown) =>
      error instanceof github.ApiError &&
      error.status === 400 &&
      error.message === '文章同步参数无效。',
  );
});

test('both index entry points cap blob work at four, preserve request order and reuse owner-specific caches', async (t) => {
  const references = Array.from({ length: 9 }, (_, index) => ({
    path: `docs/B-Notes/article-${index}.md`,
    sha: String(index).repeat(40),
  }));
  let active = 0;
  let peak = 0;
  let reads = 0;
  const h = setup(t, async (url, method = 'GET') => {
    assert.equal(method, 'GET');
    if (url.includes('/git/trees/'))
      return {
        tree: references.map((reference) => ({ ...reference, type: 'blob' })),
      };
    active++;
    peak = Math.max(peak, active);
    reads++;
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return blob();
  });
  const details = await h.index.details(owner, references);
  assert.deepEqual(
    details.map((article) => article.path),
    references.map((article) => article.path),
  );
  assert.equal(peak, 4);
  assert.equal(reads, 9);
  assert.deepEqual(await h.index.refresh(owner), {
    indexed: 0,
    remaining: 0,
    complete: true,
    errors: [],
  });
  assert.equal(reads, 9);
  peak = 0;
  assert.deepEqual(await h.index.refresh('another-owner'), {
    indexed: 9,
    remaining: 0,
    complete: true,
    errors: [],
  });
  assert.equal(peak, 4);
  assert.equal(reads, 18);
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM article_cache').get()
      ?.count,
    18,
  );
});

test('known indexing failures keep their web/MCP messages and successful siblings, including legacy empty blobs', async (t) => {
  const references = ['good', 'yaml', 'large', 'empty', 'missing'].map(
    (kind, index) => ({
      path: `docs/B-Notes/${kind}.md`,
      sha: String(index).repeat(40),
    }),
  );
  const responses = [
    blob(),
    blob('---\ntitle: [\n---\n正文'),
    { ...blob(), size: 1000001 },
    blob(''),
    { encoding: 'base64', size: 10 },
  ];
  const h = setup(t, async (url) =>
    url.includes('/git/trees/')
      ? {
          tree: references.map((reference) => ({ ...reference, type: 'blob' })),
        }
      : responses[Number(url.split('/').pop()![0])],
  );
  const result = (await h.request('article-details', { articles: references }))
    .articles;
  assert.equal(result[0].indexed, true);
  assert.equal(result[1].index_error, '文章信息格式有误，可在 GitHub 修正。');
  assert.equal(result[2].index_error, '文章过大，暂未索引。');
  assert.equal(
    result[3].indexed,
    true,
    'web historically accepts a valid empty blob',
  );
  assert.equal(result[4].index_error, '文章信息格式有误，可在 GitHub 修正。');
  const refreshed = await h.index.refresh('mcp-owner');
  assert.equal(refreshed.indexed, 1);
  assert.equal(refreshed.remaining, 4);
  assert.equal(refreshed.complete, false);
  assert.equal(
    refreshed.errors.find((error) => error.path.endsWith('/yaml.md'))?.error,
    '文章信息中的 YAML 格式有误，暂未索引。',
  );
  for (const kind of ['large', 'empty', 'missing'])
    assert.equal(
      refreshed.errors.find((error) => error.path.endsWith(`/${kind}.md`))
        ?.error,
      '文章过大或格式无效，暂未索引。',
    );
  assert.equal(
    h.sqlite
      .prepare('SELECT count(*) AS count FROM article_cache WHERE owner=?')
      .get(owner)?.count,
    2,
  );
  assert.equal(
    h.sqlite
      .prepare('SELECT count(*) AS count FROM article_cache WHERE owner=?')
      .get('mcp-owner')?.count,
    1,
  );
});

test('truncated trees, transport errors and invalid limits still reject without indexing writes', async (t) => {
  let truncated = true;
  const h = setup(t, async () => {
    if (truncated) return { truncated: true, tree: [] };
    throw new github.ApiError(429, '请求过于频繁');
  });
  await assert.rejects(
    h.request('articles'),
    (error: unknown) =>
      error instanceof github.ApiError && error.status === 502,
  );
  await assert.rejects(
    h.index.refresh(owner),
    (error: unknown) =>
      error instanceof github.ApiError && error.status === 502,
  );
  const accounts = h.accounts.length;
  await assert.rejects(h.index.refresh(owner, { limit: 13 }), /1 至 12/);
  await assert.rejects(
    h.index.details(owner, Array(13).fill({ path, sha })),
    /文章同步参数无效/,
  );
  assert.equal(
    h.accounts.length,
    accounts,
    'invalid input is rejected before obtaining a GitHub client',
  );
  truncated = false;
  await assert.rejects(
    h.index.details(owner, [{ path, sha }]),
    (error: unknown) =>
      error instanceof github.ApiError && error.status === 429,
  );
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM article_cache').get()
      ?.count,
    0,
  );
});

test('shared snapshots and actual history routes preserve ownership, revisions and deleted-draft behavior', async (t) => {
  const h = setup(t);
  h.insertDraft();
  await h.management.snapshotDraft(owner, draftId).run();
  await h.drafts.snapshotDraft(owner, draftId).run();
  await h.drafts.snapshotDraft('another-owner', draftId).run();
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM draft_versions').get()
      ?.count,
    1,
  );
  await h.db.batch([
    h.drafts.snapshotDraft(owner, draftId) as any,
    h.db
      .prepare('UPDATE drafts SET body=?,revision=revision+1 WHERE id=?')
      .bind('第二版正文', draftId),
    h.drafts.snapshotDraft(owner, draftId) as any,
  ]);
  const history = await h.request(`drafts/${draftId}/history`);
  assert.deepEqual(
    history.versions.map((version: any) => version.revision),
    [2, 1],
  );
  await assert.rejects(
    h.request(`drafts/${draftId}/history`, undefined, 'another-owner'),
    (error: unknown) =>
      error instanceof github.ApiError && error.status === 404,
  );
  const restored = await h.request('restore-version', {
    id: draftId,
    version: 1,
    revision: 2,
  });
  assert.equal(restored.body, '原始正文');
  assert.equal(restored.revision, 3);
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM draft_versions').get()
      ?.count,
    3,
  );
  await assert.rejects(
    h.request('restore-version', { id: draftId, version: 2, revision: 2 }),
    (error: unknown) =>
      error instanceof github.ApiError && error.status === 409,
  );
  h.sqlite
    .prepare('UPDATE drafts SET deleted_at=? WHERE id=?')
    .run('2026-10-02', draftId);
  assert.equal(
    (await h.drafts.ownedDraft(owner, draftId)).deleted_at,
    '2026-10-02',
  );
  assert.equal(
    (await h.request(`drafts/${draftId}/history`)).versions.length,
    3,
  );
  await assert.rejects(
    h.request('restore-version', { id: draftId, version: 1, revision: 3 }),
    /请先从回收站恢复草稿/,
  );
  assert.equal(
    h.accounts.length,
    0,
    'private history never obtains GitHub credentials',
  );
});

test('shared filename assignment stays unique under concurrent saves and leaves imported paths untouched', async (t) => {
  const h = setup(t);
  h.insertDraft();
  const second = '22222222-2222-4222-8222-222222222222';
  const imported = '33333333-3333-4333-8333-333333333333';
  h.insertDraft(second);
  h.insertDraft(imported, owner, path);
  const [first, another] = await Promise.all([
    h.drafts.ensureDraftFilename(owner, draftId),
    h.drafts.ensureDraftFilename(owner, second),
  ]);
  assert.match(first.filename!, /^\d{12}\.md$/);
  assert.notEqual(first.filename, another.filename);
  h.sqlite
    .prepare('UPDATE drafts SET title=?,metadata=? WHERE id=?')
    .run('改名', 'date: 2001-01-01', draftId);
  assert.equal(
    (await h.drafts.ensureDraftFilename(owner, draftId)).filename,
    first.filename,
  );
  const existing = await h.drafts.ensureDraftFilename(owner, imported);
  assert.equal(existing.source_path, path);
  assert.equal(existing.filename, null);
  await assert.rejects(
    h.drafts.ensureDraftFilename('another-owner', draftId),
    (error: unknown) =>
      error instanceof github.ApiError && error.status === 404,
  );
  assert.equal(h.accounts.length, 0);
});
