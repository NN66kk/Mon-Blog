'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  FileText,
  FolderOpen,
  History,
  Images,
  Link2,
  LoaderCircle,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { BLOG, COLLECTIONS, REPO, splitMarkdown } from '@/lib/content';
import { api, download, jobLabel, matches } from '@/lib/client-api';
import { needsPublicationCheck } from '@/lib/publication';
import { draftBackup } from '@/lib/backup';

type View = 'articles' | 'drafts' | 'media' | 'activity' | 'trash' | 'settings';
type Draft = {
  id: string;
  title: string;
  collection: string;
  revision: number;
  updated_at: string;
  source_path?: string;
  deleted_at?: string;
};
type Article = {
  path: string;
  title: string;
  sha: string;
  collection: string;
  tags: string[];
  description: string;
  published_at: string;
  updated_at: string;
  url: string;
  indexed: boolean;
  index_error?: string;
};
type Job = {
  id: string;
  draft_id: string;
  state: string;
  action?: string;
  title?: string;
  target_path?: string;
  commit_sha?: string;
  error?: string;
  created_at: string;
  url: string;
};
type Media = {
  name: string;
  filename: string;
  url: string;
  size: number;
  uploaded_at: string;
  archived_at: string | null;
  references: { id: string; title: string; deleted_at: string | null }[];
};
type TrashArticle = {
  id: string;
  path: string;
  title: string;
  state: string;
  created_at: string;
};
type Confirmation = {
  title: string;
  description: string;
  label: string;
  match?: string;
  run: () => Promise<void>;
};
const sections = [
  {
    id: 'articles',
    name: '博客文章',
    subtitle: '已收录的文章与笔记',
    icon: BookOpen,
  },
  { id: 'drafts', name: '草稿箱', subtitle: '还在生长的想法', icon: FileText },
  { id: 'media', name: '图片库', subtitle: '写作时用到的图片', icon: Images },
  {
    id: 'activity',
    name: '发布记录',
    subtitle: '每一次发布都有迹可循',
    icon: History,
  },
  { id: 'trash', name: '回收站', subtitle: '暂时放下，随时找回', icon: Trash2 },
  {
    id: 'settings',
    name: '设置与备份',
    subtitle: '连接博客，保管内容',
    icon: Settings2,
  },
] as const;
const day = (value?: string) =>
  value ? new Date(value).toLocaleDateString('zh-CN') : '未设置日期';
const collectionName = (id: string) =>
  COLLECTIONS.find((item) => item.id === id)?.name || id;
