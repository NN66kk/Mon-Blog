#!/usr/bin/env python3
"""Export the current public MkDocs inputs into a new, isolated Quartz trial.

No network, publishing, repository writes, or directory cleanup is performed.
Run with the project's Python environment. The output must be outside the repo.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from types import SimpleNamespace

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from hooks import dataview_static
from hooks.post_metadata import _read_front_matter, _status_from_metadata
from mkdocs.config import load_config
from mkdocs.structure.files import get_files

FRONT = re.compile(r"\A---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.S)
MEDIA = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".pdf", ".mp3", ".mp4", ".wav", ".webm", ".ogg"}


def adapt(source, path, metadata, config):
    """Small build-time bridge, not a general Obsidian or MkDocs converter."""
    match = FRONT.match(source)
    body = source[match.end():] if match else source
    data = dict(metadata)
    heading = re.search(r"^#\s+(.+)$", body, re.M)
    if not data.get("title") and heading:
        data["title"] = re.sub(r"\s*\{#[^}]+\}\s*$", "", heading[1])
    if not data.get("created"):
        for field in ("published_at", "cdate", "date"):
            if data.get(field):
                data["created"] = data[field]
                break
    if data.get("updated_at"):
        data["modified"] = data["updated_at"]
    if isinstance(data.get("tags"), str):
        data["tags"] = [tag.strip() for tag in re.split(r"[,，\s]+", data["tags"]) if tag.strip()]
    if _status_from_metadata(data) in {"hidden", "redirect"}:
        data["unlisted"] = True
    page = SimpleNamespace(file=SimpleNamespace(src_uri=path), meta=data)
    converted = dataview_static.on_page_markdown(body, page, config, [])
    # Quartz/remark does not implement Python Markdown's markdown="1" blocks.
    converted = re.sub(
        r'<div class="garden-dataview" data-dataview-static="incomplete-tasks" markdown="1">\n(.*?)\n</div>',
        r'<!-- mon-blog: static same-page Dataview -->\n\1', converted, flags=re.S,
    )
    return "---\n" + yaml.safe_dump(data, allow_unicode=True, sort_keys=False) + "---\n" + converted


def prepare(output, quartz, variant):
    output = Path(output).resolve()
    quartz = Path(quartz).resolve()
    if output.is_relative_to(ROOT) or ROOT.is_relative_to(output):
        raise ValueError("Experiment output must be outside the repository")
    if output.exists():
        raise ValueError("Output already exists; use a fresh directory (nothing is deleted)")
    config = load_config(config_file=str(ROOT / "mkdocs.yml"))
    candidates = get_files(config)
    selected = []
    excluded = []
    for file in candidates:
        if not file.is_documentation_page():
            continue
        path = Path(file.abs_src_path)
        metadata = _read_front_matter(path)
        status = _status_from_metadata(metadata)
        reason = "mkdocs-exclude_docs" if not file.inclusion.is_included() else "non-public-status" if status in {"draft", "private"} else None
        if reason:
            excluded.append({"path": file.src_uri, "reason": reason, "status": status})
        else:
            selected.append((file, metadata))
    output.mkdir(parents=True)
    content = output / "content"
    content.mkdir()
    manifest = {"variant": variant, "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "quartz_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=quartz, text=True).strip(),
                "published_inputs": [], "excluded": excluded, "assets": []}
    for file, metadata in selected:
        path = Path(file.abs_src_path)
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT / "docs"):
            raise ValueError(f"Unexpected source path: {file.src_uri}")
        source = path.read_text(encoding="utf-8")
        target = content / file.src_uri
        target.parent.mkdir(parents=True, exist_ok=True)
        if variant == "raw":
            shutil.copy2(path, target)
        else:
            target.write_text(adapt(source, file.src_uri, metadata, config), encoding="utf-8")
        manifest["published_inputs"].append({"path": file.src_uri, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                             "status": _status_from_metadata(metadata),
                                             "dataview_static": dataview_static.enabled_for_page(file.src_uri, metadata, config),
                                             "template": metadata.get("template")})
    for file in candidates:
        path = Path(file.abs_src_path)
        if not file.inclusion.is_included() or path.suffix.lower() not in MEDIA:
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT / "docs"):
            raise ValueError(f"Unexpected asset path: {file.src_uri}")
        target = content / file.src_uri
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        manifest["assets"].append(file.src_uri)
    quartz_config = yaml.safe_load((quartz / "quartz.config.default.yaml").read_text())
    settings = quartz_config["configuration"]
    settings.update({"pageTitle": "Mon 的数字花园 · Quartz 本机实验", "analytics": None, "locale": "zh-CN", "baseUrl": "nn66kk.github.io/Mon-Blog"})
    settings["theme"]["fontOrigin"] = "local"
    settings["theme"]["cdnCaching"] = False
    disabled = {"og-image", "cname", "quartz-fonts", "core", "encrypted-pages", "stacked-pages", "canvas-page", "bases-page"}
    for plugin in quartz_config["plugins"]:
        name = plugin["source"].split("/")[-1]
        if name in disabled:
            plugin["enabled"] = False
        if name == "created-modified-date":
            plugin.setdefault("options", {})["priority"] = ["frontmatter", "filesystem"]
        if name == "hard-line-breaks":
            plugin["enabled"] = True
    (output / "quartz.config.yaml").write_text(yaml.safe_dump(quartz_config, allow_unicode=True, sort_keys=False), encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"output": str(output), "variant": variant, "markdown": len(selected), "assets": len(manifest["assets"]),
                      "excluded": dict(Counter(item["reason"] for item in excluded)), "quartz_commit": manifest["quartz_commit"]}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--quartz", required=True, type=Path)
    parser.add_argument("--variant", choices=["raw", "adapted"], default="raw")
    args = parser.parse_args()
    prepare(args.output, args.quartz, args.variant)
