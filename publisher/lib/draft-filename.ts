import { articleNumber } from './article-templates';
import { database, ownedDraft } from './server';
import { ApiError } from './github';

// A filename belongs to the draft, independently of its title and editable date.
// The unique index arbitrates simultaneous creation on two devices.
export async function ensureDraftFilename(owner: string, id: string) {
  const db = database();
  let draft = await ownedDraft(owner, id);
  if (draft.source_path || draft.filename) return draft;
  const now = Date.now();
  for (let offset = 0; offset < 120; offset++) {
    const filename = `${articleNumber(new Date(now + offset * 1000))}.md`;
    const path = `docs/${draft.collection}/${filename}`;
    const occupied = await db
      .prepare(
        'SELECT 1 FROM article_cache WHERE owner=? AND path=? UNION ALL SELECT 1 FROM drafts WHERE owner=? AND source_path=? LIMIT 1',
      )
      .bind(owner, path, owner, path)
      .first();
    if (occupied) continue;
    await db
      .prepare(
        'UPDATE OR IGNORE drafts SET filename=? WHERE owner=? AND id=? AND filename IS NULL AND source_path IS NULL',
      )
      .bind(filename, owner, id)
      .run();
    draft = await ownedDraft(owner, id);
    if (draft.filename || draft.source_path) return draft;
  }
  throw new ApiError(409, '暂时无法分配文章编号，内容已保存，请稍后重试。');
}
