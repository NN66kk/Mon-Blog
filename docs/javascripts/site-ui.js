const CODE_LANGUAGE_LABELS = {
  ansi: "ANSI",
  bash: "BASH",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  dataview: "DATAVIEW",
  diff: "DIFF",
  gitignore: "GITIGNORE",
  html: "HTML",
  ini: "INI",
  java: "JAVA",
  javascript: "JS",
  js: "JS",
  json: "JSON",
  jsx: "JSX",
  markdown: "MD",
  md: "MD",
  powershell: "POWERSHELL",
  py: "PYTHON",
  python: "PYTHON",
  sh: "SHELL",
  shell: "SHELL",
  sql: "SQL",
  text: "TXT",
  toml: "TOML",
  ts: "TS",
  tsx: "TSX",
  typescript: "TS",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
};

function getCodeLanguage(frame) {
  const code = frame.querySelector("code");
  const classes = [
    ...Array.from(frame.classList),
    ...(code ? Array.from(code.classList) : []),
  ];
  const languageClass = classes.find((name) => name.startsWith("language-"));

  return languageClass ? languageClass.slice("language-".length) : "text";
}

function enhanceCodeBlocks(root = document) {
  root.querySelectorAll(".md-typeset .highlight").forEach((frame) => {
    const language = getCodeLanguage(frame).toLowerCase();
    const label = CODE_LANGUAGE_LABELS[language]
      || language.replace(/[^a-z0-9+#.-]/gi, "").toUpperCase()
      || "CODE";
    const pre = frame.querySelector("pre");
    const shell = frame.closest(".highlighttable") || frame;

    frame.dataset.codeEnhanced = "true";
    frame.dataset.codeLanguage = language;
    frame.dataset.codeLabel = label;
    shell.dataset.codeEnhanced = "true";
    shell.dataset.codeLanguage = language;
    shell.dataset.codeLabel = label;

    if (pre) {
      pre.setAttribute("aria-label", `${label} 代码`);

      window.requestAnimationFrame(() => {
        if (pre.scrollWidth > pre.clientWidth + 1) {
          pre.tabIndex = 0;
          frame.dataset.codeScrollable = "true";
          shell.dataset.codeScrollable = "true";
        } else {
          pre.removeAttribute("tabindex");
          delete frame.dataset.codeScrollable;
          delete shell.dataset.codeScrollable;
        }
      });
    }
  });
}

function updatePostStats(root = document) {
  const body = root.querySelector("[data-post-body]");
  const stats = root.querySelector("[data-reading-stats]");

  if (!body || !stats || stats.dataset.readingStatsReady === "true") {
    return;
  }

  const text = body.textContent.replace(/\s+/g, " ").trim();
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCount = (
    text.replace(/[\u3400-\u9fff]/g, " ").match(/[a-z0-9][a-z0-9_+#.-]*/gi)
    || []
  ).length;
  const total = cjkCount + latinCount;
  const minutes = Math.max(1, Math.ceil(total / 500));
  const countTarget = stats.querySelector("[data-reading-count]");
  const minutesTarget = stats.querySelector("[data-reading-minutes]");

  if (countTarget) {
    countTarget.textContent = `${total.toLocaleString("zh-CN")} 字`;
  }

  if (minutesTarget) {
    minutesTarget.textContent = `${minutes} 分钟`;
  }

  stats.dataset.readingStatsReady = "true";
}

function updateReadingProgress(root = document) {
  const progress = root.querySelector("[data-reading-progress]");
  const article = root.querySelector(".md-content__inner");

  if (!progress || !article) {
    return;
  }

  const articleTop = article.getBoundingClientRect().top + window.scrollY;
  const available = Math.max(1, article.offsetHeight - window.innerHeight);
  const value = Math.min(1, Math.max(0, (window.scrollY - articleTop) / available));

  progress.style.setProperty("--reading-progress", String(value));
  progress.setAttribute("aria-valuenow", String(Math.round(value * 100)));
}

function updateHeaderState(root = document) {
  const header = root.querySelector(".site-header");

  if (header) {
    header.toggleAttribute("data-scrolled", window.scrollY > 12);
  }
}

function updateSiteUi(root = document) {
  enhanceCodeBlocks(root);
  updatePostStats(root);
  updateReadingProgress(root);
  updateHeaderState(root);
}

function bindSiteUi() {
  updateSiteUi();

  if (document.documentElement.dataset.siteUiBound === "true") {
    return;
  }

  document.documentElement.dataset.siteUiBound = "true";
  let scheduled = false;

  const scheduleUpdate = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      updateReadingProgress();
      updateHeaderState();
    });
  };

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
}

if (typeof document !== "undefined") {
  bindSiteUi();

  if (typeof document$ !== "undefined" && typeof document$.subscribe === "function") {
    document$.subscribe(() => {
      bindSiteUi();
    });
  }
}
