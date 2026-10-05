'use client';

import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react';
import type { ExtraProps } from 'react-markdown';
import {
  createRenderQueue,
  mountDiagram,
} from '../public/diagrams/mermaid-renderer.mjs';

const render = createRenderQueue(async () => (await import('mermaid')).default);

function MermaidDiagram({ source }: { source: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (container.current)
      return mountDiagram(container.current, source, render);
  }, [source]);
  return <div ref={container} className="garden-diagram" />;
}

export function MarkdownCodeBlock({
  node,
  children,
  ...props
}: ComponentPropsWithoutRef<'pre'> & ExtraProps) {
  const code = node?.children.length === 1 ? node.children[0] : undefined;
  if (
    code?.type === 'element' &&
    code.tagName === 'code' &&
    Array.isArray(code.properties.className) &&
    code.properties.className.includes('language-mermaid')
  ) {
    const source = code.children
      .map((child) => (child.type === 'text' ? child.value : ''))
      .join('');
    return <MermaidDiagram source={source} />;
  }
  return <pre {...props}>{children}</pre>;
}
