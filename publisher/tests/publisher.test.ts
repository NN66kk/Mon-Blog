import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeMarkdown,
  splitMarkdown,
  relativeAsset,
  validPath,
  articleUrl,
  newArticlePath,
} from '../lib/content';
import { ApiError, commitArticle, github, removeArticle } from '../lib/github';
import {
  duplicateMetadata,
  managedPath,
  metadataForArticle,
  portableImages,
  restoredContent,
} from '../lib/management';
import { draftBackup, zipStored } from '../lib/backup';
import { createDraftTransition } from '../lib/draft-transition';
import { checkPublication, needsPublicationCheck } from '../lib/publication';
import { publishDraft } from '../lib/publish';
import {
  editorMetadata,
  exportMarkdown,
  previewImageUrl,
  updateMetadata,
  metadataFields,
  metadataProblem,
  normalizeYamlInput,
} from '../lib/editor-content';
import {
  articleNumber,
  BUILTIN_TEMPLATES,
  chinaDate,
  dateForInput,
  describeTemplate,
  materializeTemplate,
  standardArticle,
  syncHeading,
} from '../lib/article-templates';

test('blog template follows the latest article timestamp filenames and Shanghai front matter', () => {
  const moment = new Date('2026-08-14T10:50:45Z');
  const draft = standardArticle('D-Orginals', moment);
  assert.equal(articleNumber(moment), '260814185045');
  assert.equal(
    newArticlePath('D-Orginals', articleNumber(moment) + '.md'),
    'docs/D-Orginals/260814185045.md',
  );
  assert.equal(
    chinaDate(new Date('2026-12-31T20:10:09Z')),
    '2027-01-01T04:10:09+08:00',
  );
  assert.deepEqual(
    splitMarkdown(exportMarkdown({ ...draft, title: '真正标题' })).data,
    {
      title: '真正标题',
      date: '2026-08-14T18:50:45+08:00',
      tags: '原创文章',
      description: '',
    },
  );
  assert.equal(draft.body, '# \n\n');
  for (const filename of [
    '../../x.md',
    'title.md',
    'abc-123.md',
    '260814185045.md/extra',
  ])
    assert.throws(() => newArticlePath('D-Orginals', filename));
});

test('known Obsidian template is materialized without executing repository scripts', () => {
  const moment = new Date('2026-08-14T10:50:45Z');
  assert.deepEqual(
    materializeTemplate(
      BUILTIN_TEMPLATES.find((t) => t.name === 'yaml')!,
      'B-Notes',
      moment,
    ),
    standardArticle('B-Notes', moment),
  );
  const snippet = BUILTIN_TEMPLATES.find((t) => t.name === '社群')!;
  assert.equal(snippet.kind, 'snippet');
  assert.match(snippet.source, /终身学习与效率提升交流群/);
  const executable = describeTemplate(
    'template.md',
    '<%* fetch("https://example.com") %>',
  );
  assert.equal(executable.kind, 'unsupported');
  assert.throws(() => materializeTemplate(executable, 'D-Orginals'), /脚本/);
  const plain = describeTemplate(
    'plain.md',
    '---\ntitle: 原创模板\naliases: [参考]\n---\n# 正文',
  );
  assert.equal(materializeTemplate(plain, 'A-Life').title, '原创模板');
});

