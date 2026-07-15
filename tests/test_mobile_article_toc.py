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
        self.assertIn("data-article-toc-content", template)

    def test_script_is_loaded_after_share_script(self):
        config = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")

        self.assertIn("javascripts/article-toc.js", config)
        share_script = config.index("javascripts/share-link.js")
        toc_script = config.index("javascripts/article-toc.js")
        self.assertLess(share_script, toc_script)

    def test_mobile_styles_include_safe_area_and_reduced_motion(self):
        css = (ROOT / "docs/css/custom.css").read_text(encoding="utf-8")

        self.assertIn(".article-toc-fab", css)
        self.assertIn("env(safe-area-inset-bottom", css)
        self.assertIn("prefers-reduced-motion: reduce", css)


if __name__ == "__main__":
    unittest.main()
