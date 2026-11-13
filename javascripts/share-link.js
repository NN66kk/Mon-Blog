function getShareLinkUrl(href) {
  const currentHref = href
    || (typeof window !== "undefined" ? window.location.href : "");

  if (!currentHref) {
    throw new Error("Unable to determine the current page URL.");
  }

  const shareUrl = new URL(currentHref);
  shareUrl.hash = "";
  shareUrl.search = "";
  return shareUrl.toString();
}

function focusWithoutScroll(element) {
  if (!element || typeof element.focus !== "function") {
    return;
  }

  try {
    element.focus({ preventScroll: true });
  } catch (error) {
    try {
      element.focus();
    } catch (focusError) {
      // Focus restoration is best-effort and must not invalidate a copy.
    }
  }
}

function restoreSelection(selection, ranges) {
  if (!selection || typeof selection.removeAllRanges !== "function") {
    return;
  }

  try {
    selection.removeAllRanges();
    ranges.forEach((range) => selection.addRange(range));
  } catch (error) {
    // A page may mutate while copying; selection restoration is best-effort.
  }
}

function copyShareLinkWithExecCommand(text, documentObject) {
  const currentDocument = documentObject
    || (typeof document !== "undefined" ? document : null);

  if (
    !currentDocument
    || !currentDocument.body
    || typeof currentDocument.createElement !== "function"
    || typeof currentDocument.execCommand !== "function"
  ) {
    return false;
  }

  const textarea = currentDocument.createElement("textarea");
  const selection = typeof currentDocument.getSelection === "function"
    ? currentDocument.getSelection()
    : null;
  const originalRanges = [];
  const originalActiveElement = currentDocument.activeElement;

  if (selection && typeof selection.getRangeAt === "function") {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      originalRanges.push(selection.getRangeAt(index));
    }
  }

  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.fontSize = "16px";

  currentDocument.body.appendChild(textarea);

  try {
    focusWithoutScroll(textarea);
    textarea.select();

    if (typeof textarea.setSelectionRange === "function") {
      textarea.setSelectionRange(0, text.length);
    }

    return currentDocument.execCommand("copy") === true;
  } finally {
    if (typeof textarea.remove === "function") {
      textarea.remove();
    } else if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }

    restoreSelection(selection, originalRanges);

    if (originalActiveElement !== textarea) {
      focusWithoutScroll(originalActiveElement);
    }
  }
}

async function copyShareLink(text, options = {}) {
  const currentWindow = Object.prototype.hasOwnProperty.call(options, "windowObject")
    ? options.windowObject
    : (typeof window !== "undefined" ? window : null);
  const currentNavigator = Object.prototype.hasOwnProperty.call(options, "navigatorObject")
    ? options.navigatorObject
    : (typeof navigator !== "undefined" ? navigator : null);
  const currentDocument = Object.prototype.hasOwnProperty.call(options, "documentObject")
    ? options.documentObject
    : (typeof document !== "undefined" ? document : null);
  const isSecureContext = Object.prototype.hasOwnProperty.call(options, "isSecureContext")
    ? options.isSecureContext
    : Boolean(currentWindow && currentWindow.isSecureContext);
  const clipboard = Object.prototype.hasOwnProperty.call(options, "clipboard")
    ? options.clipboard
    : (currentNavigator && currentNavigator.clipboard);
  const legacyCopy = options.legacyCopy
    || ((value) => copyShareLinkWithExecCommand(value, currentDocument));

  if (
    isSecureContext
    && clipboard
    && typeof clipboard.writeText === "function"
  ) {
    try {
      await clipboard.writeText(text);
      return "clipboard";
    } catch (error) {
      // Permission and embedded-browser failures still get the legacy fallback.
    }
  }

  try {
    if (legacyCopy(text)) {
      return "execCommand";
    }
  } catch (error) {
    // The caller reports one clear failure state after every copy path fails.
  }

  throw new Error("Unable to copy share link.");
}

function getShareLinkLabel(button) {
  return button.querySelector("[data-share-link-label]") || button;
}

function bindShareLinkButtons(root) {
  root.querySelectorAll("[data-share-link-button]").forEach((button) => {
    if (button.dataset.shareLinkBound === "true") {
      return;
    }

    button.dataset.shareLinkBound = "true";

    button.addEventListener("click", async () => {
      if (button.dataset.shareLinkState) {
        return;
      }

      const label = getShareLinkLabel(button);
      const defaultText = button.dataset.shareLinkDefaultText || "复制链接";
      const copyingText = button.dataset.shareLinkCopyingText || "复制中…";
      const successText = button.dataset.shareLinkSuccessText || "已复制";
      const errorText = button.dataset.shareLinkErrorText || "复制失败";
      const defaultAriaLabel = button.getAttribute("aria-label") || defaultText;

      button.dataset.shareLinkState = "copying";
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-disabled", "true");
      label.textContent = copyingText;

      try {
        await copyShareLink(getShareLinkUrl());
        label.textContent = successText;
        button.dataset.shareLinkState = "copied";
        button.setAttribute("aria-label", "链接已复制");
      } catch (error) {
        label.textContent = errorText;
        button.dataset.shareLinkState = "error";
        button.setAttribute("aria-label", errorText);
      }

      window.setTimeout(() => {
        label.textContent = defaultText;
        delete button.dataset.shareLinkState;
        button.setAttribute("aria-label", defaultAriaLabel);
        button.removeAttribute("aria-busy");
        button.removeAttribute("aria-disabled");
      }, 1800);
    });
  });
}

function initializeShareLinkButtons(root) {
  const currentRoot = root || (typeof document !== "undefined" ? document : null);

  if (currentRoot) {
    bindShareLinkButtons(currentRoot);
  }
}

if (typeof document !== "undefined") {
  // The script is emitted after the page markup, so bind the first page now.
  // Keep DOMContentLoaded as a defensive fallback and document$ for instant loads.
  initializeShareLinkButtons();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initializeShareLinkButtons();
    }, { once: true });
  }

  if (typeof document$ !== "undefined" && typeof document$.subscribe === "function") {
    document$.subscribe(() => {
      initializeShareLinkButtons();
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    bindShareLinkButtons,
    copyShareLink,
    copyShareLinkWithExecCommand,
    getShareLinkUrl,
  };
}
