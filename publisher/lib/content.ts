import { parseDocument } from 'yaml';
import contract from './blog-contract.json';

const definitions: Record<string, (typeof contract.extra.collections)[keyof typeof contract.extra.collections]> = contract.extra.collections;
export const COLLECTIONS = contract.extra.collection_order.map(key => ({
  id: definitions[key].source_dir, name: definitions[key].label, mark: definitions[key].mark,
}));
export const COLLECTION_IDS = COLLECTIONS.map(collection => collection.id);
export const COLLECTION_TAGS: Record<string, string> = Object.fromEntries(
  Object.values(definitions).map(collection => [collection.source_dir, collection.legacy_tag]),
);
export const CONTENT_RULES = contract.extra.content_rules;
export const BLOG = contract.site_url;
export const REPO = contract.repo_name;
const EXCLUDED_PATHS = contract.exclude_docs.trim().split(/\r?\n/);
export function validCollection(value: string) { return COLLECTIONS.some(c => c.id === value); }
export function validPath(path: string) {
  if (typeof path !== 'string') return false;
  const parts = path.split('/');
  const relative = path.slice(5);
  return parts.length >= 3 && parts[0] === 'docs' && validCollection(parts[1]) && path.endsWith('.md')
    && !EXCLUDED_PATHS.some(excluded => excluded.includes('/')
      ? relative === excluded || relative.startsWith(excluded + '/')
      : relative.split('/').includes(excluded))
    && !parts.some(p => !p || p.startsWith('.') || p.startsWith('000000'))
    && !/[\\\u0000-\u001f?#]/.test(path);
}
export function splitMarkdown(source: string) {
  const match = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const metadata = match?.[1] ?? '';
  const document = parseDocument(metadata || '{}');
  if (document.errors.length) throw new Error('文章信息中的 YAML 格式有误，请先修正。');
  const data = document.toJSON() || {};
  return { metadata, body: (match ? source.slice(match[0].length) : source).replace(/\n?<!-- publisher-release:[a-z0-9-]+ -->\n?/g, ''), data };
}
export function composeMarkdown(draft: { title: string; metadata: string; body: string; source_path?: string | null; first_published_at?: string | null }, release: string, now = new Date().toISOString()) {
  const doc = parseDocument(draft.metadata || '{}');
  if (doc.errors.length || !doc.toJSON() || Array.isArray(doc.toJSON()) || typeof doc.toJSON() !== 'object') throw new Error('文章信息必须是有效的 YAML 对象。');
  doc.set('title', draft.title.trim());
  if (!doc.get('published_at') && !doc.get('cdate') && !doc.get('date') && (!draft.source_path || draft.first_published_at)) doc.set('published_at', draft.first_published_at || now);
  // The editor separates tags with commas; spaces may belong to a single tag.
  if (typeof doc.get('tags') === 'string') doc.set('tags', String(doc.get('tags')).split(/[,，]/).map(t => t.trim()).filter(Boolean));
  doc.set('updated_at', now);
  doc.set('status', 'published');
  if (doc.has('draft')) doc.set('draft', false);
  const body = draft.body.replace(/\n?<!-- publisher-release:[a-z0-9-]+ -->\n?/g, '');
  return `---\n${doc.toString()}---\n${body}\n\n<!-- publisher-release:${release} -->\n`;
}
export function articleUrl(path: string) {
  if (!validPath(path)) throw new Error('文章路径无效。');
  return BLOG + path.slice(5, -3).split('/').map(encodeURIComponent).join('/') + '/';
}
export function relativeAsset(path: string, asset: string) {
  return '../'.repeat(path.split('/').length - 2) + asset.replace(/^docs\//, '');
}
export function newArticlePath(collection: string, filename: string) {
  if (!validCollection(collection) || !/^\d{12}\.md$/.test(filename)) throw new Error('栏目或文章编号无效。');
  return `docs/${collection}/${filename}`;
}
