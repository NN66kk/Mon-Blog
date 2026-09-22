import { parseDocument } from 'yaml';
import type { Definition, Image, ImageReference, Nodes } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
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

const imageMarkdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath);

function markdownImageText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]]/g, '\\$&')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;');
}

function portableImageMarkdown(
  image: Image | ImageReference,
  destination: Image | Definition,
  url: string,
) {
  const alt = markdownImageText(image.alt || '');
  // Encode destination delimiters so parentheses and escaped filenames remain
  // valid even when an original angle-bracket destination is serialized inline.
  const target = url
    .replace(
      /[()\\]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    .replace(/&/g, '&amp;');
  const title =
    destination.title == null
      ? ''
      : ` "${markdownImageText(destination.title).replace(/"/g, '\\"')}"`;
  return `![${alt}](${target}${title})`;
}

// Copies and exports change the Markdown location; keep existing article images
// resolvable without rewriting Markdown examples or unrelated source formatting.
export function portableImages(body: string, sourcePath?: string | null) {
  if (!sourcePath) return body;
  const tree = imageMarkdownParser.parse(body);
  const definitions = new Map<string, Definition>();
  const images: (Image | ImageReference)[] = [];
  const collect = (node: Nodes) => {
    if (node.type === 'definition' && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if (node.type === 'image' || node.type === 'imageReference')
      images.push(node);
    if ('children' in node) node.children.forEach(collect);
  };
  collect(tree);

  const edits: { start: number; end: number; text: string }[] = [];
  for (const image of images) {
    const destination =
      image.type === 'image' ? image : definitions.get(image.identifier);
    if (!destination || /^(?:https?:|\/api\/media\/|#)/i.test(destination.url))
      continue;
    const resolved = previewImageUrl(destination.url, sourcePath);
    const start = image.position?.start.offset;
    const end = image.position?.end.offset;
    if (!resolved || start == null || end == null) continue;
    // Inline only this image reference: a shared definition may also belong to
    // an ordinary link, whose destination must remain unchanged.
    edits.push({
      start,
      end,
      text: portableImageMarkdown(image, destination, resolved),
    });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
  return body;
}
