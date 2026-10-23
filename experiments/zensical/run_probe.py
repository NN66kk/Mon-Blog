#!/usr/bin/env python3
"""Isolated compatibility experiment; never edits source, installs, or deploys.

Run with the repository's MkDocs Python and a separately installed Zensical CLI.
All input snapshots, builds and logs go into a newly created temporary directory.
"""
from __future__ import annotations

import argparse
import hashlib
from html import escape
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import quote, unquote, urljoin, urlsplit
from xml.etree import ElementTree as ET

import yaml

ROOT = Path(__file__).resolve().parents[2]
FRONT = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|$)", re.S)
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def command(args, cwd, log):
    started = time.monotonic()
    with log.open("w") as output:
        result = subprocess.run(args, cwd=cwd, stdout=output, stderr=subprocess.STDOUT)
    clean = ANSI.sub("", log.read_text(errors="replace"))
    log.with_suffix(".plain.log").write_text(clean)
    return {"command": [str(x) for x in args], "exit_code": result.returncode,
            "seconds": round(time.monotonic() - started, 3), "log": str(log)}


def snapshot(ref, target):
    target.mkdir()
    # Explicit tracked content paths: no .git, credentials, .env or CI files.
    paths = ["docs", "hooks", "publisher/public/diagrams", "mkdocs.yml", "requirements.txt"]
    payload = subprocess.check_output(["git", "archive", ref, *paths], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(payload)) as archive:
        for member in archive:
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError("Unexpected archive path/type")
            if any(part.startswith(".") and part != ".meta.yml" for part in path.parts):
                continue
            destination = target / path
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.extractfile(member).read())
    config = target / "mkdocs.yml"
    raw = config.read_text().replace("site_dir: !ENV [MON_BLOG_SITE_DIR, site]", "site_dir: site")
    if "INHERIT:" in raw:
        raise ValueError("This probe targets the standalone phase-two config; use --ref 1bd6101")
    config.write_text(raw.replace("  name: material\n", "  name: material\n  variant: classic\n"))
    for status in ("draft", "private", "hidden"):
        (target / "docs/B-Notes" / f"zensical-probe-{status}.md").write_text(
            f"---\ntitle: Zensical {status} probe\nstatus: {status}\n"
            f"published_at: 2026-10-20T00:00:00+08:00\n---\n# Zensical {status} probe\n\n"
            f"ZENSICAL_{status.upper()}_SENTINEL_7612\n")


def standard_config(source, destination):
    # Read known configuration via MkDocs in the already installed baseline env.
    from mkdocs.config import load_config
    original = load_config(str(source / "mkdocs.yml"))
    extensions = []
    for name in original.markdown_extensions:
        options = original.mdx_configs.get(name, {})
        # The native theme owns its standard Mermaid renderer in this diagnostic.
        if name == "pymdownx.superfences":
            options = {}
        extensions.append({name: options} if options else name)
    result = {
        "site_name": original.site_name, "site_description": original.site_description,
        "site_url": original.site_url, "site_author": original.site_author,
        "docs_dir": "docs", "site_dir": "site",
        "theme": {"variant": "classic", "language": "zh", "font": False},
        "plugins": ["search", "meta"], "markdown_extensions": extensions,
        "exclude_docs": "superpowers\nB-Notes/003英语/总结.md\nD-Orginals/苹果电脑自动化脚本教程_2025070215169.md\n",
    }
    (destination / "mkdocs.yml").write_text(yaml.safe_dump(result, allow_unicode=True, sort_keys=False))
    return result


def remove_template(text):
    match = FRONT.match(text)
    if not match:
        return text
    meta = yaml.safe_load(match[1]) or {}
    if not isinstance(meta, dict):
        return text
    meta.pop("template", None)
    return "---\n" + yaml.safe_dump(meta, allow_unicode=True, sort_keys=False) + "---\n" + text[match.end():]


def prepare_stock(source, destination):
    destination.mkdir()
    for path in (source / "docs").rglob("*"):
        relative = path.relative_to(source / "docs")
        if relative.parts[0] == "templates" or not path.is_file():
            continue
        output = destination / "docs" / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        if path.name == ".meta.yml":
            meta = yaml.safe_load(path.read_text()) or {}
            meta.pop("template", None)
            output.write_text(yaml.safe_dump(meta, allow_unicode=True))
        elif path.suffix == ".md":
            output.write_text(remove_template(path.read_text(encoding="utf-8-sig")))
        else:
            shutil.copyfile(path, output)
    standard_config(source, destination)


