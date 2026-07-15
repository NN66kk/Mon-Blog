# Mobile Article Table of Contents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-only floating article table-of-contents button that opens an accessible bottom sheet and navigates to headings.

**Architecture:** Reuse the table of contents already rendered by MkDocs Material in the secondary sidebar. Article-only template markup provides the trigger and sheet; a focused script clones the generated navigation and manages state; custom CSS provides responsive presentation without changing desktop navigation.

**Tech Stack:** MkDocs Material/Jinja templates, vanilla JavaScript, CSS, Python `unittest` static integration tests, Node syntax checking.

---

### Task 1: Define the integration contract

**Files:**
- Create: `tests/test_mobile_article_toc.py`

- [ ] **Step 1: Write failing integration tests**

```python
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MobileArticleTocTests(unittest.TestCase):
    def test_post_template_exposes_accessible_toc_hooks(self):
        template = (ROOT / "docs/templates/post.html").read_text(encoding="utf-8")
        self.assertIn("data-article-toc-button", template)
        self.assertIn('aria-controls="article-toc-sheet"', template)
        self.assertIn('role="dialog"', template)
        self.assertIn("data-article-toc-content", template)

    def test_script_is_loaded_after_share_script(self):
        config = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")
        self.assertIn("javascripts/article-toc.js", config)

    def test_mobile_styles_include_safe_area_and_reduced_motion(self):
        css = (ROOT / "docs/css/custom.css").read_text(encoding="utf-8")
        self.assertIn(".article-toc-fab", css)
        self.assertIn("env(safe-area-inset-bottom", css)
        self.assertIn("prefers-reduced-motion: reduce", css)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m unittest tests/test_mobile_article_toc.py -v`

Expected: three failures because the template hooks, script registration, and CSS do not exist.

### Task 2: Add article markup and behavior

**Files:**
- Modify: `docs/templates/post.html`
- Create: `docs/javascripts/article-toc.js`
- Modify: `mkdocs.yml`

- [ ] **Step 1: Add article-only accessible markup**

Add after the article body in `post.html`: a hidden `.article-toc` wrapper, a button with `data-article-toc-button`, `aria-expanded="false"`, and `aria-controls="article-toc-sheet"`; a backdrop; and a bottom sheet with `role="dialog"`, `aria-modal="true"`, a visible `本文目录` title, a close button, and an empty `data-article-toc-content` container.

- [ ] **Step 2: Implement minimal controller**

In `article-toc.js`, implement these focused operations:

```javascript
function initializeArticleToc(root = document) {
  const widget = root.querySelector("[data-article-toc]");
  const source = root.querySelector(".md-sidebar--secondary .md-nav__list");
  if (!widget || !source || widget.dataset.articleTocBound === "true") return;

  const links = source.querySelectorAll("a[href^='#']");
  if (!links.length) return;

  const content = widget.querySelector("[data-article-toc-content]");
  content.replaceChildren(source.cloneNode(true));
  widget.hidden = false;
  widget.dataset.articleTocBound = "true";
  // Bind open, close, backdrop, Escape, and cloned-link click behavior.
}
```

Opening sets `data-open`, `aria-expanded`, and the body scroll-lock class, then focuses the close button. Closing reverses state and optionally restores focus. Link clicks close without preventing the native hash navigation. Subscribe through MkDocs Material's `document$`, with `DOMContentLoaded` fallback.

- [ ] **Step 3: Register the script**

Add `javascripts/article-toc.js` immediately after `javascripts/share-link.js` in `mkdocs.yml`.

- [ ] **Step 4: Run syntax and integration checks**

Run: `node --check docs/javascripts/article-toc.js`

Expected: exit code 0 with no output.

Run: `python -m unittest tests/test_mobile_article_toc.py -v`

Expected: template and config tests pass; CSS test still fails.

### Task 3: Add responsive presentation

**Files:**
- Modify: `docs/css/custom.css`

- [ ] **Step 1: Add hidden-by-default component styles**

Define `.article-toc`, `.article-toc-fab`, backdrop, sheet, header, close button, and navigation styles. Keep the component hidden above `768px`; below that width show the trigger only after JavaScript removes `[hidden]`.

- [ ] **Step 2: Match the blog and mobile safe areas**

Use `var(--md-primary-fg-color)` for the teal trigger, existing Material foreground/background variables for themes, `calc(1rem + env(safe-area-inset-bottom, 0px))` for bottom-sheet padding, and position the button above the browser edge. Preserve nested list indentation and give every link at least a 44px touch row.

- [ ] **Step 3: Add accessible motion behavior**

Animate only opacity and transform. Under `@media (prefers-reduced-motion: reduce)`, remove component transitions. Add visible `:focus-visible` outlines.

- [ ] **Step 4: Run all permitted verification**

Run: `python -m unittest tests/test_mobile_article_toc.py -v`

Expected: all tests pass.

Run: `node --check docs/javascripts/article-toc.js`

Expected: exit code 0 with no output.

Run: `git diff --check`

Expected: exit code 0 with no whitespace errors. Do not run `mkdocs build`, and do not commit or push.
