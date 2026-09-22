import { REPO, validPath } from './content';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function github(token: string, request: typeof fetch = fetch) {
  return async function call(path: string, method = 'GET', body?: unknown): Promise<any> {
    const response = await request(`https://api.github.com${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Mon-Blog-Publisher', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        const detail = await response.json().catch(() => null) as { message?: string } | null;
        const message = typeof detail?.message === 'string' ? detail.message : '';
        if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after') || /rate limit|abuse detection/i.test(message)) {
          throw new ApiError(response.status, 'GitHub 请求达到频率限制，请暂停操作，稍后再试。草稿已保留。');
        }
        if (/resource not accessible|permission|read.only/i.test(message)) {
          throw new ApiError(403, path.includes('/actions/')
            ? 'GitHub 令牌缺少 Actions 的 Read-only 权限，暂时无法查询部署状态。'
            : 'GitHub 令牌不能执行此操作。请将仓库范围设为 Mon-Blog，并将 Contents 设为 Read and write，然后保存令牌设置。');
        }
      }
      const messages: Record<number, string> = { 401: 'GitHub 授权已过期，请重新连接。', 403: 'GitHub 权限不足或请求受限，请检查仓库授权。', 404: 'GitHub 中没有找到目标内容。', 409: '仓库已有新修改，请重新载入后发布。', 422: '仓库版本已变化或分支受到保护，请重新载入后发布。', 429: 'GitHub 请求过于频繁，请稍后重试。' };
      throw new ApiError(response.status, messages[response.status] || `GitHub 暂时不可用（${response.status}），草稿已保留。`);
    }
    return response.status === 204 ? null : response.json();
  };
}

// A deletion is a normal non-forced commit; callers persist a recovery copy first.
export async function removeArticle(call: GitCall, path: string, expectedSha: string, title: string, release: string, beforeAdvance: (sha: string) => Promise<void>) {
  if (!validPath(path)) throw new ApiError(400, '文章路径无效。');
  const head = await call(`/repos/${REPO}/git/ref/heads/main`);
  const current = await readArticle(call, path, head.object.sha);
  if (current.sha !== expectedSha) throw new ApiError(409, '文章已被修改，请同步文章列表后重新确认删除。');
  const parent = await call(`/repos/${REPO}/git/commits/${head.object.sha}`);
  const tree = await call(`/repos/${REPO}/git/trees`, 'POST', { base_tree: parent.tree.sha, tree: [{ path, mode: '100644', type: 'blob', sha: null }] });
  const commit = await call(`/repos/${REPO}/git/commits`, 'POST', { message: `Unpublish: ${title.replace(/[\r\n]/g, ' ').slice(0, 100)}\n\nPublisher-Release: ${release}`, tree: tree.sha, parents: [head.object.sha] });
  await beforeAdvance(commit.sha);
  await call(`/repos/${REPO}/git/refs/heads/main`, 'PATCH', { sha: commit.sha, force: false });
  return commit.sha as string;
}
export type GitCall = ReturnType<typeof github>;
export async function readArticle(call: GitCall, path: string, ref = 'main') {
  if (!validPath(path)) throw new ApiError(400, '不能编辑此路径。');
  return call(`/repos/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
}
export async function commitArticle(call: GitCall, input: { path: string; baseSha: string | null; markdown: string; title: string; release: string; assets: { path: string; base64: string }[] }, beforeAdvance: (sha: string) => Promise<void>) {
  if (!validPath(input.path)) throw new ApiError(400, '文章路径无效。');
  const head = await call(`/repos/${REPO}/git/ref/heads/main`);
  const parent = head.object.sha;
  let current: any = null;
  try { current = await readArticle(call, input.path, parent); } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
  if ((current?.sha ?? null) !== input.baseSha) throw new ApiError(409, '这篇文章已在其他地方修改。当前草稿已保留，请重新导入最新文章再合并。');
  const commit = await call(`/repos/${REPO}/git/commits/${parent}`);
  const tree: any[] = [{ path: input.path, mode: '100644', type: 'blob', content: input.markdown }];
  for (const asset of input.assets) {
    if (!/^docs\/assets\/publisher\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(asset.path)) throw new ApiError(400, '图片路径无效。');
    const blob = await call(`/repos/${REPO}/git/blobs`, 'POST', { content: asset.base64, encoding: 'base64' });
    tree.push({ path: asset.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const nextTree = await call(`/repos/${REPO}/git/trees`, 'POST', { base_tree: commit.tree.sha, tree });
  const next = await call(`/repos/${REPO}/git/commits`, 'POST', { message: `Publish: ${input.title.replace(/[\r\n]/g, ' ').slice(0, 100)}\n\nPublisher-Release: ${input.release}`, tree: nextTree.sha, parents: [parent] });
  await beforeAdvance(next.sha);
  await call(`/repos/${REPO}/git/refs/heads/main`, 'PATCH', { sha: next.sha, force: false });
  return { commitSha: next.sha, blobSha: nextTree.tree?.find((item: any) => item.path === input.path)?.sha as string | undefined };
}
