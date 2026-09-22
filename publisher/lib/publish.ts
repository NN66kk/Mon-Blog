import { composeMarkdown, relativeAsset, REPO } from './content';
import { ApiError, commitArticle, readArticle, type GitAsset, type GitCall } from './github';

type DraftToPublish = {
  id: string;
  title: string;
  metadata: string;
  body: string;
  base_sha: string | null;
  source_path?: string | null;
  first_published_at?: string | null;
};
type ImageObject = { size: number; arrayBuffer(): Promise<ArrayBuffer> };

// Return publication metadata only after the branch has advanced successfully.
// A failed attempt must not change the draft's first publication date.
export async function publishDraft(
  draft: DraftToPublish,
  path: string,
  release: string,
  call: GitCall,
  loadImage: (name: string) => Promise<ImageObject | null>,
  beforeAdvance: (sha: string) => Promise<void>,
  now = new Date().toISOString(),
) {
  const firstPublishedAt = draft.first_published_at || (!draft.source_path ? now : null);
  const names = [...new Set(Array.from(draft.body.matchAll(/\/api\/media\/([a-f0-9-]{36}\.(?:png|jpg|webp|gif))/g), m => m[1]))];
  const assetFolder = `docs/assets/publisher/${draft.id}`;
  const published = new Map<string, string>();
  if (draft.source_path && names.length) {
    try {
      const entries = await call(`/repos/${REPO}/contents/${assetFolder}?ref=main`);
      if (!Array.isArray(entries)) throw new ApiError(409, '已发布的图片目录无效，请检查博客仓库。');
      for (const entry of entries) {
        if (entry.type === 'file' && entry.path === `${assetFolder}/${entry.name}` && typeof entry.sha === 'string') {
          published.set(entry.name, entry.sha);
        }
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  if (names.filter(name => !published.has(name)).length > 12) throw new ApiError(400, '每次发布最多支持 12 张新图片。');
  const assets: GitAsset[] = [];
  let body = draft.body;
  let total = 0;
  for (const name of names) {
    const assetPath = `${assetFolder}/${name}`;
    const existingSha = published.get(name);
    body = body.replaceAll(`/api/media/${name}`, relativeAsset(path, assetPath));
    if (existingSha) {
      // Reuse immutable Git blobs so old images consume neither upload quota
      // nor R2 reads, and remain in the article's commit if the branch changes.
      assets.push({ path: assetPath, sha: existingSha });
      continue;
    }
    const object = await loadImage(name);
    if (!object) throw new ApiError(400, '有图片上传未完成，请重新插入图片后发布。');
    total += object.size;
    if (total > 20 * 1024 * 1024) throw new ApiError(400, '本次图片总大小超过 20 MB，请压缩后发布。');
    assets.push({ path: assetPath, base64: Buffer.from(await object.arrayBuffer()).toString('base64') });
  }
  if (body.includes('/api/media/')) throw new ApiError(400, '正文含无效的临时图片地址，请重新插入图片。');
  const markdown = composeMarkdown({ ...draft, body, first_published_at: firstPublishedAt }, release, now);
  const result = await commitArticle(call, { path, baseSha: draft.base_sha, markdown, title: draft.title, release, assets }, beforeAdvance);
  const blobSha = result.blobSha || (await readArticle(call, path, result.commitSha)).sha;
  return { ...result, blobSha, firstPublishedAt };
}
