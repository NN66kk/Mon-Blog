// Shared by the writing room and the generated blog (hooks/mermaid_assets.py).
export const MERMAID_VERSION = '12.1.0';
export const MERMAID_URL = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.esm.min.mjs`;

export function diagramConfig(dark = false) {
  const colors = dark
    ? {
        paper: '#1e221c',
        node: '#2c392c',
        ink: '#edf0e7',
        border: '#82977a',
        line: '#b2c6a9',
        secondary: '#353328',
      }
    : {
        paper: '#faf8f2',
        node: '#e8eee3',
        ink: '#253c2c',
        border: '#84997b',
        line: '#526c49',
        secondary: '#f1e8d5',
      };
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    look: 'classic',
    // Keep author-supplied directives from replacing the site theme or safety settings.
    secure: [
      'secure',
      'securityLevel',
      'startOnLoad',
      'maxTextSize',
      'maxEdges',
      'suppressErrorRendering',
      'theme',
      'themeVariables',
      'themeCSS',
      'fontFamily',
      'htmlLabels',
    ],
    fontFamily: '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif',
    htmlLabels: false,
    themeVariables: {
      darkMode: dark,
      background: colors.paper,
      fontSize: '16px',
      primaryColor: colors.node,
      primaryTextColor: colors.ink,
      primaryBorderColor: colors.border,
      secondaryColor: colors.secondary,
      secondaryTextColor: colors.ink,
      secondaryBorderColor: colors.border,
      tertiaryColor: colors.paper,
      tertiaryTextColor: colors.ink,
      tertiaryBorderColor: colors.border,
      lineColor: colors.line,
      textColor: colors.ink,
      nodeTextColor: colors.ink,
      edgeLabelBackground: colors.paper,
      clusterBkg: colors.paper,
      clusterBorder: colors.border,
    },
    themeCSS: '.node rect { rx: 10px; ry: 10px; }',
    flowchart: {
      htmlLabels: false,
      useMaxWidth: false,
      padding: 18,
      diagramPadding: 18,
      nodeSpacing: 36,
      rankSpacing: 32,
      wrappingWidth: 320,
      curve: 'basis',
    },
    sequence: { useMaxWidth: false },
  };
}
