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

let disposeSiteSearch = null;

function initializeSearchButton(root = document) {
  const button = root.querySelector("[data-site-search-button]");
  const toggle = root.querySelector("#__search");
  const dialog = root.querySelector("[data-md-component='search']");
  const query = dialog?.querySelector("[data-md-component='search-query']");

  if (!button || !toggle || !dialog || !query || button.dataset.siteSearchBound === "true") {
    return;
  }

  // Instant navigation may replace the header. Retire its document listeners.
  disposeSiteSearch?.();
  const controller = new AbortController();
  const events = { signal: controller.signal };
  const idle = dialog.querySelector("[data-search-idle]");
  const empty = dialog.querySelector("[data-search-empty]");
  const meta = dialog.querySelector(".md-search-result__meta");
  const list = dialog.querySelector(".md-search-result__list");
  const scrollwrap = dialog.querySelector(".md-search__scrollwrap");
  let active = false;
  let composing = false;
  let returnFocus = button;
  let restoreFocus = true;
  let previousOverflow = null;
  let queryValue = query.value;
  let resultValue = null;
  let emptyTimer = null;

  function unlockScroll() {
    document.body.classList.remove("site-search-open");
    if (previousOverflow) {
      document.body.style.overflow = previousOverflow.body;
      document.documentElement.style.overflow = previousOverflow.html;
      previousOverflow = null;
    }
  }

  function syncExpanded() {
    const nextActive = toggle.checked;
    button.setAttribute("aria-expanded", String(nextActive));
    dialog.setAttribute("aria-hidden", String(!nextActive));

    if (nextActive === active) {
      return;
    }

    active = nextActive;
    if (active) {
      if (!dialog.contains(document.activeElement)) {
        returnFocus = document.activeElement instanceof HTMLElement
          && document.activeElement !== document.body ? document.activeElement : button;
      }
      previousOverflow = {
        body: document.body.style.overflow,
        html: document.documentElement.style.overflow,
      };
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      document.body.classList.add("site-search-open");
    } else {
      unlockScroll();
      if (dialog.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      if (restoreFocus) {
        const target = returnFocus?.isConnected ? returnFocus : button;
        target.focus({ preventScroll: true });
      }
      restoreFocus = true;
    }
  }

  function setOpen(open) {
    if (toggle.checked !== open) {
      toggle.checked = open;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
    syncExpanded();
  }

  function openSearch(event) {
    setOpen(true);
    // Safari does not always focus buttons on click; remember the actual opener.
    if (event?.currentTarget === button) returnFocus = button;
    // Keep this synchronous with the gesture so iOS can open its keyboard.
    query.focus({ preventScroll: true });
    query.select();
  }

  function syncQueryState() {
    if (query.value !== queryValue) {
      queryValue = query.value;
      resultValue = null;
      window.clearTimeout(emptyTimer);
      if (empty) empty.hidden = true;
      if (scrollwrap) scrollwrap.scrollTop = 0;
    }
    dialog.dataset.searchState = query.value.length ? "query" : "idle";
    if (idle) idle.hidden = Boolean(query.value.length);
    if (empty && !query.value.length) empty.hidden = true;
  }

  function notifyQueryChange() {
    syncQueryState();
    // Material observes keyup/focus, not input. Also support paste, reset and IME.
    query.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
  }

  const resultObserver = new MutationObserver(() => {
    resultValue = query.value;
    window.clearTimeout(emptyTimer);
    if (empty) empty.hidden = true;
    // Wait for an actual engine update; an empty list alone can mean "loading".
    if (!empty || !query.value.length || !dialog.dataset.searchNoResults) return;
    emptyTimer = window.setTimeout(() => {
      empty.hidden = !(resultValue === query.value
        && query.value.length
        && meta?.textContent.trim() === dialog.dataset.searchNoResults.trim()
        && !list?.children.length);
    }, 150);
  });
  if (meta) resultObserver.observe(meta, { childList: true, characterData: true, subtree: true });

  button.addEventListener("click", openSearch, events);
  toggle.addEventListener("change", syncExpanded, events);
  const toggleObserver = new MutationObserver(syncExpanded);
  toggleObserver.observe(toggle, { attributes: true, attributeFilter: ["checked"] });

  dialog.querySelectorAll("[data-site-search-close]").forEach((close) => {
    close.addEventListener("click", () => setOpen(false), events);
  });
  dialog.querySelectorAll("[data-search-term]").forEach((term) => {
    term.addEventListener("click", () => {
      query.value = term.dataset.searchTerm || term.textContent.trim();
      notifyQueryChange();
      query.focus({ preventScroll: true });
    }, events);
  });
  // Material closes the toggle when a result or a recent article is selected.
  dialog.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a[href]")) {
      restoreFocus = false;
    }
  }, { ...events, capture: true });

  query.addEventListener("input", (event) => {
    syncQueryState();
    if (!composing && !event.isComposing) notifyQueryChange();
  }, events);
  query.addEventListener("keyup", syncQueryState, events);
  query.addEventListener("compositionstart", () => { composing = true; }, events);
  query.addEventListener("compositionend", () => {
    composing = false;
    notifyQueryChange();
  }, events);
  query.form?.addEventListener("reset", () => {
    // The browser applies the form reset after its reset event has completed.
    window.setTimeout(() => {
      if (!query.isConnected) return;
      notifyQueryChange();
      if (toggle.checked) query.focus({ preventScroll: true });
    }, 0);
  }, events);

  document.addEventListener("keydown", (event) => {
    if (event.isComposing || composing || event.keyCode === 229) return;

    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      event.stopPropagation();
      openSearch();
      return;
    }
    if (!toggle.checked) return;

    // Material's window keydown handler closes on Tab. Handle modal keys first,
    // while allowing its ArrowUp/ArrowDown and result Enter navigation through.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const focusable = Array.from(dialog.querySelectorAll(
        "a[href], button, input, select, textarea, summary, [tabindex]",
      )).filter((element) => element.tabIndex >= 0
        && !element.disabled
        && !element.closest("[hidden], [inert]")
        && element.getClientRects().length
        && window.getComputedStyle(element).visibility !== "hidden");
      const index = focusable.indexOf(document.activeElement);
      const next = index < 0 ? (event.shiftKey ? focusable.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      (focusable[next] || query).focus({ preventScroll: true });
      return;
    }
    // Let keyboard activation reach the new buttons without Material moving
    // focus back into the query before a Space keyup can click the button.
    if ((event.key === " " || event.key === "Enter")
      && event.target instanceof Element && event.target.closest("button")) {
      event.stopPropagation();
    }
  }, { ...events, capture: true });

  disposeSiteSearch = () => {
    controller.abort();
    resultObserver.disconnect();
    toggleObserver.disconnect();
    window.clearTimeout(emptyTimer);
    unlockScroll();
    delete button.dataset.siteSearchBound;
  };

  button.dataset.siteSearchBound = "true";
  syncQueryState();
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
