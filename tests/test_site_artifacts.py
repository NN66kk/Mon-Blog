from contextlib import redirect_stderr, redirect_stdout
from html import escape
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

    def rss_fixture(self, *, status="published", date="2026-01-02", link=None, pub_date="Fri, 02 Jan 2026 00:00:00 +0800"):
        (self.docs / "B-Notes").mkdir(exist_ok=True)
        (self.docs / "B-Notes/note.md").write_text(f"---\nstatus: {status}\ndate: '{date}'\n---\n# Note", encoding="utf-8")
        discovery = '<link rel="alternate" type="application/rss+xml" href="' + BASE + 'feed.xml">'
        self.write("index.html", f'<link rel="canonical" href="{BASE}">{discovery}<h1>Home</h1>')
        body = '<p>First paragraph.</p><p>Final paragraph.</p>'
        self.write("B-Notes/note/index.html", f'<link rel="canonical" href="{BASE}B-Notes/note/">{discovery}<h1>Note</h1><div data-post-body>{body}</div>')
        link = link or BASE + "B-Notes/note/"
        self.write("feed.xml", f'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Blog</title><description>Notes</description><link>{BASE}</link><atom:link href="{BASE}feed.xml" rel="self"/><item><title>Note</title><link>{link}</link><guid>{link}</guid><pubDate>{pub_date}</pubDate><description>{escape(body)}</description></item></channel></rss>')
        return {"extra": {"rss_feed": "feed.xml", "collections": {"B": {"source_dir": "B-Notes", "index_src": "B-Notes/index.md"}}}}

    def test_rss_matches_source_dates_and_site_base(self):
        self.assertEqual(self.check(self.rss_fixture()), [])

    def test_rss_omits_website_heading_controls_without_losing_heading_text(self):
        config = self.rss_fixture()
        plain_heading = '<h2 id="section">Section</h2>'
        web_heading = '<h2 id="section">Section<a class="headerlink" href="#section">¶</a></h2>'
        article = self.site / 'B-Notes/note/index.html'
        article.write_text(article.read_text().replace('<p>Final paragraph.</p>', web_heading + '<p>Final paragraph.</p>'))
        feed = self.site / 'feed.xml'
        feed.write_text(feed.read_text().replace(escape('<p>Final paragraph.</p>'),
                                               escape(plain_heading + '<p>Final paragraph.</p>')))
        self.assertEqual(self.check(config), [])
        feed.write_text(feed.read_text().replace(escape(plain_heading), escape(web_heading)))
        self.assertTrue(any('heading permalink controls' in e for e in self.check(config)))

    def test_rss_rejects_summary_only_and_relative_body_resources(self):
        config = self.rss_fixture()
        path = self.site / "feed.xml"
        path.write_text(path.read_text().replace(escape('<p>Final paragraph.</p>'), ""))
        self.assertTrue(any("complete article text" in e for e in self.check(config)))
        config = self.rss_fixture()
        path.write_text(path.read_text().replace(escape('<p>Final paragraph.</p>'),
                                               escape('<p>Final paragraph.</p><img src="../image.png">')))
        self.assertTrue(any("non-absolute" in e for e in self.check(config)))

    def test_rss_rejects_missing_article_images(self):
        config = self.rss_fixture()
        page = self.site / "B-Notes/note/index.html"
        page.write_text(page.read_text().replace('</div>', '<img src="https://images.example.test/photo.png"></div>'))
        self.assertTrue(any("missing article images" in e for e in self.check(config)))

    def test_rss_accepts_publisher_millisecond_timestamps_at_second_precision(self):
        config = self.rss_fixture(date="2026-10-22T01:02:03.456Z", pub_date="Thu, 22 Oct 2026 01:02:03 +0000")
        self.assertEqual(self.check(config), [])

    def test_rss_rejects_unlisted_and_undated_articles(self):
        for status, date in (("hidden", "2026-01-02"), ("published", "unknown")):
            errors = self.check(self.rss_fixture(status=status, date=date))
            self.assertTrue(any("undated or non-article" in e for e in errors), errors)

    def test_rss_rejects_wrong_publication_dates_and_missing_articles(self):
        errors = self.check(self.rss_fixture(pub_date="Sat, 03 Jan 2026 00:00:00 +0800"))
        self.assertTrue(any("differs from the source" in e for e in errors), errors)
        config = self.rss_fixture()
        feed = self.site / "feed.xml"
        source = feed.read_text()
        feed.write_text(source[:source.index("<item>")] + "</channel></rss>")
        self.assertTrue(any("missing from RSS" in e for e in self.check(config)))

    def test_rss_requires_discovery_and_real_item_destination(self):
        errors = self.check(self.rss_fixture(link="https://example.test/B-Notes/note/"))
        self.assertTrue(any("outside site base" in e for e in errors), errors)
        config = self.rss_fixture()
        self.write("index.html", f'<link rel="canonical" href="{BASE}">')
        self.assertTrue(any("RSS discovery" in e for e in self.check(config)))


if __name__ == "__main__":
    unittest.main()
