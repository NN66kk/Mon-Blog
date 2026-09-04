const ARCHIVE_COLLECTIONS = new Set(["A", "B", "C", "D"]);

function normalizeArchiveText(value) {
  const text = String(value || "");
  const normalized = typeof text.normalize === "function"
    ? text.normalize("NFKC")
    : text;

  return normalized
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, " ")
    .trim();
}

function getArchiveQueryTokens(query) {
  return normalizeArchiveText(query).split(" ").filter(Boolean);
}

function archiveEntryMatches(entry, query, collection = "") {
  const selectedCollection = ARCHIVE_COLLECTIONS.has(collection)
    ? collection
    : "";

  if (selectedCollection && entry.collection !== selectedCollection) {
    return false;
  }

  const searchText = normalizeArchiveText(entry.searchText);
  return getArchiveQueryTokens(query).every((token) => searchText.includes(token));
}

function initializeArchiveFilter(root = document) {
  const archive = root.querySelector("[data-archive-root]");

  if (!archive || archive.dataset.archiveFilterBound === "true") {
    return;
  }

  const input = archive.querySelector("[data-archive-search]");
  const clearButton = archive.querySelector("[data-archive-clear]");
  const resetButton = archive.querySelector("[data-archive-reset]");
  const emptyResetButton = archive.querySelector("[data-archive-empty-reset]");
  const result = archive.querySelector("[data-archive-results]");
  const timeline = archive.querySelector("[data-archive-timeline]");
  const emptyState = archive.querySelector("[data-archive-empty]");
  const cards = Array.from(archive.querySelectorAll("[data-archive-card]"));
  const yearSections = Array.from(archive.querySelectorAll("[data-archive-year]"));
  const collectionButtons = Array.from(
    archive.querySelectorAll(
      "[data-archive-collections] button[data-archive-collection]",
    ),
  );

  if (!input || !result || !timeline || !emptyState || !cards.length) {
    return;
  }

  let selectedCollection = "";

  try {
    const initialUrl = new URL(window.location.href);
    const initialCollection = initialUrl.searchParams.get("collection") || "";
    const initialQuery = initialUrl.searchParams.get("q") || "";

    selectedCollection = ARCHIVE_COLLECTIONS.has(initialCollection)
      ? initialCollection
      : "";
    input.value = initialQuery;
  } catch (error) {
    selectedCollection = "";
  }

  function updateUrl() {
    if (typeof window === "undefined" || !window.history?.replaceState) {
      return;
    }

    try {
      const url = new URL(window.location.href);
      const query = normalizeArchiveText(input.value);

      if (query) {
        url.searchParams.set("q", query);
      } else {
        url.searchParams.delete("q");
      }

      if (selectedCollection) {
        url.searchParams.set("collection", selectedCollection);
      } else {
        url.searchParams.delete("collection");
      }

      window.history.replaceState(window.history.state, "", url);
    } catch (error) {
      // Filtering remains fully functional when URL state is unavailable.
    }
  }

  function updateCollectionControls(query) {
    collectionButtons.forEach((button) => {
      const collection = button.dataset.archiveCollection || "";
      const isActive = collection === selectedCollection;
      const count = cards.filter((card) => archiveEntryMatches(
        {
          collection: card.dataset.archiveCollection || "",
          searchText: card.dataset.archiveSearch || "",
        },
        query,
        collection,
      )).length;
      const countTarget = button.querySelector("[data-archive-count]");

      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));

      if (countTarget) {
        countTarget.textContent = String(count);
      }
    });
  }

  function applyFilter({ syncUrl = true } = {}) {
    const query = input.value;
    let visibleCount = 0;

    cards.forEach((card) => {
      const matches = archiveEntryMatches(
        {
          collection: card.dataset.archiveCollection || "",
          searchText: card.dataset.archiveSearch || "",
        },
        query,
        selectedCollection,
      );

      card.hidden = !matches;
      if (matches) {
        visibleCount += 1;
      }
    });

    yearSections.forEach((section) => {
      const hasVisibleCard = Array.from(
        section.querySelectorAll("[data-archive-card]"),
      ).some((card) => !card.hidden);
      section.hidden = !hasVisibleCard;
    });

    const hasFilter = Boolean(normalizeArchiveText(query) || selectedCollection);
    result.textContent = hasFilter
      ? `显示 ${visibleCount} / ${cards.length} 篇`
      : `共 ${cards.length} 篇`;
    timeline.hidden = visibleCount === 0;
    emptyState.hidden = visibleCount !== 0;

    if (clearButton) {
      clearButton.hidden = !normalizeArchiveText(query);
    }
    if (resetButton) {
      resetButton.hidden = !hasFilter;
    }

    updateCollectionControls(query);

    if (syncUrl) {
      updateUrl();
    }
  }

  function resetFilter({ focus = false } = {}) {
    selectedCollection = "";
    input.value = "";
    applyFilter();

    if (focus) {
      input.focus();
    }
  }

  collectionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const collection = button.dataset.archiveCollection || "";
      selectedCollection = ARCHIVE_COLLECTIONS.has(collection) ? collection : "";
      applyFilter();
    });
  });

  input.addEventListener("input", () => applyFilter());
  input.addEventListener("search", () => applyFilter());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value) {
      event.preventDefault();
      input.value = "";
      applyFilter();
    }
  });

  clearButton?.addEventListener("click", () => {
    input.value = "";
    applyFilter();
    input.focus();
  });
  resetButton?.addEventListener("click", () => resetFilter({ focus: true }));
  emptyResetButton?.addEventListener("click", () => resetFilter({ focus: true }));

  archive.dataset.archiveFilterBound = "true";
  applyFilter({ syncUrl: false });
}

if (typeof document !== "undefined") {
  initializeArchiveFilter();

  if (typeof document$ !== "undefined" && typeof document$.subscribe === "function") {
    document$.subscribe(() => {
      initializeArchiveFilter();
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    archiveEntryMatches,
    getArchiveQueryTokens,
    normalizeArchiveText,
  };
}
