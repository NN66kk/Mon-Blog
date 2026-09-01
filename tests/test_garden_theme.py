from pathlib import Path
import struct
import unittest


ROOT = Path(__file__).resolve().parents[1]


def read_project_file(path):
    return (ROOT / path).read_text(encoding="utf-8")


def css_rule_body(css, selector):
    selector_start = css.index(selector)
    body_start = css.index("{", selector_start) + 1
    body_end = css.index("}", body_start)
    return css[body_start:body_end]


def css_scheme_block(css, scheme):
    return css_rule_body(css, f'[data-md-color-scheme="{scheme}"]')


class GardenThemeTests(unittest.TestCase):
    def test_home_uses_quiet_v3_and_archive_uses_v2_template(self):
        home_page = read_project_file("docs/index.md")
        archive_page = read_project_file("docs/archive.md")
        home_template = read_project_file("docs/templates/garden_home_v2.html")
        archive_template = read_project_file("docs/templates/garden_archive_v2.html")

        self.assertIn("template: garden_home_v2.html", home_page)
        self.assertIn("template: garden_archive_v2.html", archive_page)
        self.assertNotIn("template: garden_home.html", home_page)
        self.assertNotIn("template: garden_archive.html", archive_page)
        self.assertIn('class="garden-home garden-home-v3"', home_template)
        self.assertIn('class="garden-archive-v2"', archive_template)
        self.assertIn("config.extra.collections", home_template)
        self.assertIn("config.extra.collections", archive_template)
        self.assertIn('class="quiet-hero"', home_template)
        self.assertIn('class="quiet-reading"', home_template)
        self.assertNotIn("garden-profile-v2", home_template)
        self.assertNotIn("garden-hero-v2", home_template)

    def test_mkdocs_loads_only_v2_css_and_enables_site_ui_and_highlighting(self):
        config = read_project_file("mkdocs.yml")
        extra_css = config.split("extra_css:\n", 1)[1].strip().splitlines()

        self.assertEqual(extra_css, ["- css/garden-v2.css"])
        self.assertNotIn("css/custom.css", config)
        self.assertIn("- javascripts/site-ui.js", config)
        self.assertIn("- content.code.copy", config)
        self.assertIn("- pymdownx.highlight:", config)
        self.assertIn("anchor_linenums: true", config)
        self.assertIn("line_spans: __span", config)
        self.assertIn("pygments_lang_class: true", config)
        self.assertIn("- pymdownx.inlinehilite", config)
        self.assertIn("- pymdownx.superfences:", config)

    def test_v2_css_defines_distinct_light_and_dark_tokens(self):
        css = read_project_file("docs/css/garden-v2.css")
        light = css_scheme_block(css, "default")
        dark = css_scheme_block(css, "slate")
        required_tokens = (
            "--garden-paper:",
            "--garden-sheet:",
            "--garden-ink:",
            "--garden-muted:",
            "--garden-code-bg:",
            "--garden-code-bar:",
            "--garden-code-line:",
            "--garden-code-fg:",
            "--md-code-bg-color: var(--garden-code-bg)",
            "--md-code-fg-color: var(--garden-code-fg)",
        )

        for token in required_tokens:
            self.assertIn(token, light)
            self.assertIn(token, dark)

        self.assertIn("--garden-paper: #f4f1e9", light)
        self.assertIn("--garden-paper: #171a15", dark)
        self.assertIn("--garden-code-bg: #20251f", light)
        self.assertIn("--garden-code-bg: #11150f", dark)

    def test_code_blocks_use_one_outer_frame_and_reset_inner_surfaces(self):
        css = read_project_file("docs/css/garden-v2.css")
        outer_selector = ".md-typeset .highlight,\n.md-typeset .highlighttable"
        reset_selector = (
            ".md-typeset .highlight pre,\n"
            ".md-typeset .highlight pre > code,\n"
            ".md-typeset .highlighttable pre,\n"
            ".md-typeset .highlighttable pre > code"
        )
        outer_rule = css_rule_body(css, outer_selector)
        reset_rule = css_rule_body(css, reset_selector)

        self.assertIn("border: 1px solid var(--garden-code-line) !important", outer_rule)
        self.assertIn("background: var(--garden-code-bg) !important", outer_rule)
        self.assertIn("overflow: hidden", outer_rule)
        self.assertIn("border: 0 !important", reset_rule)
        self.assertIn("background: transparent !important", reset_rule)
        self.assertNotIn(".md-typeset pre > code,\n.highlight {", css)
        self.assertIn("content: attr(data-code-label)", css)
        self.assertIn('.highlight[data-code-enhanced="true"]', css)
        self.assertIn(".md-typeset .md-code__button:focus-visible", css)

    def test_v2_css_covers_mobile_toc_and_accessibility_states(self):
        css = read_project_file("docs/css/garden-v2.css")

        self.assertIn("/* Mobile article contents sheet */", css)
        self.assertIn("@media screen and (max-width: 48em)", css)
        self.assertIn(".article-toc[hidden]", css)
        self.assertIn(".article-toc-fab", css)
        self.assertIn(".article-toc-sheet", css)
        self.assertIn("env(safe-area-inset-bottom, 0px)", css)
        self.assertIn(":where(a, button, input, summary):focus-visible", css)
        self.assertIn(".md-typeset .highlight pre:focus-visible", css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)
        self.assertIn("transition-duration: 0.01ms !important", css)

    def test_post_template_exposes_reading_progress_and_post_body(self):
        template = read_project_file("docs/templates/post.html")

        self.assertIn("data-reading-progress", template)
        self.assertIn('role="progressbar"', template)
        self.assertIn('aria-label="文章阅读进度"', template)
        self.assertIn('aria-valuemin="0"', template)
        self.assertIn('aria-valuemax="100"', template)
        self.assertIn('aria-valuenow="0"', template)
        self.assertIn("data-reading-stats", template)
        self.assertIn("data-reading-count", template)
        self.assertIn("data-reading-minutes", template)
        self.assertIn('class="post-body" data-post-body', template)
        self.assertIn("{{ body_html|safe }}", template)

    def test_mobile_layout_prioritizes_posts_and_compacts_article_header(self):
        css = read_project_file("docs/css/garden-v2.css")
        template = read_project_file("docs/templates/post.html")

        self.assertIn("/* Reading-first mobile layout: content arrives before decoration. */", css)
        self.assertIn(".garden-home-v3 .quiet-hero__landscape", css)
        self.assertIn(".garden-home-v3 .quiet-post-list", css)
        self.assertIn("order: 1", css)
        self.assertIn(".garden-home-v3 .quiet-about-note", css)
        self.assertIn("order: 2", css)
        self.assertIn(".md-content:has(.post-header) .md-path", css)
        self.assertIn(".md-content__inner:has(.post-header)", css)
        self.assertIn("post-header-attribution", template)
        self.assertIn("page.blog_publish_label[:10]", template)
        self.assertIn('aria-label="分享本文"', template)

    def test_site_ui_labels_code_and_updates_reading_state(self):
        script = read_project_file("docs/javascripts/site-ui.js")

        for mapping in (
            'bash: "BASH"',
            'csharp: "C#"',
            'dataview: "DATAVIEW"',
            'gitignore: "GITIGNORE"',
            'python: "PYTHON"',
            'text: "TXT"',
            'yaml: "YAML"',
        ):
            self.assertIn(mapping, script)

        self.assertIn('name.startsWith("language-")', script)
        self.assertIn("frame.dataset.codeLabel = label", script)
        self.assertIn('frame.dataset.codeEnhanced = "true"', script)
        self.assertIn('pre.setAttribute("aria-label", `${label} 代码`)', script)
        self.assertIn('root.querySelector("[data-post-body]")', script)
        self.assertIn('root.querySelector("[data-reading-progress]")', script)
        self.assertIn('progress.setAttribute("aria-valuenow"', script)
        self.assertIn("document$.subscribe", script)

    def test_social_card_has_expected_png_dimensions(self):
        image = ROOT / "docs/assets/images/og-garden.png"
        self.assertTrue(image.is_file())

        header = image.read_bytes()[:24]
        self.assertEqual(header[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(header[12:16], b"IHDR")
        width, height = struct.unpack(">II", header[16:24])
        self.assertEqual((width, height), (1200, 630))


if __name__ == "__main__":
    unittest.main()
