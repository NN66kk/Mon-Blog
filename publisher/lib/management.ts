import { parseDocument } from 'yaml';
import { articleUrl, splitMarkdown, validPath } from './content';
import { previewImageUrl } from './editor-content';

export const IMAGE_NAME = /^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;
export const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function managedPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    validPath(path) &&
    !path.endsWith('/2024070515116.md')
  );
}
export function metadataForArticle(path: string, source: string) {
  const parsed = splitMarkdown(source);
  const data =
    parsed.data &&
    typeof parsed.data === 'object' &&
    !Array.isArray(parsed.data)
      ? parsed.data
      : {};
  const tags = Array.isArray(data.tags)
    ? data.tags.map(String)
    : typeof data.tags === 'string'
      ? data.tags
          .split(/[,，]/)
          .map((x: string) => x.trim())
          .filter(Boolean)
      : [];
  const text = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const filename = path.split('/').pop()!.replace(/\.md$/, '');
  const stamp =
    filename.match(/(?:^|_)(20\d{2})(\d{2})(\d{2})\d*(?:$)/) ||
    filename.match(/(20\d{2})-(\d{2})-(\d{2})/);
  const short = filename.match(/^(\d{2})(\d{2})(\d{2})\d{6}$/);
  const date =
    text(data.published_at || data.cdate || data.date) ||
    (stamp
      ? `${stamp[1]}-${stamp[2]}-${stamp[3]}`
      : short
        ? `20${short[1]}-${short[2]}-${short[3]}`
        : '');
  return {
    path,
    collection: path.split('/')[1],
    title:
      text(data.title) || parsed.body.match(/^#\s+(.+)$/m)?.[1] || filename,
    tags,
    description: text(data.description),
    published_at: date,
    updated_at: text(data.updated_at),
    url: articleUrl(path),
  };
}
export function privateImages(body: string) {
  return [
    ...new Set(
      Array.from(
        body.matchAll(/\/api\/media\/([a-f0-9-]{36}\.(?:png|jpg|webp|gif))/g),
        (m) => m[1],
      ),
    ),
  ];
}
export function duplicateMetadata(metadata: string) {
  const doc = parseDocument(metadata || '{}');
  if (
    doc.errors.length ||
    !doc.toJSON() ||
    typeof doc.toJSON() !== 'object' ||
    Array.isArray(doc.toJSON())
  )
    return metadata;
  for (const field of [
    'published_at',
    'updated_at',
    'cdate',
    'date',
    'status',
    'draft',
    'title',
  ])
    doc.delete(field);
  return doc.toString();
}
export function restoredContent(source: string, release: string) {
  return `${source.replace(/\n?<!-- publisher-release:[a-z0-9-]+ -->\n?/g, '').trimEnd()}\n\n<!-- publisher-release:${release} -->\n`;
}

// Copies and exports change the Markdown location; keep existing article images resolvable.
export function portableImages(body: string, sourcePath?: string | null) {
  if (!sourcePath) return body;
  return body.replace(
    /(!\[[^\]]*\]\()(<[^>\n]+>|[^\s)]+)/g,
    (match, before, raw) => {
      const source = raw.startsWith('<') ? raw.slice(1, -1) : raw;
      if (/^(?:https?:|\/api\/media\/|#)/i.test(source)) return match;
      const resolved = previewImageUrl(source, sourcePath);
      return resolved ? `${before}${resolved}` : match;
    },
  );
}
