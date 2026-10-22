'use client';

import { useRef, useState } from 'react';
import { LoaderCircle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { COLLECTIONS } from '@/lib/content';
import { MAX_BACKUP_BYTES } from '@/lib/backup';
import type { BackupPreview } from '@/lib/backup-restore';

async function sendBackup<T>(
  path: string,
  file: File,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`/api/backup/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip', ...headers },
    body: file,
  });
  const data = (await response
    .json()
    .catch(() => ({ error: '恢复服务暂时无法响应，请稍后重试。' }))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || '备份处理未完成。');
  return data;
}

export default function BackupRestore({
  disabled,
  onRestored,
}: {
  disabled: boolean;
  onRestored: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{
    file: File;
    preview: BackupPreview;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function inspect(file: File) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (file.size > MAX_BACKUP_BYTES)
        throw new Error(
          'ZIP 请控制在 32 MB 以内。旧大包请先使用本地备份拆分工具处理。',
        );
      if (!file.name.toLowerCase().endsWith('.zip'))
        throw new Error('请选择写作室导出的 ZIP 备份。');
      setSelected({
        file,
        preview: await sendBackup<BackupPreview>('preview', file),
      });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const result = await sendBackup<{
        drafts: { id: string }[];
        image_count: number;
      }>('restore', selected.file, {
        'x-backup-sha256': selected.preview.sha256,
        'x-restore-id': selected.preview.restore_id,
      });
      setSelected(null);
      setNotice(
        `已恢复 ${result.drafts.length} 篇私人草稿和 ${result.image_count} 张图片。可在草稿箱继续编辑。`,
      );
      await onRestored();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="manager-panel">
        <h2>恢复 ZIP 备份</h2>
        <p>
          选择写作室导出的原始
          ZIP，先检查文章与图片清单，再恢复到私人草稿箱。支持 32 MB、100
          篇草稿以内的备份。
        </p>
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Upload size={17} />
          )}
          选择备份并预览
        </Button>
        <input
          hidden
          ref={input}
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void inspect(file);
          }}
        />
        {notice && <p role="status">{notice}</p>}
        {error && !selected && (
          <p role="alert" className="manager-warning">
            {error}
          </p>
        )}
      </section>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setSelected(null);
            setError('');
          }
        }}
      >
        <DialogContent className="manager-history-dialog">
          <DialogHeader>
            <DialogTitle>确认恢复备份</DialogTitle>
            <DialogDescription>
              全部内容会创建为新的私人草稿，包括原回收站中的文章。已有草稿和博客文章保持原样；恢复不会发布到博客。
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <p>
                {selected.file.name} ·{' '}
                {(selected.preview.bytes / 1024 / 1024).toFixed(1)} MB
              </p>
              <p>
                {selected.preview.drafts.length} 篇草稿（含{' '}
                {selected.preview.trashed_count} 篇原回收站草稿），
                {selected.preview.image_count} 张私有图片。导出时间：
                {new Date(selected.preview.exported_at).toLocaleString('zh-CN')}
              </p>
              <ul
                aria-label="待恢复草稿"
                style={{
                  maxHeight: '35vh',
                  overflowY: 'auto',
                  paddingLeft: '1.5rem',
                  listStyle: 'disc',
                }}
              >
                {selected.preview.drafts.map((draft, index) => (
                  <li key={index}>
                    {draft.title || '未命名草稿'} ·{' '}
                    {
                      COLLECTIONS.find(
                        (collection) => collection.id === draft.collection,
                      )?.name
                    }
                    {draft.was_trashed ? ' · 原回收站' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p role="alert" className="manager-warning">
              {error}
            </p>
          )}
          <div className="manager-button-row">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setError('');
              }}
            >
              取消
            </Button>
            <Button disabled={busy} onClick={() => void restore()}>
              {busy && <LoaderCircle size={16} className="spin" />}
              确认恢复为私人草稿
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
