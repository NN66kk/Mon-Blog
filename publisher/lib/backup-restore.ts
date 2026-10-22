import { crc32, MAX_BACKUP_BYTES, MAX_BACKUP_DRAFTS } from './backup';
import { validCollection, validPath } from './content';
import { exportMarkdown } from './editor-content';
import { ApiError } from './github';
import { IMAGE_NAME, portableImages, privateImages, UUID } from './management';

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const MAX_RESTORED_TEXT_BYTES = 2 * 1024 * 1024;
// Historical GitHub imports could exceed the normal editor save limits. Keep
// recovery lossless while bounding the combined UTF-8 payload independently.
function restorableText(draft: Record<string, unknown>) {
  let bytes = 0;
  for (const value of [draft.title, draft.body, draft.metadata]) {
    if (typeof value !== 'string' || value.length > MAX_RESTORED_TEXT_BYTES)
      return false;
    bytes += encoder.encode(value).byteLength;
    if (bytes > MAX_RESTORED_TEXT_BYTES) return false;
  }
  return true;
}
const invalid = (
  message = '备份文件损坏或格式不受支持，请选择写作室导出的原始 ZIP。',
): never => {
  throw new ApiError(400, message);
};
const oversized = () =>
  new ApiError(
    413,
    '备份超过 32 MB，请分批导出；旧大包请先使用本地备份拆分工具处理。',
  );

// The writer exports uncompressed ZIP v1. Accept only that exact, bounded
// format: no extraction paths, decompression bombs, encryption, ZIP64 or links.
export function readStoredZip(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw oversized();
  if (bytes.byteLength < 22) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (
    view.getUint32(end, true) !== 0x06054b50 ||
    view.getUint16(end + 20, true) !== 0 ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0
  )
    invalid();
  const count = view.getUint16(end + 10, true);
  const directory = view.getUint32(end + 16, true);
  if (
    !count ||
    count > 1202 ||
    count !== view.getUint16(end + 8, true) ||
    directory + view.getUint32(end + 12, true) !== end
  )
    invalid();
  const entries = new Map<string, Uint8Array>();
  let cursor = directory;
  let localEnd = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      invalid();
    const flags = view.getUint16(cursor + 8, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      !nameLength ||
      flags !== 0x800 ||
      view.getUint16(cursor + 10, true) !== 0 ||
      size !== view.getUint32(cursor + 20, true) ||
      extraLength ||
      commentLength ||
      view.getUint16(cursor + 34, true) ||
      view.getUint32(cursor + 38, true) ||
      local !== localEnd ||
      local + 30 + nameLength + size > directory
    )
      invalid();
    let path: string;
    try {
      path = textDecoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
    } catch {
      return invalid();
    }
    if (
      !/^(manifest\.json|README\.txt|(?:drafts|trash)\/[a-f0-9-]{36}\.md|assets\/[a-f0-9-]{36}\.(?:png|jpg|gif|webp))$/.test(
        path,
      ) ||
      entries.has(path)
    )
      invalid('备份包含重复文件或不允许的路径，请使用原始导出 ZIP。');
    if (
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== 0 ||
      view.getUint16(local + 26, true) !== nameLength ||
      view.getUint16(local + 28, true) !== 0 ||
      view.getUint32(local + 18, true) !== size ||
      view.getUint32(local + 22, true) !== size ||
      !bytes
        .subarray(local + 30, local + 30 + nameLength)
        .every((byte, offset) => byte === bytes[cursor + 46 + offset])
    )
      invalid();
    const data = bytes.subarray(
      local + 30 + nameLength,
      local + 30 + nameLength + size,
    );
    const checksum = crc32(data);
    if (
      checksum !== view.getUint32(cursor + 16, true) ||
      checksum !== view.getUint32(local + 14, true)
    )
      invalid('备份文件校验失败，内容可能不完整或已损坏。');
    entries.set(path, data);
    localEnd = local + 30 + nameLength + size;
    cursor = next;
  }
  if (cursor !== end || localEnd !== directory) invalid();
  return entries;
}

type RestorableDraft = {
  id: string;
  title: string;
  collection: string;
  body: string;
  metadata: string;
  source_path?: string | null;
  deleted_at?: string | null;
};
export type BackupPreview = {
  sha256: string;
  restore_id: string;
  exported_at: string;
  bytes: number;
  image_count: number;
  trashed_count: number;
  drafts: { title: string; collection: string; was_trashed: boolean }[];
};

