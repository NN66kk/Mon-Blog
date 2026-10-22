import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { draftBackup, MAX_BACKUP_BYTES, zipStored } from '../lib/backup';
import {
  createBackupRestoreService,
  previewBackup,
  readBackupRequest,
  readStoredZip,
} from '../lib/backup-restore';
import { ApiError } from '../lib/github';

const owner = 'fresh/account';
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const imageName = '33333333-3333-4333-8333-333333333333.png';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const drafts = [
  {
    id: firstId,
    title: '恢复文章',
    collection: 'B-Notes',
    body: `# 原文\n\n![私图](/api/media/${imageName})\n![旧图](../assets/old.png)\n`,
    metadata: 'tags: [恢复, 笔记]\ncustom: keep\n',
    source_path: 'docs/B-Notes/old.md',
  },
  {
    id: secondId,
    title: '原回收站',
    collection: 'D-Orginals',
    body: `![共享图](/api/media/${imageName})\n原始正文`,
    metadata: 'invalid: [\n',
    deleted_at: '2026-10-01T00:00:00.000Z',
  },
];

async function archive() {
  return new Uint8Array(
    await (
      await draftBackup(drafts, async () => new Response(png))
    ).arrayBuffer(),
  );
}
async function changedArchive(
  bytes: Uint8Array,
  change: (entries: Map<string, Uint8Array>) => void,
) {
  const entries = readStoredZip(bytes);
  change(entries);
  return new Uint8Array(
    await zipStored(
      [...entries].map(([path, data]) => ({ path, data })),
    ).arrayBuffer(),
  );
}
function setup(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(`${migrations}/${file}`, 'utf8'));
  t.after(() => sqlite.close());
  const objects = new Map<string, Uint8Array>([
    ['someone-else/existing.png', png],
  ]);
  const hooks = { failBatch: false, failStorage: false, writes: 0 };
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
        execute() {
          return {
            meta: { changes: sqlite.prepare(sql).run(...bindings).changes },
          };
        },
      };
      return statement;
    },
    async batch(statements: { execute(): unknown }[]) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((statement, index) => {
          if (hooks.failBatch && index === 1)
            throw new Error('Simulated partial database failure');
          return statement.execute();
        });
        sqlite.exec('COMMIT');
        return result;
      } catch (failure) {
        sqlite.exec('ROLLBACK');
        throw failure;
      }
    },
  };
  const storage = {
    async put(key: string, data: Uint8Array) {
      if (hooks.failStorage) throw new Error('Simulated object upload failure');
      hooks.writes++;
      objects.set(key, data.slice());
      return {};
    },
  };
  const restore = createBackupRestoreService({
    db: db as unknown as D1Database,
    storage: storage as unknown as R2Bucket,
  });
  return { sqlite, objects, restore, hooks };
}

test('export → preview → fresh database/R2 restore preserves content and shared images as new private drafts', async (t) => {
  const h = setup(t);
  const bytes = await archive();
  const preview = await previewBackup(bytes);
  assert.equal(preview.drafts.length, 2);
  assert.equal(preview.image_count, 1);
  assert.equal(preview.trashed_count, 1);
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM drafts').get()?.count,
    0,
    'preview writes nothing',
  );
  assert.equal(h.objects.size, 1);
  const result = await h.restore(owner, bytes, preview);
  assert.equal(result.repeated, false);
  assert.equal(result.drafts.length, 2);
  const saved = h.sqlite
    .prepare('SELECT * FROM drafts WHERE owner=? ORDER BY title')
    .all(owner);
  assert.equal(saved.length, 2);
  const restored = saved.find((row) => row.title === drafts[0].title)!;
  const image = String(restored.body).match(
    /\/api\/media\/([a-f0-9-]+\.png)/,
  )![1];
  assert.notEqual(image, imageName);
  assert.deepEqual(h.objects.get(`${encodeURIComponent(owner)}/${image}`), png);
  assert.match(
    String(restored.body),
    /https:\/\/raw\.githubusercontent\.com\/NN66kk\/Mon-Blog\/main\/docs\/assets\/old.png/,
  );
  assert.equal(restored.metadata, drafts[0].metadata);
  for (const row of saved) {
    assert.notEqual(row.id, firstId);
    assert.notEqual(row.id, secondId);
    assert.equal(row.owner, owner);
    assert.equal(row.source_path, null);
    assert.equal(row.base_sha, null);
    assert.equal(row.deleted_at, null);
    assert.equal(row.revision, 1);
    assert.match(String(row.body), new RegExp(image.replace('.', '\\.')));
  }
  const trashed = saved.find((row) => row.title === drafts[1].title)!;
  assert.equal(
    trashed.metadata,
    drafts[1].metadata,
    'even invalid YAML is recoverable without rewriting',
  );
  assert.equal(trashed.body, drafts[1].body.replaceAll(imageName, image));
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM draft_versions').get()
      ?.count,
    2,
  );
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM publications').get()?.count,
    0,
  );
  assert.deepEqual(h.objects.get('someone-else/existing.png'), png);
});

