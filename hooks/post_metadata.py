from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

FRONT_MATTER_RE = re.compile(r"\A---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.DOTALL)


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple, set)):
        parts = [_normalize_text(item) for item in value]
        return " ".join(part for part in parts if part).strip()
    return str(value).strip()


def _read_front_matter(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError:
        return {}

    match = FRONT_MATTER_RE.match(raw)
    if not match:
        return {}

    try:
        data = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return {}

    return data if isinstance(data, dict) else {}


def on_nav(nav, config, files):
    docs_dir = Path(str(config["docs_dir"]))

    for page in getattr(nav, "pages", []):
        file = getattr(page, "file", None)
        src_uri = getattr(file, "src_uri", "")
        if not src_uri:
            continue

        meta = getattr(page, "meta", None)
        if not isinstance(meta, dict):
            meta = {}
            page.meta = meta

        front_matter = _read_front_matter(docs_dir / src_uri)
        for key in ("description", "excerpt", "date", "title"):
            if key not in meta and key in front_matter:
                meta[key] = front_matter[key]

        page.blog_description_text = _normalize_text(
            meta.get("description") or front_matter.get("description")
        )
        page.blog_excerpt_text = _normalize_text(
            meta.get("excerpt") or front_matter.get("excerpt")
        )

    return nav
