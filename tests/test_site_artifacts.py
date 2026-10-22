from contextlib import redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.check_site import main, SiteCheck


BASE = "https://example.test/Mon-Blog/"


class SiteArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.site = self.root / "site"
        self.docs = self.root / "docs"
        self.docs.mkdir()
        self.write("index.html", '<link rel="canonical" href="' + BASE + '"><h1 id="正文">Home</h1>')
        self.search([""])
        self.sitemap([BASE])

    def write(self, path, text):
        destination = self.site / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text, encoding="utf-8")

    def search(self, locations):
        self.write("search/search_index.json", json.dumps({"docs": [{"location": value} for value in locations]}))

    def sitemap(self, locations):
        self.write("sitemap.xml", '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>{url}</loc></url>" for url in locations) + "</urlset>")

    def check(self, config=None):
        return SiteCheck(self.site, BASE).run(self.docs, config or {})

    def test_resolves_encoded_chinese_cross_page_and_same_page_links(self):
        self.write("学习 笔记/index.html", '<link rel="canonical" href="' + BASE + '%E5%AD%A6%E4%B9%A0%20%E7%AC%94%E8%AE%B0/"><h1 id="中文">Title</h1><a href="../#正文">Home</a>')
        self.write("index.html", '<link rel="canonical" href="' + BASE + '"><h1 id="正文">Home</h1><a class="md-skip" href="#%E6%AD%A3%E6%96%87">Skip</a><a href="/Mon-Blog/%E5%AD%A6%E4%B9%A0%20%E7%AC%94%E8%AE%B0/#%E4%B8%AD%E6%96%87">Note</a>')
        self.search(["", "学习%20笔记/#中文"])
        self.assertEqual(self.check(), [])

    def test_missing_skip_and_search_section_anchors_are_reported(self):
        self.write("index.html", '<link rel="canonical" href="' + BASE + '"><a class="md-skip" href="#lost">Skip</a>')
        self.search(["#%E7%BC%BA%E5%A4%B1"])
        errors = self.check()
        self.assertTrue(any("md-skip" in e and "#lost" in e for e in errors), errors)
        self.assertTrue(any("search/search_index.json" in e and "#缺失" in e for e in errors), errors)

    def test_missing_resources_cross_page_anchors_and_site_base(self):
        self.write("note/index.html", '<link rel="canonical" href="' + BASE + 'note/"><img src="../missing.png"><a href="../#lost">Link</a><script src="/javascripts/site.js"></script>')
        errors = self.check()
        self.assertTrue(any("missing file" in e and "missing.png" in e for e in errors), errors)
        self.assertTrue(any("missing anchor #lost" in e for e in errors), errors)
        self.assertTrue(any("outside site base" in e and "site.js" in e for e in errors), errors)

    def test_external_links_are_not_fetched_and_named_anchors_work(self):
        self.write("index.html", '<link rel="canonical" href="' + BASE + '"><a name="legacy"></a><a href="#legacy">Old</a><a href="https://external.invalid/no-page#no-anchor">External</a><img src="//cdn.invalid/missing.png"><a href="mailto:reader@example.test">Mail</a><a href="#:~:text=example">Highlight</a>')
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            self.assertEqual(self.check(), [])

    def test_canonical_and_sitemap_must_use_the_configured_base(self):
        self.write("index.html", '<link rel="canonical" href="https://example.test/">')
        self.sitemap(["https://other.test/Mon-Blog/"])
        errors = self.check()
        self.assertTrue(any("canonical" in e and "outside site base" in e for e in errors), errors)
        self.assertTrue(any("sitemap.xml" in e and "outside site_url" in e for e in errors), errors)

    def test_draft_private_and_boolean_draft_cannot_leak(self):
        for name, metadata in (("draft", "status: draft"), ("private", "status: PRIVATE"), ("flag", "draft: true")):
            (self.docs / f"{name}.md").write_text(f"---\n{metadata}\n---\nSecret", encoding="utf-8")
            self.write(f"{name}/index.html", f'<link rel="canonical" href="{BASE}{name}/">Secret')
        self.search(["", "private/#section"])
        self.sitemap([BASE, BASE + "draft/"])
        errors = self.check()
        self.assertEqual(sum("draft/private HTML exists" in e for e in errors), 3)
        self.assertTrue(any("search/search_index.json" in e and "draft/private" in e for e in errors), errors)
        self.assertTrue(any("sitemap.xml" in e and "draft/private" in e for e in errors), errors)

    def test_hidden_is_publishable_but_missing_search_and_sitemap_fail(self):
        (self.docs / "index.md").write_text("---\nstatus: hidden\n---\nHome", encoding="utf-8")
        self.assertEqual(self.check(), [])
        self.search(["missing/"])
        self.sitemap([BASE + "missing/"])
        errors = self.check()
        self.assertTrue(any("search/search_index.json" in e and "missing file" in e for e in errors), errors)
        self.assertTrue(any("sitemap.xml" in e and "missing file" in e for e in errors), errors)

    def test_dataview_requires_static_output_only_for_opted_in_pages(self):
        query = "task\nwhere file.path = this.file.path and !completed\n"
        source = "---\ndataview_static: true\n---\n```dataview\n" + query + "```\n"
        (self.docs / "index.md").write_text(source, encoding="utf-8")
        self.write("index.html", f'<link rel="canonical" href="{BASE}"><pre><code>{query}</code></pre>')
        errors = self.check()
        self.assertTrue(any("Dataview static output count" in e for e in errors), errors)
        self.write("index.html", f'<link rel="canonical" href="{BASE}"><div class="garden-dataview" data-dataview-static="incomplete-tasks"><ul><li>word</li></ul></div>')
        self.assertEqual(self.check(), [])
        (self.docs / "index.md").write_text(source.replace("dataview_static: true", "dataview_static: false"), encoding="utf-8")
        self.write("index.html", f'<link rel="canonical" href="{BASE}"><pre><code>{query}</code></pre>')
        self.assertEqual(self.check(), [])

    def test_opted_in_dataview_tutorial_and_comments_are_not_active_queries(self):
        query = "```dataview\ntask\nwhere file.path = this.file.path and !completed\n```\n"
        source = "---\ndataview_static: true\n---\n````markdown\n" + query + "````\n\n<!--\n" + query + "-->\n"
        (self.docs / "index.md").write_text(source, encoding="utf-8")
        self.write("index.html", f'<link rel="canonical" href="{BASE}"><pre><code>{query}</code></pre>')
        self.assertEqual(self.check(), [])

    def test_explicit_published_status_takes_priority_over_draft_flag(self):
        (self.docs / "index.md").write_text("---\nstatus: published\ndraft: true\n---\nHome", encoding="utf-8")
        self.assertEqual(self.check(), [])

    def test_cli_uses_config_as_data_and_returns_nonzero_for_broken_build(self):
        config = self.root / "mkdocs.yml"
        config.write_text(f"site_url: {BASE}\nsite_dir: !ENV [SECRET_NAME, site]\nmarkdown_extensions:\n  - dummy: !!python/name:module.that.must.not.be.imported\n", encoding="utf-8")
        argv = ["--config", str(config), "--site-dir", str(self.site)]
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main(argv), 0)
            self.search(["#missing"])
            self.assertEqual(main(argv), 1)


if __name__ == "__main__":
    unittest.main()
