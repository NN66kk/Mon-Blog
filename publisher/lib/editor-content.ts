import { isMap, parseDocument } from 'yaml';
import { REPO } from './content';

function metadataDocument(source: string) {
  const document = parseDocument(source.trim() ? source : '{}');
  if (document.errors.length || !isMap(document.contents)) {
    throw new Error('文章信息必须是 YAML 对象，请使用“字段: 内容”的格式。');
  }
  // Catch invalid or excessive aliases before the document reaches form controls.
  try { document.toJSON(); } catch {
    throw new Error('文章信息中的 YAML 引用无效，请先修正。');
  }
  return document;
}

export function updateMetadata(source: string, field: string, value: string) {
  const document = metadataDocument(source);
  document.set(field, value);
  return document.toString();
}

function fieldText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

export function editorMetadata(source: string) {
  try {
    const data = metadataDocument(source).toJSON();
    return {
      tags: Array.isArray(data.tags) ? data.tags.map(fieldText).filter(Boolean).join('，') : fieldText(data.tags),
      description: fieldText(data.description),
    };
  } catch { return { tags: '', description: '' }; }
}

export function exportMarkdown(draft: { title: string; metadata: string; body: string }) {
  let front = draft.metadata;
  try {
    const document = metadataDocument(front);
    document.set('title', draft.title || '未命名文章');
    front = document.toString();
  } catch { /* Export must retain even invalid YAML so the user can recover their work. */ }
  return `---\n${front}\n---\n${draft.body}`;
}

export function previewImageUrl(source: string, path: string): string | null {
  if (!source.trim()) return null;
  if (/^\/api\/media\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(source)) return source;
  try {
    const base = `https://raw.githubusercontent.com/${REPO}/main/${path.split('/').slice(0, -1).join('/')}/`;
    const url = new URL(source, base);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