test('retry is idempotent and leaves later edits untouched; another account gets different private copies', async (t) => {
  const h = setup(t);
  const bytes = await archive();
  const preview = await previewBackup(bytes);
  const [first, concurrent] = await Promise.all([
    h.restore(owner, bytes, preview),
    h.restore(owner, bytes, preview),
  ]);
  assert.deepEqual(first.drafts, concurrent.drafts);
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM drafts').get()?.count,
    2,
  );
  const writesBeforeRetry = h.hooks.writes;
  h.sqlite
    .prepare('UPDATE drafts SET body=? WHERE id=?')
    .run('后来编辑的内容', first.drafts[0].id);
  const second = await h.restore(owner, bytes, preview);
  assert.equal(second.repeated, true);
  assert.deepEqual(second.drafts, first.drafts);
  assert.equal(h.hooks.writes, writesBeforeRetry);
  assert.equal(
    h.sqlite
      .prepare('SELECT body FROM drafts WHERE id=?')
      .get(first.drafts[0].id)?.body,
    '后来编辑的内容',
  );
  const foreign = await h.restore('another-owner', bytes, preview);
  assert.notEqual(foreign.drafts[0].id, first.drafts[0].id);
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM drafts').get()?.count,
    4,
  );
  assert.equal(h.objects.size, 3);
});

test('database failure rolls back every draft; retained private uploads are reused on retry', async (t) => {
  const h = setup(t);
  const bytes = await archive();
  const preview = await previewBackup(bytes);
  h.hooks.failBatch = true;
  await assert.rejects(
    h.restore(owner, bytes, preview),
    (error: unknown) => error instanceof ApiError && error.status === 503,
  );
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM drafts').get()?.count,
    0,
  );
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM draft_versions').get()
      ?.count,
    0,
  );
  const keys = [...h.objects.keys()];
  assert.equal(keys.length, 2);
  h.hooks.failBatch = false;
  await h.restore(owner, bytes, preview);
  assert.deepEqual([...h.objects.keys()], keys);
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM drafts').get()?.count,
    2,
  );
});

test('failed uploads, absent confirmation and changed preview never create drafts', async (t) => {
  const h = setup(t);
  const bytes = await archive();
  const preview = await previewBackup(bytes);
  await assert.rejects(
    h.restore(owner, bytes, { ...preview, restore_id: '' }),
    /先预览/,
  );
  await assert.rejects(
    h.restore(owner, bytes, { ...preview, sha256: 'a'.repeat(64) }),
    /不一致/,
  );
  assert.equal(h.hooks.writes, 0);
  h.hooks.failStorage = true;
  await assert.rejects(h.restore(owner, bytes, preview), /upload failure/);
  assert.equal(
    h.sqlite.prepare('SELECT count(*) AS count FROM drafts').get()?.count,
    0,
  );
});

test('rejects truncated/corrupted/compressed archives, traversal and duplicate paths', async () => {
  const bytes = await archive();
  assert.throws(
    () => readStoredZip(bytes.subarray(0, bytes.length - 1)),
    ApiError,
  );
  const corrupt = bytes.slice();
  corrupt[30 + `assets/${imageName}`.length + 11] ^= 1;
  assert.throws(() => readStoredZip(corrupt), /校验失败/);
  const compressed = bytes.slice();
  new DataView(compressed.buffer).setUint16(8, 8, true);
  assert.throws(() => readStoredZip(compressed), ApiError);
  const rename = (original: Uint8Array, from: string, to: string) => {
    assert.equal(from.length, to.length);
    const result = Buffer.from(original);
    let offset = 0;
    while ((offset = result.indexOf(from, offset)) !== -1) {
      result.set(Buffer.from(to), offset);
      offset += to.length;
    }
    return result;
  };
  assert.throws(
    () => readStoredZip(rename(bytes, 'drafts/', '../xxx/')),
    /路径/,
  );
  const duplicate = rename(
    bytes,
    `trash/${secondId}.md`,
    `trash/${firstId}.md`,
  );
  // A same-length second image filename makes a genuine duplicate central/local entry.
  const duplicatedZip = new Uint8Array(
    await zipStored([
      { path: 'README.txt', data: png },
      { path: 'readme.txt', data: png },
    ]).arrayBuffer(),
  );
  assert.throws(
    () => readStoredZip(rename(duplicatedZip, 'readme.txt', 'README.txt')),
    /重复/,
  );
  await assert.rejects(previewBackup(duplicate), /清单|不一致/);
});

