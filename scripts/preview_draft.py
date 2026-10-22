#!/usr/bin/env python3
"""Build a writing-room ZIP privately with the real MkDocs pipeline.

Run from a checkout with requirements.txt installed:
  python scripts/preview_draft.py ~/Downloads/mon-preview-<id>.zip

Only a temporary docs copy is changed. The source ZIP, repository and publication
state are untouched. Snapshots are retained in the printed temporary directory.
"""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import stat
import sys
import tempfile
from urllib.parse import urlsplit
import zipfile

import yaml

ROOT = Path(__file__).resolve().parents[1]
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_CONTENT = 128 * 1024 * 1024
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z")
MEDIA = re.compile(r"/api/media/([a-f0-9-]{36}\.(?:png|jpg|webp|gif))")
COLLECTIONS = {"A-Life", "B-Notes", "C-Highlights", "D-Orginals"}


def read_bundle(path: Path, draft_id: str | None = None):
    """Read bounded entries in memory; never extract paths from an archive."""
    if path.stat().st_size > MAX_ARCHIVE:
        raise ValueError("ZIP 超过 32 MB，请只导出当前草稿。")
    with zipfile.ZipFile(path) as archive:
        entries = {}
        total = 0
        for entry in archive.infolist():
            name = entry.filename
            parts = PurePosixPath(name).parts
            if (not name or name.startswith("/") or "\\" in name
                    or any(part in {".", ".."} for part in name.split("/"))
                    or any(ord(char) < 32 for char in name)
                    or stat.S_ISLNK(entry.external_attr >> 16)):
                raise ValueError("ZIP 包含无效文件路径。")
            if name in entries:
                raise ValueError("ZIP 包含重复文件路径。")
            if entry.is_dir():
                continue
            if not parts or len(entries) >= 5000:
                raise ValueError("ZIP 文件数量过多。")
            total += entry.file_size
            if total > MAX_CONTENT or entry.file_size > MAX_ARCHIVE:
                raise ValueError("ZIP 解压后的内容过大。")
            entries[name] = archive.read(entry)
    try:
        manifest = json.loads(entries["manifest.json"])
    except (KeyError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("未找到有效 manifest.json，请使用写作室导出的 ZIP。") from error
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise ValueError("暂不支持此备份版本。")
    drafts = manifest.get("drafts")
    if not isinstance(drafts, list) or not drafts:
        raise ValueError("备份中没有草稿。")
    if draft_id:
        drafts = [draft for draft in drafts if isinstance(draft, dict) and draft.get("id") == draft_id]
    if len(drafts) != 1:
        raise ValueError("请导出单篇草稿，或使用 --draft-id 指定其中一篇。")
    draft = drafts[0]
    if (not isinstance(draft, dict) or not isinstance(draft.get("id"), str)
            or not UUID.fullmatch(draft["id"])
            or any(not isinstance(draft.get(field), str) for field in ("title", "body", "metadata"))):
        raise ValueError("草稿字段无效。")
    if len(draft["body"]) > 2 * 1024 * 1024 or len(draft["metadata"]) > 128 * 1024:
        raise ValueError("草稿内容过大。")
    images = {}
    for name in set(MEDIA.findall(draft["body"])):
        if f"assets/{name}" not in entries:
            raise ValueError(f"预览包缺少私有图片 {name}，请重新导出。")
        images[name] = entries[f"assets/{name}"]
    return draft, images


def target_path(draft):
    source = draft.get("source_path")
    if source:
        if not isinstance(source, str) or not source.startswith("docs/"):
            raise ValueError("草稿原文路径无效。")
        target = source[5:]
    else:
        collection = draft.get("collection")
        if collection not in COLLECTIONS:
            raise ValueError("草稿栏目无效。")
        filename = draft.get("filename") or f"preview-{draft['id']}.md"
        if not isinstance(filename, str) or "/" in filename:
            raise ValueError("草稿文件名无效。")
        target = f"{collection}/{filename}"
    parts = target.split("/")
    if (parts[0] not in COLLECTIONS or len(parts) < 2 or not target.endswith(".md")
            or any(not part or part.startswith(".") or part.startswith("000000") for part in parts)
            or re.search(r"[\\\x00-\x1f?#]", target)):
        raise ValueError("草稿原文路径无效。")
    return PurePosixPath(target)


def copy_docs(source: Path, destination: Path):
    """Copy public content inputs, including .meta.yml, without secret files."""
    destination.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        if ((item.name.startswith(".") and item.name != ".meta.yml")
                or item.suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".env"}):
            continue
        if item.is_symlink():
            raise ValueError(f"docs 含符号链接，请先改为普通内容文件：{item.name}")
        target = destination / item.name
        if item.is_dir():
            copy_docs(item, target)
        elif item.is_file():
            shutil.copy2(item, target)


