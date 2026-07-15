from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class MobileArticleTocTests(unittest.TestCase):
    def test_post_template_exposes_accessible_toc_hooks(self):
        template = (ROOT / "docs/templates/post.html").read_text(encoding="utf-8")

        self.assertIn("data-article-toc-button", template)
        self.assertIn('aria-controls="article-toc-sheet"', template)
        self.assertIn('role="dialog"', template)
        self.assertIn(
            'aria-labelledby="article-toc-title"\n      aria-hidden="true"\n      inert',
            template,
        )
        self.assertIn("data-article-toc-search-toggle", template)
        self.assertIn('aria-controls="article-toc-search-panel"', template)
        self.assertIn("data-article-toc-search-panel", template)
        self.assertIn("data-article-toc-search", template)
        self.assertIn('type="search"', template)
        self.assertIn('aria-controls="article-toc-content"', template)
        self.assertIn("data-article-toc-search-status", template)
        self.assertIn("data-article-toc-empty", template)
        self.assertIn("data-article-toc-content", template)

    def test_script_is_loaded_after_share_script(self):
        config = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")

        self.assertIn("javascripts/article-toc.js", config)
        share_script = config.index("javascripts/share-link.js")
        toc_script = config.index("javascripts/article-toc.js")
        self.assertLess(share_script, toc_script)

    def test_script_supports_materials_absolute_toc_links(self):
        script = (ROOT / "docs/javascripts/article-toc.js").read_text(
            encoding="utf-8"
        )

        self.assertIn('source.querySelectorAll("a[href]")', script)
        self.assertNotIn('querySelectorAll("a[href^=\'#\']")', script)

    def test_mobile_styles_include_safe_area_and_reduced_motion(self):
        css = (ROOT / "docs/css/custom.css").read_text(encoding="utf-8")

        self.assertIn(".article-toc-fab", css)
        self.assertIn(".article-toc-search-toggle", css)
        self.assertIn(".article-toc-search[hidden]", css)
        self.assertIn(".article-toc-search-input", css)
        self.assertIn(".article-toc-item--visible-first::after", css)
        self.assertIn(".article-toc-item--visible-last::after", css)
        self.assertIn('content: ""', css)
        self.assertIn("list-style: none", css)
        self.assertIn("env(safe-area-inset-bottom", css)
        self.assertIn("prefers-reduced-motion: reduce", css)

    def test_script_marks_visible_connector_endpoints(self):
        script = (ROOT / "docs/javascripts/article-toc.js").read_text(
            encoding="utf-8"
        )

        self.assertIn('"article-toc-item--visible-first"', script)
        self.assertIn('"article-toc-item--visible-last"', script)


if __name__ == "__main__":
    unittest.main()