function imageType(bytes: Uint8Array) {
  if (bytes.length < 12 || bytes.length > 5 * 1024 * 1024)
    invalid('备份图片必须在 5 MB 以内。');
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    return { ext: 'png', mime: 'image/png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { ext: 'jpg', mime: 'image/jpeg' };
  const ascii = new TextDecoder();
  if (/^GIF8[79]a$/.test(ascii.decode(bytes.subarray(0, 6))))
    return { ext: 'gif', mime: 'image/gif' };
  if (
    ascii.decode(bytes.subarray(0, 4)) === 'RIFF' &&
    ascii.decode(bytes.subarray(8, 12)) === 'WEBP'
  )
    return { ext: 'webp', mime: 'image/webp' };
  return invalid('备份包含不支持的图片格式。');
}

function parseBackup(bytes: Uint8Array) {
  const entries = readStoredZip(bytes);
  const manifest = entries.get('manifest.json');
  if (!manifest) invalid('备份缺少有效的 manifest.json。');
  let data: any;
  try {
    data = JSON.parse(textDecoder.decode(manifest));
  } catch {
    return invalid('备份清单 JSON 无效。');
  }
  if (data?.version !== 1)
    invalid('备份版本不受支持，目前支持写作室 version 1 备份。');
  if (
    !Array.isArray(data.drafts) ||
    !data.drafts.length ||
    data.drafts.length > MAX_BACKUP_DRAFTS ||
    typeof data.exported_at !== 'string' ||
    !Number.isFinite(Date.parse(data.exported_at))
  )
    invalid('备份清单无效，单次恢复需要 1 至 100 篇草稿。');
  const drafts: RestorableDraft[] = [];
  const ids = new Set<string>();
  const expected = new Set([
    'manifest.json',
    ...(entries.has('README.txt') ? ['README.txt'] : []),
  ]);
  const names = new Set<string>();
  for (const draft of data.drafts) {
    if (
      !draft ||
      typeof draft.id !== 'string' ||
      !UUID.test(draft.id) ||
      ids.has(draft.id) ||
      !restorableText(draft) ||
      !validCollection(draft.collection) ||
      (draft.source_path != null &&
        (typeof draft.source_path !== 'string' ||
          !validPath(draft.source_path))) ||
      (draft.deleted_at != null &&
        (typeof draft.deleted_at !== 'string' ||
          !Number.isFinite(Date.parse(draft.deleted_at))))
    )
      invalid(
        '备份包含重复草稿、无效栏目，或文章标题、正文与元数据合计超过 2 MiB。',
      );
    ids.add(draft.id);
    const path = `${draft.deleted_at ? 'trash' : 'drafts'}/${draft.id}.md`;
    expected.add(path);
    const markdown = entries.get(path);
    let portable = portableImages(draft.body, draft.source_path);
    for (const name of privateImages(draft.body)) {
      if (!IMAGE_NAME.test(name)) invalid();
      names.add(name);
      expected.add(`assets/${name}`);
      portable = portable.replaceAll(`/api/media/${name}`, `../assets/${name}`);
    }
    try {
      if (
        !markdown ||
        textDecoder.decode(markdown) !==
          exportMarkdown({ ...draft, body: portable })
      )
        invalid(
          '备份中的 Markdown 与清单不一致，请使用未经修改的原始导出 ZIP。',
        );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      invalid();
    }
    drafts.push(draft);
  }
  if (
    entries.size !== expected.size ||
    [...entries.keys()].some((path) => !expected.has(path))
  )
    invalid('备份文件清单不完整，或包含未被草稿引用的额外条目。');
  const images = [...names].map((name) => {
    const image = entries.get(`assets/${name}`);
    if (!image) return invalid('备份缺少草稿引用的私有图片。');
    const type = imageType(image);
    if (!name.endsWith(`.${type.ext}`)) invalid('备份图片内容与扩展名不一致。');
    return { name, data: image, ...type };
  });
  return { drafts, images, exported_at: data.exported_at as string };
}

async function hash(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
async function stableId(value: string) {
  const hex = await hash(encoder.encode(value));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function previewBackup(bytes: Uint8Array): Promise<BackupPreview> {
  const backup = parseBackup(bytes);
  return {
    sha256: await hash(bytes),
    restore_id: crypto.randomUUID(),
    exported_at: backup.exported_at,
    bytes: bytes.length,
    image_count: backup.images.length,
    trashed_count: backup.drafts.filter((draft) => draft.deleted_at).length,
    drafts: backup.drafts.map((draft) => ({
      title: draft.title,
      collection: draft.collection,
      was_trashed: Boolean(draft.deleted_at),
    })),
  };
}

type RestoreDependencies = {
  db: Pick<D1Database, 'prepare' | 'batch'>;
  storage: Pick<R2Bucket, 'put'>;
};
export function createBackupRestoreService({
  db,
  storage,
}: RestoreDependencies) {
  return async (
    owner: string,
    bytes: Uint8Array,
    confirmation: { sha256: string; restore_id: string },
  ) => {
    if (
      !UUID.test(confirmation.restore_id || '') ||
      !/^[a-f0-9]{64}$/.test(confirmation.sha256 || '')
    )
      throw new ApiError(400, '请先预览备份，再确认恢复。');
    const backup = parseBackup(bytes);
    if ((await hash(bytes)) !== confirmation.sha256)
      throw new ApiError(409, '备份与预览时不一致，请重新选择文件预览。');
    const namespace = JSON.stringify([
      owner,
      confirmation.restore_id,
      confirmation.sha256,
    ]);
    const ids = await Promise.all(
      backup.drafts.map((draft) => stableId(`${namespace}:draft:${draft.id}`)),
    );
    const imageNames = new Map(
      await Promise.all(
        backup.images.map(
          async (image) =>
            [
              image.name,
              `${await stableId(`${namespace}:image:${image.name}`)}.${image.ext}`,
            ] as const,
        ),
      ),
    );
    const existingCount = async () => {
      let count = 0;
      for (let start = 0; start < ids.length; start += 50) {
        const batch = ids.slice(start, start + 50);
        const row = await db
          .prepare(
            `SELECT count(*) AS count FROM drafts WHERE owner=? AND id IN (${batch.map(() => '?').join(',')})`,
          )
          .bind(owner, ...batch)
          .first<{ count: number }>();
        count += row?.count || 0;
      }
      return count;
    };
    const result = (repeated: boolean) => ({
      drafts: ids.map((id, index) => ({
        id,
        title: backup.drafts[index].title,
      })),
      image_count: backup.images.length,
      repeated,
    });
    const existing = await existingCount();
    if (existing === ids.length) return result(true);
    if (existing)
      throw new ApiError(
        409,
        '本次恢复已有部分草稿，请刷新列表核对后重新预览。',
      );
    // Upload into new owner-scoped names before the atomic D1 write. On failure,
    // private objects remain for retry; existing drafts/images are never removed.
    for (const image of backup.images) {
      await storage.put(
        `${encodeURIComponent(owner)}/${imageNames.get(image.name)!}`,
        image.data as Uint8Array<ArrayBuffer>,
        {
          httpMetadata: { contentType: image.mime },
          customMetadata: { filename: image.name, restored: 'true' },
        },
      );
    }
    const now = new Date().toISOString();
    const statements = backup.drafts.flatMap((draft, index) => {
      let body = portableImages(draft.body, draft.source_path);
      for (const [original, replacement] of imageNames)
        body = body.replaceAll(
          `/api/media/${original}`,
          `/api/media/${replacement}`,
        );
      return [
        db
          .prepare(
            'INSERT INTO drafts (id,owner,title,collection,body,metadata,revision,updated_at) VALUES (?,?,?,?,?,?,1,?)',
          )
          .bind(
            ids[index],
            owner,
            draft.title,
            draft.collection,
            body,
            draft.metadata,
            now,
          ),
        db
          .prepare(
            'INSERT INTO draft_versions (id,owner,draft_id,revision,title,collection,body,metadata,created_at) VALUES (?,?,?,1,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            owner,
            ids[index],
            draft.title,
            draft.collection,
            body,
            draft.metadata,
            now,
          ),
      ];
    });
    try {
      await db.batch(statements);
    } catch (error) {
      // Concurrent confirmations share deterministic IDs. An already completed
      // batch is a successful retry, never a reason to overwrite saved edits.
      if ((await existingCount()) === ids.length) return result(true);
      throw new ApiError(
        503,
        '恢复未完成，尚未新增草稿。请保留当前预览并重试；已上传的私有图片会复用。',
      );
    }
    return result(false);
  };
}

export async function readBackupRequest(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BACKUP_BYTES)
    throw oversized();
  if (!request.body) invalid('请选择 ZIP 备份文件。');
  const reader = request.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BACKUP_BYTES) {
      await reader.cancel();
      throw oversized();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
