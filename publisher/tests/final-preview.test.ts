import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile(
  'writer.tsx',
  readFileSync(new URL('../app/writer.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let handler = '';
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'exportFinalPreview')
    handler = node.getText(source);
  else ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);

function createHandler(bindings: Record<string, unknown>) {
  const javascript = ts.transpileModule(`${handler}\nreturn exportFinalPreview;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const values = {
    opening: false, switching: false, uploading: false, publishing: false,
    previewExporting: false, metadataProblem: () => '',
    setPreviewExporting() {}, setPreviewFilename() {}, setPreviewMessage() {},
    fetch: () => { throw new Error('No live API requests'); },
    ...bindings,
  };
  return new Function(...Object.keys(values), javascript)(...Object.values(values)) as () => Promise<void>;
}

test('final preview exports a fixed snapshot of unsaved editor content without saving or publishing', async () => {
  const latest = { current: { id: 'draft-A', title: 'unsaved', metadata: '', body: 'current editor body' } };
  const captured: unknown[] = [];
  const downloads: unknown[] = [];
  let finish!: (blob: Blob) => void;
  const pending = new Promise<Blob>((resolve) => { finish = resolve; });
  const run = createHandler({
    latest,
    draftBackup: async (drafts: unknown[]) => { captured.push(...drafts); return pending; },
    download: (...args: unknown[]) => downloads.push(args),
  });
  const exporting = run();
  latest.current = { ...latest.current, id: 'draft-B', body: 'later edits' };
  const blob = new Blob(['snapshot']);
  finish(blob);
  await exporting;
  assert.deepEqual(captured, [{ id: 'draft-A', title: 'unsaved', metadata: '', body: 'current editor body' }]);
  assert.deepEqual(downloads, [[blob, 'mon-preview-draft-A.zip']]);
});

test('invalid metadata or an image export failure never downloads a misleading final preview package', async () => {
  const state = { message: '', busy: false, downloads: 0, backups: 0 };
  const common = {
    latest: { current: { id: 'draft-A', metadata: 'broken' } },
    setPreviewMessage(value: string) { state.message = value; },
    setPreviewExporting(value: boolean) { state.busy = value; },
    download() { state.downloads++; },
    draftBackup() { state.backups++; throw new Error('图片不可用'); },
  };
  await createHandler({ ...common, metadataProblem: () => 'YAML 无效' })();
  assert.equal(state.message, 'YAML 无效');
  assert.equal(state.backups, 0);
  await createHandler(common)();
  assert.equal(state.message, '图片不可用');
  assert.equal(state.busy, false);
  assert.equal(state.downloads, 0);
});
