import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { MarkdownCodeBlock } from '../components/markdown-code-block';
import { createRenderQueue } from '../public/diagrams/mermaid-renderer.mjs';
import {
  diagramConfig,
  MERMAID_VERSION,
} from '../public/diagrams/mermaid-theme.mjs';
import packageJson from '../package.json';

void test('Mermaid fences use the diagram component while ordinary and inline code survive', () => {
  const html = renderToStaticMarkup(
    <ReactMarkdown components={{ pre: MarkdownCodeBlock }}>
      {
        '```mermaid\nflowchart TD\nA[任务] --> B[通知]\n```\n\n```js\nconst value = 1;\n```\n\n`mermaid`'
      }
    </ReactMarkdown>,
  );
  assert.match(html, /class="garden-diagram"/);
  assert.doesNotMatch(html, /language-mermaid/);
  assert.match(html, /<pre><code class="language-js">const value = 1;/);
  assert.match(html, /<p><code>mermaid<\/code><\/p>/);
});

void test('concurrent diagrams retain their own theme and recover after invalid syntax', async () => {
  let active = false;
  let dark = false;
  const observed: boolean[] = [];
  const render = createRenderQueue(async () => ({
    initialize(config: ReturnType<typeof diagramConfig>) {
      assert.equal(
        active,
        false,
        'initialization must not interrupt another render',
      );
      dark = config.themeVariables.darkMode;
    },
    async render(_id: string, source: string) {
      active = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      observed.push(dark);
      active = false;
      if (source === 'invalid') throw new Error('Parse error');
      return { svg: '<svg />' };
    },
  }));
  const results = await Promise.allSettled([
    render('light', 'valid', false, undefined),
    render('broken', 'invalid', true, undefined),
    render('next', 'valid', false, undefined),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected', 'fulfilled'],
  );
  assert.deepEqual(observed, [false, true, false]);
});

function luminance(hex: string) {
  const channels = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

void test('both palettes keep labels and arrows readable on their actual backgrounds', () => {
  for (const dark of [false, true]) {
    const { themeVariables: theme, securityLevel } = diagramConfig(dark);
    assert.ok(contrast(theme.primaryTextColor, theme.primaryColor) >= 7);
    assert.ok(contrast(theme.lineColor, theme.background) >= 3);
    assert.equal(securityLevel, 'strict');
  }
  assert.equal(packageJson.dependencies.mermaid, MERMAID_VERSION);
});
