function initializeArticleToc(root = document) {
  const widget = root.querySelector("[data-article-toc]");
  const source = root.querySelector(".md-sidebar--secondary .md-nav__list");

  if (!widget || !source || widget.dataset.articleTocBound === "true") {
    return;
  }

  const sourceLinks = source.querySelectorAll("a[href^='#']");

  if (!sourceLinks.length) {
    return;
  }

  const button = widget.querySelector("[data-article-toc-button]");
  const sheet = widget.querySelector(".article-toc-sheet");
  const closeButton = widget.querySelector(".article-toc-close");
  const content = widget.querySelector("[data-article-toc-content]");
  const clonedList = source.cloneNode(true);

  clonedList.querySelectorAll("[id]").forEach((element) => {
    element.removeAttribute("id");
  });

  content.replaceChildren(clonedList);
  widget.hidden = false;
  widget.dataset.articleTocBound = "true";

  function openToc() {
    widget.dataset.open = "true";
    button.setAttribute("aria-expanded", "true");
    sheet.setAttribute("aria-hidden", "false");
    sheet.inert = false;
    document.body.classList.add("article-toc-open");
    closeButton.focus();
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

  widget.querySelectorAll("[data-article-toc-close]").forEach((element) => {
    element.addEventListener("click", () => closeToc());
  });

  content.addEventListener("click", (event) => {
    if (event.target.closest("a[href^='#']")) {
      closeToc(false);
    }
  });

  sheet.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeToc();
    }
  });
}

if (typeof document$ !== "undefined" && typeof document$.subscribe === "function") {
  document$.subscribe(() => {
    initializeArticleToc();
  });
} else {
  document.addEventListener("DOMContentLoaded", () => {
    initializeArticleToc();
  });
}
