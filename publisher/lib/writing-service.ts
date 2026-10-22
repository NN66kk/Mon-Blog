import { createDraftStore, type DraftInput, type DraftRecord } from './draft-store';
import { createArticleIndex } from './article-index';
export type { DraftInput } from './draft-store';
import { articleUrl, newArticlePath, splitMarkdown, validCollection, validPath } from './content';
import { ApiError, readArticle, type GitCall } from './github';
import { metadataForArticle } from './management';
import { checkPublication, needsPublicationCheck, type Publication } from './publication';
import { draftPublicationUpdate } from './publication-baseline';
import { publishDraft } from './publish';

type ImageObject = { size: number; arrayBuffer(): Promise<ArrayBuffer> };
export type WritingServiceDependencies = {
  db: Pick<D1Database, 'prepare' | 'batch'>;
  getAccount: (owner: string) => Promise<GitCall>;
  storage: { get(key: string): Promise<ImageObject | null> };
  request?: typeof fetch;
};

export type ListOptions = { query?: string; limit?: number; offset?: number };
export type ArticleSearchOptions = ListOptions & { collection?: string };
type PublicationRecord = Publication & {
  owner: string;
  draft_id: string;
  revision: number;
  commit_sha: string | null;
  target_path: string | null;
  action: string;
  title: string | null;
  trash_id: string | null;
};
const UUID = /^[a-f0-9-]{36}$/;
function pagination(options: ListOptions) {
  const { query = '', limit = 20, offset = 0 } = options;
  if (typeof query !== 'string' || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1000000) {
    throw new ApiError(400, '搜索条件或分页参数无效。');
  }
  return { query: query.trim(), limit, offset };
}

