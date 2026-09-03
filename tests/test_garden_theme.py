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
    def test_home_archive_and_collections_use_editorial_templates(self):
        home_page = read_project_file("docs/index.md")
        archive_page = read_project_file("docs/archive.md")
        home_template = read_project_file("docs/templates/home.html")
        archive_template = read_project_file("docs/templates/archive.html")
        collection_template = read_project_file("docs/templates/collection.html")

        self.assertIn("template: home.html", home_page)
        self.assertIn("template: archive.html", archive_page)
        self.assertIn('class="garden-home"', home_template)
        self.assertIn('class="garden-archive"', archive_template)
        self.assertIn('class="garden-collection', collection_template)
        self.assertIn("blog.recent", home_template)
        self.assertIn("blog.posts", archive_template)
        self.assertNotIn("nav.pages", home_template + archive_template)

    def test_mkdocs_loads_split_css_and_enables_site_ui_and_highlighting(self):
        config = read_project_file("mkdocs.yml")
        extra_css = [
            line.strip()
            for line in config.split("extra_css:\n", 1)[1].strip().splitlines()
        ]

        self.assertEqual(
            extra_css,
            [
                "- css/00-tokens.css",
                "- css/10-shell.css",
                "- css/20-components.css",
                "- css/30-article.css",
                "- css/40-home.css",
                "- css/50-archive.css",
                "- css/60-collection.css",
            ],
        )
        self.assertNotIn("css/garden-v2.css", config)
        self.assertIn("- javascripts/site-ui.js", config)
        self.assertIn("- content.code.copy", config)
        self.assertIn("- pymdownx.highlight:", config)
        self.assertIn("anchor_linenums: true", config)
        self.assertIn("line_spans: __span", config)
        self.assertIn("pygments_lang_class: true", config)
        self.assertIn("- pymdownx.inlinehilite", config)
        self.assertIn("- pymdownx.superfences:", config)

    def test_tokens_define_distinct_light_and_dark_palettes(self):
        css = read_project_file("docs/css/00-tokens.css")
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
            "--garden-line: 1px solid var(--garden-border)",
            "--garden-focus: 0 0 0 3px var(--garden-focus-ring)",
            "--md-code-bg-color: var(--garden-code-bg)",
            "--md-code-fg-color: var(--garden-code-fg)",
        )

        for token in required_tokens:
            self.assertIn(token, light)
            self.assertIn(token, dark)

        self.assertIn("--garden-paper: #f3f0e7", light)
        self.assertIn("--garden-paper: #171a15", dark)
        self.assertIn("--garden-code-bg: #20251f", light)
        self.assertIn("--garden-code-bg: #11150f", dark)
        root = css_rule_body(css, ":root")
        self.assertNotIn("--garden-line:", root)
        self.assertNotIn("--garden-focus:", root)

    def test_code_blocks_use_one_outer_frame_and_reset_inner_surfaces(self):
        css = read_project_file("docs/css/20-components.css")
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

    def test_split_css_covers_mobile_toc_and_accessibility_states(self):
        css = "\n".join(
            read_project_file(path)
            for path in (
                "docs/css/00-tokens.css",
                "docs/css/20-components.css",
                "docs/css/30-article.css",
            )
        )

        self.assertIn("/* Mobile article contents sheet */", css)
        self.assertIn("@media screen and (max-width: 47.99em)", css)
        self.assertIn(".article-toc[hidden]", css)
        self.assertIn(".article-toc-fab", css)
        self.assertIn(".article-toc-sheet", css)
        self.assertIn("env(safe-area-inset-bottom, 0px)", css)
        self.assertIn(":where(a, button, input, summary, [tabindex]):focus-visible", css)
        self.assertIn(".md-typeset .highlight pre:focus-visible", css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)
        self.assertIn("transition-duration: 0.01ms !important", css)

    def test_post_template_exposes_reading_progress_and_post_body(self):
        template = read_project_file("docs/templates/post.html")

        self.assertIn("data-reading-progress", template)
        self.assertIn('aria-hidden="true"', template)
        self.assertNotIn('role="progressbar"', template)
        self.assertIn("data-reading-stats", template)
        self.assertIn("data-reading-count", template)
        self.assertIn("data-reading-minutes", template)
        self.assertIn('class="post-body" data-post-body', template)
        self.assertIn("{{ body_html|safe }}", template)

    def test_mobile_layout_prioritizes_posts_and_compacts_article_header(self):
        home_css = read_project_file("docs/css/40-home.css")
        article_css = read_project_file("docs/css/30-article.css")
        template = read_project_file("docs/templates/post.html")

        self.assertIn(".recent-notes", home_css)
        self.assertIn("order: 1", home_css)
        self.assertIn(".featured-note", home_css)
        self.assertIn("order: 2", home_css)
        self.assertIn(".md-content__inner--article", article_css)
        self.assertNotIn(":has(", home_css + article_css)
        self.assertIn("post-header-attribution", template)
        self.assertIn("page.blog_publish_label[:10]", template)
        self.assertIn('aria-label="复制本文链接"', template)

    def test_custom_metadata_and_lists_reset_material_default_indentation(self):
        home_css = read_project_file("docs/css/40-home.css")
        article_css = read_project_file("docs/css/30-article.css")

        stats = css_rule_body(home_css, ".home-hero__stats div")
        stat_terms = css_rule_body(
            home_css,
            ".md-typeset .home-hero__stats dt,\n.md-typeset .home-hero__stats dd",
        )
        toc_item = css_rule_body(
            article_css,
            ".md-typeset .article-toc-content .md-nav__item",
        )
        about_item = css_rule_body(
            article_css,
            ".md-typeset .about-index ul > li",
        )

        self.assertIn("flex-direction: column", stats)
        self.assertIn("align-items: flex-start", stats)
        self.assertIn("margin-inline: 0", stat_terms)
        self.assertIn("text-align: start", stat_terms)
        self.assertIn(
            ".md-typeset .home-hero__stats dd {\n  margin-block: 0.22rem 0",
            home_css,
        )
        self.assertIn("margin: 0", toc_item)
        self.assertIn("padding-inline-start: 0.75rem", toc_item)
        self.assertIn("margin: 0", about_item)

    def test_share_button_has_visible_label_and_feedback_states(self):
        article_css = read_project_file("docs/css/30-article.css")
        template = read_project_file("docs/templates/post.html")
        script = read_project_file("docs/javascripts/share-link.js")
        share_button = css_rule_body(article_css, ".post-share-button")

        self.assertIn('data-share-link-default-text="复制链接"', template)
        self.assertIn("data-share-link-label", template)
        self.assertIn("display: inline-flex", share_button)
        self.assertIn("width: 5.5rem", share_button)
        self.assertIn("min-height: 2.2rem", share_button)
        self.assertIn("white-space: nowrap", share_button)
        self.assertIn(
            '.post-share-button[data-share-link-state="copied"]',
            article_css,
        )
        self.assertIn(
            '.post-share-button[data-share-link-state="error"]',
            article_css,
        )
        self.assertIn("copyShareLinkWithExecCommand", script)
        self.assertIn("initializeShareLinkButtons();", script)
        self.assertIn("document$.subscribe", script)

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
        self.assertNotIn('progress.setAttribute("aria-valuenow"', script)
        self.assertIn("syncPageLayout", script)
        self.assertIn("initializeSiteMenu", script)
        self.assertIn("initializeSearchButton", script)
        self.assertIn("document$.subscribe", script)

    def test_social_card_has_expected_png_dimensions(self):
        image = ROOT / "docs/assets/images/og-garden.png"
        self.assertTrue(image.is_file())

        header = image.read_bytes()[:24]
        self.assertEqual(header[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(header[12:16], b"IHDR")
        width, height = struct.unpack(">II", header[16:24])
        self.assertEqual((width, height), (1200, 630))

    def test_home_and_archive_expose_content_discovery_controls(self):
        home = read_project_file("docs/templates/home.html")
        archive = read_project_file("docs/templates/archive.html")
        script = read_project_file("docs/javascripts/archive-filter.js")
        config = read_project_file("mkdocs.yml")

        self.assertIn('class="home-collections"', home)
        self.assertIn('class="collection-card', home)
        self.assertIn("collection.description", home)
        self.assertIn("data-archive-search", archive)
        self.assertIn("data-archive-collection", archive)
        self.assertIn("data-archive-results", archive)
        self.assertIn("data-archive-empty", archive)
        self.assertIn("function archiveEntryMatches", script)
        self.assertIn("javascripts/archive-filter.js", config)

    def test_articles_emit_structured_metadata_and_collection_links(self):
        main = read_project_file("docs/templates/main.html")
        post = read_project_file("docs/templates/post.html")

        self.assertIn('property="article:published_time"', main)
        self.assertIn('type="application/ld+json"', main)
        self.assertIn('"@type": "BlogPosting"', main)
        self.assertIn("collection.index", post)
        self.assertIn('id="article-top"', post)


if __name__ == "__main__":
    unittest.main()
