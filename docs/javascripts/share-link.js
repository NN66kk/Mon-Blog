function getShareLinkUrl() {
  const shareUrl = new URL(window.location.href);
  shareUrl.hash = "";
  shareUrl.search = "";
  return shareUrl.toString();
}

async function copyShareLink(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const originalRange = selection && selection.rangeCount > 0
    ? selection.getRangeAt(0)
    : null;

  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (selection && originalRange) {
    selection.removeAllRanges();
    selection.addRange(originalRange);
  }

  if (!copied) {
    throw new Error("Unable to copy share link.");
  }
}

function bindShareLinkButtons(root) {
  root.querySelectorAll("[data-share-link-button]").forEach((button) => {
    if (button.dataset.shareLinkBound === "true") {
      return;
    }

    button.dataset.shareLinkBound = "true";

    button.addEventListener("click", async () => {
      const defaultText = button.dataset.shareLinkDefaultText || "分享链接";
      const successText = button.dataset.shareLinkSuccessText || "链接已复制";
      const errorText = button.dataset.shareLinkErrorText || "复制失败，请手动复制";

      button.disabled = true;

      try {
        await copyShareLink(getShareLinkUrl());
        button.textContent = successText;
      } catch (error) {
        button.textContent = errorText;
      }

      window.setTimeout(() => {
        button.textContent = defaultText;
        button.disabled = false;
      }, 1600);
    });
  });
}

function initializeShareLinkButtons() {
  bindShareLinkButtons(document);
}

if (typeof document$ !== "undefined" && typeof document$.subscribe === "function") {
  document$.subscribe(() => {
    initializeShareLinkButtons();
  });
} else {
  document.addEventListener("DOMContentLoaded", initializeShareLinkButtons);
}
