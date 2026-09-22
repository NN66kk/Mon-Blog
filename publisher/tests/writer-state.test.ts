import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createDraftTransition } from '../lib/draft-transition';

// Exercise the component's own async handlers with controlled network timing.
// No browser, live API, or duplicate implementation of the handlers is needed.
function componentSource(file: string) {
  return ts.createSourceFile(
    file,
    readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
const writer = componentSource('writer.tsx');
const manager = componentSource('manager.tsx');

function findNode(
  source: ts.SourceFile,
  predicate: (node: ts.Node) => boolean,
) {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, 'production handler must exist');
  return found.getText(source);
}

function compile(source: string, bindings: Record<string, unknown>) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), javascript)(
    ...Object.values(bindings),
  );
}

function writerHandlers(bindings: Record<string, unknown>) {
  const names = ['openVersions', 'moveToDraft', 'restoreHistory'];
  const functions = names.map((name) =>
    findNode(
      writer,
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
    ),
  );
  return compile(`${functions.join('\n')}\nreturn { ${names.join(',')} };`, {
    transition: createDraftTransition(),
    publishing: false,
    uploading: false,
    user: {},
    dirtyRef: { current: false },
    pending: { current: null },
    setSwitching() {},
    setDraft() {},
    setDirty() {},
    setLibrary() {},
    window: { history: { replaceState() {} } },
    ...bindings,
  }) as {
    openVersions(): Promise<void>;
    moveToDraft(
      loadNext: () => Promise<{ id: string; revision: number }>,
    ): Promise<boolean>;
    restoreHistory(): Promise<void>;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function historyFixture(api: (...args: unknown[]) => Promise<unknown>) {
  const latest = { current: { id: 'A', revision: 3 } };
  const state = { open: false, error: '', history: null as unknown };
  const bindings = {
    latest,
    historyRequest: { current: 0 },
    versionHistory: { draftId: 'A', versions: [{ revision: 1 }] },
    restoreVersion: 1,
    setPanelBusy() {},
    setError(value: string) {
      state.error = value;
    },
    save: async () => ({ ...latest.current }),
    api,
    setVersionHistory(value: unknown) {
      state.history = value;
    },
    setRestoreVersion() {},
    setVersionsOpen(value: boolean) {
      state.open = value;
    },
    setNotice() {},
    reload: async () => {},
  };
  return { latest, state, bindings, handlers: writerHandlers(bindings) };
}

test('history responses are discarded after switching, including switching back to the original draft', async () => {
  for (const switchBack of [false, true]) {
    const response = deferred<{ versions: { revision: number }[] }>();
    const fixture = historyFixture(async () => response.promise);
    const opening = fixture.handlers.openVersions();
    await Promise.resolve();
    await fixture.handlers.moveToDraft(async () => ({ id: 'B', revision: 4 }));
    if (switchBack)
      await fixture.handlers.moveToDraft(async () => ({
        id: 'A',
        revision: 3,
      }));
    response.resolve({ versions: [{ revision: 1 }] });
    await opening;
    assert.equal(fixture.state.open, false);
    assert.equal(fixture.state.history, null);
  }
});

test('history stays bound to its draft and stale restore actions never reach the API', async () => {
  const requests: unknown[][] = [];
  const fixture = historyFixture(async (...args) => {
    requests.push(args);
    return { versions: [{ revision: 1 }] };
  });
  await fixture.handlers.openVersions();
  assert.equal(fixture.state.open, true);
  assert.deepEqual(fixture.state.history, {
    draftId: 'A',
    versions: [{ revision: 1 }],
  });
  await fixture.handlers.moveToDraft(async () => ({ id: 'B', revision: 4 }));
  await fixture.handlers.restoreHistory();
  assert.deepEqual(requests, [['drafts/A/history']]);
  assert.equal(fixture.state.open, false);
});

test('history restoration saves current edits before restoring the captured draft with its latest revision', async () => {
  const requests: unknown[][] = [];
  const fixture = historyFixture(async (...args) => {
    requests.push(args);
    return { id: 'A', revision: 5 };
  });
  const save = deferred<{ id: string; revision: number }>();
  const handlers = writerHandlers({
    ...fixture.bindings,
    dirtyRef: { current: true },
    save: async () => {
      const result = await save.promise;
      fixture.latest.current = result;
      return result;
    },
  });
  const restoring = handlers.restoreHistory();
  await Promise.resolve();
  assert.deepEqual(requests, []);
  assert.equal(
    await handlers.moveToDraft(async () => ({ id: 'B', revision: 4 })),
    false,
  );
  save.resolve({ id: 'A', revision: 4 });
  await restoring;
  assert.deepEqual(requests, [
    ['restore-version', 'POST', { id: 'A', version: 1, revision: 4 }],
  ]);
  assert.deepEqual(fixture.latest.current, { id: 'A', revision: 5 });
});

test('errors from an obsolete history request do not overwrite the current draft status', async () => {
  const response = deferred<never>();
  const fixture = historyFixture(async () => response.promise);
  const opening = fixture.handlers.openVersions();
  await Promise.resolve();
  await fixture.handlers.moveToDraft(async () => ({ id: 'B', revision: 4 }));
  response.reject(new Error('obsolete request failed'));
  await opening;
  assert.equal(fixture.state.error, '');
});

test('manager rotates publication checks across effect restarts while earlier jobs remain pending', async () => {
  const effect = findNode(
    manager,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(manager) === 'useEffect' &&
      node.getText(manager).includes('needsPublicationCheck(job.state)'),
  );
  let jobs = Array.from({ length: 6 }, (_, index) => ({
    id: String(index + 1),
    state: 'cancelled',
  }));
  const pollOffset = { current: 0 };
  const pollLock = { current: false };
  const batches: string[][] = [];
  for (let render = 0; render < 3; render++) {
    let tick!: () => Promise<void>;
    const requests: string[] = [];
    compile(`${effect};`, {
      useEffect: (callback: () => void) => callback(),
      user: {},
      jobs,
      pollOffset,
      pollLock,
      mounted: { current: true },
      needsPublicationCheck: (state: string) =>
        !['live', 'failed', 'superseded'].includes(state),
      api: async (path: string) => {
        const id = path.split('/').pop()!;
        requests.push(id);
        return jobs.find((job) => job.id === id);
      },
      setJobs: (update: (previous: typeof jobs) => typeof jobs) => {
        jobs = update(jobs);
      },
      setInterval: (callback: () => Promise<void>) => {
        tick = callback;
        return 1;
      },
      clearInterval() {},
    });
    await tick();
    batches.push(requests);
  }
  assert.deepEqual(batches, [
    ['1', '2', '3', '4'],
    ['5', '6', '1', '2'],
    ['3', '4', '5', '6'],
  ]);
});
