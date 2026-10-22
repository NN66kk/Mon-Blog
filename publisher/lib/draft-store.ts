import { articleNumber } from './article-templates';
import { ApiError } from './github';

export type DraftInput = {
  id: string;
  title: string;
  body: string;
  metadata: string;
  collection: string;
  revision: number;
};
export type DraftRecord = DraftInput & {
  owner: string;
  source_path: string | null;
  filename: string | null;
  base_sha: string | null;
  first_published_at: string | null;
  deleted_at: string | null;
  updated_at: string;
};

// The authenticated owner is supplied by the caller. This store deliberately
// has no Worker bindings, authentication, GitHub client or publication effects.
export function createDraftStore(db: Pick<D1Database, 'prepare'>) {
  async function ownedDraft(owner: string, id: string) {
    const row = await db
      .prepare('SELECT * FROM drafts WHERE id = ? AND owner = ?')
      .bind(id, owner)
      .first<DraftRecord>();
    if (!row) throw new ApiError(404, '找不到这篇草稿。');
    return row;
  }

  function snapshotDraft(owner: string, id: string) {
    return db
      .prepare(
        'INSERT OR IGNORE INTO draft_versions (id,owner,draft_id,revision,title,collection,body,metadata,created_at) SELECT ?,owner,id,revision,title,collection,body,metadata,updated_at FROM drafts WHERE owner=? AND id=?',
      )
      .bind(crypto.randomUUID(), owner, id);
  }

  // A filename belongs to the draft, independently of its title and editable
  // date. The unique index arbitrates simultaneous creation on two devices.
  async function ensureDraftFilename(owner: string, id: string) {
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

  return { ownedDraft, snapshotDraft, ensureDraftFilename };
}
