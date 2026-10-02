import { account, credentialReady, database, encryptToken, files, identity, jsonBody, response } from '@/lib/server';
import { ApiError, github } from '@/lib/github';
import { REPO } from '@/lib/content';
import { managementRequest } from '@/lib/management-server';
import { createWritingService } from '@/lib/writing-service';

export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    const owner = await identity(request);
    const url = new URL(request.url);
    const route = url.pathname.slice('/api/'.length);
    const db = database();
    const writing = createWritingService({ db, getAccount: account, storage: files() });
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
      return response(await writing.saveDraft(owner, await jsonBody(request)));
    }
    if (route.startsWith('drafts/') && request.method === 'GET') {
      return response(await writing.getDraft(owner, route.slice(7)));
    }
    if (route === 'import' && request.method === 'POST') {
      const { path } = await jsonBody(request);
      return response(await writing.importArticle(owner, path));
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
      return response(await writing.publish(owner, await jsonBody(request)));
    }
    if (route.startsWith('publication/') && request.method === 'GET') {
      return response(await writing.getPublication(owner, route.slice(12)));
    }
    throw new ApiError(404, '接口不存在。');
  } catch (error) {
    return response({ error: error instanceof ApiError ? error.message : '操作暂时未完成，请稍后重试。' }, error instanceof ApiError ? error.status : 500);
  }
}
export const GET = handle;
export const POST = handle;
