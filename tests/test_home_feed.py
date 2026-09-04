from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import importlib.util
import re
import unittest

from jinja2 import ChoiceLoader, DictLoader, Environment, FileSystemLoader


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "post_metadata", ROOT / "hooks/post_metadata.py"
)
POST_METADATA = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(POST_METADATA)


def make_page(name, **metadata):
    return SimpleNamespace(
        file=SimpleNamespace(src_uri=f"B-Notes/{name}.md"),
        url=f"B-Notes/{name}/",
        title=name,
        meta=metadata,
    )


def build_blog(pages, featured_post=""):
    with TemporaryDirectory() as docs_dir:
        config = {
            "docs_dir": docs_dir,
            "extra": {
                # A leftover setting must not pin or exclude any article.
                "featured_post": featured_post,
                "about_page": "B-Notes/about.md",
                "collections": {
                    "B": {
                        "mark": "技",
                        "label": "格物札记",
                        "description": "技术与学习笔记。",
                        "source_dir": "B-Notes",
                        "index": "B-Notes/index/",
                        "index_src": "B-Notes/index.md",
                    }
                },
            },
        }
        nav = SimpleNamespace(pages=pages)
        POST_METADATA.on_nav(nav, config, files=[])
    return nav.blog


def render_home(blog):
    environment = Environment(
        loader=ChoiceLoader(
            [
                DictLoader({"main.html": "{% block content %}{% endblock %}"}),
                FileSystemLoader(ROOT / "docs/templates"),
            ]
        )
    )
    environment.filters["url"] = lambda value: value
    return environment.get_template("home.html").render(
        blog=blog, config={"extra": {"about_url": "about/"}}
    )


def article_links(html):
    return re.findall(r'<article class="recent-note">\s*<a href="([^"]+)">', html)


class HomeFeedTests(unittest.TestCase):
    def test_home_renders_latest_ten_public_articles_in_publish_order(self):
        for former_featured in ("B-Notes/note-05.md", "B-Notes/note-14.md"):
            with self.subTest(former_featured=former_featured):
                pages = [
                    make_page(
                        f"note-{day:02d}",
                        date=f"2026-08-{day:02d}T12:00:00+08:00",
                    )
                    for day in (7, 14, 5, 11, 8, 13, 6, 12, 9, 10)
                ]
                pages.append(make_page("undated"))
                pages.extend(
                    make_page(status, status=status, date="2026-09-01")
                    for status in ("draft", "private", "hidden", "redirect")
                )
                pages.extend(
                    [
                        make_page("flagged-draft", draft=True),
                        make_page("index", date="2026-09-01"),
                        make_page("about", date="2026-09-01"),
                    ]
                )

                blog = build_blog(pages, former_featured)
                html = render_home(blog)
                expected_public = [
                    f"B-Notes/note-{day:02d}/" for day in range(14, 4, -1)
                ] + ["B-Notes/undated/"]

                self.assertEqual(article_links(html), expected_public[:10])
                self.assertEqual(
                    [page.url for page in blog["posts"]], expected_public
                )
                self.assertEqual(blog["count"], len(expected_public))
                self.assertGreater(len(expected_public), 10)
                self.assertNotIn("featured", blog)
                self.assertNotIn("featured-note", html)
                self.assertNotIn("编辑推荐", html)

    def test_sorting_uses_publish_time_instead_of_update_time(self):
        newest = make_page("newest", date="2026-08-14T18:50:45+08:00")
        morning = make_page("morning", published_at="2026-08-05T09:52:51+08:00")
        earlier = make_page("earlier", date="2026-08-05T09:28:46+08:00")
        updated = make_page("updated", cdate="2026-08-01", date="2026-09-04")
        filename_date = make_page("260715215301")
        pages = [updated, filename_date, morning, earlier, newest]

        html = render_home(build_blog(pages))

        self.assertEqual(
            article_links(html),
            [page.url for page in (newest, morning, earlier, updated, filename_date)],
        )

    def test_empty_home_has_no_recommendation_or_article(self):
        html = render_home(build_blog([]))

        self.assertEqual(article_links(html), [])
        self.assertNotIn("featured-note", html)


if __name__ == "__main__":
    unittest.main()
