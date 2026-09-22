import { account, credentialReady, database, encryptToken, files, identity, jsonBody, ownedDraft, response } from '@/lib/server';
import { ApiError, github, readArticle } from '@/lib/github';
import { articleUrl, newArticlePath, REPO, splitMarkdown, validCollection, validPath } from '@/lib/content';
import { checkPublication, needsPublicationCheck } from '@/lib/publication';
import { publishDraft } from '@/lib/publish';
import { managementRequest, snapshotDraft } from '@/lib/management-server';
import { ensureDraftFilename } from '@/lib/draft-filename';

export const dynamic = 'force-dynamic';
const UUID = /^[a-f0-9-]{36}$/;
async function handle(request: Request) {
  try {
    const owner = await identity(request);
    const url = new URL(request.url);
    const route = url.pathname.slice('/api/'.length);
    const db = database();
    const managed = await managementRequest(route, request, owner);
    if (managed) return managed;
    if (route === 'state' && request.method === 'GET') {
      const [drafts, publications, connection] = await Promise.all([
        db.prepare('SELECT id,title,collection,revision,updated_at,source_path FROM drafts WHERE owner=? AND deleted_at IS NULL ORDER BY updated_at DESC').bind(owner).all(),
        db.prepare('SELECT publications.*, COALESCE(publications.title,drafts.title) AS title FROM publications LEFT JOIN drafts ON drafts.id=publications.draft_id AND drafts.owner=publications.owner WHERE publications.owner=? ORDER BY publications.created_at DESC LIMIT 100').bind(owner).all(),
        db.prepare('SELECT login FROM connections WHERE owner=?').bind(owner).first(),
      ]);
      return response({ drafts: drafts.results, publications: publications.results, connection, credentialReady: credentialReady() });
    }
    if (route === 'connection' && request.method === 'POST') {
      const input = await jsonBody(request);
      const token = typeof input.token === 'string' ? input.token.trim() : '';
      if (token.length < 20 || token.length > 1000) throw new ApiError(400, '请输入有效的 GitHub 授权令牌。');
      const call = github(token);
      const user = await call('/user');
      if (user.login.toLowerCase() !== 'nn66kk') throw new ApiError(403, '请使用博客所有者 NN66kk 的 GitHub 账号。');
      const repo = await call(`/repos/${REPO}`);
      if (!repo.permissions?.push) throw new ApiError(403, '此账号没有博客仓库的写入权限。');
      await call(`/repos/${REPO}/git/ref/heads/main`);
      const ciphertext = await encryptToken(token, owner);
      await db.prepare('INSERT INTO connections (owner,ciphertext,login,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner) DO UPDATE SET ciphertext=excluded.ciphertext,login=excluded.login,updated_at=excluded.updated_at').bind(owner, ciphertext, user.login, new Date().toISOString()).run();
      return response({ login: user.login });
    }
    if (route === 'drafts' && request.method === 'POST') {
      const input = await jsonBody(request);
      const { id, title, body, metadata, collection, revision } = input;
      if (!UUID.test(id) || typeof title !== 'string' || title.length > 300 || typeof body !== 'string' || body.length > 300000 || typeof metadata !== 'string' || metadata.length > 30000 || !validCollection(collection) || !Number.isInteger(revision) || revision < 0) throw new ApiError(400, '草稿内容或栏目无效。');
      const now = new Date().toISOString();
      if (revision === 0) {
        const results = await db.batch([db.prepare('INSERT OR IGNORE INTO drafts (id,owner,title,collection,body,metadata,revision,updated_at) VALUES (?,?,?,?,?,?,1,?)').bind(id, owner, title, collection, body, metadata, now), snapshotDraft(owner, id)]);
        if (!results[0].meta.changes) throw new ApiError(409, '草稿已有新版本，请刷新草稿列表后重新打开。');
      } else {
        const existing = await ownedDraft(owner, id);
        if (existing.deleted_at) throw new ApiError(409, '这篇草稿已移入回收站，请先恢复再编辑。');
        if (existing.source_path && existing.collection !== collection) throw new ApiError(400, '已发布文章暂不支持移动栏目，以保持原有网址。');
        const results = await db.batch([snapshotDraft(owner, id), db.prepare('UPDATE drafts SET title=?,collection=?,body=?,metadata=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL').bind(title, collection, body, metadata, now, id, owner, revision), snapshotDraft(owner, id)]);
        if (!results[1].meta.changes) throw new ApiError(409, '另一台设备已保存了新版本。请先导出当前内容备份，再刷新页面并重新打开云端草稿。');
      }
      const saved = await ensureDraftFilename(owner, id);
      return response({ revision: revision + 1, updated_at: now, filename: saved.filename });
    }
    if (route.startsWith('drafts/') && request.method === 'GET') {
      const draft = await ownedDraft(owner, route.slice(7));
      if (draft.deleted_at) throw new ApiError(409, '草稿已在回收站，请先恢复。');
      return response(draft);
    }
    if (route === 'import' && request.method === 'POST') {
      const { path } = await jsonBody(request);
      if (typeof path !== 'string' || !validPath(path)) throw new ApiError(400, '文章路径无效。');
      const remote = await readArticle(await account(owner), path);
      if (!remote.content || remote.encoding !== 'base64') throw new ApiError(400, '文章过大，暂不能导入。');
      const parsed = splitMarkdown(Buffer.from(remote.content, 'base64').toString('utf8'));
      if (parsed.data.status === 'redirect') throw new ApiError(400, '这是跳转页面，请选择普通文章。');
      const existingDraft = await db.prepare('SELECT * FROM drafts WHERE owner=? AND source_path=? AND base_sha=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1').bind(owner, path, remote.sha).first();
      if (existingDraft) return response(existingDraft);
      const id = crypto.randomUUID();
      const title = String(parsed.data.title || parsed.body.match(/^#\s+(.+)$/m)?.[1] || path.split('/').pop()?.slice(0, -3));
      await db.prepare('INSERT INTO drafts (id,owner,title,collection,body,metadata,source_path,base_sha,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?)').bind(id, owner, title, path.split('/')[1], parsed.body, parsed.metadata, path, remote.sha, new Date().toISOString()).run();
      await snapshotDraft(owner, id).run();
      return response(await ownedDraft(owner, id));
    }
    if (route === 'upload' && request.method === 'POST') {
      if (Number(request.headers.get('content-length') || 0) > 6 * 1024 * 1024) throw new ApiError(413, '图片请控制在 5 MB 以内。');
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || file.size < 12) throw new ApiError(400, '请选择 5 MB 以内的 PNG、JPG、GIF 或 WebP 图片。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let ext = ''; let mime = '';
      if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) { ext = 'png'; mime = 'image/png'; }
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) { ext = 'jpg'; mime = 'image/jpeg'; }
      else if (new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/)) { ext = 'gif'; mime = 'image/gif'; }
      else if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') { ext = 'webp'; mime = 'image/webp'; }
      if (!ext) throw new ApiError(400, '不支持这种图片格式，请转换为 PNG、JPG、GIF 或 WebP。');
      const name = `${crypto.randomUUID()}.${ext}`;
      await files().put(`${encodeURIComponent(owner)}/${name}`, bytes, { httpMetadata: { contentType: mime }, customMetadata: { filename: file.name.slice(0, 200) } });
      return response({ url: `/api/media/${name}`, name: file.name });
    }
    if (route.startsWith('media/') && request.method === 'GET') {
      const name = route.slice(6);
      if (!/^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(name)) throw new ApiError(404, '图片不存在。');
      const object = await files().get(`${encodeURIComponent(owner)}/${name}`);
      if (!object) throw new ApiError(404, '图片不存在。');
      return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
    }
    if (route === 'publish' && request.method === 'POST') {
      const { id, revision } = await jsonBody(request);
      const draft = await ensureDraftFilename(owner, id);
      if (draft.deleted_at) throw new ApiError(409, '这篇草稿已移入回收站，请先恢复。');
      if (draft.revision !== revision) throw new ApiError(409, '草稿已更新，请保存最新内容后重新发布。');
      if (!draft.title.trim() || !draft.body.trim()) throw new ApiError(400, '请填写文章标题和正文。');
      const call = await account(owner);
      const previous = await db.prepare('SELECT * FROM publications WHERE draft_id=? AND revision=? AND owner=?').bind(id, revision, owner).first<any>();
      if (previous) return response(previous);
      const release = crypto.randomUUID();
      const path = draft.source_path || newArticlePath(draft.collection, draft.filename);
      const target = articleUrl(path);
      const inserted = await db.prepare('INSERT OR IGNORE INTO publications (id,owner,draft_id,revision,state,url,target_path,title,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(release, owner, id, revision, 'preparing', target, path, draft.title, new Date().toISOString()).run();
      if (!inserted.meta.changes) return response(await db.prepare('SELECT * FROM publications WHERE draft_id=? AND revision=? AND owner=?').bind(id, revision, owner).first());
      let advancedSha: string | null = null;
      try {
        const result = await publishDraft(draft, path, release, call,
          name => files().get(`${encodeURIComponent(owner)}/${name}`), async sha => {
          advancedSha = sha;
          await db.prepare('UPDATE publications SET commit_sha=?,state=? WHERE id=? AND owner=?').bind(sha, 'verifying', release, owner).run();
        });
        await db.batch([
          db.prepare('UPDATE publications SET state=? WHERE id=? AND owner=?').bind('submitted', release, owner),
          db.prepare('UPDATE drafts SET source_path=?,base_sha=?,first_published_at=COALESCE(first_published_at,?) WHERE id=? AND owner=?').bind(path, result.blobSha, result.firstPublishedAt, id, owner),
        ]);
      } catch (error) {
        const message = error instanceof ApiError || (error instanceof Error && error.message.startsWith('文章信息')) ? (error as Error).message : '发布请求未完成。草稿已保留，请检查发布记录。';
        await db.prepare('UPDATE publications SET state=?,error=? WHERE id=? AND owner=?').bind(advancedSha ? 'verifying' : 'failed', message, release, owner).run();
      }
      return response(await db.prepare('SELECT * FROM publications WHERE id=? AND owner=?').bind(release, owner).first());
    }
    if (route.startsWith('publication/') && request.method === 'GET') {
      const id = route.slice(12);
      let job = await db.prepare('SELECT * FROM publications WHERE id=? AND owner=?').bind(id, owner).first<any>();
      if (!job) throw new ApiError(404, '找不到发布记录。');
      if (!needsPublicationCheck(job.state)) return response(job);
      const successor = job.commit_sha && job.target_path
        ? await db.prepare('SELECT id FROM publications WHERE owner=? AND target_path=? AND state=? AND created_at>? LIMIT 1').bind(owner, job.target_path, 'live', job.created_at).first()
        : null;
      const call = await account(owner);
      job = await checkPublication(job, call, async (blobSha, publishedAt) => {
        if (job.action === 'delete' || job.action === 'restore') {
          await db.prepare('UPDATE article_trash SET state=?,restored_at=? WHERE id=? AND owner=?').bind(job.action === 'delete' ? 'removed' : 'restored', job.action === 'restore' ? new Date().toISOString() : null, job.trash_id, owner).run();
        } else await db.prepare('UPDATE drafts SET source_path=?,base_sha=?,first_published_at=COALESCE(first_published_at,?) WHERE id=? AND owner=?').bind(job.target_path, blobSha, publishedAt, job.draft_id, owner).run();
      }, fetch, Date.now(), Boolean(successor));
      await db.prepare('UPDATE publications SET state=?,error=? WHERE id=? AND owner=?').bind(job.state, job.error, job.id, owner).run();
      if (job.state === 'failed' && job.action === 'delete') await db.prepare("UPDATE article_trash SET state='failed' WHERE id=? AND owner=? AND state='pending'").bind(job.trash_id, owner).run();
      return response(job);
    }
    throw new ApiError(404, '接口不存在。');
  } catch (error) {
    return response({ error: error instanceof ApiError ? error.message : '操作暂时未完成，请稍后重试。' }, error instanceof ApiError ? error.status : 500);
  }
}
export const GET = handle;
export const POST = handle;
