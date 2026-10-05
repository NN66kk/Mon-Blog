'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
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
import type { McpKeySummary, McpScope } from '@/lib/mcp-keys';

const scopeName: Record<McpScope, string> = {
  'content:read': '读取内容',
  'drafts:write': '编辑草稿',
  'publications:write': '发布文章',
};
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '尚未使用';

async function request<T>(path = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/mcp-keys${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const data = await response
    .json()
    .catch(() => ({ error: '服务暂时无法响应，请稍后重试。' }));
  if (!response.ok) {
    const message =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : '密钥操作未完成，请稍后重试。';
    throw new Error(message);
  }
  return data as T;
}

export default function McpSettings() {
  const [keys, setKeys] = useState<McpKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState('90');
  const [drafts, setDrafts] = useState(true);
  const [publish, setPublish] = useState(false);
  const [issued, setIssued] = useState<{
    key: string;
    record: McpKeySummary;
  } | null>(null);
  const [revoking, setRevoking] = useState<McpKeySummary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [endpoint, setEndpoint] = useState('/api/mcp');
  const [checkedAt, setCheckedAt] = useState(0);

  const reload = useCallback(
    () =>
      request<{ keys: McpKeySummary[] }>()
        .then((data) => {
          setKeys(data.keys);
          setError('');
        })
        .catch((failure: unknown) => {
          setError(
            failure instanceof Error ? failure.message : '读取密钥失败。',
          );
        })
        .finally(() => {
          setEndpoint(`${window.location.origin}/api/mcp`);
          setCheckedAt(Date.now());
          setLoading(false);
        }),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setError('');
      setNotice(message);
    } catch {
      setError('复制失败，请选中文字后手动复制。');
    }
  }
  async function generate() {
    if (busy || issued) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const scopes: McpScope[] = ['content:read'];
      if (drafts) scopes.push('drafts:write');
      if (publish) scopes.push('publications:write');
      const created = await request<{ key: string; record: McpKeySummary }>(
        '',
        { name, expiresInDays: Number(days), scopes },
      );
      setIssued(created);
      setKeys((previous) => [created.record, ...previous]);
      setName('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '生成密钥失败。');
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!revoking || busy) return;
    const target = revoking;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { record } = await request<{ record: McpKeySummary }>(
        `/${encodeURIComponent(target.id)}/revoke`,
        {},
      );
      setKeys((previous) =>
        previous.map((item) => (item.id === record.id ? record : item)),
      );
      if (issued?.record.id === record.id) setIssued(null);
      setRevoking(null);
      setNotice(`「${record.name}」已撤销，客户端需要换用新密钥。`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '撤销密钥失败。');
    } finally {
      setBusy(false);
    }
  }
  const oauthEndpoint = endpoint.replace(/\/api\/mcp$/, '/mcp');
  const hostedSite = /^https:\/\/[^/]+\.chatgpt\.site\/api\/mcp$/.test(
    endpoint,
  );
  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        'mon-blog': {
          url: endpoint,
          headers: {
            Authorization: 'Bearer <MON_BLOG_API_KEY>',
            ...(hostedSite
              ? { 'OAI-Sites-Authorization': 'Bearer <SITES_SERVICE_TOKEN>' }
              : {}),
          },
        },
      },
    },
    null,
    2,
  );
  const codexConfig = `[mcp_servers.mon_blog]\nurl = ${JSON.stringify(endpoint)}\nhttp_headers = { Authorization = "Bearer <MON_BLOG_API_KEY>"${hostedSite ? ', "OAI-Sites-Authorization" = "Bearer <SITES_SERVICE_TOKEN>"' : ''} }`;

  return (
    <section
      className="manager-panel min-w-0"
      style={{ gridColumn: '1 / -1' }}
      aria-labelledby="mcp-settings-title"
    >
      <span className="manager-panel-icon">
        <KeyRound />
      </span>
      <h2 id="mcp-settings-title">连接 AI 写作助手</h2>
      <p>通过 MCP 让 AI 助手读取博客、整理草稿，并在你明确要求时发布文章。</p>
      <div className="my-5 rounded-lg border border-primary/30 bg-secondary p-4">
        <h3 className="mb-2 text-lg">通过 ChatGPT 登录连接（推荐）</h3>
        <p className="manager-field-help">
          在 Codex 的「插件 → 个人 → 由你创建」中找到「Mon ·
          写作室」，安装并连接。 支持 OAuth 的 MCP
          客户端也可使用下面的地址，按提示登录拥有此写作室的账号。
          该连接可以读取内容、编辑草稿和发布文章，沿用网页中的博客连接。
        </p>
        <label className="manager-field" htmlFor="mcp-oauth-url">
          登录授权服务地址
          <div className="flex min-w-0 gap-2">
            <Input
              id="mcp-oauth-url"
              readOnly
              value={oauthEndpoint}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() =>
                void copy(oauthEndpoint, '已复制登录授权服务地址。')
              }
            >
              <Copy size={16} />
              复制
            </Button>
          </div>
        </label>
        <p className="manager-field-help">
          这种方式无需生成下方的 API Key，也无需保持写作室网页打开。
        </p>
      </div>
      <h3 className="mb-2 text-lg">API Key（高级连接）</h3>
      <p className="manager-field-help">
        为支持自定义请求头的客户端生成独立密钥，可限制权限、设置有效期或单独撤销。
        私有线上写作室还需要平台服务凭证，仅填写 API Key
        无法通过登录网关；日常使用请优先选择上方的登录授权连接。
      </p>
      {error && (
        <div role="alert" className="manager-warning mb-4">
          {error}
        </div>
      )}
      {notice && (
        <output className="mb-4 block text-sm text-primary">{notice}</output>
      )}
      <label className="manager-field" htmlFor="mcp-server-url">
        API Key 服务地址
        <div className="flex min-w-0 gap-2">
          <Input
            id="mcp-server-url"
            readOnly
            value={endpoint}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void copy(endpoint, '已复制 MCP 服务地址。')}
          >
            <Copy size={16} />
            复制
          </Button>
        </div>
      </label>
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <label className="manager-field" htmlFor="mcp-key-name">
            密钥名称
            <Input
              id="mcp-key-name"
              required
              maxLength={80}
              placeholder="例如：我的 Codex"
              autoComplete="off"
              value={name}
              disabled={busy || Boolean(issued)}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="manager-field" htmlFor="mcp-key-expiry">
            有效期
            <NativeSelect
              id="mcp-key-expiry"
              value={days}
              disabled={busy || Boolean(issued)}
              onChange={(event) => setDays(event.target.value)}
            >
              {[7, 30, 90, 365].map((day) => (
                <NativeSelectOption key={day} value={String(day)}>
                  {day} 天
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <fieldset
            disabled={busy || Boolean(issued)}
            className="my-5 grid gap-3 text-sm"
          >
            <legend className="mb-3 text-muted-foreground">
              允许执行的操作
            </legend>
            <label className="flex items-center gap-2" htmlFor="mcp-scope-read">
              <Checkbox id="mcp-scope-read" checked disabled />
              读取博客与草稿（必选）
            </label>
            <label
              className="flex items-center gap-2"
              htmlFor="mcp-scope-drafts"
            >
              <Checkbox
                id="mcp-scope-drafts"
                checked={drafts}
                onCheckedChange={(checked) => setDrafts(checked === true)}
              />
              创建、修改草稿
            </label>
            <label
              className="flex items-center gap-2"
              htmlFor="mcp-scope-publish"
            >
              <Checkbox
                id="mcp-scope-publish"
                checked={publish}
                onCheckedChange={(checked) => setPublish(checked === true)}
              />
              发布文章到博客
            </label>
          </fieldset>
          {publish && (
            <p className="manager-field-help">
              开启后，客户端可以把文章提交到博客，完成部署后公开可见。
            </p>
          )}
          <Button
            type="submit"
            disabled={busy || loading || Boolean(issued) || !name.trim()}
          >
            {busy ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            生成密钥
          </Button>
        </form>
        <div className="min-w-0 pt-6">
          {issued ? (
            <div className="rounded-lg border border-primary/30 bg-secondary p-4">
              <h3 className="mb-2 text-lg">保存这把密钥</h3>
              <p className="manager-field-help">
                完整密钥只显示这一次。复制到客户端后请收起；离开页面后无法再次查看。
              </p>
              <textarea
                aria-label="新生成的 MCP 密钥，仅显示一次"
                className="w-full resize-none break-all rounded border bg-background p-3 font-mono text-sm"
                rows={3}
                readOnly
                spellCheck={false}
                autoComplete="off"
                value={issued.key}
              />
              <div className="manager-button-row mt-3">
                <Button
                  type="button"
                  onClick={() =>
                    void copy(
                      issued.key,
                      '已复制密钥，请粘贴到你的 MCP 客户端。',
                    )
                  }
                >
                  <Copy size={16} />
                  复制密钥
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIssued(null);
                    setNotice('密钥已收起。');
                  }}
                >
                  已保存，收起
                </Button>
              </div>
            </div>
          ) : (
            <p className="manager-field-help">
              建议为每个客户端分别生成密钥，方便单独撤销。默认只允许读取内容和编辑草稿。
            </p>
          )}
          <details className="mt-5 min-w-0 rounded-lg border p-4">
            <summary className="cursor-pointer">查看客户端配置示例</summary>
            <p className="manager-field-help mt-3">
              将 &lt;MON_BLOG_API_KEY&gt;
              替换为刚生成的密钥，保存到客户端的个人配置即可。示例只包含占位符，请勿把真实密钥提交到博客仓库。
              {hostedSite &&
                '线上还需将 <SITES_SERVICE_TOKEN> 替换为平台服务凭证；它与这里生成的 API Key 不同。'}
            </p>
            <h3 className="mb-2 text-sm">Codex · 个人 config.toml</h3>
            <pre className="max-w-full overflow-x-auto rounded bg-secondary p-3 font-mono text-xs">
              {codexConfig}
            </pre>
            <Button
              type="button"
              variant="ghost"
              className="my-2"
              onClick={() =>
                void copy(
                  codexConfig,
                  '已复制 Codex 配置示例，请替换密钥占位符。',
                )
              }
            >
              <Copy size={15} />
              复制 Codex 示例
            </Button>
            <h3 className="mb-2 text-sm">Cursor · ~/.cursor/mcp.json</h3>
            <pre className="max-w-full overflow-x-auto rounded bg-secondary p-3 font-mono text-xs">
              {cursorConfig}
            </pre>
            <Button
              type="button"
              variant="ghost"
              className="mt-2"
              onClick={() =>
                void copy(
                  cursorConfig,
                  '已复制 Cursor 配置示例，请替换密钥占位符。',
                )
              }
            >
              <Copy size={15} />
              复制 Cursor 示例
            </Button>
          </details>
        </div>
      </div>
      <div className="mb-3 mt-8 flex items-center justify-between gap-3">
        <h3 className="text-lg">已创建的密钥</h3>
        <Button
          type="button"
          variant="outline"
          disabled={loading || busy}
          onClick={() => {
            setLoading(true);
            void reload();
          }}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          刷新
        </Button>
      </div>
      {loading && !keys.length ? (
        <output>正在读取密钥…</output>
      ) : !keys.length ? (
        <p>还没有密钥，生成后即可连接客户端。</p>
      ) : (
        <ul className="grid gap-3">
          {keys.map((item) => {
            const expired = new Date(item.expires_at).getTime() <= checkedAt;
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="break-all font-medium">
                      {item.name}
                    </strong>
                    <span className="rounded bg-secondary px-2 py-1 text-xs">
                      {item.revoked_at ? '已撤销' : expired ? '已过期' : '可用'}
                    </span>
                  </div>
                  <code className="my-2 block text-xs text-muted-foreground">
                    {item.prefix}…
                  </code>
                  <div className="text-sm">
                    {item.scopes.map((scope) => scopeName[scope]).join(' · ')}
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    <span>创建：{date(item.created_at)}</span>
                    <span>到期：{date(item.expires_at)}</span>
                    <span>最近使用：{date(item.last_used_at)}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || loading || Boolean(item.revoked_at)}
                  onClick={() => setRevoking(item)}
                >
                  撤销
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <AlertDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => {
          if (!open && !busy) setRevoking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤销这把密钥？</AlertDialogTitle>
            <AlertDialogDescription>
              「{revoking?.name}
              」将立即失效，使用它的客户端需要换用新密钥。文章与草稿会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void revoke();
              }}
            >
              {busy ? '正在撤销…' : '确认撤销'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
