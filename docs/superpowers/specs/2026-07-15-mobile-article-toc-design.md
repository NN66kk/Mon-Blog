# Mobile article table of contents design

## Goal

Make long blog posts navigable on phones without changing the existing desktop table of contents. A floating button appears near the lower-right reading area and opens the current article's generated table of contents.

## Chosen interaction

- Show the control only on mobile-width article pages that have a non-empty MkDocs table of contents.
- Place a compact circular button at the lower right, above the browser safe area and clear of the existing back-to-top control.
- Open a bottom sheet with a dimmed backdrop. The sheet title is `本文目录` and the body preserves MkDocs' nested heading structure.
- Selecting an entry closes the sheet, updates the URL hash through the native link, and scrolls to the matching heading.
- Close via the close button, backdrop click, or Escape. Restore focus to the floating button after dismissal.
- Lock background scrolling while the sheet is open.

## Integration

- `docs/templates/post.html` provides article-only dialog markup and a mobile trigger.
- `docs/javascripts/article-toc.js` copies links from the existing `.md-sidebar--secondary .md-nav__list`, binds interaction once, and reinitializes after MkDocs instant navigation.
- `docs/css/custom.css` owns all visual and responsive behavior, including light/dark themes, safe-area spacing, focus states, and reduced-motion behavior.
- `mkdocs.yml` loads the new script.

## Empty and failure states

- If the secondary navigation or its links are absent, keep both trigger and sheet hidden.
- JavaScript enhancement is progressive: article content and desktop navigation remain usable if the script does not run.

## Verification

- Automated DOM tests cover visibility, cloned hierarchy, opening and closing paths, link selection, focus restoration, and duplicate initialization.
- Static checks confirm the script is registered and the template exposes the required hooks.
- No `mkdocs build` is run, per project instructions.

## Scope

This change does not alter heading generation, desktop navigation, article content, or the existing sharing control.
