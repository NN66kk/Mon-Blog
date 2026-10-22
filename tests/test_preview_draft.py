import io
import json
from pathlib import Path, PurePosixPath
import stat
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import zipfile

from scripts.preview_draft import (
    PreviewHandler, prepare_snapshot, read_bundle, target_path,
)


ID = "12345678-1234-1234-1234-123456789abc"
IMAGE = "87654321-4321-4321-4321-cba987654321.png"


class DraftPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.draft = {
            "id": ID, "title": "当前编辑标题", "collection": "B-Notes",
            "metadata": "status: private\ndraft: true\ntags: 数学，工具\n",
            "body": "# 当前编辑标题\n\n[[已有笔记]]\n\n![原图](../local.png)",
            "source_path": "docs/B-Notes/学习 笔记.md",
        }

    def bundle(self, drafts=None, entries=()):
        path = self.root / "preview.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("manifest.json", json.dumps({"version": 1, "drafts": drafts or [self.draft]}))
            for name, data in entries:
                archive.writestr(name, data)
        return path

    def test_manifest_retains_current_content_and_ignores_portable_markdown(self):
        draft, images = read_bundle(self.bundle(entries=[("drafts/anything.md", "stale")]))
        self.assertEqual(draft, self.draft)
        self.assertEqual(images, {})

    def test_selected_draft_is_required_for_multi_article_backups(self):
        second = {**self.draft, "id": "87654321-4321-4321-4321-cba987654321"}
        path = self.bundle([self.draft, second])
        with self.assertRaisesRegex(ValueError, "--draft-id"):
            read_bundle(path)
        self.assertEqual(read_bundle(path, second["id"])[0], second)

    def test_missing_private_media_fails_instead_of_showing_broken_image(self):
        self.draft["body"] += f"\n![上传图](/api/media/{IMAGE})"
        with self.assertRaisesRegex(ValueError, "缺少私有图片"):
            read_bundle(self.bundle())
        draft, images = read_bundle(self.bundle(entries=[(f"assets/{IMAGE}", b"png-data")]))
        self.assertEqual(images, {IMAGE: b"png-data"})
        self.assertIn("/api/media/", draft["body"])

    def test_archive_paths_never_escape_and_symlinks_are_rejected(self):
        for name in ("../escape", "/absolute", "a\\b", "assets/./x"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "路径"):
                read_bundle(self.bundle(entries=[(name, "bad")]))
        info = zipfile.ZipInfo("assets/link")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaisesRegex(ValueError, "路径"):
            read_bundle(self.bundle(entries=[(info, "../outside")]))

    def test_path_validation_and_new_draft_fallback(self):
        self.assertEqual(target_path(self.draft), PurePosixPath("B-Notes/学习 笔记.md"))
        new = {**self.draft, "source_path": None}
        self.assertEqual(target_path(new), PurePosixPath(f"B-Notes/preview-{ID}.md"))
        self.assertEqual(target_path({**new, "filename": "261022123456.md"}), PurePosixPath("B-Notes/261022123456.md"))
        for path in ("../outside.md", "docs/B-Notes/../bad.md", "docs/B-Notes/.hidden.md", "docs/B-Notes/000000目录.md", "docs/assets/bad.md"):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "路径"):
                target_path({**self.draft, "source_path": path})

    def test_snapshot_changes_only_selected_copy_and_resolves_private_images_locally(self):
        docs = self.root / "repo/docs"
        (docs / "B-Notes").mkdir(parents=True)
        original = docs / "B-Notes/学习 笔记.md"
        original.write_text("original private source", encoding="utf-8")
        (docs / "B-Notes/.meta.yml").write_text("template: post.html", encoding="utf-8")
        (docs / ".hidden-cache").write_text("not content", encoding="utf-8")
        (docs / "local.png").write_bytes(b"existing-image")
        self.draft["body"] += f"\n![上传图](/api/media/{IMAGE})"
        snapshot = self.root / "snapshot"
        copied, target = prepare_snapshot(self.draft, {IMAGE: b"new-image"}, self.root / "repo", snapshot)
        content = (copied / target).read_text(encoding="utf-8")
        self.assertEqual(original.read_text(), "original private source")
        self.assertEqual(self.draft["metadata"], "status: private\ndraft: true\ntags: 数学，工具\n")
        self.assertIn("status: published", content)
        self.assertIn("draft: false", content)
        self.assertIn("[[已有笔记]]", content)
        self.assertIn("(../local.png)", content)
        self.assertIn(f"(../assets/_draft-preview/{ID}/{IMAGE})", content)
        self.assertEqual((copied / f"assets/_draft-preview/{ID}/{IMAGE}").read_bytes(), b"new-image")
        self.assertTrue((copied / "B-Notes/.meta.yml").exists())
        self.assertFalse((copied / ".hidden-cache").exists())

    def test_preview_server_rejects_foreign_hosts_and_serves_only_base_path(self):
        handler = PreviewHandler.__new__(PreviewHandler)
        handler.server = SimpleNamespace(server_port=8766)
        handler.headers = {"Host": "foreign.example:8766"}
        handler.path = "/Mon-Blog/article/"
        handler.base_path = "/Mon-Blog/"
        handler.send_error = Mock()
        self.assertIsNone(handler.send_head())
        self.assertEqual(handler.send_error.call_args.args[0], 403)
        handler.headers = {"Host": "127.0.0.1:8766"}
        with patch("http.server.SimpleHTTPRequestHandler.send_head", return_value=io.BytesIO(b"page")) as parent:
            self.assertEqual(handler.send_head().read(), b"page")
            self.assertEqual(handler.path, "/Mon-Blog/article/")
            parent.assert_called_once()
        handler.directory = str(self.root)
        self.assertEqual(handler.translate_path(handler.path), str(self.root / "article") + "/")
        handler.path = "/outside/"
        self.assertIsNone(handler.send_head())
        self.assertEqual(handler.send_error.call_args.args[0], 404)


if __name__ == "__main__":
    unittest.main()
