import { parseDocument } from 'yaml';

export const COLLECTIONS = [
  { id: 'D-Orginals', name: '原创手记', mark: '思' },
  { id: 'B-Notes', name: '格物札记', mark: '技' },
  { id: 'A-Life', name: '行旅札记', mark: '行' },
  { id: 'C-Highlights', name: '人间拾遗', mark: '拾' },
] as const;
export const BLOG = 'https://nn66kk.github.io/Mon-Blog/';
export const REPO = 'NN66kk/Mon-Blog';
export function validCollection(value: string) { return COLLECTIONS.some(c => c.id === value); }
export function validPath(path: string) {
  return /^docs\/(A-Life|B-Notes|C-Highlights|D-Orginals)\/.+\.md$/.test(path)
    && !['docs/B-Notes/003英语/总结.md', 'docs/D-Orginals/苹果电脑自动化脚本教程_2025070215169.md'].includes(path)
    && !path.split('/').some(p => p === '..' || p === '.' || p.startsWith('.') || p.startsWith('000000'))
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
  if (typeof doc.get('tags') === 'string' && /[,，]/.test(String(doc.get('tags')))) doc.set('tags', String(doc.get('tags')).split(/[,，]/).map(t => t.trim()).filter(Boolean));
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