test('rejects incompatible manifests, duplicate drafts, missing images and inconsistent Markdown', async () => {
  const bytes = await archive();
  for (const mutate of [
    (data: any) => {
      data.version = 2;
    },
    (data: any) => {
      data.drafts.push(data.drafts[0]);
    },
    (data: any) => {
      data.drafts[0].collection = '../elsewhere';
    },
    (data: any) => {
      data.drafts[0].title = '清单被编辑';
    },
  ]) {
    const changed = await changedArchive(bytes, (entries) => {
      const data = JSON.parse(
        new TextDecoder().decode(entries.get('manifest.json')),
      );
      mutate(data);
      entries.set(
        'manifest.json',
        new TextEncoder().encode(JSON.stringify(data)),
      );
    });
    await assert.rejects(previewBackup(changed), ApiError);
  }
  await assert.rejects(
    previewBackup(
      await changedArchive(bytes, (entries) =>
        entries.delete(`assets/${imageName}`),
      ),
    ),
    /清单|图片/,
  );
  await assert.rejects(
    previewBackup(
      await changedArchive(bytes, (entries) =>
        entries.set(`assets/${imageName}`, new Uint8Array(12)),
      ),
    ),
    /图片格式/,
  );
});

test('enforces archive size both before upload reads and while reading chunked requests', async () => {
  await assert.rejects(
    readBackupRequest(
      new Request('https://example.test/api/backup/preview', {
        method: 'POST',
        headers: { 'content-length': String(MAX_BACKUP_BYTES + 1) },
      }),
    ),
    (error: unknown) => error instanceof ApiError && error.status === 413,
  );
  const bytes = await archive();
  assert.deepEqual(
    await readBackupRequest(
      new Request('https://example.test/api/backup/preview', {
        method: 'POST',
        body: bytes,
      }),
    ),
    bytes,
  );
  const huge = new Uint8Array(MAX_BACKUP_BYTES + 1);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(huge);
      controller.close();
    },
  });
  await assert.rejects(
    readBackupRequest(
      new Request('https://example.test/api/backup/preview', {
        method: 'POST',
        body: stream,
        duplex: 'half',
      } as RequestInit),
    ),
    /32 MB/,
  );
  await assert.rejects(draftBackup(Array(101).fill(drafts[0])), /100 篇/);
});

test('restores legacy v1 imports above ordinary editor limits without truncating title, body or metadata', async (t) => {
  const h = setup(t);
  const historical = {
    id: firstId,
    title: '旧稿标题'.repeat(101),
    collection: 'B-Notes',
    body: `# 历史长稿\n\n${'a'.repeat(310001)}\n结尾保留`,
    metadata: `custom: ${'b'.repeat(30001)}\n`,
    source_path: 'docs/B-Notes/historical.md',
  };
  const bytes = new Uint8Array(
    await (await draftBackup([historical])).arrayBuffer(),
  );
  const preview = await previewBackup(bytes);
  assert.equal(preview.drafts[0].title, historical.title);
  const restored = await h.restore(owner, bytes, preview);
  const saved = h.sqlite
    .prepare('SELECT title,body,metadata FROM drafts WHERE id=?')
    .get(restored.drafts[0].id);
  assert.equal(saved?.title, historical.title);
  assert.equal(saved?.body, historical.body);
  assert.equal(saved?.metadata, historical.metadata);
  const snapshot = h.sqlite
    .prepare('SELECT title,body,metadata FROM draft_versions WHERE draft_id=?')
    .get(restored.drafts[0].id);
  assert.deepEqual(snapshot, saved);
});

test('bounds restored text by combined UTF-8 bytes, including multi-byte titles and metadata', async () => {
  const maximum = 2 * 1024 * 1024;
  const title = '历史标题';
  const metadata = 'custom: 中文\n';
  const overhead = new TextEncoder().encode(title + metadata).byteLength;
  const body = 'a'.repeat(maximum - overhead);
  const record = { id: firstId, title, collection: 'B-Notes', metadata, body };
  const within = new Uint8Array(
    await (await draftBackup([record])).arrayBuffer(),
  );
  assert.equal(
    (await previewBackup(within)).drafts.length,
    1,
    'exactly 2 MiB is recoverable',
  );
  const beyond = new Uint8Array(
    await (await draftBackup([{ ...record, body: `${body}汉` }])).arrayBuffer(),
  );
  await assert.rejects(previewBackup(beyond), /2 MiB/);
});
