import { exportMarkdown } from './editor-content';
import { portableImages, privateImages } from './management';

const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let i = 0; i < 8; i++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipStored(entries: { path: string; data: Uint8Array }[]) {
  const parts: BlobPart[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (
      entry.path.startsWith('/') ||
      entry.path.split('/').some((part) => part === '..') ||
      entry.path.includes('\\')
    )
      throw new Error('备份文件路径无效。');
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(12, 33, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, entry.data.length, true);
    c.setUint32(24, entry.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    parts.push(header, entry.data as Uint8Array<ArrayBuffer>);
    directory.push(central);
    offset += header.length + entry.data.length;
  }
  const size = directory.reduce((sum, x) => sum + x.length, 0);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  return new Blob(
    [...parts, ...(directory as Uint8Array<ArrayBuffer>[]), end],
    { type: 'application/zip' },
  );
}
type BackupDraft = {
  id: string;
  title: string;
  body: string;
  metadata: string;
  source_path?: string | null;
  deleted_at?: string | null;
};

export async function draftBackup(
  drafts: BackupDraft[],
  request: typeof fetch = fetch,
  progress: (value: string) => void = () => {},
) {
  const entries: { path: string; data: Uint8Array }[] = [];
  let total = 0;
  const names = [
    ...new Set(drafts.flatMap((draft) => privateImages(draft.body))),
  ];
  for (const [index, name] of names.entries()) {
    progress(`正在打包图片 ${index + 1}/${names.length}`);
    const result = await request(`/api/media/${name}`);
    if (!result.ok)
      throw new Error(`图片 ${name} 读取失败，备份已停止，请重试。`);
    const data = new Uint8Array(await result.arrayBuffer());
    total += data.byteLength;
    if (total > 100 * 1024 * 1024)
      throw new Error('本次图片超过 100 MB，请分批选择草稿导出。');
    entries.push({ path: `assets/${name}`, data });
  }
  for (const draft of drafts) {
    let body = portableImages(draft.body, draft.source_path);
    for (const name of privateImages(body))
      body = body.replaceAll(`/api/media/${name}`, `../assets/${name}`);
    // Keep published relative assets usable; these already exist in the GitHub backup.
    const folder = draft.deleted_at ? 'trash' : 'drafts';
    entries.push({
      path: `${folder}/${draft.id}.md`,
      data: encoder.encode(exportMarkdown({ ...draft, body })),
    });
  }
  entries.push({
    path: 'manifest.json',
    data: encoder.encode(
      JSON.stringify(
        { version: 1, exported_at: new Date().toISOString(), drafts },
        null,
        2,
      ),
    ),
  });
  entries.push({
    path: 'README.txt',
    data: encoder.encode(
      'Mon 写作室备份\n草稿位于 drafts/，回收站草稿位于 trash/，私有图片位于 assets/。manifest.json 保留原始内容和元数据。已发布文章及其原有图片另外保存在 GitHub 仓库。Markdown 可通过写作室的「导入 Markdown」再次导入；重新上传本地图片后发布。\n',
    ),
  });
  return zipStored(entries);
}
