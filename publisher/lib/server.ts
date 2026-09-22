import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ApiError, github } from './github';

export const database = () => env.DB;
export const files = () => env.FILES;
export async function identity(request: Request) {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, '请先登录，再保存或发布文章。');
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, '请求来源无效，请刷新页面重试。');
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, '请求来源无效。');
  }
  return user.userId;
}
export async function jsonBody(request: Request) {
  const text = await request.text();
  if (text.length > 500000) throw new ApiError(413, '文章过长，请控制在 50 万字符以内。');
  try { return JSON.parse(text); } catch { throw new ApiError(400, '提交内容格式无效。'); }
}
export function credentialReady() { return typeof (env as any).CREDENTIAL_KEY === 'string' && (env as any).CREDENTIAL_KEY.length >= 32; }
async function key() {
  const secret = (env as any).CREDENTIAL_KEY;
  if (!secret || secret.length < 32) throw new ApiError(503, '写作室还需要完成安全配置，草稿功能可以先使用。');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function encryptToken(token: string, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) }, await key(), new TextEncoder().encode(token));
  return `${Buffer.from(iv).toString('base64')}.${Buffer.from(encrypted).toString('base64')}`;
}
export async function account(owner: string) {
  const row = await database().prepare('SELECT ciphertext FROM connections WHERE owner = ?').bind(owner).first<{ ciphertext: string }>();
  if (!row) throw new ApiError(428, '请先在「连接博客」中连接 GitHub。');
  const [iv, ciphertext] = row.ciphertext.split('.');
  try {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64'), additionalData: new TextEncoder().encode(owner) }, await key(), Buffer.from(ciphertext, 'base64'));
    return github(new TextDecoder().decode(decrypted));
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(428, '连接已失效，请重新连接 GitHub。'); }
}
export async function ownedDraft(owner: string, id: string) {
  const row = await database().prepare('SELECT * FROM drafts WHERE id = ? AND owner = ?').bind(id, owner).first<any>();
  if (!row) throw new ApiError(404, '找不到这篇草稿。');
  return row;
}
export function response(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }); }
