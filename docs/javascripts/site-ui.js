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
  const article = root.querySelector(".post-page");

  if (!progress || !article) {
    return;
  }

  const articleTop = article.getBoundingClientRect().top + window.scrollY;
  const available = Math.max(1, article.offsetHeight - window.innerHeight);
  const value = Math.min(1, Math.max(0, (window.scrollY - articleTop) / available));

  progress.style.setProperty("--reading-progress", String(value));
}

function updateHeaderState(root = document) {
  const header = root.querySelector(".site-header");

  if (header) {
    header.toggleAttribute("data-scrolled", window.scrollY > 12);
  }
}

const PAGE_LAYOUT_CLASSES = [
  "layout-home",
  "layout-archive",
  "layout-collection",
  "layout-article",
  "layout-about",
  "layout-redirect",
  "layout-page",
];

function syncPageLayout(root = document) {
  const marker = root.querySelector(".md-content [data-page-layout]");
  const content = root.querySelector(".md-content[data-page-type]");
  const layout = marker?.dataset.pageLayout || content?.dataset.pageType || "page";
  const collection = content?.dataset.pageCollection || "";

  document.body.classList.remove(...PAGE_LAYOUT_CLASSES);
  document.body.classList.add(`layout-${layout}`);
  document.documentElement.dataset.pageLayout = layout;

  root.querySelectorAll("[data-site-nav], [data-site-nav-collection]").forEach((link) => {
    const target = link.dataset.siteNav;
    const targetCollection = link.dataset.siteNavCollection;
    const active = Boolean(
      (target === "home" && layout === "home")
      || (target === "articles" && ["archive", "article", "collection"].includes(layout))
      || (target === "archive" && ["archive", "article"].includes(layout))
      || (target === "about" && layout === "about")
      || (targetCollection && layout === "collection" && targetCollection === collection)
    );

    link.classList.toggle("is-active", active);
    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.closest("[hidden]") && !element.hidden);
}

function initializeSiteMenu(root = document) {
  const button = root.querySelector("[data-site-menu-button]");
  const panel = root.querySelector("[data-site-menu-panel]");

  if (!button || !panel || panel.dataset.siteMenuBound === "true") {
    return;
  }

  let lastFocused = null;

  function closeMenu({ restoreFocus = true } = {}) {
    delete panel.dataset.open;
    panel.setAttribute("aria-hidden", "true");
    panel.inert = true;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "打开站点导航");
    document.body.classList.remove("site-menu-open");

    if (restoreFocus && lastFocused instanceof HTMLElement) {
      lastFocused.focus();
    }
  }

  function openMenu() {
    lastFocused = document.activeElement;
    panel.dataset.open = "true";
    panel.setAttribute("aria-hidden", "false");
    panel.inert = false;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", "关闭站点导航");
    document.body.classList.add("site-menu-open");
    getFocusableElements(panel)[0]?.focus();
  }

  button.addEventListener("click", () => {
    if (panel.dataset.open === "true") {
      closeMenu();
    } else {
      openMenu();
    }
  });

  panel.querySelectorAll("[data-site-menu-close]").forEach((element) => {
    element.addEventListener("click", () => closeMenu());
  });

  panel.querySelectorAll("a[href]").forEach((link) => {
    link.addEventListener("click", () => closeMenu({ restoreFocus: false }));
  });

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = getFocusableElements(panel);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!first || !last) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  panel.dataset.siteMenuBound = "true";
  closeMenu({ restoreFocus: false });
}

function initializeSearchButton(root = document) {
  const button = root.querySelector("[data-site-search-button]");
  const toggle = root.querySelector("#__search");

  if (!button || !toggle || button.dataset.siteSearchBound === "true") {
    return;
  }

  const syncExpanded = () => {
    button.setAttribute("aria-expanded", String(toggle.checked));
  };

  button.addEventListener("click", () => {
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    syncExpanded();
    window.setTimeout(() => {
      const currentQuery = document.querySelector("[data-md-component='search-query']");
      currentQuery?.focus();
    }, 50);
  });
  toggle.addEventListener("change", syncExpanded);

  button.dataset.siteSearchBound = "true";
  syncExpanded();
}

function updateSiteUi(root = document) {
  syncPageLayout(root);
  enhanceCodeBlocks(root);
  updatePostStats(root);
  updateReadingProgress(root);
  updateHeaderState(root);
  initializeSiteMenu(root);
  initializeSearchButton(root);
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
      window.requestAnimationFrame(() => updateSiteUi());
    });
  }
}