test('form edits preserve custom YAML fields, quoted titles and original date conventions', () => {
  const source =
    '# 保留备注\ncdate: "2023-08-12 18:29"\naliases: [笔记]\ntitle: 旧标题\n';
  const updated = updateMetadata(source, 'title', '冒号: "引号" # 标题');
  assert.equal(metadataFields(updated).title, '冒号: "引号" # 标题');
  assert.equal(metadataFields(updated).dateField, 'cdate');
  assert.equal(
    dateForInput(metadataFields(updated).date),
    '2023-08-12T18:29:00',
  );
  assert.equal(dateForInput('2026-08-14T10:50:45Z'), '2026-08-14T18:50:45');
  assert.match(updated, /保留备注/);
  assert.deepEqual(splitMarkdown(`---\n${updated}---\n正文`).data.aliases, [
    '笔记',
  ]);
  assert.equal(normalizeYamlInput('---\ntitle: 标题\n---'), 'title: 标题\n');
  assert.equal(metadataProblem('title: 标题'), '');
  assert.notEqual(metadataProblem('bad: ['), '');
  assert.notEqual(metadataProblem('title: 123'), '');
  assert.equal(
    syncHeading('# 旧标题\n\n正文', '旧标题', '新标题'),
    '# 新标题\n\n正文',
  );
  assert.equal(syncHeading('# \n\n', '', '新标题'), '# 新标题\n\n');
  assert.equal(
    syncHeading('# 手动独立标题\n\n正文', '旧标题', '新标题'),
    '# 手动独立标题\n\n正文',
  );
});

test('old metadata, wiki links and filename dates survive editing', () => {
  const parsed = splitMarkdown(
    '---\naliases: [one, two]\n# keep comment\ntitle: old\n---\n[[笔记|别名]]\n![[Pasted image.png]]\n',
  );
  const result = composeMarkdown(
    {
      ...parsed,
      title: '冒号: "标题"',
      source_path: 'docs/A-Life/两台手机互相开热点_20240411091923.md',
    },
    'abc',
  );
  assert.match(result, /keep comment/);
  assert.match(result, /\[\[笔记\|别名\]\]/);
  const data = splitMarkdown(result).data;
  assert.deepEqual(data.aliases, ['one', 'two']);
  assert.equal(data.title, '冒号: "标题"');
  assert.equal(data.published_at, undefined);
});
test('new article retains its first publication date on later edits', () => {
  const draft = {
    title: '文章',
    metadata: 'tags: "AI, Claude Code"\ndraft: true',
    body: '正文',
    first_published_at: '2026-09-01T10:00:00Z',
  };
  const first = splitMarkdown(
    composeMarkdown(draft, 'one', '2026-09-02T10:00:00Z'),
  );
  const second = splitMarkdown(
    composeMarkdown(
      { ...draft, source_path: 'docs/D-Orginals/id.md' },
      'two',
      '2026-09-03T10:00:00Z',
    ),
  );
  assert.equal(first.data.published_at, second.data.published_at);
  assert.equal(second.data.updated_at, '2026-09-03T10:00:00Z');
  assert.deepEqual(second.data.tags, ['AI', 'Claude Code']);
  assert.equal(second.data.draft, false);
});
test('rejects unsafe and excluded paths; resolves nested image and article URLs', () => {
  for (const path of [
    '.github/workflows/ci.yml',
    'docs/A-Life/../secret.md',
    'docs/A-Life/.env.md',
    'docs/A-Life/000000目录.md',
    'docs/B-Notes/003英语/总结.md',
  ])
    assert.equal(validPath(path), false, path);
  assert.equal(
    relativeAsset('docs/B-Notes/math/文章.md', 'docs/assets/publisher/x.png'),
    '../../assets/publisher/x.png',
  );
  assert.equal(
    articleUrl('docs/D-Orginals/中文.md'),
    'https://nn66kk.github.io/Mon-Blog/D-Orginals/%E4%B8%AD%E6%96%87/',
  );
});
test('invalid YAML cannot be published', () => {
  assert.throws(() =>
    composeMarkdown({ title: 'test', metadata: 'bad: [', body: 'test' }, 'abc'),
  );
});

test('non-object and invalid YAML remain exportable without breaking the metadata editor', () => {
  for (const metadata of [
    'hello',
    'null',
    '- one\n- two',
    'bad: [',
    'title: *missing',
  ]) {
    assert.throws(() => updateMetadata(metadata, 'tags', '测试'), /文章信息/);
    assert.deepEqual(editorMetadata(metadata), { tags: '', description: '' });
    assert.equal(
      exportMarkdown({ title: '恢复标题', metadata, body: '不能丢失的正文' }),
      `---\n${metadata}\n---\n不能丢失的正文`,
    );
  }
});

