from email.utils import parsedate_to_datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from xml.etree import ElementTree as ET
import importlib.util
import unittest

from jinja2 import ChoiceLoader, DictLoader, Environment, FileSystemLoader
import yaml


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("discovery_metadata", ROOT / "hooks/post_metadata.py")
METADATA = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(METADATA)


def config_for(root):
    return {
        "docs_dir": str(root / "docs"), "site_dir": str(root / "site"),
        "site_url": "https://example.test/Mon-Blog/", "site_name": "Mon & Notes",
        "site_description": "A <garden> & notes",
        "extra": {
            "rss_feed": "feed.xml", "collection_order": ["B"],
            "collections": {"B": {
                "source_dir": "B-Notes", "index_src": "B-Notes/index.md",
                "index": "B-Notes/",
                "label": "Notes", "mark": "技", "legacy_tag": "学习笔记",
            }},
        },
    }


def make_page(config, name, **metadata):
    src = f"B-Notes/{name}.md"
    path = Path(config["docs_dir"]) / src
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("---\n" + yaml.safe_dump(metadata, allow_unicode=True)
                    + "---\n# Article\n\nThis is a useful article with enough content for an excerpt.\n",
                    encoding="utf-8")
    return SimpleNamespace(file=SimpleNamespace(src_uri=src), meta={},
                           title=metadata.get("title", name), url=f"B-Notes/{name}/")


def prepare(config, pages):
    nav = SimpleNamespace(pages=pages)
    METADATA.on_nav(nav, config, [])
    return nav


def read_feed(config):
    METADATA.on_post_build(config)
    return ET.parse(Path(config["site_dir"]) / "feed.xml").getroot()


