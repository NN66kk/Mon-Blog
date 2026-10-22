import { articleUrl, REPO } from './content';
import { ApiError, type GitCall } from './github';
import { managedPath, metadataForArticle } from './management';

type ArticleReference = { path: string; sha: string };
type TreeEntry = ArticleReference & { type: string };
type ArticleMetadata = ReturnType<typeof metadataForArticle>;
type ArticleCacheRecord = {
  id: string;
  owner: string;
  path: string;
  sha: string;
  title: string;
  tags: string;
  description: string;
  published_at: string | null;
  updated_at: string | null;
  synced_at: string;
};
type IndexDependencies = {
  db: Pick<D1Database, 'prepare'>;
  getAccount: (owner: string) => Promise<GitCall>;
};
type IndexResult =
  | { ok: true; metadata: ArticleMetadata }
  | { ok: false; reason: 'blob' | 'metadata' };

// Keep GitHub traffic bounded consistently for both web and MCP callers. A
// failed remote/DB request still rejects; only known content errors are partial.
async function inBatches<T>(
  articles: ArticleReference[],
  task: (article: ArticleReference) => Promise<T>,
) {
  const result: T[] = [];
  for (let start = 0; start < articles.length; start += 4) {
    result.push(
      ...(await Promise.all(articles.slice(start, start + 4).map(task))),
    );
  }
  return result;
}

export function createArticleIndex({ db, getAccount }: IndexDependencies) {
  async function readCatalog(owner: string) {
    const call = await getAccount(owner);
    const [tree, cached] = await Promise.all([
      call(`/repos/${REPO}/git/trees/main?recursive=1`),
      db
        .prepare('SELECT * FROM article_cache WHERE owner=?')
        .bind(owner)
        .all<ArticleCacheRecord>(),
    ]);
    if (tree.truncated)
      throw new ApiError(502, '文章目录超出读取范围，请联系管理员。');
    const articles = (tree.tree as TreeEntry[]).filter(
      (item) => item.type === 'blob' && managedPath(item.path),
    );
    return {
      call,
      articles,
      cache: new Map(cached.results.map((row) => [row.path, row])),
    };
  }

  async function list(owner: string, collection?: string) {
    const { articles, cache } = await readCatalog(owner);
    return articles
      .filter((item) => !collection || item.path.split('/')[1] === collection)
      .map((item) => {
        const row = cache.get(item.path);
        return {
          ...metadataForArticle(item.path, ''),
          ...(row
            ? {
                title: row.title,
                tags: JSON.parse(row.tags) as string[],
                description: row.description,
                published_at: row.published_at,
                updated_at: row.updated_at,
              }
            : {}),
          sha: item.sha,
          indexed: row?.sha === item.sha,
        };
      });
  }

  async function indexArticle(
    owner: string,
    call: GitCall,
    item: ArticleReference,
    requireContent: boolean,
  ): Promise<IndexResult> {
    const remote = await call(`/repos/${REPO}/git/blobs/${item.sha}`);
    // Web's existing empty-blob behavior differs from MCP: preserve it while
    // sharing all actual parsing and cache writes.
    if (
      remote.encoding !== 'base64' ||
      remote.size > 1000000 ||
      (requireContent && !remote.content)
    )
      return { ok: false, reason: 'blob' };
    let metadata: ArticleMetadata;
    try {
      metadata = metadataForArticle(
        item.path,
        Buffer.from(remote.content, 'base64').toString('utf8'),
      );
    } catch {
      return { ok: false, reason: 'metadata' };
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
        metadata.title,
        JSON.stringify(metadata.tags),
        metadata.description,
        metadata.published_at,
        metadata.updated_at,
        new Date().toISOString(),
      )
      .run();
    return { ok: true, metadata };
  }

  async function details(owner: string, articles: ArticleReference[]) {
    if (
      !Array.isArray(articles) ||
      articles.length > 12 ||
      articles.some(
        (item) =>
          !managedPath(item?.path) ||
          typeof item.sha !== 'string' ||
          !/^[a-f0-9]{40}$/.test(item.sha),
      )
    )
      throw new ApiError(400, '文章同步参数无效。');
    const call = await getAccount(owner);
    return inBatches(articles, async (item) => {
      const old = await db
        .prepare('SELECT sha FROM article_cache WHERE owner=? AND path=?')
        .bind(owner, item.path)
        .first<{ sha: string }>();
      if (old?.sha === item.sha) {
        const cache = await db
          .prepare('SELECT * FROM article_cache WHERE owner=? AND path=?')
          .bind(owner, item.path)
          .first<ArticleCacheRecord>();
        // Preserve the web endpoint's full cached-row response shape.
        return {
          ...cache!,
          collection: item.path.split('/')[1],
          url: articleUrl(item.path),
          tags: JSON.parse(cache!.tags) as string[],
          indexed: true,
        };
      }
      const result = await indexArticle(owner, call, item, false);
      if (!result.ok)
        return {
          path: item.path,
          index_error:
            result.reason === 'blob'
              ? '文章过大，暂未索引。'
              : '文章信息格式有误，可在 GitHub 修正。',
        };
      return { ...result.metadata, sha: item.sha, indexed: true };
    });
  }

  async function refresh(owner: string, options: { limit?: number } = {}) {
    const limit = options.limit ?? 12;
    if (!Number.isInteger(limit) || limit < 1 || limit > 12)
      throw new ApiError(400, '每次可同步 1 至 12 篇文章。');
    const { call, articles, cache } = await readCatalog(owner);
    const pending = articles.filter(
      (item) => cache.get(item.path)?.sha !== item.sha,
    );
    const errors: { path: string; error: string }[] = [];
    let indexed = 0;
    await inBatches(pending.slice(0, limit), async (item) => {
      const result = await indexArticle(owner, call, item, true);
      if (!result.ok)
        errors.push({
          path: item.path,
          error:
            result.reason === 'blob'
              ? '文章过大或格式无效，暂未索引。'
              : '文章信息中的 YAML 格式有误，暂未索引。',
        });
      else indexed++;
    });
    const remaining = pending.length - indexed;
    return { indexed, remaining, complete: remaining === 0, errors };
  }

  return { list, details, refresh };
}
