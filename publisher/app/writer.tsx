'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  ArrowUpRight,
  Bold,
  BookOpen,
  Check,
  Cloud,
  Code2,
  Download,
  FileText,
  ImagePlus,
  Link2,
  LoaderCircle,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  X,
  History,
  Images,
  ArrowLeft,
  LayoutTemplate,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BLOG, COLLECTIONS, REPO } from '@/lib/content';
import { createDraftTransition } from '@/lib/draft-transition';
import { needsPublicationCheck } from '@/lib/publication';
import {
  editorMetadata,
  exportMarkdown,
  previewImageUrl,
  updateMetadata,
  metadataDocument,
  metadataFields,
  metadataProblem,
  normalizeYamlInput,
} from '@/lib/editor-content';
import {
  BUILTIN_TEMPLATES,
  COLLECTION_TAGS,
  dateForInput,
  materializeTemplate,
  standardArticle,
  syncHeading,
  type ArticleTemplate,
} from '@/lib/article-templates';
import { download, jobLabel } from '@/lib/client-api';
import { draftBackup } from '@/lib/backup';
import 'katex/dist/katex.min.css';

type Draft = {
  id: string;
  title: string;
  collection: string;
  body: string;
  metadata: string;
  revision: number;
  updated_at?: string;
  source_path?: string | null;
  filename?: string | null;
  base_sha?: string | null;
};
type Job = {
  id: string;
  state: string;
  url: string;
  error?: string;
  created_at: string;
  draft_id: string;
  action?: string;
};
const labels: Record<string, string> = {
  preparing: '准备发布',
  verifying: '正在确认提交',
  submitted: '已提交，等待构建',
  building: '博客正在构建',
  built: '构建完成，等待上线',
  live: '文章已上线',
  failed: '发布未完成',
  cancelled: '构建已替代，等待上线',
  superseded: '较新版本已上线',
};
const fresh = (): Draft => ({
  id: crypto.randomUUID(),
  collection: 'D-Orginals',
  ...standardArticle(),
  revision: 0,
});
const contentKey = (d: Draft) =>
  JSON.stringify([d.id, d.title, d.collection, d.body, d.metadata]);
async function api(path: string, method = 'GET', data?: unknown): Promise<any> {
  const result = await fetch(`/api/${path}`, {
    method,
    ...(data !== undefined && method !== 'GET' && method !== 'HEAD'
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      : {}),
  });
  const body: any = await result.json();
  if (!result.ok) throw new Error(body.error || '操作未完成，请稍后重试。');
  return body;
}

