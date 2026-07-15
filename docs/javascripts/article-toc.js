function isSamePageAnchor(link, currentLocation = window.location) {
  const href = link.getAttribute("href");

  if (!href) {
    return false;
  }

  try {
    const target = new URL(href, currentLocation.href);

    return Boolean(target.hash)
      && target.origin === currentLocation.origin
      && target.pathname === currentLocation.pathname
      && target.search === currentLocation.search;
  } catch (error) {
    return false;
  }
}

function normalizeTocSearchText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function tocTextMatchesQuery(text, query) {
  return normalizeTocSearchText(text).includes(
    normalizeTocSearchText(query),
  );
}

function filterTocList(list, query) {
  let matchCount = 0;
  let hasVisibleItems = false;

  Array.from(list.children).forEach((item) => {
    if (!item.matches(".md-nav__item")) {
      return;
    }

    const link = Array.from(item.children)
      .find((child) => child.matches("a[href]"));
    const childNav = Array.from(item.children)
      .find((child) => child.matches("nav.md-nav"));
    const childList = childNav
      ? Array.from(childNav.children)
        .find((child) => child.matches(".md-nav__list"))
      : null;
    const childResult = childList
      ? filterTocList(childList, query)
      : { matchCount: 0, hasVisibleItems: false };
    const selfMatches = Boolean(link)
      && tocTextMatchesQuery(link.textContent, query);
    const isVisible = selfMatches || childResult.hasVisibleItems;

    item.hidden = !isVisible;

    if (childNav) {
      childNav.hidden = !childResult.hasVisibleItems;
    }

    matchCount += childResult.matchCount + (selfMatches ? 1 : 0);
    hasVisibleItems = hasVisibleItems || isVisible;
  });

  return { matchCount, hasVisibleItems };
}

function initializeArticleToc(root = document) {
  const widget = root.querySelector("[data-article-toc]");
  const source = root.querySelector(".md-sidebar--secondary .md-nav__list");

  if (!widget || !source || widget.dataset.articleTocBound === "true") {
    return;
  }

  // Material rewrites hash-only TOC links to absolute URLs at runtime, so an
  // `a[href^='#']` selector works in the generated HTML but fails online.
  const sourceLinks = Array.from(source.querySelectorAll("a[href]"))
    .filter((link) => isSamePageAnchor(link));

  if (!sourceLinks.length) {
    return;
  }

  const button = widget.querySelector("[data-article-toc-button]");
  const sheet = widget.querySelector(".article-toc-sheet");
  const closeButton = widget.querySelector(".article-toc-close");
  const searchInput = widget.querySelector("[data-article-toc-search]");
  const searchStatus = widget.querySelector("[data-article-toc-search-status]");
  const content = widget.querySelector("[data-article-toc-content]");
  const emptyState = widget.querySelector("[data-article-toc-empty]");
  const clonedList = source.cloneNode(true);

  clonedList.querySelectorAll("[id]").forEach((element) => {
    element.removeAttribute("id");
  });

  content.replaceChildren(clonedList, emptyState);
  widget.hidden = false;
  widget.dataset.articleTocBound = "true";

  function updateSearchResults() {
    const query = normalizeTocSearchText(searchInput.value);
    const result = filterTocList(clonedList, query);

    searchStatus.value = query
      ? `${result.matchCount} 项`
      : `共 ${sourceLinks.length} 项`;
    emptyState.hidden = result.hasVisibleItems;
  }

  function openToc() {
    widget.dataset.open = "true";
    button.setAttribute("aria-expanded", "true");
    sheet.setAttribute("aria-hidden", "false");
    sheet.inert = false;
    document.body.classList.add("article-toc-open");
    searchInput.value = "";
    content.scrollTop = 0;
    updateSearchResults();
    searchInput.focus();
  }

  function closeToc(restoreFocus = true) {
    delete widget.dataset.open;
    button.setAttribute("aria-expanded", "false");
    sheet.setAttribute("aria-hidden", "true");
    sheet.inert = true;
    document.body.classList.remove("article-toc-open");

    if (restoreFocus) {
      button.focus();
    }
  }

  button.addEventListener("click", openToc);
  searchInput.addEventListener("input", updateSearchResults);
  searchInput.addEventListener("search", updateSearchResults);

  widget.querySelectorAll("[data-article-toc-close]").forEach((element) => {
    element.addEventListener("click", () => closeToc());
  });

  content.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");

    if (link && isSamePageAnchor(link)) {
      closeToc(false);
    }
  });

  sheet.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeToc();
    }
  });

  updateSearchResults();
}

if (typeof document !== "undefined") {
  // The script is emitted after the page markup, so initialize the first page
  // immediately. Keep the Material observable for subsequent instant loads.
  initializeArticleToc();

  if (typeof document$ !== "undefined" && typeof document$.subscribe === "function") {
    document$.subscribe(() => {
      initializeArticleToc();
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isSamePageAnchor,
    normalizeTocSearchText,
    tocTextMatchesQuery,
  };
}
