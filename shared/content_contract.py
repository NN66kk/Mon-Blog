"""Renderer-independent content rules; JSON is the only editable source."""
from __future__ import annotations

import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def load_contract(path: Path = ROOT / "shared/blog.json") -> dict:
    contract = json.loads(path.read_text(encoding="utf-8"))
    extra = contract["extra"]
    rules = extra["content_rules"]
    if rules["schema_version"] != 1:
        raise ValueError("Unsupported content contract version")
    site = urlsplit(contract["site_url"])
    if site.scheme not in {"http", "https"} or not site.netloc or site.query or site.fragment or not site.path.endswith("/"):
        raise ValueError("site_url must be an absolute URL ending in /")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", contract["repo_name"]):
        raise ValueError("repo_name must be owner/repository")
    collections = extra["collections"]
    if not collections or set(extra["collection_order"]) != set(collections) or len(extra["collection_order"]) != len(collections):
        raise ValueError("collection_order must list every collection once")
    source_dirs = []
    for collection in collections.values():
        source = collection["source_dir"]
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", source):
            raise ValueError("Collection source_dir must be a single safe folder")
        source_dirs.append(source)
        if not collection["index_src"].startswith(source + "/"):
            raise ValueError("Collection index must belong to its source folder")
    if len(set(source_dirs)) != len(source_dirs):
        raise ValueError("Collection folders must be unique")
    for path in contract["exclude_docs"].splitlines():
        if not path or any(part in {"", ".", ".."} for part in path.split("/")) or re.search(r"[\\*?\[\]#\x00-\x1f]", path):
            raise ValueError("Shared exclusions must be literal docs-relative files or folders")
    return contract


CONTRACT = load_contract()
RULES = CONTRACT["extra"]["content_rules"]
COLLECTION_IDS = tuple(CONTRACT["extra"]["collections"][key]["source_dir"] for key in CONTRACT["extra"]["collection_order"])


def valid_article_path(path: str) -> bool:
    """The same publish/preview boundary as publisher/lib/content.ts."""
    if not isinstance(path, str):
        return False
    parts = path.split("/")
    relative = path[5:]
    return (
        len(parts) >= 3 and parts[0] == "docs" and parts[1] in COLLECTION_IDS
        and path.endswith(".md")
        and not any(not part or part.startswith((".", "000000")) for part in parts)
        and not re.search(r"[\\\x00-\x1f?#]", path)
        and not any(
            (excluded in relative.split("/") if "/" not in excluded else relative == excluded or relative.startswith(excluded + "/"))
            for excluded in CONTRACT["exclude_docs"].splitlines()
        )
    )
