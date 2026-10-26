import { diagramConfig } from './mermaid-theme.mjs';

// Mermaid has global configuration: initialize + render must be one queued job.
export function createRenderQueue(loadMermaid) {
  let pending = Promise.resolve();
  return (id, source, dark, container) => {
    const result = pending.then(async () => {
      const mermaid = await loadMermaid();
      mermaid.initialize(diagramConfig(dark));
      return mermaid.render(id, source, container);
    });
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  };
}

export function diagramIsDark() {
  return (
    document.body.getAttribute('data-md-color-scheme') === 'slate' ||
    document.documentElement.classList.contains('dark')
  );
}

export function mountDiagram(host, source, render) {
  let disposed = false;
  let revision = 0;
  let dark = diagramIsDark();
  host.classList.add('garden-diagram');

  async function update() {
    const current = ++revision;
    const status = document.createElement('p');
    status.className = 'diagram-status';
    status.textContent = '正在绘制图表…';
    status.setAttribute('role', 'status');
    // Keep the previous SVG's height during a theme change to avoid moving the
    // reader's scroll position while the next SVG is being measured.
    if (!host.querySelector('.diagram-viewport')) host.replaceChildren(status);
    host.dataset.diagramState = 'loading';
    host.setAttribute('aria-busy', 'true');
    const stage = document.createElement('div');
    stage.className = 'diagram-stage';
    stage.setAttribute('aria-hidden', 'true');
    document.body.append(stage);
    try {
      // Measure Chinese labels with the actual reading font, not a fallback.
      await document.fonts?.load('16px "LXGW WenKai"', source).catch(() => {});
      if (disposed || current !== revision) return;
      const { svg } = await render(
        `garden-diagram-${crypto.randomUUID()}`,
        source,
        dark,
        stage,
      );
      if (disposed || current !== revision) return;
      const viewport = document.createElement('div');
      viewport.className = 'diagram-viewport';
      viewport.tabIndex = 0;
      viewport.setAttribute('role', 'region');
      viewport.setAttribute('aria-label', 'Mermaid 图表，宽图可左右滚动');
      // Only Mermaid's strict-mode, sanitized SVG is inserted. Source is never HTML.
      viewport.innerHTML = svg;
      host.replaceChildren(viewport);
      host.dataset.diagramState = 'ready';
    } catch {
      if (disposed || current !== revision) return;
      status.textContent = '图表暂时无法显示，请检查 Mermaid 语法或重试。';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'diagram-retry';
      retry.textContent = '重新渲染';
      retry.addEventListener('click', () => void update());
      const details = document.createElement('details');
      details.className = 'diagram-source';
      const summary = document.createElement('summary');
      summary.textContent = '查看图表源码';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = source;
      pre.append(code);
      details.append(summary, pre);
      host.replaceChildren(status, retry, details);
      host.dataset.diagramState = 'error';
    } finally {
      stage.remove();
      if (!disposed && current === revision) host.removeAttribute('aria-busy');
    }
  }

  const observer = new MutationObserver(() => {
    const next = diagramIsDark();
    if (dark === next) return;
    dark = next;
    void update();
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-md-color-scheme'],
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  void update();
  return () => {
    disposed = true;
    revision++;
    observer.disconnect();
  };
}
