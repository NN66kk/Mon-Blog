from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import importlib.util
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "post_metadata", ROOT / "hooks/post_metadata.py"
)
POST_METADATA = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(POST_METADATA)


def blog_config(docs_dir):
    return {
        "docs_dir": str(docs_dir),
        "extra": {
            "featured_post": "B-Notes/没有日期的文章.md",
            "about_page": "about.md",
            "collection_order": ["B"],
            "collections": {
                "B": {
                    "mark": "技",
                    "label": "格物札记",
                    "description": "技术与学习笔记。",
                    "index": "B-Notes/000000学习笔记目录/",
                    "index_src": "B-Notes/000000学习笔记目录.md",
                    "source_dir": "B-Notes",
                    "legacy_tag": "学习笔记",
                }
            },
        },
    }


class PostMetadataTests(unittest.TestCase):
    def test_extracts_a_clean_description_from_markdown(self):
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "article.md"
            path.write_text(
                """---
tags: [AI, Obsidian]
---

# 标题不会进入摘要

![[missing-image.png]]

这是一段真正描述文章内容的文字，包含 [可读链接](https://example.com) 与 `行内代码`，足以作为页面摘要。

```python
print("code should not leak")
```
""",
                encoding="utf-8",
            )

            description = POST_METADATA._description_from_markdown(path)

        self.assertIn("真正描述文章内容", description)
        self.assertIn("可读链接", description)
        self.assertIn("行内代码", description)
        self.assertNotIn("标题不会进入摘要", description)
        self.assertNotIn("missing-image", description)
        self.assertNotIn("code should not leak", description)

    def test_on_nav_uses_cdate_and_populates_article_metadata(self):
        with TemporaryDirectory() as temp_dir:
            docs_dir = Path(temp_dir)
            article = docs_dir / "B-Notes" / "没有日期的文章.md"
            article.parent.mkdir(parents=True)
            article.write_text(
                """---
cdate: 2026-08-14 18:50:45
tags:
  - AI
  - 写作
---

# 没有日期的文章

这段正文会成为自动摘要，因此文章在搜索结果和社交分享中不再退回站点的通用描述。
""",
                encoding="utf-8",
            )
            page = SimpleNamespace(
                file=SimpleNamespace(src_uri="B-Notes/没有日期的文章.md"),
                meta={},
                title="没有日期的文章",
            )
            nav = SimpleNamespace(pages=[page])

            POST_METADATA.on_nav(nav, blog_config(docs_dir), files=[])
            # MkDocs reloads front matter after on_nav; the page-context hook
            # makes the generated description available to the base template.
            page.meta = {"tags": ["AI", "写作"]}
            POST_METADATA.on_page_context({}, page, {}, nav)

        self.assertEqual(page.blog_publish_key, "20260814185045")
        self.assertEqual(page.blog_publish_label, "2026-08-14 18:50")
        self.assertEqual(page.blog_tags_text, "AI 写作")
        self.assertIn("这段正文会成为自动摘要", page.blog_description_text)
        self.assertEqual(page.meta["description"], page.blog_description_text)
        self.assertTrue(page.blog_is_article)
        self.assertTrue(page.blog_is_listed)
        self.assertEqual(nav.blog["count"], 1)
        self.assertEqual(nav.blog["featured"], page)

    def test_compact_two_digit_year_remains_supported(self):
        publish = POST_METADATA._publish_parts_from_value("260814185045")
        self.assertEqual(publish[0], "20260814185045")
        self.assertEqual(publish[1], "2026-08-14 18:50")

    def test_generated_description_is_safe_inside_html_attributes(self):
        description = POST_METADATA._truncate_description(
            '"engage" 表示参与 & 连接，也可能出现在 <code> 中。'
        )

        self.assertEqual(description, "“engage” 表示参与 ＆ 连接，也可能出现在 ＜code＞ 中。")
        self.assertNotIn('"', description)

    def test_tag_lists_preserve_multiword_items_and_remove_collection_tag(self):
        tags = POST_METADATA._normalize_tags(["Claude Code", "学习笔记", "claude code"])

        self.assertEqual(tags, ["Claude Code", "学习笔记"])

    def test_draft_and_private_files_are_removed_before_build(self):
        with TemporaryDirectory() as temp_dir:
            docs_dir = Path(temp_dir)
            published = docs_dir / "B-Notes" / "published.md"
            draft = docs_dir / "B-Notes" / "draft.md"
            private = docs_dir / "B-Notes" / "private.md"
            published.parent.mkdir(parents=True)
            published.write_text("# Published\n", encoding="utf-8")
            draft.write_text("---\nstatus: draft\n---\n# Draft\n", encoding="utf-8")
            private.write_text("---\nstatus: private\n---\n# Private\n", encoding="utf-8")
            files = [
                SimpleNamespace(src_uri="B-Notes/published.md"),
                SimpleNamespace(src_uri="B-Notes/draft.md"),
                SimpleNamespace(src_uri="B-Notes/private.md"),
            ]

            POST_METADATA.on_files(files, {"docs_dir": str(docs_dir)})

        self.assertEqual([file.src_uri for file in files], ["B-Notes/published.md"])

    def test_redirect_is_not_treated_as_an_article(self):
        with TemporaryDirectory() as temp_dir:
            docs_dir = Path(temp_dir)
            legacy = docs_dir / "B-Notes" / "legacy.md"
            legacy.parent.mkdir(parents=True)
            legacy.write_text(
                "---\nstatus: redirect\ntitle: Legacy\n---\n# Legacy\n",
                encoding="utf-8",
            )
            page = SimpleNamespace(
                file=SimpleNamespace(src_uri="B-Notes/legacy.md"),
                meta={},
                title="Legacy",
            )
            nav = SimpleNamespace(pages=[page])

            POST_METADATA.on_nav(nav, blog_config(docs_dir), files=[])

        self.assertFalse(page.blog_is_article)
        self.assertFalse(page.blog_is_listed)
        self.assertEqual(page.blog_page_type, "redirect")
        self.assertEqual(nav.blog["posts"], [])

    def test_article_content_has_one_reserved_h1(self):
        page = SimpleNamespace(blog_is_article=True, blog_is_about=False)
        html = '<h1 id="title">Title</h1><p>Lead</p><h1 id="section">Section</h1>'

        content = POST_METADATA.on_page_content(html, page, {}, [])

        self.assertNotIn('<h1', content)
        self.assertIn('<h2 id="section">Section</h2>', content)

    def test_repeated_markdown_h1s_are_demoted_outside_code_fences(self):
        page = SimpleNamespace(blog_is_article=True, blog_is_about=False)
        markdown = "# Title\n\n# Section\n\n```md\n# Code sample\n```\n"

        content = POST_METADATA.on_page_markdown(markdown, page, {}, [])

        self.assertTrue(content.startswith("# Title\n\n## Section"))
        self.assertIn("```md\n# Code sample\n```", content)


if __name__ == "__main__":
    unittest.main()