def prepare_snapshot(draft, images, root: Path, snapshot: Path):
    target = target_path(draft)
    metadata = yaml.safe_load(draft["metadata"]) if draft["metadata"].strip() else {}
    if not isinstance(metadata, dict):
        raise ValueError("文章信息必须是有效 YAML 对象。")
    metadata["title"] = draft["title"] or "未命名文章"
    # Make only the selected copy renderable; never enable all drafts globally.
    metadata["status"] = "published"
    metadata["draft"] = False
    if isinstance(metadata.get("tags"), str):
        metadata["tags"] = [tag.strip() for tag in re.split(r"[,，]", metadata["tags"]) if tag.strip()]
    docs = snapshot / "docs"
    copy_docs(root / "docs", docs)
    asset_dir = docs / "assets" / "_draft-preview" / draft["id"]
    if images:
        asset_dir.mkdir(parents=True, exist_ok=False)
        for name, content in images.items():
            (asset_dir / name).write_bytes(content)
    def image_target(match):
        return posixpath.relpath(
            f"assets/_draft-preview/{draft['id']}/{match[1]}", str(target.parent)
        )
    body = MEDIA.sub(image_target, draft["body"])
    article = docs / target
    article.parent.mkdir(parents=True, exist_ok=True)
    article.write_text(
        "---\n" + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False) + "---\n" + body,
        encoding="utf-8",
    )
    return docs, target


def build_preview(draft, images, root: Path, snapshot: Path, port: int):
    from mkdocs.commands.build import build
    from mkdocs.config import load_config
    from mkdocs.structure.files import File

    try:
        from scripts.check_site import SiteCheck
    except ModuleNotFoundError:
        from check_site import SiteCheck

    docs, target = prepare_snapshot(draft, images, root, snapshot)
    site = snapshot / "site"
    config = load_config(
        config_file=str(root / "mkdocs.yml"), docs_dir=str(docs),
        site_dir=str(site), strict=True,
    )
    base_path = urlsplit(config.site_url).path.rstrip("/") + "/"
    config.site_url = f"http://127.0.0.1:{port}{base_path}"
    # Use the copied templates so the result is a consistent content snapshot.
    config.theme["custom_dir"] = str(docs / "templates")
    config.theme.dirs = [
        str(docs / "templates") if Path(directory).resolve() == (root / "docs/templates").resolve() else directory
        for directory in config.theme.dirs
    ]
    previous = os.environ.pop("MON_BLOG_INCLUDE_DRAFTS", None)
    try:
        config.plugins.on_startup(command="build", dirty=False)
        try:
            build(config)
        finally:
            config.plugins.on_shutdown()
    finally:
        if previous is not None:
            os.environ["MON_BLOG_INCLUDE_DRAFTS"] = previous
    page = File(str(target), str(docs), str(site), config.use_directory_urls)
    if not Path(page.abs_dest_path).is_file():
        raise ValueError("草稿未生成页面，可能被项目 exclude_docs 排除。")
    checker = SiteCheck(site, config.site_url)
    errors = checker.run(docs, config)
    if errors:
        raise ValueError("预览产物检查未通过：\n" + "\n".join(errors[:20]))
    return site, base_path, config.site_url + page.url


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, base_path="/", **kwargs):
        self.base_path = base_path
        super().__init__(*args, **kwargs)

    def send_head(self):
        expected_host = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != expected_host:
            self.send_error(403, "This private preview is only available on its loopback URL")
            return None
        path = urlsplit(self.path).path
        if path == "/" and self.base_path != "/":
            self.send_response(302)
            self.send_header("Location", self.base_path)
            self.end_headers()
            return None
        if not path.startswith(self.base_path):
            self.send_error(404)
            return None
        return super().send_head()

    def translate_path(self, path):
        # Preserve the original request path for directory redirects while
        # mapping the configured project URL prefix to the build directory.
        return super().translate_path("/" + path[len(self.base_path):])

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("bundle", type=Path, help="写作室导出的含图片 ZIP")
    parser.add_argument("--draft-id", help="多篇备份中需要预览的草稿 ID")
    parser.add_argument("--port", type=int, default=8766, help="本机预览端口，默认 8766")
    parser.add_argument("--build-only", action="store_true", help="只构建并检查，不启动 HTTP 服务")
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("--port 必须在 1024 至 65535 之间")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s - %(message)s")
    snapshot = None
    try:
        draft, images = read_bundle(args.bundle, args.draft_id)
        snapshot = Path(tempfile.mkdtemp(prefix="mon-blog-draft-preview-"))
        site, base_path, url = build_preview(draft, images, ROOT, snapshot, args.port)
        print(f"私有预览构建完成：{url}", flush=True)
        print(f"临时副本保留在：{snapshot}", flush=True)
        print("这是导出时的快照；继续编辑后请重新导出并运行。外链图片和 CDN 脚本仍需联网。", flush=True)
        if args.build_only:
            return 0
        handler = partial(PreviewHandler, directory=str(site), base_path=base_path)
        with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
            print("仅接受本机访问；按 Ctrl+C 停止预览。", flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        print("\n预览已停止；临时副本仍保留。")
        return 0
    except Exception as error:
        print(f"预览未完成：{error}", file=sys.stderr)
        if snapshot:
            print(f"临时副本保留在：{snapshot}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
