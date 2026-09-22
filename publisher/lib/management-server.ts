import {
  account,
  database,
  files,
  jsonBody,
  ownedDraft,
  response,
} from './server';
import { ApiError, commitArticle, readArticle, removeArticle } from './github';
import { articleUrl, REPO, splitMarkdown } from './content';
import {
  duplicateMetadata,
  IMAGE_NAME,
  managedPath,
  metadataForArticle,
  portableImages,
  restoredContent,
  UUID,
} from './management';

export function snapshotDraft(owner: string, id: string) {
  return database()
    .prepare(
      'INSERT OR IGNORE INTO draft_versions (id,owner,draft_id,revision,title,collection,body,metadata,created_at) SELECT ?,owner,id,revision,title,collection,body,metadata,updated_at FROM drafts WHERE owner=? AND id=?',
    )
    .bind(crypto.randomUUID(), owner, id);
}
const activeJob = (owner: string, path: string) =>
  database()
    .prepare(
      "SELECT id FROM publications WHERE owner=? AND target_path=? AND state IN ('preparing','verifying') LIMIT 1",
    )
    .bind(owner, path)
    .first();

export async function managementRequest(
  route: string,
  request: Request,
  owner: string,
): Promise<Response | null> {
  const db = database();
  const url = new URL(request.url);
  if (route === 'article-history' && request.method === 'GET') {
    const path = url.searchParams.get('path');
    if (!managedPath(path)) throw new ApiError(400, '请选择有效的文章。');
    const rows = await (
      await account(owner)
    )(`/repos/${REPO}/commits?path=${encodeURIComponent(path)}&per_page=30`);
    return response({
      versions: rows.map((row: any) => ({
        sha: row.sha,
        message: row.commit.message.split('\n')[0],
        date: row.commit.author?.date,
        author: row.commit.author?.name,
        url: row.html_url,
      })),
    });
  }
  if (route === 'article-version' && request.method === 'POST') {
    const { path, sha } = await jsonBody(request);
    if (
      !managedPath(path) ||
      typeof sha !== 'string' ||
      !/^[a-f0-9]{40}$/.test(sha)
    )
      throw new ApiError(400, '文章版本无效。');
    const call = await account(owner);
    const current = await readArticle(call, path);
    const previous = await readArticle(call, path, sha);
    if (
      previous.encoding !== 'base64' ||
      !previous.content ||
      previous.size > 1000000
    )
      throw new ApiError(400, '无法读取这个版本。');
    const source = Buffer.from(previous.content, 'base64').toString('utf8');
    const parsed = splitMarkdown(source);
    const title = metadataForArticle(path, source).title;
    const id = crypto.randomUUID();
    await db
      .prepare(
        'INSERT INTO drafts (id,owner,title,collection,body,metadata,source_path,base_sha,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?)',
      )
      .bind(
        id,
        owner,
        title,
        path.split('/')[1],
        parsed.body,
        parsed.metadata,
        path,
        current.sha,
        new Date().toISOString(),
      )
      .run();
    await snapshotDraft(owner, id).run();
    return response(await ownedDraft(owner, id));
  }
  if (route === 'blog-assets' && request.method === 'GET') {
    const tree = await (
      await account(owner)
    )(`/repos/${REPO}/git/trees/main?recursive=1`);
    if (tree.truncated) throw new ApiError(502, '图片目录超出读取范围。');
    return response({
      assets: tree.tree
        .filter(
          (x: any) =>
            x.type === 'blob' &&
            x.path.startsWith('docs/') &&
            /\.(png|jpg|jpeg|gif|webp)$/i.test(x.path),
        )
        .map((x: any) => ({
          path: x.path,
          filename: x.path.split('/').pop(),
          size: x.size,
          url: `https://raw.githubusercontent.com/${REPO}/main/${x.path.split('/').map(encodeURIComponent).join('/')}`,
        })),
    });
  }
  if (route === 'articles' && request.method === 'GET') {
    const call = await account(owner);
    const tree = await call(`/repos/${REPO}/git/trees/main?recursive=1`);
    if (tree.truncated)
      throw new ApiError(502, '文章目录超出读取范围，请联系管理员。');
    const [cached, draftRows] = await Promise.all([
      db
        .prepare('SELECT * FROM article_cache WHERE owner=?')
        .bind(owner)
        .all<any>(),
      db
        .prepare(
          'SELECT id,source_path,updated_at FROM drafts WHERE owner=? AND deleted_at IS NULL AND source_path IS NOT NULL ORDER BY updated_at DESC',
        )
        .bind(owner)
        .all<any>(),
    ]);
    const index = new Map(cached.results.map((row) => [row.path, row]));
    const articles = tree.tree
      .filter((item: any) => item.type === 'blob' && managedPath(item.path))
      .map((item: any) => {
        const cached = index.get(item.path);
        const valid = cached?.sha === item.sha;
        return {
          ...metadataForArticle(item.path, ''),
          ...(cached
            ? {
                title: cached.title,
                tags: JSON.parse(cached.tags),
                description: cached.description,
                published_at: cached.published_at,
                updated_at: cached.updated_at,
              }
            : {}),
          sha: item.sha,
          indexed: valid,
          draft_id:
            draftRows.results.find((row) => row.source_path === item.path)
              ?.id || null,
        };
      });
    return response({ articles, synced_at: new Date().toISOString() });
  }
  if (route === 'article-details' && request.method === 'POST') {
    const { articles } = await jsonBody(request);
    if (
      !Array.isArray(articles) ||
      articles.length > 12 ||
      articles.some(
        (x) =>
          !managedPath(x?.path) ||
          typeof x.sha !== 'string' ||
          !/^[a-f0-9]{40}$/.test(x.sha),
      )
    )
      throw new ApiError(400, '文章同步参数无效。');
    const call = await account(owner);
    const result: any[] = [];
    // Limit each request to four in-flight GitHub reads; return partial indexing errors explicitly.
    for (let i = 0; i < articles.length; i += 4) {
      const batch = await Promise.all(
        articles.slice(i, i + 4).map(async (item) => {
          const old = await db
            .prepare('SELECT sha FROM article_cache WHERE owner=? AND path=?')
            .bind(owner, item.path)
            .first<any>();
          if (old?.sha === item.sha) {
            const cache = await db
              .prepare('SELECT * FROM article_cache WHERE owner=? AND path=?')
              .bind(owner, item.path)
              .first<any>();
            return {
              ...cache,
              collection: item.path.split('/')[1],
              url: articleUrl(item.path),
              tags: JSON.parse(cache.tags),
              indexed: true,
            };
          }
          const remote = await call(`/repos/${REPO}/git/blobs/${item.sha}`);
          if (remote.encoding !== 'base64' || remote.size > 1000000)
            return { path: item.path, index_error: '文章过大，暂未索引。' };
          let meta;
          try {
            meta = metadataForArticle(
              item.path,
              Buffer.from(remote.content, 'base64').toString('utf8'),
            );
          } catch {
            return {
              path: item.path,
              index_error: '文章信息格式有误，可在 GitHub 修正。',
            };
          }
          await db
            .prepare(
              'INSERT INTO article_cache (id,owner,path,sha,title,tags,description,published_at,updated_at,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,path) DO UPDATE SET sha=excluded.sha,title=excluded.title,tags=excluded.tags,description=excluded.description,published_at=excluded.published_at,updated_at=excluded.updated_at,synced_at=excluded.synced_at',
            )
            .bind(
              crypto.randomUUID(),
              owner,
              item.path,
              item.sha,
              meta.title,
              JSON.stringify(meta.tags),
              meta.description,
              meta.published_at,
              meta.updated_at,
              new Date().toISOString(),
            )
            .run();
          return { ...meta, sha: item.sha, indexed: true };
        }),
      );
      result.push(...batch);
    }
    return response({ articles: result });
  }
  if (route === 'trash' && request.method === 'GET') {
    const [drafts, articles] = await Promise.all([
      db
        .prepare(
          'SELECT id,title,collection,revision,source_path,deleted_at,updated_at FROM drafts WHERE owner=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
        )
        .bind(owner)
        .all(),
      db
        .prepare(
          "SELECT id,path,title,state,created_at,publication_id FROM article_trash WHERE owner=? AND state <> 'restored' ORDER BY created_at DESC",
        )
        .bind(owner)
        .all(),
    ]);
    return response({ drafts: drafts.results, articles: articles.results });
  }
  if (route === 'draft-action' && request.method === 'POST') {
    const { id, action, revision } = await jsonBody(request);
    if (
      !UUID.test(id) ||
      !['trash', 'restore', 'duplicate'].includes(action) ||
      !Number.isInteger(revision)
    )
      throw new ApiError(400, '草稿操作无效。');
    const draft = await ownedDraft(owner, id);
    if (draft.revision !== revision)
      throw new ApiError(409, '草稿已有新版本，请刷新列表后重试。');
    if (draft.source_path && (await activeJob(owner, draft.source_path)))
      throw new ApiError(409, '这篇文章正在提交，请等待发布状态确认后再操作。');
    const now = new Date().toISOString();
    if (action === 'duplicate') {
      const nextId = crypto.randomUUID();
      await db
        .prepare(
          'INSERT INTO drafts (id,owner,title,collection,body,metadata,revision,updated_at) VALUES (?,?,?,?,?,?,1,?)',
        )
        .bind(
          nextId,
          owner,
          `${(draft.title || '未命名文章').slice(0, 296)}（副本）`,
          draft.collection,
          portableImages(draft.body, draft.source_path),
          duplicateMetadata(draft.metadata),
          now,
        )
        .run();
      await snapshotDraft(owner, nextId).run();
      return response(await ownedDraft(owner, nextId));
    }
    if ((action === 'trash') === Boolean(draft.deleted_at))
      return response({ ok: true });
    const changes = await db.batch([
      snapshotDraft(owner, id),
      db
        .prepare(
          'UPDATE drafts SET deleted_at=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=?',
        )
        .bind(action === 'trash' ? now : null, now, id, owner, revision),
      snapshotDraft(owner, id),
    ]);
    if (!changes[1].meta.changes)
      throw new ApiError(409, '草稿已有新版本，请刷新列表后重试。');
    return response({ ok: true });
  }
  const history = route.match(/^drafts\/([a-f0-9-]+)\/history$/);
  if (history && request.method === 'GET') {
    await ownedDraft(owner, history[1]);
    const rows = await db
      .prepare(
        'SELECT revision,title,created_at,length(body) AS characters FROM draft_versions WHERE owner=? AND draft_id=? ORDER BY revision DESC LIMIT 100',
      )
      .bind(owner, history[1])
      .all();
    return response({ versions: rows.results });
  }
  if (route === 'restore-version' && request.method === 'POST') {
    const { id, version, revision } = await jsonBody(request);
    if (
      !UUID.test(id) ||
      !Number.isInteger(version) ||
      !Number.isInteger(revision)
    )
      throw new ApiError(400, '版本参数无效。');
    const draft = await ownedDraft(owner, id);
    if (draft.deleted_at) throw new ApiError(409, '请先从回收站恢复草稿。');
    const old = await db
      .prepare(
        'SELECT * FROM draft_versions WHERE draft_id=? AND owner=? AND revision=?',
      )
      .bind(id, owner, version)
      .first<any>();
    if (!old) throw new ApiError(404, '找不到这个历史版本。');
    const now = new Date().toISOString();
    const results = await db.batch([
      snapshotDraft(owner, id),
      db
        .prepare(
          'UPDATE drafts SET title=?,collection=?,body=?,metadata=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL',
        )
        .bind(
          old.title,
          draft.source_path ? draft.collection : old.collection,
          old.body,
          old.metadata,
          now,
          id,
          owner,
          revision,
        ),
      snapshotDraft(owner, id),
    ]);
    if (!results[1].meta.changes)
      throw new ApiError(409, '草稿已有新版本，请重新打开后再恢复。');
    return response(await ownedDraft(owner, id));
  }
  if (route === 'backup' && request.method === 'GET') {
    const rows = await db
      .prepare(
        'SELECT id,title,collection,body,metadata,revision,source_path,updated_at,deleted_at FROM drafts WHERE owner=? ORDER BY updated_at DESC',
      )
      .bind(owner)
      .all();
    return response({
      version: 1,
      exported_at: new Date().toISOString(),
      drafts: rows.results,
    });
  }
  if (route === 'media' && request.method === 'GET') {
    const cursor = url.searchParams.get('cursor') || undefined;
    const listed = await files().list({
      prefix: `${encodeURIComponent(owner)}/`,
      limit: 60,
      cursor,
      include: ['customMetadata'],
    } as R2ListOptions);
    const names = listed.objects
      .map((object) => object.key.split('/').pop()!)
      .filter((name) => IMAGE_NAME.test(name));
    const entries = await db
      .prepare(
        'SELECT name,archived_at,original_name FROM media_entries WHERE owner=?',
      )
      .bind(owner)
      .all<any>();
    const entriesByName = new Map(
      entries.results.map((item) => [item.name, item]),
    );
    const refs = await db
      .prepare('SELECT id,title,body,deleted_at FROM drafts WHERE owner=?')
      .bind(owner)
      .all<any>();
    return response({
      media: listed.objects
        .filter((object) => names.includes(object.key.split('/').pop()!))
        .map((object) => {
          const name = object.key.split('/').pop()!;
          const entry = entriesByName.get(name);
          return {
            name,
            filename:
              entry?.original_name || object.customMetadata?.filename || name,
            url: `/api/media/${name}`,
            size: object.size,
            uploaded_at: object.uploaded.toISOString(),
            archived_at: entry?.archived_at || null,
            references: refs.results
              .filter((draft) => draft.body.includes(`/api/media/${name}`))
              .map(({ id, title, deleted_at }) => ({ id, title, deleted_at })),
          };
        }),
      cursor: listed.truncated ? listed.cursor : null,
    });
  }
  if (route === 'media-action' && request.method === 'POST') {
    const { name, action } = await jsonBody(request);
    if (!IMAGE_NAME.test(name) || !['trash', 'restore'].includes(action))
      throw new ApiError(400, '图片操作无效。');
    const object = await files().head(`${encodeURIComponent(owner)}/${name}`);
    if (!object) throw new ApiError(404, '找不到这张图片。');
    if (action === 'trash') {
      const used = await db
        .prepare(
          'SELECT id FROM drafts WHERE owner=? AND instr(body,?) > 0 LIMIT 1',
        )
        .bind(owner, `/api/media/${name}`)
        .first();
      if (used)
        throw new ApiError(
          409,
          '图片仍被草稿或回收站内容引用，暂不能移入图片回收站。',
        );
    }
    await db
      .prepare(
        'INSERT INTO media_entries (id,owner,name,original_name,archived_at,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,name) DO UPDATE SET archived_at=excluded.archived_at',
      )
      .bind(
        crypto.randomUUID(),
        owner,
        name,
        object.customMetadata?.filename || name,
        action === 'trash' ? new Date().toISOString() : null,
        object.uploaded.toISOString(),
      )
      .run();
    return response({ ok: true });
  }
  if (route === 'connection-check' && request.method === 'POST') {
    const call = await account(owner);
    const repo = await call(`/repos/${REPO}`);
    await call(`/repos/${REPO}/git/ref/heads/main`);
    let actions = true;
    let warning = '';
    try {
      await call(`/repos/${REPO}/actions/workflows/ci.yml/runs?per_page=1`);
    } catch (error) {
      actions = false;
      warning =
        error instanceof ApiError ? error.message : '暂时无法查询构建状态。';
    }
    return response({
      repository: REPO,
      readable: true,
      account_can_push: Boolean(repo.permissions?.push),
      actions,
      warning,
      write_note:
        '读取检查通过。发布仍要求该令牌具有 Contents 的 Read and write 权限。',
    });
  }
  if (route === 'article-operation' && request.method === 'POST') {
    const input = await jsonBody(request);
    if (
      !UUID.test(input.id) ||
      !['delete', 'restore'].includes(input.action) ||
      input.confirm !== true
    )
      throw new ApiError(400, '请确认后再执行文章操作。');
    const existing = await db
      .prepare('SELECT * FROM publications WHERE id=? AND owner=?')
      .bind(input.id, owner)
      .first();
    if (existing) return response(existing);
    const call = await account(owner);
    let path: string;
    let title: string;
    let content: string;
    let trashId: string;
    let originalSha: string;
    if (input.action === 'delete') {
      if (!managedPath(input.path) || typeof input.sha !== 'string')
        throw new ApiError(400, '请选择有效的文章。');
      path = input.path;
      const remote = await readArticle(call, path);
      if (remote.sha !== input.sha)
        throw new ApiError(409, '文章已被修改，请同步博客后重新确认删除。');
      if (
        remote.encoding !== 'base64' ||
        !remote.content ||
        remote.size > 1000000
      )
        throw new ApiError(400, '无法完整备份这篇文章，已取消删除。');
      content = Buffer.from(remote.content, 'base64').toString('utf8');
      title = metadataForArticle(path, content).title;
      originalSha = remote.sha;
      trashId = crypto.randomUUID();
    } else {
      const trash = await db
        .prepare(
          "SELECT * FROM article_trash WHERE id=? AND owner=? AND state='removed'",
        )
        .bind(String(input.trash_id), owner)
        .first<any>();
      if (!trash || !managedPath(trash.path))
        throw new ApiError(404, '文章尚未确认下线，或已经恢复。');
      ({ path, title, content } = trash);
      originalSha = trash.original_sha;
      trashId = trash.id;
    }
    if (await activeJob(owner, path))
      throw new ApiError(409, '这篇文章有待确认的提交，请先刷新发布记录。');
    const now = new Date().toISOString();
    const statements = [
      db
        .prepare(
          'INSERT INTO publications (id,owner,draft_id,revision,state,url,target_path,action,title,trash_id,created_at) VALUES (?,?,?,1,?,?,?,?,?,?,?)',
        )
        .bind(
          input.id,
          owner,
          `operation:${input.id}`,
          'preparing',
          articleUrl(path),
          path,
          input.action,
          title,
          trashId,
          now,
        ),
    ];
    if (input.action === 'delete')
      statements.push(
        db
          .prepare(
            'INSERT INTO article_trash (id,owner,path,title,content,original_sha,state,publication_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            trashId,
            owner,
            path,
            title,
            content,
            originalSha,
            'pending',
            input.id,
            now,
          ),
      );
    await db.batch(statements);
    let prepared = false;
    const beforeAdvance = async (sha: string) => {
      await db
        .prepare(
          "UPDATE publications SET commit_sha=?,state='verifying' WHERE id=? AND owner=?",
        )
        .bind(sha, input.id, owner)
        .run();
      prepared = true;
    };
    try {
      if (input.action === 'delete')
        await removeArticle(
          call,
          path,
          originalSha,
          title,
          input.id,
          beforeAdvance,
        );
      else
        await commitArticle(
          call,
          {
            path,
            baseSha: null,
            markdown: restoredContent(content, input.id),
            title: `Restore: ${title}`,
            release: input.id,
            assets: [],
          },
          beforeAdvance,
        );
      await db.batch([
        db
          .prepare(
            "UPDATE publications SET state='submitted' WHERE id=? AND owner=?",
          )
          .bind(input.id, owner),
        db
          .prepare(
            'UPDATE article_trash SET state=?,restored_at=?,publication_id=? WHERE id=? AND owner=?',
          )
          .bind(
            input.action === 'delete' ? 'removed' : 'restored',
            input.action === 'restore' ? now : null,
            input.id,
            trashId,
            owner,
          ),
      ]);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : '操作结果尚未确认，请刷新发布记录。恢复副本已保留。';
      await db
        .prepare(
          'UPDATE publications SET state=?,error=? WHERE id=? AND owner=?',
        )
        .bind(prepared ? 'verifying' : 'failed', message, input.id, owner)
        .run();
      if (!prepared && input.action === 'delete')
        await db
          .prepare(
            "UPDATE article_trash SET state='failed' WHERE id=? AND owner=?",
          )
          .bind(trashId, owner)
          .run();
    }
    return response(
      await db
        .prepare('SELECT * FROM publications WHERE id=? AND owner=?')
        .bind(input.id, owner)
        .first(),
    );
  }
  return null;
}