def prepare_bridge(source, destination):
    """Proof of concept: run existing MkDocs input events as a preprocessing step.

    This deliberately retains a MkDocs dependency, but does not run its renderer.
    Zensical renders the transformed Markdown with its standard classic theme.
    """
    from mkdocs.config import load_config
    from mkdocs.structure.files import get_files, set_exclusions
    from mkdocs.structure.nav import get_navigation
    destination.mkdir()
    config = load_config(str(source / "mkdocs.yml"))
    config.plugins.on_startup(command="build", dirty=False)
    config = config.plugins.on_config(config)
    config.plugins.on_pre_build(config=config)
    files = get_files(config)
    files = config.plugins.on_files(files, config=config)
    set_exclusions(files, config)
    nav = config.plugins.on_nav(get_navigation(files, config), config=config, files=files)

    def article_link(page, source_uri):
        relative = posixpath.relpath(page.file.src_uri, posixpath.dirname(source_uri) or ".")
        title = page.meta.get("title") or page.title or Path(page.file.src_uri).stem
        return f"[{escape(str(title))}](<{relative}>)"

    for file in files:
        if not file.inclusion.is_included() or file.src_uri.startswith("templates/"):
            continue
        output = destination / "docs" / file.src_uri
        output.parent.mkdir(parents=True, exist_ok=True)
        if file.is_documentation_page():
            page = file.page
            if page is None:
                continue
            page.read_source(config)
            body = config.plugins.on_page_markdown(page.markdown, page=page, config=config, files=files)
            meta = dict(page.meta)
            meta.pop("template", None)
            meta["description"] = getattr(page, "blog_description_text", "")
            if getattr(page, "blog_series", None):
                series = page.blog_series
                links = [f"\n\n**系列：{escape(series['name'])}**\n"]
                if page.blog_series_previous:
                    links.append("\n上一篇：" + article_link(page.blog_series_previous, file.src_uri) + "\n")
                if page.blog_series_next:
                    links.append("\n下一篇：" + article_link(page.blog_series_next, file.src_uri) + "\n")
                for member in series["posts"]:
                    links.append("- " + article_link(member, file.src_uri) + "\n")
                body += "".join(links)
            output.write_text("---\n" + yaml.safe_dump(meta, allow_unicode=True, sort_keys=False) + "---\n" + body)
        elif file.src_uri.endswith(".meta.yml"):
            meta = yaml.safe_load(Path(file.abs_src_path).read_text()) or {}
            meta.pop("template", None)
            output.write_text(yaml.safe_dump(meta, allow_unicode=True))
        else:
            shutil.copyfile(file.abs_src_path, output)
    topics = ["# 主题与系列\n\n[RSS 订阅](feed.xml)\n"]
    for key, title in (("topics", "主题"), ("series", "系列")):
        topics.append(f"\n## {title}\n")
        for group in nav.blog[key]:
            topics.append(f"\n### {escape(group['name'])} {{#{group['id']}}}\n")
            topics.extend("- " + article_link(page, "topics.md") + "\n" for page in group["posts"])
    (destination / "docs/topics.md").write_text("".join(topics))
    output_config = standard_config(source, destination)
    overrides = destination / "overrides"
    overrides.mkdir()
    (overrides / "main.html").write_text(
        '{% extends "base.html" %}\n{% block extrahead %}{{ super() }}'
        '<link rel="alternate" type="application/rss+xml" title="RSS" href="{{ \'feed.xml\'|url }}">'
        '{% endblock %}\n')
    output_config["theme"]["custom_dir"] = "overrides"
    (destination / "mkdocs.yml").write_text(yaml.safe_dump(output_config, allow_unicode=True, sort_keys=False))
    rss_writer = next(callback for callback in config.plugins.events["post_build"]
                      if callback.__module__ == "hooks/post_metadata.py")
    return config, rss_writer, {"topics": len(nav.blog["topics"]), "series": len(nav.blog["series"])}


def inspect(site):
    pages = {p.relative_to(site).as_posix(): p.read_text(errors="replace") for p in site.rglob("*.html")}
    articles = {p for p in pages if p.startswith(("A-Life/", "B-Notes/", "C-Highlights/", "D-Orginals/"))
                and "zensical-probe-" not in p}
    result = {"html_pages": len(pages), "article_paths": sorted(articles),
              "dataview_blocks": sum(text.count('data-dataview-static="incomplete-tasks"') for text in pages.values()),
              "sentinels": {status: any(f"ZENSICAL_{status.upper()}_SENTINEL_7612" in text for text in pages.values())
                            for status in ("draft", "private", "hidden")},
              "feed_exists": (site / "feed.xml").exists(),
              "search_files": [p.relative_to(site).as_posix() for p in site.rglob("*") if p.is_file() and "search" in p.name]}
    if result["feed_exists"]:
        feed = ET.parse(site / "feed.xml")
        result["rss_items"] = len(feed.findall("./channel/item"))
    math = next((text for path, text in pages.items() if "BM25算法_" in path), "")
    result["bm25_math_markers"] = math.count("arithmatex")
    result["raw_dataview_query_pages"] = sum("file.path = this.file.path" in text for text in pages.values())
    result["raw_wikilink_pages"] = sum(bool(re.search(r"(?<!!)\[\[[^\]]+\]\]", text)) for text in pages.values())
    result.update(inspect_references(site, pages))
    return result


