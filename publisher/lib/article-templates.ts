import { parseDocument, isMap } from 'yaml';
import { COLLECTIONS, COLLECTION_TAGS, CONTENT_RULES, splitMarkdown } from './content';
import sources from './blog-templates.json';

export const TEMPLATE_FOLDER = CONTENT_RULES.template_folder;
export { COLLECTION_TAGS } from './content';
const offset = CONTENT_RULES.timezone_offset_minutes;
const timezoneSuffix = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;

export function chinaDate(now = new Date()) {
  return (
    new Date(now.getTime() + offset * 60000).toISOString().slice(0, 19) + timezoneSuffix
  );
}
export function articleNumber(now = new Date()) {
  return chinaDate(now).slice(2, 19).replace(/\D/g, '');
}
export function standardArticle(collection = COLLECTIONS[0].id, now = new Date()) {
  const document = parseDocument(
    'title: ""\ndate: ""\ntags: ""\ndescription: ""\n',
  );
  document.set('date', chinaDate(now));
  document.set('tags', COLLECTION_TAGS[collection] || '');
  return { title: '', metadata: document.toString(), body: '# \n\n' };
}

export type ArticleTemplate = {
  name: string;
  path: string;
  source: string;
  kind: 'article' | 'snippet' | 'unsupported';
};
const normalized = (value: string) => value.replace(/\r\n/g, '\n').trim();
const standardSource = normalized(sources.yaml);
export function describeTemplate(
  path: string,
  source: string,
): ArticleTemplate {
  const known = normalized(source) === standardSource;
  const kind = known
    ? 'article'
    : source.includes('<%')
      ? 'unsupported'
      : /^\uFEFF?---\r?\n/.test(source)
        ? 'article'
        : 'snippet';
  return {
    path,
    source,
    name: path.split('/').pop()!.replace(/\.md$/, ''),
    kind,
  };
}
export const BUILTIN_TEMPLATES = Object.entries(sources).map(([name, source]) =>
  describeTemplate(`${TEMPLATE_FOLDER}/${name}.md`, source),
);

export function materializeTemplate(
  template: ArticleTemplate,
  collection: string,
  now = new Date(),
) {
  if (normalized(template.source) === standardSource)
    return standardArticle(collection, now);
  // Templates are content. Never evaluate JavaScript from a repository or Templater.
  if (template.source.includes('<%'))
    throw new Error(
      '这个模板包含尚不支持的 Obsidian 脚本，请先转换为普通 Markdown。',
    );
  const parsed = splitMarkdown(template.source);
  const document = parseDocument(parsed.metadata || '{}');
  if (!isMap(document.contents))
    throw new Error('模板的 YAML 必须是字段与内容的对应表。');
  return {
    title: typeof parsed.data.title === 'string' ? parsed.data.title : '',
    metadata: parsed.metadata,
    body: parsed.body,
  };
}

export function syncHeading(
  body: string,
  previousTitle: string,
  nextTitle: string,
) {
  return body.replace(
    /^(\s*# )([^\r\n]*)(\r?\n|$)/,
    (whole, prefix, title, end) =>
      title.trim() === previousTitle.trim()
        ? `${prefix}${nextTitle}${end}`
        : whole,
  );
}

export function dateForInput(value: string) {
  if (!value) return '';
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    ? value
    : value.replace(' ', 'T') +
      (value.length === 10 ? 'T00:00:00' : '') +
      timezoneSuffix;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? '' : chinaDate(date).slice(0, 19);
}
