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

function getTocLinkHash(link, currentLocation = window.location) {
  const href = link.getAttribute("href");

  if (!href) {
    return "";
  }

  try {
    return new URL(href, currentLocation.href).hash;
  } catch (error) {
    return "";
  }
}

function findCurrentTocLink(
  links,
  root = document,
  currentLocation = window.location,
) {
  if (!links.length) {
    return null;
  }

  const header = root.querySelector(".md-header");
  const readingLine = header
    ? header.getBoundingClientRect().bottom + 16
    : 80;
  let currentLink = links[0];

  for (const link of links) {
    const hash = getTocLinkHash(link, currentLocation);

    if (!hash) {
      continue;
    }

    let headingId;

    try {
      headingId = decodeURIComponent(hash.slice(1));
    } catch (error) {
      headingId = hash.slice(1);
    }

    const heading = root.getElementById(headingId);

    if (!heading) {
      continue;
    }

    if (heading.getBoundingClientRect().top <= readingLine) {
      currentLink = link;
    } else {
      break;
    }
  }

  return currentLink;
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
  const visibleItems = [];

  Array.from(list.children).forEach((item) => {
    if (!item.matches(".md-nav__item")) {
      return;
    }

    item.classList.remove(
      "article-toc-item--visible-first",
      "article-toc-item--visible-last",
    );

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

    if (isVisible) {
      visibleItems.push(item);
    }
  });

  if (visibleItems.length) {
    visibleItems[0].classList.add("article-toc-item--visible-first");
    visibleItems[visibleItems.length - 1]
      .classList.add("article-toc-item--visible-last");
  }

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
  const searchToggle = widget.querySelector("[data-article-toc-search-toggle]");
  const searchPanel = widget.querySelector("[data-article-toc-search-panel]");
  const searchInput = widget.querySelector("[data-article-toc-search]");
  const searchStatus = widget.querySelector("[data-article-toc-search-status]");
  const content = widget.querySelector("[data-article-toc-content]");
  const emptyState = widget.querySelector("[data-article-toc-empty]");
  const clonedList = source.cloneNode(true);
  const clonedLinks = Array.from(clonedList.querySelectorAll("a[href]"))
    .filter((link) => isSamePageAnchor(link));

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

  function revealCurrentTocEntry(currentHash) {
    const currentLink = clonedLinks.find(
      (link) => getTocLinkHash(link) === currentHash,
    );

    clonedLinks.forEach((link) => {
      link.classList.remove("md-nav__link--active", "article-toc-current");
      link.removeAttribute("aria-current");
    });

    if (!currentLink) {
      content.scrollTop = 0;
      return;
    }

    currentLink.classList.add("article-toc-current");
    currentLink.setAttribute("aria-current", "location");

    const contentRect = content.getBoundingClientRect();
    const linkRect = currentLink.getBoundingClientRect();
    const centeredTop = content.scrollTop
      + linkRect.top
      - contentRect.top
      - (content.clientHeight - linkRect.height) / 2;

    content.scrollTop = Math.max(0, centeredTop);
  }

  function closeSearch(restoreFocus = false) {
    delete widget.dataset.searchOpen;
    searchToggle.setAttribute("aria-expanded", "false");
    searchPanel.hidden = true;
    searchInput.value = "";
    updateSearchResults();

    if (restoreFocus) {
      searchToggle.focus();
    }
  }

  function openSearch() {
    widget.dataset.searchOpen = "true";
    searchToggle.setAttribute("aria-expanded", "true");
    searchPanel.hidden = false;
    searchInput.focus();
  }

  function toggleSearch() {
    if (widget.dataset.searchOpen === "true") {
      closeSearch(true);
    } else {
      openSearch();
    }
  }

  function openToc() {
    // Capture the reading position before focus and scroll-lock changes can
    // affect heading geometry in mobile browsers.
    const currentSourceLink = findCurrentTocLink(sourceLinks);
    const currentHash = currentSourceLink
      ? getTocLinkHash(currentSourceLink)
      : "";

    widget.dataset.open = "true";
    button.setAttribute("aria-expanded", "true");
    sheet.setAttribute("aria-hidden", "false");
    sheet.inert = false;
    document.body.classList.add("article-toc-open");
    closeSearch();
    closeButton.focus();
    window.requestAnimationFrame(() => revealCurrentTocEntry(currentHash));
  }

  function closeToc(restoreFocus = true) {
    delete widget.dataset.open;
    closeSearch();
    button.setAttribute("aria-expanded", "false");
    sheet.setAttribute("aria-hidden", "true");
    sheet.inert = true;
    document.body.classList.remove("article-toc-open");

    if (restoreFocus) {
      button.focus();
    }
  }

  button.addEventListener("click", openToc);
  searchToggle.addEventListener("click", toggleSearch);
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

      if (widget.dataset.searchOpen === "true") {
        closeSearch(true);
      } else {
        closeToc();
      }
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
    findCurrentTocLink,
    getTocLinkHash,
    isSamePageAnchor,
    normalizeTocSearchText,
    tocTextMatchesQuery,
  };
}