export default function Writer({
  user,
}: {
  user: { name: string; id: string } | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    id: '',
    title: '',
    collection: 'D-Orginals',
    body: '',
    metadata: '',
    revision: 0,
  }));
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connected, setConnected] = useState(false);
  const [keyReady, setKeyReady] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState('write');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] =
    useState<ArticleTemplate[]>(BUILTIN_TEMPLATES);
  const [selectedTemplate, setSelectedTemplate] = useState(
    BUILTIN_TEMPLATES[0].path,
  );
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateMessage, setTemplateMessage] = useState(
    '当前为随写作室保存的博客模板。连接博客后可同步最新版本。',
  );
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState(false);
  const [settings, setSettings] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [articles, setArticles] = useState<{ path: string; title: string }[]>(
    [],
  );
  const [importQuery, setImportQuery] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionHistory, setVersionHistory] = useState<{
    draftId: string;
    versions: {
      revision: number;
      title: string;
      created_at: string;
      characters: number;
    }[];
  } | null>(null);
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaItems, setMediaItems] = useState<
    { name: string; filename: string; url: string; archived_at?: string }[]
  >([]);
  const [mediaCursor, setMediaCursor] = useState<string | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const [opening, setOpening] = useState(true);
  const editor = useRef<HTMLTextAreaElement>(null);
  const libraryTrigger = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(draft);
  const pending = useRef<Promise<Draft> | null>(null);
  const pollOffset = useRef(0);
  const historyRequest = useRef(0);
  const transition = useRef(createDraftTransition<Draft>()).current;
  const dirtyRef = useRef(false);
  const storageKey = `mon-writer-recovery:${user?.id || 'local'}`;
  latest.current = draft;
  dirtyRef.current = dirty;
  function change(update: Partial<Draft>) {
    if (transition.busy || opening) return;
    latest.current = { ...latest.current, ...update };
    dirtyRef.current = true;
    setDraft(latest.current);
    setDirty(true);
    setError('');
  }
  async function reload() {
    const state = await api('state');
    setDrafts(state.drafts);
    setJobs(state.publications);
    setConnected(Boolean(state.connection));
    setKeyReady(state.credentialReady);
    return state;
  }
  useEffect(() => {
    setDraft(fresh());
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) setRecovery(JSON.parse(cached));
    } catch {
      /* Storage may be unavailable. */
    }
    if (user)
      reload()
        .then(async () => {
          const id = new URLSearchParams(window.location.search).get('draft');
          if (id && /^[a-f0-9-]{36}$/.test(id)) {
            const saved = await api(`drafts/${id}`);
            if (!dirtyRef.current) {
              latest.current = saved;
              setDraft(saved);
            }
          }
        })
        .catch((e) => setError(e.message))
        .finally(() => setOpening(false));
    else setOpening(false);
  }, []);
  useEffect(() => {
    if (dirty && draft.id) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(draft));
      } catch {
        /* Cloud save remains authoritative. */
      }
    }
    if (!dirty || !user || !draft.id || publishing || switching || error)
      return;
    const timer = setTimeout(() => {
      save().catch((e) => setError(e.message));
    }, 1400);
    return () => clearTimeout(timer);
  }, [draft, dirty, publishing, switching, error]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || pending.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    if (!user || !jobs.some((j) => needsPublicationCheck(j.state))) return;
    const timer = setInterval(() => {
      checkJobs().catch(() => {});
    }, 12000);
    return () => clearInterval(timer);
  }, [jobs, user]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 721px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setLibrary(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (user && !publishing && !switching)
          save()
            .then(() => setNotice('草稿已保存。'))
            .catch((error) => setError(error.message));
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [publishing, switching, user]);

  async function openVersions() {
    const draftId = latest.current.id;
    const request = ++historyRequest.current;
    const isCurrent = () =>
      request === historyRequest.current && latest.current.id === draftId;
    setPanelBusy(true);
    setError('');
    try {
      const saved = await save();
      if (!isCurrent() || saved.id !== draftId) return;
      const result = await api(`drafts/${draftId}/history`);
      if (!isCurrent()) return;
      setVersionHistory({ draftId, versions: result.versions });
      setRestoreVersion(null);
      setVersionsOpen(true);
    } catch (error: any) {
      if (isCurrent()) setError(error.message);
    } finally {
      setPanelBusy(false);
    }
  }
  async function browseMedia(more = false) {
    setPanelBusy(true);
    setError('');
    try {
      const result = await api(
        `media${more && mediaCursor ? `?cursor=${encodeURIComponent(mediaCursor)}` : ''}`,
      );
      setMediaItems((items) =>
        more ? [...items, ...result.media] : result.media,
      );
      setMediaCursor(result.cursor);
      setMediaOpen(true);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setPanelBusy(false);
    }
  }
  async function backupCurrent() {
    setPanelBusy(true);
    setError('');
    try {
      const blob = await draftBackup([{ ...latest.current }], fetch, setNotice);
      download(blob, `${latest.current.title || '草稿'}-含图片.zip`);
      setNotice('文章和私有图片已打包下载。');
    } catch (error: any) {
      setError(error.message);
    } finally {
      setPanelBusy(false);
    }
  }

  async function save(force = false): Promise<Draft> {
    if (!user) throw new Error('请先登录，即可将草稿保存到云端。');
    if (pending.current) {
      await pending.current;
      if (dirtyRef.current) return save();
      return latest.current;
    }
    const snapshot = { ...latest.current };
    if (!snapshot.id) throw new Error('编辑器正在准备，请稍后重试。');
    if (
      !dirtyRef.current &&
      snapshot.revision > 0 &&
      (snapshot.filename || snapshot.source_path) &&
      !force
    )
      return snapshot;
    setSaving(true);
    const work = api('drafts', 'POST', snapshot).then((result) => {
      const saved = { ...snapshot, ...result };
      if (latest.current.id === snapshot.id) {
        const same = contentKey(latest.current) === contentKey(snapshot);
        latest.current = {
          ...latest.current,
          revision: result.revision,
          updated_at: result.updated_at,
          filename: result.filename,
        };
        setDraft(latest.current);
        window.history.replaceState(null, '', `/write?draft=${snapshot.id}`);
        setDirty(!same);
        dirtyRef.current = !same;
        if (same) {
          try {
            localStorage.removeItem(storageKey);
          } catch {}
        }
      }
      setDrafts((items) => [
        saved,
        ...items.filter((d) => d.id !== snapshot.id),
      ]);
      return saved;
    });
    pending.current = work;
    try {
      return await work;
    } finally {
      pending.current = null;
      setSaving(false);
    }
  }
  async function moveToDraft(
    loadNext: () => Promise<Draft>,
    recovered = false,
  ) {
    if (publishing || uploading) return;
    try {
      return await transition.run({
        onBusyChange: setSwitching,
        saveCurrent: async () => {
          if ((dirtyRef.current || pending.current) && user) await save();
          if (
            dirtyRef.current &&
            !user &&
            (latest.current.body ||
              latest.current.title ||
              latest.current.metadata)
          ) {
            throw new Error('请先导出当前文章，或登录保存后再切换。');
          }
        },
        loadNext,
        activate: (loaded) => {
          historyRequest.current++;
          setVersionHistory(null);
          setRestoreVersion(null);
          setVersionsOpen(false);
          latest.current = loaded;
          setDraft(loaded);
          setDirty(recovered);
          dirtyRef.current = recovered;
          setLibrary(false);
          setError('');
          window.history.replaceState(
            null,
            '',
            loaded.revision ? `/write?draft=${loaded.id}` : '/write',
          );
        },
      });
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function switchDraft(next?: Draft) {
    await moveToDraft(() =>
      next ? api(`drafts/${next.id}`) : Promise.resolve(fresh()),
    );
  }
  async function restoreHistory() {
    const draftId = versionHistory?.draftId;
    const version = restoreVersion;
    if (!draftId || version === null || latest.current.id !== draftId) return;
    const restored = await moveToDraft(() =>
      api('restore-version', 'POST', {
        id: draftId,
        version,
        revision: latest.current.revision,
      }),
    );
    if (restored) {
      setNotice('历史内容已恢复为新的草稿版本。');
      await reload();
    }
  }
  async function restoreDraft() {
    if (!recovery) return;
    const recovered = recovery;
    const restored = await moveToDraft(
      async () => ({
        ...recovered,
        ...(latest.current.id === recovered.id
          ? { revision: latest.current.revision }
          : {}),
      }),
      true,
    );
    if (restored) setRecovery(null);
  }
  function insert(before: string, after = '') {
    const element = editor.current;
    const start = element?.selectionStart ?? latest.current.body.length;
    const end = element?.selectionEnd ?? start;
    const text = latest.current.body;
    change({
      body:
        text.slice(0, start) +
        before +
        text.slice(start, end) +
        after +
        text.slice(end),
    });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + before.length, end + before.length);
    });
  }
  async function upload(file: File) {
    if (transition.busy || publishing) return;
    if (!user) {
      setError('请先登录再上传图片。');
      return;
    }
    setUploading(true);
    setError('');
    const selectedDraft = latest.current.id;
    try {
      let prepared = file;
      if (file.type !== 'image/gif' && file.size > 1024 * 1024) {
        try {
          const bitmap = await createImageBitmap(file);
          const scale = Math.min(
            1,
            2200 / Math.max(bitmap.width, bitmap.height),
          );
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(bitmap.width * scale);
          canvas.height = Math.round(bitmap.height * scale);
          canvas
            .getContext('2d')!
            .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/webp', 0.86),
          );
          if (blob && blob.size < file.size)
            prepared = new File([blob], 'image.webp', { type: 'image/webp' });
        } catch {
          /* The server will validate the original image. */
        }
      }
      const form = new FormData();
      form.append('file', prepared);
      const result = await fetch('/api/upload', { method: 'POST', body: form });
      const body: any = await result.json();
      if (!result.ok) throw new Error(body.error);
      if (latest.current.id !== selectedDraft)
        throw new Error('图片已上传，但文章已切换，请回到原草稿重新插入。');
      insert(
        `\n![${file.name.replace(/[\[\]\\\r\n]/g, '').replace(/\.[^.]+$/, '')}](${body.url})\n`,
      );
      setNotice('图片已插入，发布前仅自己可见。');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  function setMeta(field: string, value: string) {
    try {
      change({
        metadata: updateMetadata(latest.current.metadata, field, value),
      });
    } catch (e: any) {
      setError(e.message);
    }
  }
  function setTitle(title: string) {
    try {
      change({
        title,
        metadata: updateMetadata(latest.current.metadata, 'title', title),
        body: syncHeading(latest.current.body, latest.current.title, title),
      });
    } catch (error: any) {
      setError(error.message);
    }
  }
  function setYaml(value: string) {
    const source = normalizeYamlInput(value);
    const update: Partial<Draft> = { metadata: source };
    if (!metadataProblem(source)) {
      const data = metadataDocument(source).toJSON();
      if (Object.hasOwn(data, 'title')) {
        update.title = data.title ?? '';
        update.body = syncHeading(
          latest.current.body,
          latest.current.title,
          update.title!,
        );
      }
    }
    change(update);
  }
  function setCollection(value: string) {
    try {
      const current = latest.current;
      const tags = editorMetadata(current.metadata).tags;
      const nextTags =
        tags === COLLECTION_TAGS[current.collection]
          ? COLLECTION_TAGS[value]
          : tags;
      change({
        collection: value,
        ...(tags !== nextTags
          ? { metadata: updateMetadata(current.metadata, 'tags', nextTags) }
          : {}),
      });
    } catch (error: any) {
      setError(error.message);
    }
  }
  async function syncTemplates() {
    setTemplateBusy(true);
    try {
      const result = await api('templates');
      setTemplates(result.templates);
      setSelectedTemplate(result.templates[0]?.path || '');
      setTemplateMessage(
        result.templates.length
          ? '已同步博客仓库中的模板。'
          : '仓库模板目录暂时没有 Markdown 文件。',
      );
    } catch (error: any) {
      setTemplateMessage(`同步未完成：${error.message} 当前模板仍可使用。`);
    } finally {
      setTemplateBusy(false);
    }
  }
  async function useTemplate(template: ArticleTemplate) {
    try {
      if (template.kind === 'snippet') {
        insert(`\n\n${template.source}\n`);
        setMode('write');
        setTemplatesOpen(false);
        setNotice('模板片段已插入正文。');
      } else {
        const content = materializeTemplate(
          template,
          latest.current.collection,
        );
        const next = {
          ...fresh(),
          collection: latest.current.collection,
          ...content,
        };
        const moved = await moveToDraft(async () => next, true);
        if (moved) {
          setTemplatesOpen(false);
          setMode('write');
          setNotice('已按模板新建草稿。');
        }
      }
    } catch (error: any) {
      setTemplateMessage(error.message);
    }
  }
  const metadata = editorMetadata(draft.metadata);
  const fields = metadataFields(draft.metadata);
  const yamlError = metadataProblem(draft.metadata);
  const articleFilename = draft.source_path?.split('/').pop() || draft.filename;
  const activeTemplate = templates.find(
    (item) => item.path === selectedTemplate,
  );
  let templatePreview = activeTemplate?.source || '';
  if (activeTemplate?.kind === 'article') {
    try {
      templatePreview = exportMarkdown(
        materializeTemplate(activeTemplate, draft.collection),
      );
    } catch {
      /* Show the source when the template needs correction. */
    }
  }
  async function publish() {
    if (transition.busy) return;
    const problem = metadataProblem(latest.current.metadata);
    if (problem) {
      setError(problem);
      setMode('yaml');
      return;
    }
    if (!connected) {
      setSettings(true);
      return;
    }
    setPublishing(true);
    setError('');
    try {
      const retry = jobs.some(
        (j) =>
          j.draft_id === latest.current.id &&
          ['failed', 'cancelled'].includes(j.state),
      );
      const saved = await save(retry);
      const job = await api('publish', 'POST', {
        id: saved.id,
        revision: saved.revision,
      });
      setJobs((items) => [job, ...items.filter((j) => j.id !== job.id)]);
      setNotice(labels[job.state] || '发布任务已创建');
      const updated = await api(`drafts/${saved.id}`);
      if (latest.current.id === updated.id) {
        latest.current = {
          ...latest.current,
          source_path: updated.source_path,
          base_sha: updated.base_sha,
          filename: updated.filename,
        };
        setDraft(latest.current);
      }
      if (job.error) setError(job.error);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  }
  async function checkJobs() {
    const waiting = jobs.filter((j) => needsPublicationCheck(j.state));
    const start = waiting.length ? pollOffset.current % waiting.length : 0;
    const active = [...waiting.slice(start), ...waiting.slice(0, start)].slice(
      0,
      5,
    );
    pollOffset.current = start + active.length;
    const updates = await Promise.all(
      active.map((j) => api(`publication/${j.id}`).catch(() => j)),
    );
    setJobs((items) =>
      items.map((j) => updates.find((u) => u.id === j.id) || j),
    );
  }
  async function connect() {
    setConnecting(true);
    setError('');
    try {
      await api('connection', 'POST', { token });
      setToken('');
      setConnected(true);
      setSettings(false);
      setNotice('博客已连接，可以发布文章了。');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConnecting(false);
    }
  }
  async function openImport() {
    setLibrary(false);
    if (!connected) {
      setSettings(true);
      return;
    }
    setImportOpen(true);
    setImportLoading(true);
    try {
      setArticles((await api('articles')).articles);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImportLoading(false);
    }
  }
  async function importArticle(path: string) {
    if (transition.busy) return;
    setImportLoading(true);
    try {
      const imported = await moveToDraft(() => api('import', 'POST', { path }));
      if (imported) {
        setImportOpen(false);
        await reload();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImportLoading(false);
    }
  }
  function exportArticle() {
    const blob = new Blob([exportMarkdown(draft)], {
      type: 'text/markdown;charset=utf-8',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = articleFilename || '未保存草稿.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setNotice(
      draft.body.includes('/api/media/')
        ? '已导出 Markdown。文件包含图片引用，未包含上传的图片附件。'
        : '已导出 Markdown。',
    );
  }
  const activeJob = jobs.find((j) => j.draft_id === draft.id);
  const collection = COLLECTIONS.find((c) => c.id === draft.collection)!;
  const visibleDrafts = drafts.filter((d) =>
    d.title.toLowerCase().includes(query.toLowerCase()),
  );

  const libraryContents = (
    <>
      <div className="library-heading">
        <span>
          <BookOpen size={18} />
          我的文章
        </span>
        <Button
          className="mobile-close"
          variant="ghost"
          size="icon"
          onClick={() => setLibrary(false)}
          aria-label="关闭文章列表"
        >
          <X />
        </Button>
      </div>
      <a className="writer-back-link" href="/">
        <ArrowLeft size={16} />
        返回文章管理
      </a>
      <Button
        className="new-draft"
        onClick={() => switchDraft()}
        disabled={publishing || uploading || switching}
      >
        <Plus size={19} />
        写一篇新文章
      </Button>
      <div className="search-box">
        <Search size={17} />
        <Input
          aria-label="搜索草稿"
          placeholder="找一篇草稿…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="list-label">
        <span>草稿箱</span>
        <span>{drafts.length}</span>
      </div>
      <div className="draft-list">
        {visibleDrafts.length ? (
          visibleDrafts.map((item) => (
            <button
              className={`draft-card ${item.id === draft.id ? 'selected' : ''}`}
              key={item.id}
              onClick={() => switchDraft(item)}
              disabled={publishing || uploading || switching}
            >
              <span className="draft-category">
                <FileText size={14} />
                {COLLECTIONS.find((c) => c.id === item.collection)?.name}
              </span>
              <strong>{item.title || '未命名文章'}</strong>
              <span className="draft-date">
                {item.source_path ? '编辑稿' : '草稿'}
                <span>·</span>
                {item.updated_at
                  ? new Date(item.updated_at).toLocaleDateString('zh-CN')
                  : '刚刚'}
              </span>
            </button>
          ))
        ) : (
          <div className="empty-drafts">
            <span className="empty-icon">
              <FileText size={25} />
            </span>
            <p>{query ? '没有找到这篇草稿' : '还没有草稿'}</p>
            <small>
              {user
                ? '写下的每一段，都会保存在这里。'
                : '登录后，在另一台设备接着写。'}
            </small>
          </div>
        )}
      </div>
      <Button
        variant="outline"
        className="import-button"
        onClick={openImport}
        disabled={publishing || uploading || switching}
      >
        <BookOpen size={17} />
        从博客打开文章
        <ArrowUpRight size={15} />
      </Button>
      <div className="account-row">
        <span className="avatar">Mon</span>
        <div>
          <strong>{user ? '私人写作空间' : '本地试写'}</strong>
          <small>{user ? user.name : '登录开启云端保存'}</small>
        </div>
        {user ? (
          <a href="/signout-with-chatgpt?return_to=/" target="_top">
            退出
          </a>
        ) : (
          <a href="/signin-with-chatgpt?return_to=/" target="_top">
            登录
          </a>
        )}
      </div>
    </>
  );

  return (
    <div className="writer-app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-seal" aria-hidden="true">
            文
          </span>
          <div>
            <strong>Mon 的写作室</strong>
            <span>我的数字花园</span>
          </div>
        </div>
        <div className="top-actions">
          <a className="blog-link" href={BLOG} target="_blank" rel="noreferrer">
            去博客看看 <ArrowUpRight size={16} />
          </a>
          <Button
            variant="outline"
            className="connection-button"
            onClick={() => setSettings(true)}
          >
            <span className={`connection-dot ${connected ? 'on' : ''}`} />
            {connected ? '博客已连接' : '连接我的博客'}
          </Button>
        </div>
      </header>
      <div className="workspace">
        <aside className="library">{libraryContents}</aside>
        <Sheet open={library} onOpenChange={setLibrary}>
          <SheetContent
            className="library-sheet"
            side="left"
            showCloseButton={false}
            finalFocus={settings || importOpen ? false : libraryTrigger}
          >
            <SheetTitle className="sr-only">我的文章</SheetTitle>
            {libraryContents}
          </SheetContent>
        </Sheet>
        <main className="writing-space">
          <div className="editor-topline">
            <div className="document-location">
              <Button
                ref={libraryTrigger}
                className="mobile-menu"
                variant="ghost"
                size="icon"
                onClick={() => setLibrary(true)}
                aria-label="打开文章列表"
              >
                <Menu />
              </Button>
              <span className="location-parent">草稿箱</span>
              <span className="location-separator">/</span>
              <strong>{draft.title || '未命名草稿'}</strong>
            </div>
            <div className="editor-actions">
              <Button
                variant="outline"
                onClick={() => setTemplatesOpen(true)}
                disabled={opening || switching || publishing}
              >
                <LayoutTemplate size={17} />
                模板
              </Button>
              <Button
                variant="ghost"
                title="草稿历史版本"
                aria-label="草稿历史版本"
                disabled={!user || panelBusy || switching || publishing}
                onClick={() => void openVersions()}
              >
                <History size={17} />
                <span className="optional-label">历史</span>
              </Button>
              <Button
                variant="outline"
                className="writer-settings-button"
                onClick={() => setInspectorOpen(true)}
              >
                <Settings2 size={17} />
                文章设置
              </Button>
              <Button
                variant="ghost"
                onClick={exportArticle}
                title="导出 Markdown"
              >
                <Download size={17} />
                <span className="optional-label">导出</span>
              </Button>
              <Button
                className="publish-button"
                onClick={publish}
                disabled={
                  publishing ||
                  switching ||
                  uploading ||
                  !draft.title.trim() ||
                  !draft.body.trim() ||
                  Boolean(yamlError) ||
                  !user
                }
              >
                {publishing ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <Send size={17} />
                )}
                {publishing ? '发布中…' : '发布文章'}
              </Button>
            </div>
          </div>
          {!user && (
            <div className="login-banner">
              <span>登录后，草稿会自动同步到其他设备。</span>
              <a href="/signin-with-chatgpt?return_to=/" target="_top">
                使用 ChatGPT 登录 <ArrowUpRight size={16} />
              </a>
            </div>
          )}
          {recovery && (
            <div className="recovery-banner">
              <span>发现未保存的内容：{recovery.title || '未命名文章'}</span>
              <Button
                variant="outline"
                onClick={restoreDraft}
                disabled={publishing || uploading || switching}
              >
                恢复内容
              </Button>
              <Button variant="ghost" onClick={() => setRecovery(null)}>
                稍后
              </Button>
            </div>
          )}
          {error && (
            <div className="message error" role="alert">
              {error}
              <button onClick={() => setError('')} aria-label="关闭提示">
                <X size={17} />
              </button>
            </div>
          )}
          {notice && !error && (
            <div className="message" role="status">
              {notice}
              <button onClick={() => setNotice('')} aria-label="关闭提示">
                <X size={17} />
              </button>
            </div>
          )}
          <div className="editor-layout">
            <section className="manuscript" aria-label="文章编辑区">
              <div className="paper-heading">
                <span className="article-category">
                  <span className="collection-stamp">{collection.mark}</span>
                  {collection.name}
                </span>
                <span className="save-state" role="status">
                  {saving ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : dirty ? (
                    <Cloud size={15} />
                  ) : (
                    <Check size={15} />
                  )}
                  <span>
                    {opening
                      ? '正在打开草稿'
                      : switching
                        ? '正在切换草稿'
                        : saving
                          ? '正在保存'
                          : !user
                            ? '仅保存在本机'
                            : dirty
                              ? '等待保存'
                              : draft.revision
                                ? '已保存'
                                : '新草稿'}
                  </span>
                </span>
              </div>
              <div className="paper-title">
                <label className="frontmatter-caption" htmlFor="article-title">
                  文章标题 · YAML title
                </label>
                <Input
                  id="article-title"
                  className="title-input"
                  aria-label="文章标题"
                  placeholder="写下你的标题…"
                  maxLength={300}
                  value={draft.title}
                  disabled={
                    publishing || switching || opening || Boolean(yamlError)
                  }
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <section className="frontmatter-form" aria-label="YAML 逐项填写">
                <div className="frontmatter-file">
                  <span>文章文件名</span>
                  <code>
                    {articleFilename || '首次保存后自动生成 12 位时间编号.md'}
                  </code>
                  <small>
                    {draft.source_path
                      ? '沿用原文件名，修改标题不会改变链接。'
                      : '按北京时间生成；标题和日期修改后，编号保持不变。'}
                  </small>
                </div>
                <div className="frontmatter-field">
                  <label htmlFor="yaml-collection">收录栏目</label>
                  <NativeSelect
                    id="yaml-collection"
                    value={draft.collection}
                    disabled={
                      Boolean(draft.source_path) ||
                      publishing ||
                      switching ||
                      opening ||
                      Boolean(yamlError)
                    }
                    onChange={(e) => setCollection(e.target.value)}
                  >
                    {COLLECTIONS.map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {c.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="frontmatter-field">
                  <label htmlFor="yaml-date">
                    文章日期 · {fields.dateField} <small>北京时间</small>
                  </label>
                  <Input
                    id="yaml-date"
                    type="datetime-local"
                    step="1"
                    value={dateForInput(fields.date)}
                    disabled={
                      publishing || switching || opening || Boolean(yamlError)
                    }
                    onChange={(e) =>
                      setMeta(
                        fields.dateField,
                        e.target.value ? `${e.target.value}+08:00` : '',
                      )
                    }
                  />
                  {fields.date && !dateForInput(fields.date) && (
                    <small>
                      原日期：{fields.date}。可在 YAML 中查看和修改。
                    </small>
                  )}
                </div>
                <div className="frontmatter-field frontmatter-wide">
                  <label htmlFor="yaml-tags">文章标签 · tags</label>
                  <Input
                    id="yaml-tags"
                    placeholder="原创文章，AI，工具"
                    value={metadata.tags}
                    onChange={(e) => setMeta('tags', e.target.value)}
                    disabled={
                      publishing || switching || opening || Boolean(yamlError)
                    }
                  />
                  <small>多个标签用逗号分隔；默认使用该栏目的标签。</small>
                </div>
                <div className="frontmatter-field frontmatter-wide">
                  <label htmlFor="yaml-description">
                    文章摘要 · description
                  </label>
                  <Textarea
                    id="yaml-description"
                    placeholder="用一两句话概括文章内容。"
                    value={metadata.description}
                    onChange={(e) => setMeta('description', e.target.value)}
                    disabled={
                      publishing || switching || opening || Boolean(yamlError)
                    }
                  />
                </div>
                <div className="frontmatter-help">
                  <span>逐项填写会同步到 YAML，其他原有字段会保留。</span>
                  <Button
                    variant="ghost"
                    onClick={() => setMode(mode === 'yaml' ? 'write' : 'yaml')}
                  >
                    {mode === 'yaml' ? '返回正文' : '编辑完整 YAML'}
                  </Button>
                </div>
                {yamlError && (
                  <p className="frontmatter-error" role="alert">
                    {yamlError} 内容仍可保存和导出；修正后可发布。
                  </p>
                )}
              </section>
              <div className="editor-toolbar">
                <div className="format-tools">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="从图片库插入"
                    aria-label="从图片库插入"
                    disabled={!user || panelBusy || switching || publishing}
                    onClick={() => void browseMedia()}
                  >
                    <Images size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="加粗"
                    title="加粗"
                    onClick={() => insert('**', '**')}
                    disabled={publishing || switching || mode !== 'write'}
                  >
                    <Bold />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="插入二级标题"
                    title="标题"
                    onClick={() => insert('\n## ')}
                    disabled={publishing || switching || mode !== 'write'}
                  >
                    <span className="heading-icon">H₂</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="插入链接"
                    title="链接"
                    onClick={() => insert('[', '](https://)')}
                    disabled={publishing || switching || mode !== 'write'}
                  >
                    <Link2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="插入代码块"
                    title="代码块"
                    onClick={() => insert('\n```\n', '\n```\n')}
                    disabled={publishing || switching || mode !== 'write'}
                  >
                    <Code2 />
                  </Button>
                  <span className="toolbar-divider" />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="上传图片"
                    title="上传图片"
                    onClick={() => fileInput.current?.click()}
                    disabled={uploading || publishing || switching}
                  >
                    {uploading ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <ImagePlus />
                    )}
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f);
                      e.target.value = '';
                    }}
                  />
                </div>
                <Tabs
                  value={mode}
                  onValueChange={(value) => setMode(String(value))}
                >
                  <TabsList>
                    <TabsTrigger value="write">写作</TabsTrigger>
                    <TabsTrigger value="yaml">YAML</TabsTrigger>
                    <TabsTrigger value="preview">预览</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {mode === 'yaml' ? (
                <div className="yaml-editor-panel">
                  <p>
                    填写字段和内容即可，无需手写两端的 <code>---</code>。修改
                    title 会同步上方标题。
                  </p>
                  <Textarea
                    aria-label="完整 YAML"
                    className="yaml-editor"
                    value={draft.metadata}
                    onChange={(e) => setYaml(e.target.value)}
                    disabled={publishing || switching || opening}
                    spellCheck={false}
                  />
                </div>
              ) : mode === 'write' ? (
                <Textarea
                  ref={editor}
                  className="body-editor"
                  aria-label="文章正文"
                  placeholder={
                    '今天，想写些什么？\n\n把一个念头慢慢写成一篇文章。'
                  }
                  value={draft.body}
                  disabled={publishing || switching || opening}
                  onChange={(e) => change({ body: e.target.value })}
                  onPaste={(e) => {
                    const image = Array.from(e.clipboardData.files).find((f) =>
                      f.type.startsWith('image/'),
                    );
                    if (image) {
                      e.preventDefault();
                      void upload(image);
                    }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const image = Array.from(e.dataTransfer.files).find((f) =>
                      f.type.startsWith('image/'),
                    );
                    if (image) void upload(image);
                  }}
                />
              ) : (
                <div className="preview-pane">
                  <p className="preview-note">
                    Wiki Link、提示块和 Mermaid 以博客显示为准。
                  </p>
                  <article className="prose">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        img: ({ src, alt }) => {
                          const source = typeof src === 'string' ? src : '';
                          const resolved = previewImageUrl(
                            source,
                            draft.source_path ||
                              `docs/${draft.collection}/new.md`,
                          );
                          if (!resolved)
                            return (
                              <span role="note">
                                图片地址无效{alt ? `：${alt}` : ''}
                              </span>
                            );
                          return (
                            <img
                              src={resolved}
                              alt={alt || ''}
                              loading="lazy"
                            />
                          );
                        },
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noreferrer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {draft.body || '写下正文后，预览会出现在这里。'}
                    </ReactMarkdown>
                  </article>
                </div>
              )}
              <div className="editor-foot">
                <span>
                  {draft.body.replace(/\s/g, '').length.toLocaleString()} 字
                  <span className="foot-dot">·</span>约{' '}
                  {Math.max(1, Math.ceil(draft.body.length / 500))} 分钟阅读
                </span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    save()
                      .then(() => setNotice('草稿已保存。'))
                      .catch((e) => setError(e.message))
                  }
                  disabled={!user || saving || publishing || switching}
                >
                  <Cloud size={16} />
                  保存草稿
                </Button>
              </div>
            </section>
            <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
              <SheetContent className="writer-inspector-sheet">
                <SheetTitle>文章设置与发布状态</SheetTitle>
                <aside
                  className="article-inspector"
                  aria-label="文章设置和发布状态"
                >
                  <details className="properties-panel" open>
                    <summary>
                      <span>
                        <Settings2 size={17} />
                        文章设置
                      </span>
                      <span className="details-chevron">⌄</span>
                    </summary>
                    <div className="article-meta">
                      <label htmlFor="collection">收录栏目</label>
                      <NativeSelect
                        id="collection"
                        value={draft.collection}
                        disabled={
                          Boolean(draft.source_path) || publishing || switching
                        }
                        onChange={(e) => setCollection(e.target.value)}
                      >
                        {COLLECTIONS.map((c) => (
                          <NativeSelectOption key={c.id} value={c.id}>
                            {c.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <label htmlFor="article-tags">文章标签</label>
                      <Input
                        id="article-tags"
                        placeholder="技术，生活，随想"
                        value={metadata.tags}
                        onChange={(e) => setMeta('tags', e.target.value)}
                        disabled={publishing || switching}
                      />
                      <small>多个标签用逗号分隔</small>
                      <label htmlFor="article-description">
                        文章摘要<span>选填</span>
                      </label>
                      <Textarea
                        id="article-description"
                        placeholder="留空时，博客会从正文提取摘要。"
                        value={metadata.description}
                        onChange={(e) => setMeta('description', e.target.value)}
                        disabled={publishing || switching}
                      />
                    </div>
                    <details className="advanced">
                      <summary>
                        更多文章信息<span>＋</span>
                      </summary>
                      <p>其他原有字段会保留，可在这里修改 YAML。</p>
                      <Textarea
                        aria-label="YAML 文章信息"
                        value={draft.metadata}
                        onChange={(e) => setYaml(e.target.value)}
                        disabled={publishing || switching}
                      />
                    </details>
                  </details>
                  <div className="draft-context">
                    <Cloud size={19} />
                    <div>
                      <strong>
                        {draft.source_path
                          ? '正在修改已发布文章'
                          : '这是一篇私人草稿'}
                      </strong>
                      <p>
                        {draft.source_path
                          ? '点击发布后，博客才会更新。'
                          : '发布之前，内容仅自己可见。'}
                      </p>
                    </div>
                  </div>
                  {activeJob && (
                    <div
                      className={`publication-status ${activeJob.state === 'live' ? 'is-live' : ''}`}
                    >
                      <div>
                        <strong>{labels[activeJob.state]}</strong>
                        <p>
                          {activeJob.error ||
                            (activeJob.state === 'live'
                              ? '已在博客中确认本次发布。'
                              : '离开页面后，仍可回来查看结果。')}
                        </p>
                      </div>
                      <div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="刷新发布状态"
                          onClick={() => checkJobs()}
                        >
                          <RefreshCw size={16} />
                        </Button>
                        <a
                          href={activeJob.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开文章 <ArrowUpRight size={16} />
                        </a>
                      </div>
                    </div>
                  )}
                  {jobs.length > 0 && (
                    <details className="history">
                      <summary>
                        最近发布<span>{jobs.length}</span>
                      </summary>
                      {jobs.map((j) => (
                        <div key={j.id}>
                          <span>
                            {new Date(j.created_at).toLocaleString('zh-CN')}
                            <br />
                            {jobLabel(j)}
                          </span>
                          <a
                            href={j.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="查看已发布文章"
                          >
                            <ArrowUpRight size={17} />
                          </a>
                        </div>
                      ))}
                      <a
                        href={`https://github.com/${REPO}/actions`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看构建详情 ↗
                      </a>
                    </details>
                  )}
                  <Button
                    variant="outline"
                    disabled={panelBusy}
                    onClick={() => void backupCurrent()}
                  >
                    <Download size={17} />
                    导出文章与图片
                  </Button>
                  <a className="manager-text-link" href="/#activity">
                    查看全部发布记录 <ArrowUpRight size={15} />
                  </a>
                </aside>
              </SheetContent>
            </Sheet>
          </div>
        </main>
      </div>
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="manager-history-dialog">
          <DialogHeader>
            <DialogTitle>草稿历史版本</DialogTitle>
            <DialogDescription>
              恢复会生成一个新版本，已有历史继续保留。博客内容需要再次发布才会更新。
            </DialogDescription>
          </DialogHeader>
          <div className="manager-version-list">
            {versionHistory?.versions.map((version) => (
              <article key={version.revision}>
                <div>
                  <strong>
                    版本 {version.revision} · {version.title || '未命名文章'}
                  </strong>
                  <small>
                    {new Date(version.created_at).toLocaleString('zh-CN')} ·{' '}
                    {version.characters} 字
                  </small>
                </div>
                <Button
                  variant="outline"
                  disabled={switching || version.revision === draft.revision}
                  onClick={() => setRestoreVersion(version.revision)}
                >
                  选择恢复
                </Button>
              </article>
            ))}
          </div>
          {restoreVersion !== null && (
            <div className="manager-check-result">
              <p>确认恢复到版本 {restoreVersion}？当前内容会先保存。</p>
              <Button
                disabled={switching || versionHistory?.draftId !== draft.id}
                onClick={() => void restoreHistory()}
              >
                确认恢复
              </Button>
            </div>
          )}
          {error && (
            <p className="manager-warning" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={mediaOpen} onOpenChange={setMediaOpen}>
        <DialogContent className="manager-history-dialog">
          <DialogHeader>
            <DialogTitle>插入图片</DialogTitle>
            <DialogDescription>
              选择一张已上传的图片，插入当前文章。
            </DialogDescription>
          </DialogHeader>
          <div className="writer-media-picker">
            {mediaItems
              .filter((item) => !item.archived_at)
              .map((item) => (
                <button
                  key={item.name}
                  disabled={switching || publishing}
                  onClick={() => {
                    insert(
                      `\n![${item.filename.replace(/[\[\]\\\r\n]/g, '')}](${item.url})\n`,
                    );
                    setMediaOpen(false);
                  }}
                >
                  <img src={item.url} alt={item.filename} loading="lazy" />
                  <span>{item.filename}</span>
                </button>
              ))}
          </div>
          {!mediaItems.length && (
            <p>图片库为空。使用工具栏的上传按钮添加图片。</p>
          )}
          {mediaCursor && (
            <Button
              variant="outline"
              disabled={panelBusy}
              onClick={() => void browseMedia(true)}
            >
              加载更多
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={settings}
        onOpenChange={(value) => {
          setSettings(value);
          if (!value) setToken('');
        }}
      >
        <DialogContent className="connection-dialog">
          <DialogHeader>
            <span className="dialog-icon">
              <Link2 size={22} />
            </span>
            <DialogTitle>连接你的数字花园</DialogTitle>
            <DialogDescription>
              配置一次，就可以在手机和电脑上写作、发布。
            </DialogDescription>
          </DialogHeader>
          <div className="repo-card">
            <BookOpen size={23} />
            <div>
              <strong>Mon's Digital Garden</strong>
              <span>{REPO}</span>
            </div>
          </div>
          {!user ? (
            <a
              className="login-action"
              href="/signin-with-chatgpt?return_to=/"
              target="_top"
            >
              使用 ChatGPT 登录
            </a>
          ) : (
            <>
              <ol className="connection-steps">
                <li>在 GitHub 创建细粒度访问令牌。</li>
                <li>
                  仓库仅选择 <strong>Mon-Blog</strong>。
                </li>
                <li>
                  Contents 设为 <strong>Read and write</strong>；Actions 设为{' '}
                  <strong>Read-only</strong>。
                </li>
              </ol>
              <a
                className="text-link"
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noreferrer"
              >
                前往 GitHub 创建令牌 <ArrowUpRight size={16} />
              </a>
              <label className="token-label" htmlFor="writer-github-token">
                GitHub 访问令牌
                <Input
                  id="writer-github-token"
                  type="password"
                  autoComplete="off"
                  placeholder="github_pat_…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <p className="security-note">
                令牌加密保存在私有服务端，用于向你的博客提交文章。
              </p>
              {!keyReady && (
                <p className="configuration-note">
                  管理员需先配置写作室的加密密钥。你可以先保存草稿。
                </p>
              )}
              <Button
                className="connect-submit"
                onClick={connect}
                disabled={connecting || !token || !keyReady}
              >
                {connecting ? <LoaderCircle className="spin" /> : <Link2 />}
                {connected ? '更新连接' : '连接博客'}
              </Button>
              {error && (
                <p className="dialog-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent className="template-dialog">
          <DialogHeader>
            <DialogTitle>博客文章模板</DialogTitle>
            <DialogDescription>
              来自你的博客模板目录。文章模板会新建草稿；正文片段插入当前文章。
            </DialogDescription>
          </DialogHeader>
          <div className="template-sync">
            <p role="status">{templateMessage}</p>
            <Button
              variant="outline"
              disabled={!user || !connected || templateBusy || switching}
              onClick={() => void syncTemplates()}
            >
              <RefreshCw size={16} className={templateBusy ? 'spin' : ''} />
              同步仓库模板
            </Button>
          </div>
          <label htmlFor="article-template">选择模板</label>
          <NativeSelect
            id="article-template"
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            disabled={templateBusy || switching}
          >
            {templates.map((item) => (
              <NativeSelectOption key={item.path} value={item.path}>
                {item.name === 'yaml'
                  ? '标准文章 · YAML 与一级标题'
                  : item.name}{' '}
                {item.kind === 'snippet'
                  ? '· 正文片段'
                  : item.kind === 'unsupported'
                    ? '· 需转换脚本'
                    : ''}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {activeTemplate && (
            <>
              <small className="template-path">{activeTemplate.path}</small>
              <pre className="template-preview">{templatePreview}</pre>
              {activeTemplate.kind === 'unsupported' && (
                <p role="alert">
                  此模板包含尚不支持的 Obsidian 脚本。请在仓库中另存为普通
                  Markdown 后同步。
                </p>
              )}
              <Button
                disabled={
                  activeTemplate.kind === 'unsupported' ||
                  switching ||
                  publishing ||
                  opening ||
                  uploading ||
                  templateBusy
                }
                onClick={() => void useTemplate(activeTemplate)}
              >
                {activeTemplate.kind === 'snippet'
                  ? '插入当前正文'
                  : '保存当前文章并按模板新建'}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="import-dialog">
          <DialogHeader>
            <DialogTitle>从博客打开文章</DialogTitle>
            <DialogDescription>
              选择一篇文章，创建私有编辑稿。发布前不会改变博客。
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="搜索已有文章"
            placeholder="搜索文章文件名或目录…"
            value={importQuery}
            onChange={(e) => setImportQuery(e.target.value)}
          />
          <div className="import-list">
            {importLoading ? (
              <p>
                <LoaderCircle className="spin" />
                正在读取文章…
              </p>
            ) : (
              articles
                .filter((a) =>
                  a.path.toLowerCase().includes(importQuery.toLowerCase()),
                )
                .map((a) => (
                  <button key={a.path} onClick={() => importArticle(a.path)}>
                    <FileText size={19} />
                    <div>
                      <strong>{a.title}</strong>
                      <small>{a.path}</small>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                ))
            )}
          </div>
          {error && <p className="dialog-error">{error}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
