import test from 'node:test';
import assert from 'node:assert/strict';

// Intentionally restricted to the local Sites test identity. Never run against production.
const origin = new URL(
  process.env.PUBLISHER_TEST_URL || 'http://localhost:5173',
).origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Local acceptance tests must use a loopback URL.');
}
const login = await fetch(`${origin}/signin-with-chatgpt?return_to=/`, {
  redirect: 'manual',
});
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.equal(login.status, 302);
assert.ok(
  cookie,
  'Start the local development server with Sites test sign-in enabled.',
);
const headers = {
  Cookie: cookie,
  Origin: origin,
  'Content-Type': 'application/json',
};
const draft = {
  id: crypto.randomUUID(),
  title: '本地 API 验收草稿',
  collection: 'D-Orginals',
  body: '仅本地验收，不发布到博客。',
  metadata: 'tags: [验收]',
  revision: 0,
};

test('anonymous users cannot read drafts', async () => {
  const result = await fetch(`${origin}/api/state`);
  assert.equal(result.status, 401);
});

test('cross-origin requests cannot save drafts', async () => {
  const result = await fetch(`${origin}/api/drafts`, {
    method: 'POST',
    headers: { ...headers, Origin: 'https://other.example' },
    body: JSON.stringify(draft),
  });
  assert.equal(result.status, 403);
});

test('draft revisions survive round trips and stale saves cannot overwrite new content', async () => {
  const save = (body: object) =>
    fetch(`${origin}/api/drafts`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  const created = await save(draft);
  assert.equal(created.status, 200);
  assert.equal(((await created.json()) as { revision: number }).revision, 1);
  const updated = await save({
    ...draft,
    body: '第二次保存的正文',
    revision: 1,
  });
  assert.equal(updated.status, 200);
  assert.equal(((await updated.json()) as { revision: number }).revision, 2);
  const stale = await save({ ...draft, body: '不应覆盖的旧内容', revision: 1 });
  assert.equal(stale.status, 409);
  const stored = (await (
    await fetch(`${origin}/api/drafts/${draft.id}`, { headers })
  ).json()) as {
    body: string;
    revision: number;
    first_published_at: string | null;
    source_path: string | null;
  };
  assert.equal(stored.body, '第二次保存的正文');
  assert.equal(stored.revision, 2);
  assert.equal(stored.first_published_at, null);
  assert.equal(stored.source_path, null);
});

test('invalid draft data is rejected without creating an article', async () => {
  const result = await fetch(`${origin}/api/drafts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...draft,
      id: crypto.randomUUID(),
      collection: '../outside',
    }),
  });
  assert.equal(result.status, 400);
});

test('uploaded PNG bytes are private and round-trip through local R2', async () => {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XsAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.append(
    'file',
    new File([bytes], 'local-acceptance.png', { type: 'image/png' }),
  );
  const uploaded = await fetch(`${origin}/api/upload`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  assert.equal(uploaded.status, 200);
  const { url } = (await uploaded.json()) as { url: string };
  assert.match(url, /^\/api\/media\/[a-f0-9-]+\.png$/);
  const image = await fetch(`${origin}${url}`, { headers });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
  assert.equal((await fetch(`${origin}${url}`)).status, 401);
});

test('files with a spoofed image content type are rejected', async () => {
  const form = new FormData();
  form.append(
    'file',
    new File(['this is not an image'], 'fake.png', { type: 'image/png' }),
  );
  const result = await fetch(`${origin}/api/upload`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  assert.equal(result.status, 400);
});

test('draft history, duplication, trash and restoration are durable and version checked', async () => {
  const sample = {
    ...draft,
    id: crypto.randomUUID(),
    title: '管理验收草稿',
    body: '初始正文',
    metadata: 'cdate: 2024-01-01\naliases: [keep]',
  };
  const post = async (path: string, value: unknown) =>
    fetch(`${origin}/api/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(value),
    });
  assert.equal((await post('drafts', sample)).status, 200);
  assert.equal(
    (await post('drafts', { ...sample, body: '新版正文', revision: 1 })).status,
    200,
  );
  const history = (await (
    await fetch(`${origin}/api/drafts/${sample.id}/history`, { headers })
  ).json()) as any;
  assert.deepEqual(
    history.versions.map((v: any) => v.revision),
    [2, 1],
  );
  const restored = (await (
    await post('restore-version', { id: sample.id, version: 1, revision: 2 })
  ).json()) as any;
  assert.equal(restored.body, '初始正文');
  assert.equal(restored.revision, 3);
  const copied = (await (
    await post('draft-action', {
      id: sample.id,
      revision: 3,
      action: 'duplicate',
    })
  ).json()) as any;
  assert.notEqual(copied.id, sample.id);
  assert.equal(copied.source_path, null);
  assert.doesNotMatch(copied.metadata, /cdate/);
  assert.match(copied.metadata, /aliases/);
  assert.equal(
    (
      await post('draft-action', {
        id: sample.id,
        revision: 2,
        action: 'trash',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post('draft-action', {
        id: sample.id,
        revision: 3,
        action: 'trash',
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${origin}/api/drafts/${sample.id}`, { headers })).status,
    409,
  );
  assert.equal((await post('drafts', { ...sample, revision: 3 })).status, 409);
  const trash = (await (
    await fetch(`${origin}/api/trash`, { headers })
  ).json()) as any;
  const trashed = trash.drafts.find((d: any) => d.id === sample.id);
  assert.equal(trashed.revision, 4);
  assert.equal(
    (
      await post('draft-action', {
        id: sample.id,
        revision: 4,
        action: 'restore',
      })
    ).status,
    200,
  );
  const reopened = (await (
    await fetch(`${origin}/api/drafts/${sample.id}`, { headers })
  ).json()) as any;
  assert.equal(reopened.body, '初始正文');
  assert.equal(reopened.revision, 5);
});

test('media recycling preserves bytes and blocks recycling referenced images', async () => {
  const file = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XsAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.append(
    'file',
    new File([file], '图片管理验收.png', { type: 'image/png' }),
  );
  const uploaded = (await (
    await fetch(`${origin}/api/upload`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
      body: form,
    })
  ).json()) as any;
  const name = uploaded.url.split('/').pop();
  const post = (action: string) =>
    fetch(`${origin}/api/media-action`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, action }),
    });
  assert.equal((await post('trash')).status, 200);
  assert.deepEqual(
    Buffer.from(
      await (
        await fetch(`${origin}${uploaded.url}`, { headers })
      ).arrayBuffer(),
    ),
    file,
  );
  assert.equal((await post('restore')).status, 200);
  await fetch(`${origin}/api/drafts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...draft,
      id: crypto.randomUUID(),
      body: `![image](${uploaded.url})`,
    }),
  });
  assert.equal((await post('trash')).status, 409);
  const library = (await (
    await fetch(`${origin}/api/media`, { headers })
  ).json()) as any;
  assert.ok(
    library.media.find((item: any) => item.name === name).references.length > 0,
  );
});

test('new management endpoints reject anonymous access and unconfirmed repository mutations', async () => {
  for (const path of ['trash', 'backup', 'media', `drafts/${draft.id}/history`])
    assert.equal((await fetch(`${origin}/api/${path}`)).status, 401);
  const unconfirmed = await fetch(`${origin}/api/article-operation`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      action: 'delete',
      path: 'docs/D-Orginals/example.md',
    }),
  });
  assert.equal(unconfirmed.status, 400);
});