class References(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.anchors = set()
        self.links = []
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get("id"):
            self.anchors.add(attrs["id"])
        for key in ("href", "src", "poster"):
            if attrs.get(key):
                self.links.append(attrs[key])


def inspect_references(site, pages):
    base = "https://nn66kk.github.io/Mon-Blog/"
    parsed = {path: References(html) for path, html in pages.items()}
    errors = set()

    def check(ref, current, source):
        url = urlsplit(urljoin(current, ref))
        if url.scheme not in {"http", "https"} or url.netloc != "nn66kk.github.io":
            return
        path = unquote(url.path)
        if not path.startswith("/Mon-Blog/"):
            errors.add(f"{source}: outside base path: {ref}")
            return
        relative = path[len("/Mon-Blog/"):]
        if not relative or relative.endswith("/"):
            relative += "index.html"
        destination = site / relative
        if not destination.is_file():
            errors.add(f"{source}: missing {relative}")
        fragment = unquote(url.fragment).split(":~:text=", 1)[0]
        if fragment and relative in parsed and fragment not in parsed[relative].anchors:
            errors.add(f"{source}: missing #{fragment} in {relative}")

    for path, page in parsed.items():
        current = urljoin(base, quote(path[:-10] if path.endswith("index.html") else path))
        for reference in page.links:
            check(reference, current, path)
    search = site / "search.json"
    if not search.exists():
        search = site / "search/search_index.json"
    search_count = 0
    search_sentinels = {}
    if search.exists():
        data = json.loads(search.read_text())
        items = data.get("items", data.get("docs", []))
        search_count = len(items)
        for item in items:
            check(item.get("location", ""), base, "search")
        text = search.read_text()
        search_sentinels = {status: f"ZENSICAL_{status.upper()}_SENTINEL_7612" in text
                            for status in ("draft", "private", "hidden")}
    return {"reference_errors": sorted(errors), "search_entries": search_count,
            "search_sentinels": search_sentinels}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="1bd6101", help="frozen phase-two baseline commit")
    parser.add_argument("--zensical", type=Path, required=True, help="isolated zensical 0.0.71 executable")
    parser.add_argument("--temp-parent", type=Path, default=Path(tempfile.gettempdir()))
    args = parser.parse_args()
    version = subprocess.check_output([args.zensical, "--version"], text=True).strip()
    if version != "0.0.71":
        raise ValueError(f"This recorded experiment requires Zensical 0.0.71, got {version}")
    run = Path(tempfile.mkdtemp(prefix="mon-blog-zensical-probe-", dir=args.temp_parent))
    print(f"Experiment: {run}", flush=True)
    source = run / "direct"
    snapshot(args.ref, source)
    report = {"source_commit": subprocess.check_output(["git", "rev-parse", args.ref], cwd=ROOT, text=True).strip(),
              "zensical": version, "python": sys.version, "root": str(run), "runs": {}}
    report["runs"]["baseline"] = command([sys.executable, "-m", "mkdocs", "build", "--strict", "-f", source / "mkdocs.yml",
                                           "--site-dir", run / "baseline-site"], source, run / "baseline.log")
    report["runs"]["direct"] = command([args.zensical, "build", "--strict", "-f", source / "mkdocs.yml"], source, run / "direct.log")
    stock = run / "stock"
    prepare_stock(source, stock)
    report["runs"]["stock_strict"] = command([args.zensical, "build", "--strict", "-f", stock / "mkdocs.yml"], stock, run / "stock-strict.log")
    # Non-strict diagnostic output is deliberately separate from a passing check.
    report["runs"]["stock_diagnostic"] = command([args.zensical, "build", "-f", stock / "mkdocs.yml"], stock, run / "stock-diagnostic.log")
    bridge = run / "bridge"
    config, rss_writer, model = prepare_bridge(source, bridge)
    report["runs"]["bridge"] = command([args.zensical, "build", "--strict", "-f", bridge / "mkdocs.yml"], bridge, run / "bridge.log")
    if report["runs"]["bridge"]["exit_code"] == 0:
        config.site_dir = str(bridge / "site")
        rss_writer(config)
    report["bridge_model"] = model
    report["artifacts"] = {name: inspect(site) for name, site in (
        ("baseline", run / "baseline-site"), ("direct", source / "site"),
        ("stock", stock / "site"), ("bridge", bridge / "site"))}
    expected = set(report["artifacts"]["baseline"]["article_paths"])
    for data in report["artifacts"].values():
        paths = set(data.pop("article_paths"))
        data["article_path_count"] = len(paths)
        data["missing_article_paths"] = sorted(expected - paths)
        data["extra_article_paths"] = sorted(paths - expected)
    baseline_assets = {p.relative_to(run / "baseline-site").as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in (run / "baseline-site/assets").rglob("*") if p.is_file()}
    bridge_assets = {p.relative_to(bridge / "site").as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in (bridge / "site/assets").rglob("*") if p.is_file()}
    source_assets = [p.relative_to(source / "docs").as_posix() for p in (source / "docs/assets").rglob("*") if p.is_file()]
    report["bridge_assets"] = {"source_asset_count": len(source_assets),
                               "missing_or_changed": [p for p in source_assets if baseline_assets.get(p) != bridge_assets.get(p)]}
    (run / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