test('metadata editing preserves unknown fields and form controls always receive text', () => {
  const original =
    '# preserve\naliases: [one, two]\ntags: [中文, 2026]\ndescription: {unexpected: object}';
  const updated = updateMetadata(original, 'tags', '博客，验收');
  assert.match(updated, /# preserve/);
  assert.deepEqual(splitMarkdown(`---\n${updated}---\nbody`).data.aliases, [
    'one',
    'two',
  ]);
  assert.deepEqual(editorMetadata(original), {
    tags: '中文，2026',
    description: '',
  });
  assert.deepEqual(
    editorMetadata('tags: {unexpected: object}\ndescription: 123'),
    { tags: '', description: '123' },
  );
});

test('malformed preview image URLs cannot crash the editor; private and nested image paths still resolve', () => {
  const path = 'docs/B-Notes/math/post.md';
  for (const source of [
    '//',
    'http:',
    'http://[bad]',
    '',
    'javascript:alert(1)',
    'data:text/html,test',
  ]) {
    assert.equal(previewImageUrl(source, path), null, source);
  }
  const privateImage = '/api/media/12345678-1234-1234-1234-123456789abc.png';
  assert.equal(previewImageUrl(privateImage, path), privateImage);
  assert.equal(
    previewImageUrl('../../assets/image.png', path),
    'https://raw.githubusercontent.com/NN66kk/Mon-Blog/main/docs/assets/image.png',
  );
});
function fakeGit(current: string | null, failPatch = false) {
  const calls: any[] = [];
  const call = async (path: string, method = 'GET', body?: any) => {
    calls.push({ path, method, body });
    if (path.endsWith('/git/ref/heads/main'))
      return { object: { sha: 'base-commit' } };
    if (path.includes('/contents/')) {
      if (!current) throw new ApiError(404, 'missing');
      return { sha: current };
    }
    if (path.endsWith('/git/commits/base-commit'))
      return { tree: { sha: 'base-tree' } };
    if (path.endsWith('/git/blobs')) return { sha: 'image-blob' };
    if (path.endsWith('/git/trees'))
      return {
        sha: 'next-tree',
        tree: [{ path: 'docs/D-Orginals/post.md', sha: 'post-blob' }],
      };
    if (path.endsWith('/git/commits')) return { sha: 'new-commit' };
    if (method === 'PATCH') {
      if (failPatch) throw new ApiError(422, 'conflict');
      return {};
    }
    throw new Error(path);
  };
  return { call, calls };
}
const input = {
  path: 'docs/D-Orginals/post.md',
  baseSha: null,
  markdown: '# hello',
  title: '文章',
  release: 'release',
  assets: [
    {
      path: 'docs/assets/publisher/12345678-1234-1234-1234-123456789abc/12345678-1234-1234-1234-123456789abc.png',
      base64: 'aGVsbG8=',
    },
  ],
};
test('publishes content and image atomically without replacing unrelated tree entries', async () => {
  const { call, calls } = fakeGit(null);
  let persisted = '';
  await commitArticle(call, input, async (sha) => {
    persisted = sha;
  });
  const tree = calls.find((c) => c.path.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree, 'base-tree');
  assert.equal(tree.tree.length, 2);
  assert.deepEqual(
    calls.find((c) => c.path.endsWith('/git/commits')).body.parents,
    ['base-commit'],
  );
  assert.deepEqual(calls.at(-1).body, { sha: 'new-commit', force: false });
  assert.equal(persisted, 'new-commit');
  assert.match(
    calls.find((c) => c.path.includes('/contents/')).path,
    /ref=base-commit/,
  );
});
test('existing and externally changed articles fail before creating commits', async () => {
  for (const baseSha of [null, 'old-blob']) {
    const { call, calls } = fakeGit('new-blob');
    await assert.rejects(
      commitArticle(call, { ...input, baseSha }, async () => {}),
      (e: any) => e.status === 409,
    );
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  }
});
test('branch changes are never retried with force', async () => {
  const { call, calls } = fakeGit(null, true);
  await assert.rejects(commitArticle(call, input, async () => {}));
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 1);
  assert.equal(calls.at(-1).body.force, false);
});
test('GitHub errors do not expose token or remote error bodies', async () => {
  const call = github(
    'private-token',
    async () => new Response('private-token bad request', { status: 403 }),
  );
  await assert.rejects(
    call('/user'),
    (e: any) => e.status === 403 && !e.message.includes('private-token'),
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('draft navigation locks before saving and loading; repeated clicks cannot overwrite the selected draft', async () => {
  const transition = createDraftTransition<string>();
  const save = deferred<void>();
  const load = deferred<string>();
  let current = 'A: final unsaved words';
  let persisted = '';
  let loads = 0;
  const states: boolean[] = [];
  const moving = transition.run({
    saveCurrent: async () => {
      await save.promise;
      persisted = current;
    },
    loadNext: () => {
      loads++;
      return load.promise;
    },
    activate: (value) => {
      current = value;
    },
    onBusyChange: (value) => {
      states.push(value);
    },
  });
  assert.equal(transition.busy, true);
  assert.equal(loads, 0);
  const repeated = await transition.run({
    saveCurrent: async () => {
      throw new Error('must not run');
    },
    loadNext: async () => 'C',
    activate: (value) => {
      current = value;
    },
    onBusyChange: () => {},
  });
  assert.equal(repeated, false);
  save.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(persisted, 'A: final unsaved words');
  assert.equal(current, persisted);
  assert.equal(transition.busy, true);
  load.resolve('B');
  await moving;
  assert.equal(current, 'B');
  assert.equal(transition.busy, false);
  assert.deepEqual(states, [true, false]);
});

test('failed saves and loads retain the current editor; recovery saves current content first', async () => {
  const transition = createDraftTransition<string>();
  let current = 'unsaved current article';
  for (const stage of ['save', 'load']) {
    await assert.rejects(
      transition.run({
        saveCurrent: async () => {
          if (stage === 'save') throw new Error('save failed');
        },
        loadNext: async () => {
          throw new Error('load failed');
        },
        activate: (value) => {
          current = value;
        },
        onBusyChange: () => {},
      }),
    );
    assert.equal(current, 'unsaved current article');
    assert.equal(transition.busy, false);
  }
  let persisted = '';
  await transition.run({
    saveCurrent: async () => {
      persisted = current;
    },
    loadNext: async () => 'recovered article',
    activate: (value) => {
      current = value;
    },
    onBusyChange: () => {},
  });
  assert.equal(persisted, 'unsaved current article');
  assert.equal(current, 'recovered article');
});

const publication = {
  id: 'release-a',
  state: 'submitted',
  commit_sha: 'commit-a',
  url: 'https://blog.example/article/',
  created_at: '2026-09-22T00:00:00Z',
  error: null,
};
const noConfirm = async () => {
  throw new Error('unexpected draft update');
};
test('a cancelled build can become live through a later deployment and clears the stale error', async () => {
  const call = async () => ({
    workflow_runs: [{ status: 'completed', conclusion: 'cancelled' }],
  });
  const cancelled = await checkPublication(
    publication,
    call,
    noConfirm,
    async () => new Response('previous article'),
  );
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(needsPublicationCheck(cancelled.state), true);
  const live = await checkPublication(
    cancelled,
    async () => {
      throw new Error('live content needs no Actions request');
    },
    noConfirm,
    async () =>
      new Response('new deployment <!-- publisher-release:release-a -->'),
  );
  assert.equal(live.state, 'live');
  assert.equal(live.error, null);
});

test('a successful build or a different release marker does not prove this publication is live', async () => {
  const checked = await checkPublication(
    publication,
    async () => ({
      workflow_runs: [{ status: 'completed', conclusion: 'success' }],
    }),
    noConfirm,
    async () => new Response('<!-- publisher-release:another-release -->'),
  );
  assert.equal(checked.state, 'built');
  assert.equal(needsPublicationCheck(checked.state), true);
});

test('an older release stops polling only after a newer version of the same article is confirmed live', async () => {
  const checked = await checkPublication(
    { ...publication, state: 'cancelled' },
    async () => {
      throw new Error('no further GitHub request needed');
    },
    noConfirm,
    async () => {
      throw new Error('no further page request needed');
    },
    Date.now(),
    true,
  );
  assert.equal(checked.state, 'superseded');
  assert.equal(checked.error, null);
  assert.equal(needsPublicationCheck(checked.state), false);
});

test('uncertain commits recover the publication date from the exact committed article', async () => {
  let confirmed: unknown;
  const checked = await checkPublication(
    { ...publication, state: 'verifying', target_path: input.path },
    async (path) =>
      path.includes('/compare/')
        ? { status: 'ahead' }
        : {
            sha: 'confirmed-blob',
            encoding: 'base64',
            content: Buffer.from(
              '---\npublished_at: 2026-09-22T01:00:00Z\n---\nbody',
            ).toString('base64'),
          },
    async (sha, date) => {
      confirmed = { sha, date };
    },
    async () => new Response('<!-- publisher-release:release-a -->'),
  );
  assert.equal(checked.state, 'live');
  assert.deepEqual(confirmed, {
    sha: 'confirmed-blob',
    date: '2026-09-22T01:00:00Z',
  });
});

test('failed first publication does not reserve its date; later edits retain the successful date', async () => {
  const draft = {
    id: '12345678-1234-1234-1234-123456789abc',
    title: '日期验收',
    body: '正文',
    metadata: '',
    base_sha: null,
  };
  const failed = fakeGit(null, true);
  await assert.rejects(
    publishDraft(
      draft,
      input.path,
      'attempt-1',
      failed.call,
      async () => null,
      async () => {},
      '2026-09-01T00:00:00Z',
    ),
  );
  assert.equal('first_published_at' in draft, false);
  const successful = fakeGit(null);
  const result = await publishDraft(
    draft,
    input.path,
    'attempt-2',
    successful.call,
    async () => null,
    async () => {},
    '2026-09-22T00:00:00Z',
  );
  assert.equal(result.firstPublishedAt, '2026-09-22T00:00:00Z');
  const committed = splitMarkdown(
    successful.calls.find((c) => c.path.endsWith('/git/trees')).body.tree[0]
      .content,
  );
  assert.equal(committed.data.published_at, result.firstPublishedAt);
  const edited = fakeGit('post-blob');
  await publishDraft(
    {
      ...draft,
      source_path: input.path,
      base_sha: 'post-blob',
      first_published_at: result.firstPublishedAt,
    },
    input.path,
    'attempt-3',
    edited.call,
    async () => null,
    async () => {},
    '2026-09-23T00:00:00Z',
  );
  assert.equal(
    splitMarkdown(
      edited.calls.find((c) => c.path.endsWith('/git/trees')).body.tree[0]
        .content,
    ).data.published_at,
    result.firstPublishedAt,
  );
});

test('publishing replaces private image URLs and stops before Git writes when an image is missing', async () => {
  const name = '12345678-1234-1234-1234-123456789abc.png';
  const draft = {
    id: '12345678-1234-1234-1234-123456789abc',
    title: '图片验收',
    body: `![one](/api/media/${name})\n![again](/api/media/${name})`,
    metadata: '',
    base_sha: null,
  };
  const { call, calls } = fakeGit(null);
  await assert.rejects(
    publishDraft(
      draft,
      input.path,
      'missing',
      call,
      async () => null,
      async () => {},
    ),
    /图片上传未完成/,
  );
  assert.equal(calls.length, 0);
  let reads = 0;
  await publishDraft(
    draft,
    input.path,
    'complete',
    call,
    async () => {
      reads++;
      return {
        size: 3,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      };
    },
    async () => {},
  );
  const tree = calls.find((c) => c.path.endsWith('/git/trees')).body.tree;
  assert.equal(reads, 1);
  assert.equal(tree.length, 2);
  assert.doesNotMatch(tree[0].content, /\/api\/media\//);
  assert.match(tree[0].content, /\.\.\/assets\/publisher\//);
});

test('deletion retains other tree entries and refuses a concurrently modified article', async () => {
  const git = fakeGit('original-blob');
  let recorded = '';
  await removeArticle(
    git.call,
    input.path,
    'original-blob',
    '文章',
    'release',
    async (sha) => {
      recorded = sha;
    },
  );
  assert.equal(recorded, 'new-commit');
  assert.deepEqual(git.calls.find((c) => c.path.endsWith('/git/trees')).body, {
    base_tree: 'base-tree',
    tree: [{ path: input.path, mode: '100644', type: 'blob', sha: null }],
  });
  assert.deepEqual(git.calls.at(-1).body, { sha: 'new-commit', force: false });
  const changed = fakeGit('newer-blob');
  await assert.rejects(
    removeArticle(
      changed.call,
      input.path,
      'old-blob',
      '文章',
      'release',
      async () => {},
    ),
    (error: any) => error.status === 409,
  );
  assert.equal(
    changed.calls.some((c) => c.method === 'POST'),
    false,
  );
});

test('deletion status requires successful deployment and an absent public page', async () => {
  const job = { ...publication, action: 'delete' };
  const run = async () => ({
    workflow_runs: [{ status: 'completed', conclusion: 'success' }],
  });
  assert.equal(
    (
      await checkPublication(
        job,
        run,
        noConfirm,
        async () => new Response('old page'),
      )
    ).state,
    'built',
  );
  assert.equal(
    (
      await checkPublication(
        job,
        run,
        noConfirm,
        async () => new Response('', { status: 404 }),
      )
    ).state,
    'live',
  );
  const cancelled = async () => ({
    workflow_runs: [{ status: 'completed', conclusion: 'cancelled' }],
  });
  assert.equal(
    (
      await checkPublication(
        job,
        cancelled,
        noConfirm,
        async () => new Response('', { status: 404 }),
      )
    ).state,
    'cancelled',
  );
});

test('uncertain deletion confirms absence in the exact committed tree before updating trash', async () => {
  let confirmed = false;
  const result = await checkPublication(
    {
      ...publication,
      action: 'delete',
      state: 'verifying',
      target_path: input.path,
    },
    async (path) => {
      if (path.includes('/compare/')) return { status: 'identical' };
      if (path.includes('/contents/')) {
        assert.match(path, /ref=commit-a/);
        throw new ApiError(404, 'missing');
      }
      return { workflow_runs: [] };
    },
    async () => {
      confirmed = true;
    },
    async () => new Response('', { status: 404 }),
  );
  assert.equal(confirmed, true);
  assert.equal(result.state, 'submitted');
});

test('a later successful deployment proves deletion only when it includes the deletion commit', async () => {
  for (const [comparison, expected] of [
    ['ahead', 'live'],
    ['behind', 'cancelled'],
  ]) {
    const result = await checkPublication(
      { ...publication, action: 'delete' },
      async (path) => {
        if (path.includes('/compare/')) {
          assert.match(path, /commit-a\.\.\.later-build/);
          return { status: comparison };
        }
        if (path.includes('status=success'))
          return { workflow_runs: [{ head_sha: 'later-build' }] };
        return {
          workflow_runs: [{ status: 'completed', conclusion: 'cancelled' }],
        };
      },
      noConfirm,
      async () => new Response('', { status: 404 }),
    );
    assert.equal(result.state, expected);
  }
});

test('copied article image references remain resolvable outside their original folder', () => {
  const body =
    '![旧图](../assets/test.png)\n![外链](https://example.com/photo.jpg)\n![私有](/api/media/12345678-1234-1234-1234-123456789abc.png)';
  const portable = portableImages(body, 'docs/D-Orginals/article.md');
  assert.match(
    portable,
    /https:\/\/raw.githubusercontent.com\/NN66kk\/Mon-Blog\/main\/docs\/assets\/test.png/,
  );
  assert.match(portable, /!\[外链\]\(https:\/\/example.com\/photo.jpg\)/);
  assert.match(portable, /!\[私有\]\(\/api\/media\//);
  assert.equal(portableImages(body), body);
  assert.match(
    portableImages(
      '![图](<../assets/old photo.png> "保留说明")',
      'docs/D-Orginals/article.md',
    ),
    /docs\/assets\/old%20photo.png "保留说明"\)/,
  );
});

test('article metadata, restoration and duplication preserve content without reusing publication identity', () => {
  const text =
    '---\ntitle: 真实标题\ncdate: 2025-02-03\ntags: [旅行, 生活]\naliases: [test]\n---\n正文\n<!-- publisher-release:old -->\n';
  const meta = metadataForArticle('docs/D-Orginals/260922123456.md', text);
  assert.equal(meta.title, '真实标题');
  assert.equal(meta.published_at, '2025-02-03');
  assert.deepEqual(meta.tags, ['旅行', '生活']);
  assert.equal(
    metadataForArticle('docs/D-Orginals/260922123456.md', '').published_at,
    '2026-09-22',
  );
  const restored = restoredContent(text, 'new');
  assert.match(restored, /cdate: 2025-02-03/);
  assert.doesNotMatch(restored, /publisher-release:old/);
  assert.match(restored, /publisher-release:new/);
  const duplicate = splitMarkdown(
    `---\n${duplicateMetadata(splitMarkdown(text).metadata)}---\ntext`,
  ).data;
  assert.equal(duplicate.cdate, undefined);
  assert.deepEqual(duplicate.aliases, ['test']);
  assert.equal(managedPath('docs/D-Orginals/2024070515116.md'), false);
});

test('rate limits and missing token permissions are distinguished without exposing remote content', async () => {
  const rate = github(
    'secret',
    async () =>
      new Response(JSON.stringify({ message: 'secret' }), {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
  );
  await assert.rejects(rate('/user'), /频率限制/);
  const denied = github(
    'secret',
    async () =>
      new Response(
        JSON.stringify({
          message: 'Resource not accessible by personal access token secret',
        }),
        { status: 403 },
      ),
  );
  await assert.rejects(
    denied(`/repos/${'NN66kk/Mon-Blog'}/git/trees`, 'POST', {}),
    (error: any) =>
      /Contents/.test(error.message) && !error.message.includes('secret'),
  );
  await assert.rejects(
    denied('/repos/NN66kk/Mon-Blog/actions/runs'),
    /Actions/,
  );
});

test('portable backup includes each private image once and fails instead of silently omitting missing files', async () => {
  const name = '12345678-1234-1234-1234-123456789abc.png';
  const drafts = [
    {
      id: 'one',
      title: '备份',
      body: `![图](/api/media/${name})\n![图2](/api/media/${name})`,
      metadata: '',
    },
  ];
  let requests = 0;
  const zip = await draftBackup(drafts, async () => {
    requests++;
    return new Response(new Uint8Array([1, 2, 3]));
  });
  assert.equal(requests, 1);
  const data = new Uint8Array(await zip.arrayBuffer());
  assert.equal(new DataView(data.buffer).getUint32(0, true), 0x04034b50);
  assert.equal(new DataView(data.buffer).getUint16(data.length - 12, true), 4);
  assert.match(new TextDecoder().decode(data), /\.\.\/assets\//);
  await assert.rejects(
    draftBackup(drafts, async () => new Response('', { status: 404 })),
    /备份已停止/,
  );
  assert.throws(
    () => zipStored([{ path: '../escape', data: new Uint8Array() }]),
    /路径无效/,
  );
});