// Both the website and MCP authenticate their caller before entering this layer.
// The owner always comes from that authenticated identity, never tool arguments.
export function createWritingService({ db, getAccount, storage, request = fetch }: WritingServiceDependencies) {
  const { ownedDraft, snapshotDraft, ensureDraftFilename } = createDraftStore(db);
  const articleIndex = createArticleIndex({ db, getAccount });

  async function ownedPublication(owner: string, id: string) {
    const row = await db.prepare('SELECT * FROM publications WHERE id=? AND owner=?').bind(id, owner).first<PublicationRecord>();
    if (!row) throw new ApiError(404, '找不到发布记录。');
    return row;
  }

  async function saveDraft(owner: string, input: DraftInput) {
    if (!input || typeof input !== 'object') throw new ApiError(400, '草稿内容或栏目无效。');
    const { id, title, body, metadata, collection, revision } = input;
    if (typeof id !== 'string' || !UUID.test(id) || typeof title !== 'string' || title.length > 300 || typeof body !== 'string' || body.length > 300000 || typeof metadata !== 'string' || metadata.length > 30000 || !validCollection(collection) || !Number.isInteger(revision) || revision < 0) throw new ApiError(400, '草稿内容或栏目无效。');
    const now = new Date().toISOString();
    if (revision === 0) {
      const results = await db.batch([db.prepare('INSERT OR IGNORE INTO drafts (id,owner,title,collection,body,metadata,revision,updated_at) VALUES (?,?,?,?,?,?,1,?)').bind(id, owner, title, collection, body, metadata, now), snapshotDraft(owner, id)]);
      if (!results[0].meta.changes) throw new ApiError(409, '草稿已有新版本，请刷新草稿列表后重新打开。');
    } else {
      const existing = await ownedDraft(owner, id);
      if (existing.deleted_at) throw new ApiError(409, '这篇草稿已移入回收站，请先恢复再编辑。');
      if (existing.source_path && existing.collection !== collection) throw new ApiError(400, '已发布文章暂不支持移动栏目，以保持原有网址。');
      if (existing.collection !== collection && await db.prepare("SELECT 1 FROM publications WHERE owner=? AND draft_id=? AND state <> 'failed' LIMIT 1").bind(owner, id).first()) {
        throw new ApiError(409, '这篇草稿已经发起发布，暂不能更换栏目。请重新读取草稿后重试。');
      }
      // A publication may be inserted after the read above. Keep the first
      // publication's target stable even before source_path is confirmed.
      const results = await db.batch([snapshotDraft(owner, id), db.prepare("UPDATE drafts SET title=?,collection=?,body=?,metadata=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL AND (collection=? OR (source_path IS NULL AND NOT EXISTS (SELECT 1 FROM publications WHERE publications.owner=drafts.owner AND publications.draft_id=drafts.id AND publications.state <> 'failed')))").bind(title, collection, body, metadata, now, id, owner, revision, collection), snapshotDraft(owner, id)]);
      if (!results[1].meta.changes) throw new ApiError(409, '草稿已有新版本或发布任务。请先保留当前内容，再重新读取草稿后重试。');
    }
    const saved = await ensureDraftFilename(owner, id);
    return { revision: revision + 1, updated_at: now, filename: saved.filename };
  }

  async function getDraft(owner: string, id: string) {
    const draft = await ownedDraft(owner, id);
    if (draft.deleted_at) throw new ApiError(409, '草稿已在回收站，请先恢复。');
    return draft;
  }

  async function listDrafts(owner: string, options: ListOptions = {}) {
    const { query, limit, offset } = pagination(options);
    const filter = 'owner=? AND deleted_at IS NULL AND (? = \'\' OR instr(lower(title),lower(?)) > 0)';
    const [rows, count] = await Promise.all([
      db.prepare(`SELECT id,title,collection,revision,updated_at,source_path,filename FROM drafts WHERE ${filter} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).bind(owner, query, query, limit, offset).all<Pick<DraftRecord, 'id' | 'title' | 'collection' | 'revision' | 'updated_at' | 'source_path' | 'filename'>>(),
      db.prepare(`SELECT count(*) AS total FROM drafts WHERE ${filter}`).bind(owner, query, query).first<{ total: number }>(),
    ]);
    const total = count?.total || 0;
    return { drafts: rows.results, total, limit, offset, has_more: offset + rows.results.length < total };
  }

  async function getArticle(owner: string, path: string) {
    if (typeof path !== 'string' || !validPath(path)) throw new ApiError(400, '文章路径无效。');
    const remote = await readArticle(await getAccount(owner), path);
    if (!remote.content || remote.encoding !== 'base64' || remote.size > 1000000) throw new ApiError(400, '文章过大，暂不能读取。');
    const source = Buffer.from(remote.content, 'base64').toString('utf8');
    let parsed;
    let info;
    try {
      parsed = splitMarkdown(source);
      info = metadataForArticle(path, source);
    } catch {
      throw new ApiError(400, '文章信息中的 YAML 格式有误，请先修正。');
    }
    if (parsed.data?.status === 'redirect') throw new ApiError(400, '这是跳转页面，请选择普通文章。');
    return { ...info, sha: remote.sha, metadata: parsed.metadata, body: parsed.body };
  }

  async function importArticle(owner: string, path: string) {
    const article = await getArticle(owner, path);
    const matchingDraft = () => db.prepare('SELECT * FROM drafts WHERE owner=? AND source_path=? AND base_sha=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1').bind(owner, path, article.sha).first<DraftRecord>();
    const existingDraft = await matchingDraft();
    if (existingDraft) return existingDraft;
    const id = crypto.randomUUID();
    // The guard belongs to the INSERT itself: two clients may both finish the
    // initial read before either creates a draft. A trashed draft does not block
    // a later import, so this deliberately is not a permanent unique constraint.
    await db.batch([
      db.prepare('INSERT INTO drafts (id,owner,title,collection,body,metadata,source_path,base_sha,revision,updated_at) SELECT ?,?,?,?,?,?,?,?,1,? WHERE NOT EXISTS (SELECT 1 FROM drafts WHERE owner=? AND source_path=? AND base_sha=? AND deleted_at IS NULL)')
        .bind(id, owner, article.title, article.collection, article.body, article.metadata, path, article.sha, new Date().toISOString(), owner, path, article.sha),
      snapshotDraft(owner, id),
    ]);
    const imported = await matchingDraft();
    if (!imported) throw new ApiError(409, '草稿状态已变化，请重新导入文章。');
    return imported;
  }

  async function searchArticles(owner: string, options: ArticleSearchOptions = {}) {
    const { query, limit, offset } = pagination(options);
    if (options.collection !== undefined && !validCollection(options.collection)) throw new ApiError(400, '栏目无效。');
    const articles = await articleIndex.list(owner, options.collection);
    const needle = query.toLocaleLowerCase();
    const matches = articles.filter((article) => [article.title, article.path, article.description, ...article.tags].some((value) => value.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || '') || a.path.localeCompare(b.path));
    const unindexed = articles.filter((article) => !article.indexed).length;
    return {
      articles: matches.slice(offset, offset + limit), total: matches.length, limit, offset,
      has_more: offset + limit < matches.length,
      search_fields: ['title', 'path', 'description', 'tags'],
      index_complete: unindexed === 0, unindexed_count: unindexed,
      ...(unindexed ? { warning: '部分文章标题和标签尚未同步，搜索结果可能不完整。请刷新文章索引后重试。' } : {}),
    };
  }

  async function refreshArticleIndex(owner: string, options: { limit?: number } = {}) {
    return articleIndex.refresh(owner, options);
  }

  async function publish(owner: string, input: { id: string; revision: number }) {
    if (!input || typeof input.id !== 'string' || !UUID.test(input.id) || !Number.isInteger(input.revision) || input.revision < 1) throw new ApiError(400, '发布参数无效。');
    const { id, revision } = input;
    const draft = await ensureDraftFilename(owner, id);
    if (draft.deleted_at) throw new ApiError(409, '这篇草稿已移入回收站，请先恢复。');
    if (draft.revision !== revision) throw new ApiError(409, '草稿已更新，请保存最新内容后重新发布。');
    if (!draft.title.trim() || !draft.body.trim()) throw new ApiError(400, '请填写文章标题和正文。');
    const call = await getAccount(owner);
    const previous = await db.prepare('SELECT * FROM publications WHERE draft_id=? AND revision=? AND owner=?').bind(id, revision, owner).first<PublicationRecord>();
    if (previous) return previous;
    const release = crypto.randomUUID();
    const path = draft.source_path || newArticlePath(draft.collection, draft.filename || '');
    const target = articleUrl(path);
    // Saving a new revision/collection and claiming a publication both arbitrate
    // in SQL, so a stale in-memory draft cannot publish to its former column.
    const inserted = await db.prepare('INSERT OR IGNORE INTO publications (id,owner,draft_id,revision,state,url,target_path,title,created_at) SELECT ?,?,?,?,?,?,?,?,? FROM drafts WHERE id=? AND owner=? AND revision=? AND collection=? AND deleted_at IS NULL').bind(release, owner, id, revision, 'preparing', target, path, draft.title, new Date().toISOString(), id, owner, revision, draft.collection).run();
    if (!inserted.meta.changes) {
      const existing = await db.prepare('SELECT * FROM publications WHERE draft_id=? AND revision=? AND owner=?').bind(id, revision, owner).first<PublicationRecord>();
      if (existing) return existing;
      throw new ApiError(409, '草稿已更新，请重新读取并确认最新版本后再发布。');
    }
    let advancedSha: string | null = null;
    try {
      const result = await publishDraft(draft, path, release, call,
        name => storage.get(`${encodeURIComponent(owner)}/${name}`), async sha => {
          advancedSha = sha;
          await db.prepare('UPDATE publications SET commit_sha=?,state=? WHERE id=? AND owner=?').bind(sha, 'verifying', release, owner).run();
        });
      await db.batch([
        db.prepare("UPDATE publications SET state=?,error=NULL WHERE id=? AND owner=? AND state IN ('preparing','verifying') AND commit_sha=?").bind('submitted', release, owner, advancedSha),
        draftPublicationUpdate(db, { owner, draftId: id, path, blobSha: result.blobSha, firstPublishedAt: result.firstPublishedAt, expectedBaseSha: draft.base_sha }),
      ]);
    } catch (error) {
      const message = error instanceof ApiError || (error instanceof Error && error.message.startsWith('文章信息')) ? (error as Error).message : '发布请求未完成。草稿已保留，请检查发布记录。';
      await db.prepare("UPDATE publications SET state=?,error=? WHERE id=? AND owner=? AND state IN ('preparing','verifying') AND (commit_sha IS ? OR commit_sha IS NULL)").bind(advancedSha ? 'verifying' : 'failed', message, release, owner, advancedSha).run();
    }
    return ownedPublication(owner, release);
  }

  async function getPublication(owner: string, id: string) {
    let job = await ownedPublication(owner, id);
    if (!needsPublicationCheck(job.state)) return job;
    const expectedState = job.state;
    const expectedCommitSha = job.commit_sha;
    const targetPath = job.target_path;
    const draft = job.state === 'verifying' && job.action !== 'delete' && job.action !== 'restore' ? await ownedDraft(owner, job.draft_id) : null;
    const successor = job.commit_sha && job.target_path
      ? await db.prepare('SELECT id FROM publications WHERE owner=? AND target_path=? AND state=? AND created_at>? LIMIT 1').bind(owner, job.target_path, 'live', job.created_at).first()
      : null;
    const call = await getAccount(owner);
    job = await checkPublication(job, call, async (blobSha, publishedAt) => {
      if (job.action === 'delete' || job.action === 'restore') {
        await db.prepare('UPDATE article_trash SET state=?,restored_at=? WHERE id=? AND owner=?').bind(job.action === 'delete' ? 'removed' : 'restored', job.action === 'restore' ? new Date().toISOString() : null, job.trash_id, owner).run();
      } else if (draft && targetPath) {
        // Only confirm a baseline while this committed article is still current.
        // The CAS also protects a newer confirmation arriving during this read.
        let current;
        try { current = await readArticle(call, targetPath); }
        catch (error) { if (error instanceof ApiError && error.status === 404) return; throw error; }
        if (current.sha !== blobSha) return;
        await draftPublicationUpdate(db, { owner, draftId: job.draft_id, path: targetPath, blobSha, firstPublishedAt: publishedAt, expectedBaseSha: draft.base_sha }).run();
      }
    }, request, Date.now(), Boolean(successor));
    // Another caller may have confirmed this job while remote reads were pending.
    // Never replace that newer state with this request's older observation.
    await db.prepare('UPDATE publications SET state=?,error=? WHERE id=? AND owner=? AND state=? AND commit_sha IS ?').bind(job.state, job.error, job.id, owner, expectedState, expectedCommitSha).run();
    const current = await ownedPublication(owner, id);
    if (current.state === 'failed' && current.action === 'delete') await db.prepare("UPDATE article_trash SET state='failed' WHERE id=? AND owner=? AND state='pending'").bind(current.trash_id, owner).run();
    return current;
  }

  return { saveDraft, getDraft, importArticle, publish, getPublication, getArticle, listDrafts, searchArticles, refreshArticleIndex };
}