const bytes = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(size / 1024)} KB`;
const writeUrl = (id?: string) =>
  id ? `/write?draft=${encodeURIComponent(id)}` : '/write';

export default function Manager({
  user,
}: {
  user: { name: string; id: string } | null;
}) {
  const [view, setView] = useState<View>('articles');
  const [mobileNav, setMobileNav] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connection, setConnection] = useState<{ login: string } | null>(null);
  const [keyReady, setKeyReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncText, setSyncText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('all');
  const [tag, setTag] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [trash, setTrash] = useState<{
    drafts: Draft[];
    articles: TrashArticle[];
  }>({ drafts: [], articles: [] });
  const [media, setMedia] = useState<Media[]>([]);
  const [mediaCursor, setMediaCursor] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaFilter, setMediaFilter] = useState('active');
  const [mediaSource, setMediaSource] = useState('private');
  const [blogAssets, setBlogAssets] = useState<
    { path: string; filename: string; url: string; size: number }[]
  >([]);
  const [token, setToken] = useState('');
  const [check, setCheck] = useState<any>(null);
  const [history, setHistory] = useState<{
    article: Article;
    versions: any[];
  } | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    filename: string;
  } | null>(null);
  const markdownInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const syncLock = useRef(false);
  const mounted = useRef(true);
  const pollLock = useRef(false);
  const pollOffset = useRef(0);
  const title = sections.find((item) => item.id === view)!;
  const changeView = (next: View) => {
    setView(next);
    setQuery('');
    setCollection('all');
    setTag('all');
    setPage(1);
    setSelected([]);
    setMobileNav(false);
    window.history.replaceState(null, '', `/#${next}`);
  };
  async function loadState() {
    const result = await api('state');
    if (mounted.current) {
      setDrafts(result.drafts);
      setJobs(result.publications);
      setConnection(result.connection);
      setKeyReady(result.credentialReady);
    }
    return result;
  }
  async function loadTrash() {
    const result = await api('trash');
    setTrash(result);
  }
  async function syncArticles() {
    if (syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    setSyncText('正在读取博客目录…');
    try {
      const result = await api('articles');
      if (!mounted.current) return;
      setArticles(result.articles);
      const pending: Article[] = result.articles.filter(
        (article: Article) => !article.indexed,
      );
      for (
        let offset = 0;
        offset < pending.length && mounted.current;
        offset += 12
      ) {
        setSyncText(
          `正在同步标题与标签 ${Math.min(offset + 12, pending.length)}/${pending.length}`,
        );
        const batch = await api('article-details', 'POST', {
          articles: pending
            .slice(offset, offset + 12)
            .map(({ path, sha }) => ({ path, sha })),
        });
        if (!mounted.current) return;
        setArticles((items) =>
          items.map((item) => ({
            ...item,
            ...batch.articles.find((next: any) => next.path === item.path),
          })),
        );
      }
      setSyncText(
        `已同步 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
      );
    } catch (error: any) {
      if (mounted.current) {
        setError(error.message);
        setSyncText('同步未完成，可稍后重试');
      }
    } finally {
      syncLock.current = false;
      if (mounted.current) setSyncing(false);
    }
  }
  async function loadMedia(more = false) {
    setMediaLoading(true);
    try {
      const result = await api(
        `media${more && mediaCursor ? `?cursor=${encodeURIComponent(mediaCursor)}` : ''}`,
      );
      setMedia((items) =>
        more
          ? [
              ...items,
              ...result.media.filter(
                (item: Media) => !items.some((old) => old.name === item.name),
              ),
            ]
          : result.media,
      );
      setMediaCursor(result.cursor);
    } finally {
      setMediaLoading(false);
    }
  }
  async function work(action: () => Promise<void>, message = '') {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (message) setNotice(message);
    } catch (error: any) {
      setError(error.message || '操作未完成，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const section = window.location.hash.slice(1);
    if (sections.some((item) => item.id === section)) setView(section as View);
    if (!user) {
      setLoading(false);
      return;
    }
    loadState()
      .then((result) => {
        if (result.connection) void syncArticles();
      })
      .catch((error) => setError(error.message))
      .finally(() => setLoading(false));
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    if (view === 'trash') loadTrash().catch((error) => setError(error.message));
    if (view === 'media') loadMedia().catch((error) => setError(error.message));
  }, [view]);
  useEffect(() => {
    setPage(1);
  }, [query, collection, sort, tag, mediaFilter, mediaSource]);
  useEffect(() => {
    const onHashChange = () => {
      const section = window.location.hash.slice(1);
      if (sections.some((item) => item.id === section)) {
        setView(section as View);
        setQuery('');
        setCollection('all');
        setTag('all');
        setPage(1);
        setSelected([]);
        setMobileNav(false);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (!user || !jobs.some((job) => needsPublicationCheck(job.state))) return;
    const timer = setInterval(async () => {
      if (pollLock.current) return;
      pollLock.current = true;
      const waiting = jobs.filter((job) => needsPublicationCheck(job.state));
      const index = pollOffset.current % waiting.length;
      const batch = [...waiting.slice(index), ...waiting.slice(0, index)].slice(
        0,
        4,
      );
      pollOffset.current = (index + batch.length) % waiting.length;
      try {
        const updates = await Promise.all(
          batch.map((job) => api(`publication/${job.id}`).catch(() => job)),
        );
        if (mounted.current)
          setJobs((items) =>
            items.map(
              (item) => updates.find((next) => next.id === item.id) || item,
            ),
          );
      } finally {
        pollLock.current = false;
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [jobs, user]);
  function ask(value: Confirmation) {
    setConfirmText('');
    setConfirmation(value);
    setError('');
  }
  async function openArticle(article: Article) {
    await work(async () => {
      const draft = await api('import', 'POST', { path: article.path });
      window.location.assign(writeUrl(draft.id));
    });
  }
  function deleteArticle(article: Article) {
    ask({
      title: '删除这篇博客文章？',
      description: `「${article.title}」将从公开博客下线，原链接将无法访问。正文会保存在回收站，图片继续保留。输入文章标题确认。`,
      label: '确认删除文章',
      match: article.title,
      run: async () => {
        const job = await api('article-operation', 'POST', {
          id: crypto.randomUUID(),
          action: 'delete',
          path: article.path,
          sha: article.sha,
          confirm: true,
        });
        await loadState();
        if (job.state === 'failed' || job.error)
          throw new Error(job.error || '文章删除未完成。');
        setNotice('删除提交已创建，请在发布记录中查看下线进度。');
        setArticles((items) =>
          items.filter((item) => item.path !== article.path),
        );
      },
    });
  }
  function trashDrafts(items: Draft[]) {
    ask({
      title: `将 ${items.length} 篇草稿移入回收站？`,
      description: '草稿可以恢复。已经发布到博客的内容不会因此下线。',
      label: '移入回收站',
      run: async () => {
        let done = 0;
        try {
          for (const draft of items) {
            await api('draft-action', 'POST', {
              id: draft.id,
              revision: draft.revision,
              action: 'trash',
            });
            done++;
          }
        } catch (error: any) {
          throw new Error(
            `已移动 ${done} 篇，剩余内容未移动。${error.message}`,
          );
        } finally {
          setSelected([]);
          await loadState();
        }
        setNotice(`${done} 篇草稿已移入回收站。`);
      },
    });
  }
  async function backup(ids?: string[]) {
    await work(async () => {
      setNotice('正在准备备份…');
      const result = await api('backup');
      const content = ids
        ? result.drafts.filter((draft: Draft) => ids.includes(draft.id))
        : result.drafts;
      if (!content.length) throw new Error('还没有可导出的草稿。');
      const blob = await draftBackup(content, fetch, setNotice);
      download(blob, `Mon-写作室-${new Date().toISOString().slice(0, 10)}.zip`);
      setNotice('备份已下载，包含所选草稿与私有图片。');
    });
  }
  async function importMarkdown(file: File) {
    await work(async () => {
      if (file.size > 450000)
        throw new Error('Markdown 文件请控制在 450 KB 以内。');
      const source = await file.text();
      const parsed = splitMarkdown(source);
      if (
        !parsed.data ||
        typeof parsed.data !== 'object' ||
        Array.isArray(parsed.data)
      )
        throw new Error('文件开头的文章信息必须是 YAML 对象。');
      const title = String(
        parsed.data.title ||
          parsed.body.match(/^#\s+(.+)$/m)?.[1] ||
          file.name.replace(/\.md$/i, ''),
      );
      const id = crypto.randomUUID();
      await api('drafts', 'POST', {
        id,
        title,
        collection: 'D-Orginals',
        body: parsed.body,
        metadata: parsed.metadata,
        revision: 0,
      });
      window.location.assign(writeUrl(id));
    });
  }
  async function uploadMedia(file: File) {
    await work(async () => {
      const form = new FormData();
      form.append('file', file);
      const result = await fetch('/api/upload', { method: 'POST', body: form });
      const value: any = await result.json();
      if (!result.ok) throw new Error(value.error);
      await loadMedia();
      setMediaFilter('active');
      setNotice('图片已上传。写文章时可从图片库插入。');
    });
  }
  const articleTags = [
    ...new Set(articles.flatMap((item) => item.tags)),
  ].sort();
  const filteredArticles = articles
    .filter(
      (item) =>
        (collection === 'all' || item.collection === collection) &&
        (tag === 'all' || item.tags.includes(tag)) &&
        matches(query, item.title, item.path, item.description, ...item.tags),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, 'zh-CN')
        : (sort === 'oldest' ? 1 : -1) *
          (a.published_at || '').localeCompare(b.published_at || ''),
    );
  const filteredDrafts = drafts
    .filter(
      (item) =>
        (collection === 'all' || item.collection === collection) &&
        matches(query, item.title),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, 'zh-CN')
        : (sort === 'oldest' ? 1 : -1) *
          a.updated_at.localeCompare(b.updated_at),
    );
  const filteredMedia = media.filter(
    (item) =>
      (mediaFilter === 'trash'
        ? Boolean(item.archived_at)
        : !item.archived_at &&
          (mediaFilter !== 'unused' || !item.references.length)) &&
      matches(query, item.filename),
  );
  const resultCount =
    view === 'articles'
      ? filteredArticles.length
      : view === 'drafts'
        ? filteredDrafts.length
        : view === 'media' && mediaSource === 'blog'
          ? blogAssets.filter((item) =>
              matches(query, item.filename, item.path),
            ).length
          : view === 'media'
            ? filteredMedia.length
            : 0;
  const totalPages = Math.max(1, Math.ceil(resultCount / 20));
  const currentPage = Math.min(page, totalPages);
  const slice = <T,>(items: T[]) =>
    items.slice((currentPage - 1) * 20, currentPage * 20);
  const visibleDrafts = slice(filteredDrafts);
  const collectionSelect = (
    <NativeSelect
      aria-label="筛选栏目"
      value={collection}
      onChange={(event) => setCollection(event.target.value)}
    >
      <NativeSelectOption value="all">全部栏目</NativeSelectOption>
      {COLLECTIONS.map((item) => (
        <NativeSelectOption key={item.id} value={item.id}>
          {item.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
  const empty = (text: string, detail: string, action?: React.ReactNode) => (
    <div className="manager-empty">
      <FolderOpen size={34} />
      <h3>{text}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
  const navContents = (
    <>
      <a className="manager-brand" href="/">
        <span>文</span>
        <div>
          <strong>Mon 的写作室</strong>
          <small>数字花园 · 管理</small>
        </div>
      </a>
      <a className="manager-compose" href="/write">
        <Plus size={19} />
        写一篇新文章
      </a>
      <nav aria-label="写作室导航">
        {sections.map((item) => (
          <button
            key={item.id}
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => changeView(item.id)}
          >
            <item.icon size={19} />
            <span>{item.name}</span>
            {item.id === 'drafts' && <small>{drafts.length}</small>}
            {item.id === 'articles' && articles.length > 0 && (
              <small>{articles.length}</small>
            )}
          </button>
        ))}
      </nav>
      <div className="manager-sidebar-foot">
        <a href={BLOG} target="_blank" rel="noreferrer">
          去博客看看
          <ArrowUpRight size={16} />
        </a>
        <span>{user?.name || '尚未登录'}</span>
        <a
          href={
            user
              ? '/signout-with-chatgpt?return_to=/'
              : '/signin-with-chatgpt?return_to=/'
          }
          target="_top"
        >
          {user ? '退出登录' : '使用 ChatGPT 登录'}
        </a>
      </div>
    </>
  );
  return (
    <div className="manager-app">
      <aside className="manager-sidebar">{navContents}</aside>
      <Dialog open={mobileNav} onOpenChange={setMobileNav}>
        <DialogContent className="manager-nav-dialog">
          <DialogHeader>
            <DialogTitle>写作室导航</DialogTitle>
          </DialogHeader>
          {navContents}
        </DialogContent>
      </Dialog>
      <main className="manager-main">
        <header className="manager-header">
          <div className="manager-heading">
            <Button
              className="manager-menu"
              variant="ghost"
              size="icon"
              aria-label="打开管理导航"
              onClick={() => setMobileNav(true)}
            >
              <Menu />
            </Button>
            <div>
              <p>{title.subtitle}</p>
              <h1>{title.name}</h1>
            </div>
          </div>
          <div className="manager-header-actions">
            <button
              className={`manager-connection ${connection ? 'connected' : ''}`}
              onClick={() => changeView('settings')}
            >
              <Link2 size={16} />
              {connection ? '博客已连接' : '连接博客'}
            </button>
            <a className="manager-new-link" href="/write">
              <Plus size={17} />
              新文章
            </a>
          </div>
        </header>
        {error && (
          <div className="manager-message error" role="alert">
            <span>{error}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭错误提示"
              onClick={() => setError('')}
            >
              <X size={16} />
            </Button>
          </div>
        )}
        {notice && (
          <div className="manager-message" role="status">
            <span>{notice}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭提示"
              onClick={() => setNotice('')}
            >
              <X size={16} />
            </Button>
          </div>
        )}
        {!user ? (
          empty(
            '登录你的写作室',
            '登录后管理私人草稿、博客文章和图片。',
            <a
              className="manager-compose"
              href="/signin-with-chatgpt?return_to=/"
            >
              使用 ChatGPT 登录
            </a>,
          )
        ) : loading ? (
          <div className="manager-empty">
            <LoaderCircle className="spin" />
            <p>正在打开写作室…</p>
          </div>
        ) : (
          <>
            {(view === 'articles' || view === 'drafts') && (
              <>
                <div className="manager-collection-strip">
                  <button
                    className={collection === 'all' ? 'active' : ''}
                    onClick={() => setCollection('all')}
                  >
                    <span>全部</span>
                    <strong>
                      {view === 'articles' ? articles.length : drafts.length}
                    </strong>
                  </button>
                  {COLLECTIONS.map((item) => (
                    <button
                      className={collection === item.id ? 'active' : ''}
                      key={item.id}
                      onClick={() => setCollection(item.id)}
                    >
                      <span>
                        <i>{item.mark}</i>
                        {item.name}
                      </span>
                      <strong>
                        {
                          (view === 'articles' ? articles : drafts).filter(
                            (article) => article.collection === item.id,
                          ).length
                        }
                      </strong>
                    </button>
                  ))}
                </div>
                <div className="manager-toolbar">
                  <div className="manager-search">
                    <Search size={18} />
                    <Input
                      aria-label="搜索文章"
                      placeholder={
                        view === 'articles'
                          ? '搜索标题、标签或关键词…'
                          : '搜索草稿标题…'
                      }
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                  {collectionSelect}
                  {view === 'articles' && (
                    <NativeSelect
                      aria-label="筛选标签"
                      value={tag}
                      onChange={(event) => setTag(event.target.value)}
                    >
                      <NativeSelectOption value="all">
                        全部标签
                      </NativeSelectOption>
                      {articleTags.map((value) => (
                        <NativeSelectOption key={value} value={value}>
                          {value}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                  <NativeSelect
                    aria-label="排序方式"
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                  >
                    <NativeSelectOption value="newest">
                      最近优先
                    </NativeSelectOption>
                    <NativeSelectOption value="oldest">
                      最早优先
                    </NativeSelectOption>
                    <NativeSelectOption value="title">
                      按标题
                    </NativeSelectOption>
                  </NativeSelect>
                </div>
                <div className="manager-list-caption">
                  <span>
                    {resultCount} 篇
                    {view === 'articles' && (
                      <small aria-live="polite">{syncText}</small>
                    )}
                  </span>
                  <div>
                    {view === 'articles' ? (
                      <Button
                        variant="outline"
                        disabled={!connection || syncing || busy}
                        onClick={() => void syncArticles()}
                      >
                        <RefreshCw
                          size={15}
                          className={syncing ? 'spin' : ''}
                        />
                        同步博客
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => markdownInput.current?.click()}
                        >
                          <Upload size={15} />
                          导入 Markdown
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || !drafts.length}
                          onClick={() =>
                            void backup(drafts.map((item) => item.id))
                          }
                        >
                          <Download size={15} />
                          备份草稿
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
            {view === 'articles' && (
              <section className="manager-list" aria-label="博客文章列表">
                {slice(filteredArticles).map((article) => (
                  <article className="manager-article" key={article.path}>
                    <span className="manager-collection-mark">
                      {
                        COLLECTIONS.find(
                          (item) => item.id === article.collection,
                        )?.mark
                      }
                    </span>
                    <div className="manager-article-content">
                      <button
                        className="manager-title-link"
                        disabled={busy}
                        onClick={() => void openArticle(article)}
                      >
                        {article.title}
                      </button>
                      <div className="manager-article-meta">
                        <span>{collectionName(article.collection)}</span>
                        <time>{day(article.published_at)}</time>
                        {article.tags.slice(0, 3).map((tag) => (
                          <button
                            className="manager-tag"
                            key={tag}
                            onClick={() => setTag(tag)}
                          >
                            {tag}
                          </button>
                        ))}
                        {article.index_error && (
                          <span className="manager-warning">
                            {article.index_error}
                          </span>
                        )}
                      </div>
                      {article.description && <p>{article.description}</p>}
                    </div>
                    <div className="manager-row-actions">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void openArticle(article)}
                      >
                        <Pencil size={15} />
                        编辑
                      </Button>
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`查看 ${article.title}`}
                        title="查看博客文章"
                      >
                        <ArrowUpRight size={18} />
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`查看 ${article.title} 的历史`}
                        title="文章历史"
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            const result = await api(
                              `article-history?path=${encodeURIComponent(article.path)}`,
                            );
                            setHistory({ article, versions: result.versions });
                          })
                        }
                      >
                        <History size={17} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="manager-danger"
                        aria-label={`删除 ${article.title}`}
                        title="删除文章"
                        disabled={busy}
                        onClick={() => deleteArticle(article)}
                      >
                        <Trash2 size={17} />
                      </Button>
                    </div>
                  </article>
                ))}
                {!filteredArticles.length &&
                  empty(
                    connection
                      ? syncing
                        ? '正在同步文章'
                        : '没有找到文章'
                      : '先连接你的博客',
                    connection
                      ? '可以换一个关键词，或点击同步博客读取文章。'
                      : '草稿功能可以直接使用，连接 GitHub 后即可管理已发布文章。',
                    !connection && (
                      <Button onClick={() => changeView('settings')}>
                        连接博客
                      </Button>
                    ),
                  )}
              </section>
            )}
            {view === 'drafts' && (
              <section className="manager-list" aria-label="草稿列表">
                {visibleDrafts.length > 0 && (
                  <div className="manager-bulk">
                    <label htmlFor="select-draft-page">
                      <Checkbox
                        id="select-draft-page"
                        aria-label="选择本页所有草稿"
                        checked={visibleDrafts.every((item) =>
                          selected.includes(item.id),
                        )}
                        onCheckedChange={(checked) =>
                          setSelected((items) =>
                            checked
                              ? [
                                  ...new Set([
                                    ...items,
                                    ...visibleDrafts.map((item) => item.id),
                                  ]),
                                ]
                              : items.filter(
                                  (id) =>
                                    !visibleDrafts.some(
                                      (item) => item.id === id,
                                    ),
                                ),
                          )
                        }
                      />
                      选择本页
                    </label>
                    {selected.length > 0 && (
                      <>
                        <span>已选 {selected.length} 篇</span>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void backup(selected)}
                        >
                          导出所选
                        </Button>
                        <Button
                          variant="ghost"
                          className="manager-danger"
                          disabled={busy}
                          onClick={() =>
                            trashDrafts(
                              drafts.filter((item) =>
                                selected.includes(item.id),
                              ),
                            )
                          }
                        >
                          移入回收站
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {visibleDrafts.map((draft) => (
                  <article className="manager-article" key={draft.id}>
                    <Checkbox
                      aria-label={`选择 ${draft.title || '未命名草稿'}`}
                      checked={selected.includes(draft.id)}
                      onCheckedChange={(checked) =>
                        setSelected((items) =>
                          checked
                            ? [...items, draft.id]
                            : items.filter((id) => id !== draft.id),
                        )
                      }
                    />
                    <div className="manager-article-content">
                      <a
                        className="manager-title-link"
                        href={writeUrl(draft.id)}
                      >
                        {draft.title || '未命名草稿'}
                      </a>
                      <div className="manager-article-meta">
                        <span>{collectionName(draft.collection)}</span>
                        <time>{day(draft.updated_at)}</time>
                        <span>
                          {draft.source_path ? '旧文编辑稿' : '私人草稿'}
                        </span>
                      </div>
                    </div>
                    <div className="manager-row-actions">
                      <a
                        className="manager-outline-link"
                        href={writeUrl(draft.id)}
                      >
                        <Pencil size={15} />
                        继续写
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`复制 ${draft.title}`}
                        title="复制为新草稿"
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            await api('draft-action', 'POST', {
                              id: draft.id,
                              revision: draft.revision,
                              action: 'duplicate',
                            });
                            await loadState();
                          }, '已创建一份新草稿。')
                        }
                      >
                        <Copy size={17} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`备份 ${draft.title}`}
                        title="导出含图片备份"
                        disabled={busy}
                        onClick={() => void backup([draft.id])}
                      >
                        <Download size={17} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="manager-danger"
                        aria-label={`删除草稿 ${draft.title}`}
                        title="移入回收站"
                        disabled={busy}
                        onClick={() => trashDrafts([draft])}
                      >
                        <Trash2 size={17} />
                      </Button>
                    </div>
                  </article>
                ))}
                {!filteredDrafts.length &&
                  empty(
                    '这里还没有草稿',
                    '写下新想法，或从博客文章中打开一篇继续修改。',
                    <a className="manager-compose" href="/write">
                      <Plus size={17} />
                      开始写作
                    </a>,
                  )}
              </section>
            )}
            {view === 'media' && (
              <>
                <div className="manager-subnav">
                  <button
                    className={mediaSource === 'private' ? 'active' : ''}
                    onClick={() => setMediaSource('private')}
                  >
                    写作室图片
                  </button>
                  <button
                    className={mediaSource === 'blog' ? 'active' : ''}
                    disabled={!connection || busy}
                    onClick={() => {
                      setMediaSource('blog');
                      if (!blogAssets.length)
                        void work(async () =>
                          setBlogAssets((await api('blog-assets')).assets),
                        );
                    }}
                  >
                    博客图片
                  </button>
                </div>
                <div className="manager-toolbar">
                  <div className="manager-search">
                    <Search size={18} />
                    <Input
                      aria-label="搜索图片"
                      placeholder="搜索图片文件名…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                  {mediaSource === 'private' && (
                    <>
                      <NativeSelect
                        aria-label="图片状态"
                        value={mediaFilter}
                        onChange={(event) => setMediaFilter(event.target.value)}
                      >
                        <NativeSelectOption value="active">
                          可用图片
                        </NativeSelectOption>
                        <NativeSelectOption value="unused">
                          未被草稿引用
                        </NativeSelectOption>
                        <NativeSelectOption value="trash">
                          图片回收站
                        </NativeSelectOption>
                      </NativeSelect>
                      <Button
                        disabled={busy}
                        onClick={() => imageInput.current?.click()}
                      >
                        <Upload size={17} />
                        上传图片
                      </Button>
                    </>
                  )}
                </div>
                <p className="manager-explainer">
                  {mediaSource === 'private'
                    ? '发布前，上传图片只有你能访问。回收站保留原文件，恢复草稿时图片仍可使用。'
                    : '这里展示博客仓库中的图片。为保留旧文中的图片引用，这里提供预览与原文件访问。'}
                </p>
                <div className="manager-media-grid">
                  {mediaSource === 'private'
                    ? slice(filteredMedia).map((item) => (
                        <article className="manager-media-card" key={item.name}>
                          <button
                            className="manager-media-preview"
                            onClick={() => setPreview(item)}
                            aria-label={`预览 ${item.filename}`}
                          >
                            <img
                              src={item.url}
                              alt={item.filename}
                              loading="lazy"
                            />
                          </button>
                          <div className="manager-media-caption">
                            <strong title={item.filename}>
                              {item.filename}
                            </strong>
                            <small>
                              {bytes(item.size)} · {day(item.uploaded_at)}
                            </small>
                            <span>
                              {item.references.length
                                ? `${item.references.length} 篇草稿引用`
                                : '未被草稿引用'}
                            </span>
                            <div>
                              {item.references.slice(0, 2).map((ref) => (
                                <a
                                  key={ref.id}
                                  href={
                                    ref.deleted_at
                                      ? '/#trash'
                                      : writeUrl(ref.id)
                                  }
                                >
                                  {ref.title || '未命名草稿'}
                                  {ref.deleted_at ? '（回收站）' : ''}
                                </a>
                              ))}
                            </div>
                            <div className="manager-media-actions">
                              <a
                                href={item.url}
                                download={item.filename}
                                aria-label={`下载 ${item.filename}`}
                              >
                                <Download size={17} />
                              </a>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="复制 Markdown 引用"
                                aria-label={`复制 ${item.filename} 引用`}
                                onClick={() =>
                                  void work(async () => {
                                    await navigator.clipboard.writeText(
                                      `![${item.filename.replace(/[\[\]\\\r\n]/g, '')}](${item.url})`,
                                    );
                                  }, '已复制图片引用。')
                                }
                              >
                                <Copy size={16} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={
                                  item.archived_at
                                    ? '恢复图片'
                                    : '移入图片回收站'
                                }
                                aria-label={`${item.archived_at ? '恢复' : '移入回收站'} ${item.filename}`}
                                disabled={
                                  busy ||
                                  (!item.archived_at &&
                                    item.references.length > 0)
                                }
                                onClick={() =>
                                  item.archived_at
                                    ? void work(async () => {
                                        await api('media-action', 'POST', {
                                          name: item.name,
                                          action: 'restore',
                                        });
                                        await loadMedia();
                                      }, '图片已恢复。')
                                    : ask({
                                        title: '将图片移入回收站？',
                                        description:
                                          '图片文件仍然保留，可以随时恢复。',
                                        label: '移入回收站',
                                        run: async () => {
                                          await api('media-action', 'POST', {
                                            name: item.name,
                                            action: 'trash',
                                          });
                                          await loadMedia();
                                        },
                                      })
                                }
                              >
                                {item.archived_at ? (
                                  <RotateCcw size={16} />
                                ) : (
                                  <Trash2 size={16} />
                                )}
                              </Button>
                            </div>
                          </div>
                        </article>
                      ))
                    : slice(
                        blogAssets.filter((item) =>
                          matches(query, item.filename, item.path),
                        ),
                      ).map((item) => (
                        <article className="manager-media-card" key={item.path}>
                          <button
                            className="manager-media-preview"
                            onClick={() => setPreview(item)}
                            aria-label={`预览 ${item.filename}`}
                          >
                            <img
                              src={item.url}
                              alt={item.filename}
                              loading="lazy"
                            />
                          </button>
                          <div className="manager-media-caption">
                            <strong title={item.filename}>
                              {item.filename}
                            </strong>
                            <small>{bytes(item.size)}</small>
                            <a href={item.url} target="_blank" rel="noreferrer">
                              查看原图 <ArrowUpRight size={14} />
                            </a>
                          </div>
                        </article>
                      ))}
                </div>
                {!resultCount &&
                  empty(
                    mediaLoading || busy ? '正在读取图片' : '没有找到图片',
                    '上传图片后，可以在写作页的图片库里插入。',
                  )}
                {mediaSource === 'private' && mediaCursor && (
                  <Button
                    variant="outline"
                    disabled={mediaLoading}
                    onClick={() => void work(() => loadMedia(true))}
                  >
                    加载更多图片
                  </Button>
                )}
              </>
            )}
            {view === 'activity' && (
              <>
                <div className="manager-list-caption">
                  <span>最近 {jobs.length} 次操作 · 状态会自动更新</span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void work(async () => {
                        const pending = jobs.filter((job) =>
                          needsPublicationCheck(job.state),
                        );
                        for (const job of pending.slice(0, 10))
                          await api(`publication/${job.id}`);
                        await loadState();
                      })
                    }
                  >
                    <RefreshCw size={16} />
                    刷新状态
                  </Button>
                </div>
                <div className="manager-timeline">
                  {jobs.map((job) => (
                    <article key={job.id}>
                      <span className={`manager-status-dot ${job.state}`} />
                      <div className="manager-article-content">
                        <div className="manager-activity-title">
                          <strong>
                            {job.title ||
                              job.target_path?.split('/').pop() ||
                              '文章操作'}
                          </strong>
                          <span className={`manager-status ${job.state}`}>
                            {jobLabel(job)}
                          </span>
                        </div>
                        <p>
                          {job.action === 'delete'
                            ? '删除文章'
                            : job.action === 'restore'
                              ? '恢复文章'
                              : '发布文章'}{' '}
                          · {new Date(job.created_at).toLocaleString('zh-CN')}
                        </p>
                        {job.error && (
                          <p className="manager-warning">{job.error}</p>
                        )}
                        <div className="manager-inline-links">
                          {job.url && job.action !== 'delete' && (
                            <a href={job.url} target="_blank" rel="noreferrer">
                              查看文章 <ArrowUpRight size={14} />
                            </a>
                          )}
                          {job.commit_sha && (
                            <a
                              href={`https://github.com/${REPO}/commit/${job.commit_sha}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              提交记录 <ArrowUpRight size={14} />
                            </a>
                          )}
                          <a
                            href={`https://github.com/${REPO}/actions`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            部署详情 <ArrowUpRight size={14} />
                          </a>
                          {job.state === 'failed' &&
                            !job.draft_id.startsWith('operation:') && (
                              <a href={writeUrl(job.draft_id)}>返回草稿处理</a>
                            )}
                        </div>
                      </div>
                    </article>
                  ))}
                  {!jobs.length &&
                    empty(
                      '还没有发布记录',
                      '文章发布、删除和恢复的进度会出现在这里。',
                    )}
                </div>
              </>
            )}
            {view === 'trash' && (
              <>
                <p className="manager-explainer">
                  这里的内容不会自动清空。恢复草稿仅回到草稿箱；恢复博客文章会重新提交到公开博客。
                </p>
                <section className="manager-list">
                  <h2 className="manager-section-title">
                    草稿 · {trash.drafts.length}
                  </h2>
                  {trash.drafts.map((draft) => (
                    <article className="manager-article" key={draft.id}>
                      <FileText size={21} />
                      <div className="manager-article-content">
                        <strong>{draft.title || '未命名草稿'}</strong>
                        <div className="manager-article-meta">
                          <span>{collectionName(draft.collection)}</span>
                          <span>{day(draft.deleted_at)} 移入</span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            await api('draft-action', 'POST', {
                              id: draft.id,
                              revision: draft.revision,
                              action: 'restore',
                            });
                            await loadTrash();
                            await loadState();
                          }, '草稿已恢复。')
                        }
                      >
                        <RotateCcw size={16} />
                        恢复草稿
                      </Button>
                    </article>
                  ))}
                  {!trash.drafts.length && (
                    <p className="manager-section-empty">没有已删除的草稿。</p>
                  )}
                </section>
                <section className="manager-list">
                  <h2 className="manager-section-title">
                    博客文章 · {trash.articles.length}
                  </h2>
                  {trash.articles.map((item) => (
                    <article className="manager-article" key={item.id}>
                      <BookOpen size={21} />
                      <div className="manager-article-content">
                        <strong>{item.title}</strong>
                        <div className="manager-article-meta">
                          <span>{day(item.created_at)}</span>
                          <span>
                            {item.state === 'removed'
                              ? '已从仓库移除'
                              : item.state === 'failed'
                                ? '删除未完成，原文备份保留'
                                : '正在确认删除结果'}
                          </span>
                        </div>
                      </div>
                      {item.state === 'removed' ? (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            ask({
                              title: '恢复这篇博客文章？',
                              description: `「${item.title}」会恢复到原来的博客地址，并触发一次公开部署。原路径如果已有新文章，恢复会停止。`,
                              label: '恢复到博客',
                              run: async () => {
                                const job = await api(
                                  'article-operation',
                                  'POST',
                                  {
                                    id: crypto.randomUUID(),
                                    action: 'restore',
                                    trash_id: item.id,
                                    confirm: true,
                                  },
                                );
                                await loadState();
                                await loadTrash();
                                if (job.error) throw new Error(job.error);
                                setNotice('恢复提交已创建，请查看发布记录。');
                                void syncArticles();
                              },
                            })
                          }
                        >
                          <RotateCcw size={16} />
                          恢复到博客
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => changeView('activity')}
                        >
                          查看记录
                        </Button>
                      )}
                    </article>
                  ))}
                  {!trash.articles.length && (
                    <p className="manager-section-empty">
                      没有已删除的博客文章。
                    </p>
                  )}
                </section>
              </>
            )}
            {view === 'settings' && (
              <div className="manager-settings-grid">
                <section className="manager-panel">
                  <span className="manager-panel-icon">
                    <Link2 />
                  </span>
                  <h2>连接你的博客</h2>
                  <p>{REPO}</p>
                  <div
                    className={`manager-connection-state ${connection ? 'connected' : ''}`}
                  >
                    {connection ? <Check size={18} /> : <Link2 size={18} />}
                    {connection
                      ? `已连接 ${connection.login}`
                      : '尚未连接 GitHub'}
                  </div>
                  <ol className="manager-connection-help">
                    <li>
                      仓库范围选择{' '}
                      <strong>Only select repositories → Mon-Blog</strong>。
                    </li>
                    <li>
                      <strong>Contents</strong> 设为{' '}
                      <strong>Read and write</strong>。
                    </li>
                    <li>
                      <strong>Actions</strong> 设为 <strong>Read-only</strong>。
                    </li>
                  </ol>
                  <a
                    className="manager-text-link"
                    href="https://github.com/settings/personal-access-tokens"
                    target="_blank"
                    rel="noreferrer"
                  >
                    在 GitHub 管理令牌 <ArrowUpRight size={15} />
                  </a>
                  <label
                    className="manager-field"
                    htmlFor="manager-github-token"
                  >
                    GitHub 访问令牌
                    <Input
                      id="manager-github-token"
                      type="password"
                      autoComplete="off"
                      placeholder="github_pat_…"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                    />
                  </label>
                  <p className="manager-field-help">
                    令牌加密保存在服务端。修改原令牌的权限后，无需重新输入。
                  </p>
                  {!keyReady && (
                    <p className="manager-warning">
                      管理员需要先完成密钥配置，草稿仍可正常保存。
                    </p>
                  )}
                  <div className="manager-button-row">
                    <Button
                      disabled={busy || !token.trim() || !keyReady}
                      onClick={() =>
                        void work(async () => {
                          await api('connection', 'POST', { token });
                          setToken('');
                          await loadState();
                          void syncArticles();
                        }, '博客连接已更新。')
                      }
                    >
                      {connection ? '更新连接' : '连接博客'}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || !connection}
                      onClick={() =>
                        void work(async () =>
                          setCheck(await api('connection-check', 'POST', {})),
                        )
                      }
                    >
                      <RefreshCw size={16} />
                      检查连接
                    </Button>
                  </div>
                  {check && (
                    <div className="manager-check-result">
                      <p>仓库读取：{check.readable ? '正常' : '不可用'}</p>
                      <p>部署查询：{check.actions ? '正常' : '需要处理'}</p>
                      {check.warning && (
                        <p className="manager-warning">{check.warning}</p>
                      )}
                      <p>{check.write_note}</p>
                    </div>
                  )}
                </section>
                <div>
                  <section className="manager-panel">
                    <span className="manager-panel-icon">
                      <Download />
                    </span>
                    <h2>保留一份自己的备份</h2>
                    <p>
                      导出全部草稿、回收站草稿和引用的私有图片，打包成一个 ZIP
                      文件。已发布文章的历史版本保存在 GitHub。
                    </p>
                    <Button disabled={busy} onClick={() => void backup()}>
                      <Download size={17} />
                      导出完整草稿备份
                    </Button>
                    <a
                      className="manager-text-link"
                      href={`https://github.com/${REPO}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开博客仓库 <ArrowUpRight size={15} />
                    </a>
                  </section>
                  <section className="manager-panel">
                    <h2>从 Markdown 开始</h2>
                    <p>
                      把本机的 .md
                      文件导入为私人草稿。标题、标签及原有文章信息会保留；本地图片需要重新上传。
                    </p>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => markdownInput.current?.click()}
                    >
                      <Upload size={17} />
                      导入 Markdown
                    </Button>
                  </section>
                  <section className="manager-panel manager-note-panel">
                    <h2>写作室与博客</h2>
                    <p>
                      自动保存只更新私人草稿。发布、删除博客文章和恢复上线会提交到
                      GitHub，完成部署后读者才能看到变化。
                    </p>
                    <p>
                      文章设置和历史版本都在写作页右上角，窄窗口也能直接打开。
                    </p>
                  </section>
                </div>
              </div>
            )}
            {['articles', 'drafts', 'media'].includes(view) &&
              resultCount > 20 && (
                <nav className="manager-pagination" aria-label="列表分页">
                  <span>
                    第 {currentPage} / {totalPages} 页
                  </span>
                  <Button
                    variant="outline"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                    aria-label="上一页"
                  >
                    <ChevronLeft size={17} />
                  </Button>
                  <Button
                    variant="outline"
                    disabled={currentPage === totalPages}
                    onClick={() => setPage(currentPage + 1)}
                    aria-label="下一页"
                  >
                    <ChevronRight size={17} />
                  </Button>
                </nav>
              )}
          </>
        )}
        <footer className="manager-footer">
          <span>Mon&apos;s Digital Garden</span>
          <span>
            <Cloud size={14} />
            私人写作，随时继续
          </span>
        </footer>
      </main>
      <input
        hidden
        ref={markdownInput}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importMarkdown(file);
        }}
      />
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void uploadMedia(file);
        }}
      />
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent className="manager-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmation?.match && (
            <Input
              aria-label="输入文章标题确认"
              placeholder="输入完整文章标题"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
            />
          )}
          {error && (
            <p role="alert" className="manager-warning">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                busy ||
                Boolean(
                  confirmation?.match && confirmText !== confirmation.match,
                )
              }
              onClick={() =>
                void work(async () => {
                  await confirmation?.run();
                  setConfirmation(null);
                })
              }
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : null}
              {confirmation?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={Boolean(history)}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
      >
        <DialogContent className="manager-history-dialog">
          <DialogHeader>
            <DialogTitle>文章历史 · {history?.article.title}</DialogTitle>
            <DialogDescription>
              选择历史版本会创建独立编辑稿。审阅并发布后，博客才会更新。
            </DialogDescription>
          </DialogHeader>
          <div className="manager-version-list">
            {history?.versions.map((version) => (
              <article key={version.sha}>
                <div>
                  <strong>{version.message}</strong>
                  <small>
                    {new Date(version.date).toLocaleString('zh-CN')} ·{' '}
                    {version.author}
                  </small>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void work(async () => {
                      const draft = await api('article-version', 'POST', {
                        path: history.article.path,
                        sha: version.sha,
                      });
                      window.location.assign(writeUrl(draft.id));
                    })
                  }
                >
                  打开此版本
                </Button>
              </article>
            ))}
            {history && !history.versions.length && (
              <p>没有可读取的历史版本。</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="manager-image-dialog">
          <DialogHeader>
            <DialogTitle>{preview?.filename}</DialogTitle>
            <DialogDescription>图片预览</DialogDescription>
          </DialogHeader>
          {preview && <img src={preview.url} alt={preview.filename} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