class DiscoveryTests(unittest.TestCase):
    def test_feed_sorts_real_dates_encodes_urls_and_escapes_xml(self):
        with TemporaryDirectory() as directory:
            config = config_for(Path(directory))
            pages = [
                make_page(config, "old", published_at="2026-09-21T16:00:00Z"),
                make_page(config, "中文 & article", title="<b>New</b> & notes",
                          published_at="2026-09-22T01:30:00+08:00",
                          description="Read & understand <things>", tags=["AI & RAG"]),
            ]
            prepare(config, pages)
            rss = read_feed(config)
            items = rss.findall("channel/item")
            self.assertEqual([item.findtext("title") for item in items], ["New & notes", "old"])
            self.assertEqual(items[0].findtext("link"),
                             "https://example.test/Mon-Blog/B-Notes/%E4%B8%AD%E6%96%87%20%26%20article/")
            self.assertEqual(items[0].findtext("guid"), items[0].findtext("link"))
            self.assertEqual(items[0].findtext("category"), "AI & RAG")
            published = parsedate_to_datetime(items[0].findtext("pubDate"))
            self.assertEqual(published.isoformat(), "2026-09-22T01:30:00+08:00")
            self.assertEqual(rss.find("channel/{http://www.w3.org/2005/Atom}link").get("href"),
                             "https://example.test/Mon-Blog/feed.xml")
            raw = (Path(config["site_dir"]) / "feed.xml").read_text()
            self.assertIn("Mon &amp; Notes", raw)
            self.assertIn("AI &amp; RAG", raw)
            self.assertNotIn("<things>", raw)

    def test_private_hidden_draft_and_redirect_do_not_enter_discovery(self):
        with TemporaryDirectory() as directory:
            config = config_for(Path(directory))
            pages = [make_page(config, "public", date="2026-01-02", tags=["AI"], series="Public", series_order=1)]
            for status in ("private", "draft", "hidden", "redirect"):
                pages.append(make_page(config, status, status=status, date="2026-02-02",
                                       tags=["Secret"], series="Secret", series_order=1))
            pages.append(make_page(config, "draft-flag", draft=True, date="2026-02-02", tags=["Secret"]))
            nav = prepare(config, pages)
            rss = read_feed(config)
            self.assertEqual([p.title for p in nav.blog["posts"]], ["public"])
            self.assertEqual([t["name"] for t in nav.blog["topics"]], ["AI"])
            self.assertEqual([s["name"] for s in nav.blog["series"]], ["Public"])
            self.assertEqual([item.findtext("title") for item in rss.findall("channel/item")], ["public"])
            for page in pages[1:]:
                self.assertEqual(page.blog_topic_links, [])
                self.assertIsNone(page.blog_series)

    def test_undated_notes_remain_on_site_but_never_receive_a_feed_date(self):
        with TemporaryDirectory() as directory:
            config = config_for(Path(directory))
            pages = [make_page(config, "undated", tags=["AI"]),
                     make_page(config, "bad-date", date="not a date", tags=["AI"]),
                     make_page(config, "legacy_20251012115917", tags=["AI"])]
            nav = prepare(config, pages)
            rss = read_feed(config)
            self.assertEqual(len(nav.blog["topics"][0]["posts"]), 3)
            self.assertEqual(nav.blog["feed_count"], 1)
            self.assertEqual([item.findtext("title") for item in rss.findall("channel/item")],
                             ["legacy_20251012115917"])
            self.assertEqual(parsedate_to_datetime(rss.findtext("channel/lastBuildDate")).year, 2025)

    def test_feed_is_replaced_when_a_note_becomes_private_on_live_rebuild(self):
        with TemporaryDirectory() as directory:
            config = config_for(Path(directory))
            page = make_page(config, "public", date="2026-01-01")
            prepare(config, [page])
            self.assertEqual(len(read_feed(config).findall("channel/item")), 1)
            page = make_page(config, "public", status="private", date="2026-01-01")
            prepare(config, [page])
            rss = read_feed(config)
            self.assertEqual(rss.findall("channel/item"), [])
            self.assertIsNone(rss.find("channel/lastBuildDate"))

    def test_series_uses_explicit_order_and_omits_nonpublic_neighbors(self):
        with TemporaryDirectory() as directory:
            config = config_for(Path(directory))
            pages = [make_page(config, "third", series="Study", series_order=3),
                     make_page(config, "first", series="Study", series_order="1"),
                     make_page(config, "second", series="study", series_order=2),
                     make_page(config, "unordered", series="Study"),
                     make_page(config, "private", series="Study", series_order=2, status="private")]
            nav = prepare(config, pages)
            group = nav.blog["series"][0]
            self.assertEqual([p.title for p in group["posts"]], ["first", "second", "third", "unordered"])
            first, second, third, last = group["posts"]
            self.assertIsNone(first.blog_series_previous)
            self.assertIs(first.blog_series_next, second)
            self.assertIs(second.blog_series_previous, first)
            self.assertIs(second.blog_series_next, third)
            self.assertEqual(last.blog_series_position, 4)
            self.assertIsNone(last.blog_series_next)

    def test_ambiguous_series_order_warns_for_strict_build(self):
        with TemporaryDirectory() as directory:
            config = config_for(Path(directory))
            with self.assertLogs("mkdocs.plugins.post_metadata", "WARNING") as logs:
                prepare(config, [make_page(config, "one", series="Study", series_order=1),
                                 make_page(config, "duplicate", series="Study", series_order=1),
                                 make_page(config, "invalid", series="Study", series_order=True)])
            self.assertTrue(any("positive integer" in item for item in logs.output))
            self.assertTrue(any("duplicate series_order" in item for item in logs.output))

    def test_topics_reuse_casefolded_tags_and_related_links_require_shared_topic(self):
        with TemporaryDirectory() as directory:
            config = config_for(Path(directory))
            pages = [make_page(config, "one", tags=["AI", "学习笔记", "zettelkasten"]),
                     make_page(config, "two", tags=["ai"]),
                     make_page(config, "unrelated", tags=["English"])]
            nav = prepare(config, pages)
            self.assertEqual(len(nav.blog["topics"]), 2)
            self.assertEqual(len(nav.blog["topics"][0]["posts"]), 2)
            self.assertEqual(pages[0].blog_related_pages, [pages[1]])
            self.assertEqual(pages[2].blog_related_pages, [])
            self.assertEqual(METADATA._discovery_anchor("topic", "AI"),
                             METADATA._discovery_anchor("topic", "ai"))
            self.assertNotEqual(METADATA._discovery_anchor("topic", "AI"),
                                METADATA._discovery_anchor("series", "AI"))

    def test_discovery_templates_escape_names_and_preserve_article_links(self):
        with TemporaryDirectory() as directory:
            config = config_for(Path(directory))
            name = 'AI <img src=x onerror="alert(1)"> & notes'
            first = make_page(config, "first", tags=[name], series=name, series_order=1)
            second = make_page(config, "second", tags=[name], series=name, series_order=2)
            nav = prepare(config, [first, second])
            env = Environment(loader=ChoiceLoader([
                DictLoader({"main.html": "{% block content %}{% endblock %}"}),
                FileSystemLoader(ROOT / "docs/templates"),
            ]))
            env.filters["url"] = lambda value: "/Mon-Blog/" + value
            index = SimpleNamespace(blog_title_id="topics")
            rendered = env.get_template("topics.html").render(page=index, blog=nav.blog, config=config)
            self.assertIn("&lt;img", rendered)
            self.assertNotIn("<img", rendered)
            self.assertIn('href="/Mon-Blog/B-Notes/first/"', rendered)
            first.content = "<p>Body</p>"
            first.blog_title_id = "first"
            rendered = env.get_template("post.html").render(page=first, blog=nav.blog, config=config)
            self.assertIn('rel="next" href="/Mon-Blog/B-Notes/second/"', rendered)
            self.assertIn('href="/Mon-Blog/topics/#topic-', rendered)
            self.assertNotIn("<img src=x", rendered)

    def test_feed_requires_safe_site_and_output_urls(self):
        with TemporaryDirectory() as directory:
            config = config_for(Path(directory))
            config["extra"]["rss_feed"] = "../escape.xml"
            with self.assertRaises(ValueError):
                METADATA.on_post_build(config)
            config["extra"]["rss_feed"] = "feed.xml"
            config["site_url"] = "/Mon-Blog/"
            with self.assertRaises(ValueError):
                METADATA.on_post_build(config)
            config["extra"].pop("rss_feed")
            METADATA.on_post_build(config)
            self.assertFalse(Path(config["site_dir"]).exists())


if __name__ == "__main__":
    unittest.main()
