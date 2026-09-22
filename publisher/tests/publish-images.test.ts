import test from 'node:test';
import assert from 'node:assert/strict';
import { publishDraft } from '../lib/publish';
import { ApiError } from '../lib/github';

const id = '12345678-1234-1234-1234-123456789abc';
const path = 'docs/D-Orginals/260922190000.md';
const folder = `docs/assets/publisher/${id}`;
const names = Array.from({ length: 26 }, (_, index) =>
  `${String(index).padStart(8, '0')}-1234-1234-1234-123456789abc.png`,
);
const body = (images: string[]) => images.map(name => `![image](/api/media/${name})`).join('\n');
const draft = (images: string[]) => ({
  id, title: '图片增量发布', metadata: '', body: body(images),
  source_path: path, base_sha: 'previous-article',
});
function fakeGit(existing: string[], folderError?: ApiError) {
  const writes: { url: string; body: unknown }[] = [];
  const call = async (url: string, method = 'GET', input?: unknown) => {
    if (method !== 'GET') writes.push({ url, body: input });
    if (url.includes(`/contents/${folder}?`)) {
      if (folderError) throw folderError;
      return existing.map(name => ({ type: 'file', name, path: `${folder}/${name}`, sha: `old-${name}` }));
    }
    if (url.endsWith('/git/ref/heads/main')) return { object: { sha: 'head' } };
    if (url.includes('/contents/')) return { sha: 'previous-article' };
    if (url.endsWith('/git/commits/head')) return { tree: { sha: 'tree' } };
    if (url.endsWith('/git/blobs')) return { sha: 'uploaded-image' };
    if (url.endsWith('/git/trees')) return { sha: 'next-tree', tree: [{ path, sha: 'next-article' }] };
    if (url.endsWith('/git/commits')) return { sha: 'next-commit' };
    if (method === 'PATCH') return {};
    throw new Error(`Unexpected Git request: ${url}`);
  };
  return { call, writes };
}
const image = async () => ({ size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
const confirm = async () => {};

test('adding one image after twelve published images uploads only the new image', async () => {
  const git = fakeGit(names.slice(0, 12));
  const reads: string[] = [];
  await publishDraft(draft(names.slice(0, 13)), path, 'release', git.call, async name => {
    reads.push(name);
    assert.equal(name, names[12]);
    return image();
  }, confirm);
  assert.deepEqual(reads, [names[12]]);
  assert.equal(git.writes.filter(write => write.url.endsWith('/git/blobs')).length, 1);
  const tree = git.writes.find(write => write.url.endsWith('/git/trees'))!.body as {
    tree: { path: string; content?: string; sha?: string }[];
  };
  assert.equal(tree.tree.length, 14);
  assert.equal(tree.tree.find(entry => entry.path === `${folder}/${names[0]}`)?.sha, `old-${names[0]}`);
  assert.doesNotMatch(tree.tree[0].content!, /\/api\/media\//);
});

test('published images remain usable without their private R2 objects', async () => {
  const git = fakeGit(names);
  await publishDraft(draft(names), path, 'release', git.call, async () => {
    throw new Error('Existing images must not be downloaded again');
  }, confirm);
  assert.equal(git.writes.filter(write => write.url.endsWith('/git/blobs')).length, 0);
});

test('the limit still rejects thirteen new images before any Git writes', async () => {
  const git = fakeGit(names.slice(0, 12));
  await assert.rejects(
    publishDraft(draft(names.slice(0, 25)), path, 'release', git.call, image, confirm),
    /12 张新图片/,
  );
  assert.deepEqual(git.writes, []);
});

test('a missing published image folder allows uploads, but permission errors stop publishing', async () => {
  const missing = fakeGit([], new ApiError(404, 'missing folder'));
  await publishDraft(draft(names.slice(0, 1)), path, 'release', missing.call, image, confirm);
  assert.equal(missing.writes.filter(write => write.url.endsWith('/git/blobs')).length, 1);
  const denied = fakeGit([], new ApiError(403, 'denied'));
  await assert.rejects(
    publishDraft(draft(names.slice(0, 1)), path, 'release', denied.call, image, confirm),
    /denied/,
  );
  assert.deepEqual(denied.writes, []);
});
