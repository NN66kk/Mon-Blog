import { MERMAID_URL } from '../assets/diagrams/mermaid-theme.mjs';
import { createRenderQueue, mountDiagram } from '../assets/diagrams/mermaid-renderer.mjs';

const render = createRenderQueue(async () => (await import(MERMAID_URL)).default);
const mounted = new Map();

function renderDiagrams() {
  for (const [host, dispose] of mounted) {
    if (!host.isConnected) {
      dispose();
      mounted.delete(host);
    }
  }
  // Use a distinct fence class so Material's own Mermaid renderer never races ours.
  for (const code of document.querySelectorAll('pre.garden-mermaid > code')) {
    const host = document.createElement('div');
    const source = code.textContent;
    code.parentElement.replaceWith(host);
    mounted.set(host, mountDiagram(host, source, render));
  }
}

renderDiagrams();
if (typeof document$ !== 'undefined') document$.subscribe(renderDiagrams);
