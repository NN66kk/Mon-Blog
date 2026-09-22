import assert from 'node:assert/strict';
import test from 'node:test';
import type { Image, Nodes } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { composeMarkdown, splitMarkdown } from '../lib/content';
import { metadataForArticle, portableImages } from '../lib/management';

const articlePath = 'docs/D-Orginals/article.md';
const assetRoot =
  'https://raw.githubusercontent.com/NN66kk/Mon-Blog/main/docs/assets/';

function parsedImages(source: string) {
  const images: Image[] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'image') images.push(node);
    if ('children' in node) node.children.forEach(visit);
  };
  visit(unified().use(remarkParse).parse(source));
  return images;
}

void test('publishing preserves spaces in one tag and agrees with article management', () => {
  for (const [metadata, expected] of [
    ['tags: Claude Code\n', ['Claude Code']],
    ['tags: " Claude Code， AI "\n', ['Claude Code', 'AI']],
    ['tags: [Claude Code, AI]\n', ['Claude Code', 'AI']],
    ['tags: ""\n', []],
  ] as const) {
    const markdown = composeMarkdown(
      { title: 'Article', metadata, body: 'Content' },
      'tag-regression',
      '2026-09-22T00:00:00Z',
    );
    assert.deepEqual(splitMarkdown(markdown).data.tags, expected);
    assert.deepEqual(metadataForArticle(articlePath, markdown).tags, expected);
  }
});

void test('portable images leave code samples, escapes, HTML and CRLF untouched', () => {
  const examples = [
    '```markdown',
    '![fenced](../assets/fenced.png)',
    '```',
    '',
    '~~~markdown',
    '![tilde](../assets/tilde.png)',
    '~~~',
    '',
    '    ![indented](../assets/indented.png)',
    '',
    '`![inline](../assets/inline.png)`',
    '\\![escaped](../assets/escaped.png)',
    '',
    '<!-- ![comment](../assets/comment.png) -->',
    '',
    '<pre>',
    '![html](../assets/html.png)',
    '</pre>',
    '',
  ].join('\r\n');
  const original = `${examples}![real](../assets/real.png "说明")\r\n`;
  assert.equal(
    portableImages(original, articlePath),
    `${examples}![real](${assetRoot}real.png "说明")\r\n`,
  );
});

void test('portable image destinations preserve angle paths, balanced parentheses, alt text and titles', () => {
  const source = [
    '![photo](<../assets/old photo.png> "说明")',
    "![nested [label]](../assets/photo(1).png 'parentheses')",
    '![escaped \\[label\\] &amp;copy;](../assets/photo\\(2\\).png "A \\"quote\\" &amp;copy;")',
    '![query](../assets/query.png?literal=&amp;copy; "line',
    'break")',
  ].join('\n');
  const before = parsedImages(source);
  const after = parsedImages(portableImages(source, articlePath));
  assert.equal(before.length, 4);
  assert.equal(after.length, before.length);
  after.forEach((image, index) => {
    assert.equal(image.alt, before[index].alt);
    assert.equal(image.title, before[index].title);
    assert.equal(
      image.url,
      new URL(
        before[index].url,
        'https://raw.githubusercontent.com/NN66kk/Mon-Blog/main/docs/D-Orginals/',
      ).href.replace(/[()]/g, (character) =>
        character === '(' ? '%28' : '%29',
      ),
    );
  });
});

void test('portable reference images keep shared link definitions and resolve all reference forms', () => {
  const source = [
    '[ordinary link][Shared]',
    '![first][shared]',
    '![Shared][]',
    '![Shared]',
    '',
    '[Shared]: <../assets/shared photo.png> "shared title"',
    '[unused]: ../assets/unused.png',
    '',
  ].join('\r\n');
  const result = portableImages(source, articlePath);
  assert.match(result, /^\[ordinary link\]\[Shared\]\r\n/);
  assert.ok(
    result.endsWith(
      '[Shared]: <../assets/shared photo.png> "shared title"\r\n[unused]: ../assets/unused.png\r\n',
    ),
  );
  const images = parsedImages(result);
  assert.deepEqual(
    images.map((image) => image.alt),
    ['first', 'Shared', 'Shared'],
  );
  for (const image of images) {
    assert.equal(image.url, `${assetRoot}shared%20photo.png`);
    assert.equal(image.title, 'shared title');
  }
});

void test('portable images keep external, private, fragment and unsupported URLs unchanged', () => {
  const source = [
    '![remote](https://example.com/photo.png)',
    '![private](/api/media/12345678-1234-1234-1234-123456789abc.png)',
    '![fragment](#image)',
    '![unsupported](data:image/png;base64,AAAA)',
    '![reference][remote]',
    '',
    '[remote]: https://example.com/remote.png',
  ].join('\n');
  assert.equal(portableImages(source, articlePath), source);
  assert.equal(
    portableImages('![relative](image.png)'),
    '![relative](image.png)',
  );
});
