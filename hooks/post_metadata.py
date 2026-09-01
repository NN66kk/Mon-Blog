from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml

FRONT_MATTER_RE = re.compile(r"\A---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.DOTALL)
FENCED_CODE_RE = re.compile(r"^\s*(```|~~~).*?^\s*\1\s*$", re.MULTILINE | re.DOTALL)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
OBSIDIAN_EMBED_RE = re.compile(r"!\[\[[^\]]+\]\]")
OBSIDIAN_LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]")
MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
INLINE_CODE_RE = re.compile(r"`([^`]+)`")
HTML_TAG_RE = re.compile(r"<[^>]+>")
MARKDOWN_PREFIX_RE = re.compile(r"^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)")
TABLE_DIVIDER_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?\s*$")
TEMPLATE_RE = re.compile(r"<%.*?%>", re.DOTALL)


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


def _truncate_description(value: str, limit: int = 155) -> str:
    text = re.sub(r"\s+", " ", value).strip()
    text = text.translate(str.maketrans({"&": "＆", "<": "＜", ">": "＞"}))
    quote_open = True
    quote_safe: list[str] = []
    for character in text:
        if character == '"':
            quote_safe.append("“" if quote_open else "”")
            quote_open = not quote_open
        else:
            quote_safe.append(character)
    text = "".join(quote_safe)

    if len(text) <= limit:
        return text

    shortened = text[: limit - 1].rstrip(" ，,、；;：:")
    return f"{shortened}…"


def _description_from_markdown(path: Path, limit: int = 155) -> str:
    """Extract a stable, human-readable summary for search and social metadata."""

    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError:
        return ""

    raw = FRONT_MATTER_RE.sub("", raw, count=1)
    raw = FENCED_CODE_RE.sub("", raw)
    raw = HTML_COMMENT_RE.sub("", raw)
    raw = TEMPLATE_RE.sub("", raw)
    raw = OBSIDIAN_EMBED_RE.sub("", raw)
    raw = MARKDOWN_IMAGE_RE.sub(r"\1", raw)
    raw = OBSIDIAN_LINK_RE.sub(lambda match: match.group(2) or match.group(1), raw)
    raw = MARKDOWN_LINK_RE.sub(r"\1", raw)
    raw = INLINE_CODE_RE.sub(r"\1", raw)
    raw = HTML_TAG_RE.sub("", raw)

    paragraphs: list[str] = []
    current: list[str] = []

    def flush_current() -> None:
        if not current:
            return
        paragraph = re.sub(r"\s+", " ", " ".join(current)).strip()
        current.clear()
        if paragraph:
            paragraphs.append(paragraph)

    for raw_line in raw.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            flush_current()
            continue
        if stripped.startswith("#") or stripped in {"---", "***", "___"}:
            flush_current()
            continue
        if TABLE_DIVIDER_RE.match(stripped):
            continue

        line = MARKDOWN_PREFIX_RE.sub("", stripped)
        line = line.replace("|", " ")
        line = re.sub(r"[*_~=]+", "", line)
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            current.append(line)

    flush_current()

    for paragraph in paragraphs:
        if len(paragraph) >= 24:
            return _truncate_description(paragraph, limit)

    return _truncate_description(" ".join(paragraphs), limit)


def _is_plausible_year(year_text: str) -> bool:
    if len(year_text) != 4 or not year_text.isdigit():
        return False
    year_value = int(year_text)
    return 1900 <= year_value <= 2100


def _expand_two_digit_year(year_text: str) -> int:
    year_value = int(year_text)
    return 2000 + year_value if year_value < 70 else 1900 + year_value


def _publish_parts_from_datetime(value: date | datetime) -> tuple[str, str, str]:
    if isinstance(value, datetime):
        return (
            value.strftime("%Y%m%d%H%M%S"),
            value.strftime("%Y-%m-%d %H:%M"),
            value.isoformat(),
        )

    return (
        value.strftime("%Y%m%d") + "000000",
        value.strftime("%Y-%m-%d"),
        value.isoformat(),
    )


def _publish_parts_from_compact(compact: str) -> tuple[str, str, str] | None:
    if len(compact) >= 14 and _is_plausible_year(compact[:4]):
        try:
            parsed = datetime(
                int(compact[:4]),
                int(compact[4:6]),
                int(compact[6:8]),
                int(compact[8:10]),
                int(compact[10:12]),
                int(compact[12:14]),
            )
        except ValueError:
            return None
        return (
            parsed.strftime("%Y%m%d%H%M%S"),
            parsed.strftime("%Y-%m-%d %H:%M"),
            parsed.isoformat(),
        )

    if len(compact) >= 12 and _is_plausible_year(compact[:4]):
        try:
            parsed = datetime(
                int(compact[:4]),
                int(compact[4:6]),
                int(compact[6:8]),
                int(compact[8:10]),
                int(compact[10:12]),
            )
        except ValueError:
            return None
        return (
            parsed.strftime("%Y%m%d%H%M%S"),
            parsed.strftime("%Y-%m-%d %H:%M"),
            parsed.isoformat(),
        )

    if len(compact) >= 12:
        try:
            parsed = datetime(
                _expand_two_digit_year(compact[:2]),
                int(compact[2:4]),
                int(compact[4:6]),
                int(compact[6:8]),
                int(compact[8:10]),
                int(compact[10:12]),
            )
        except ValueError:
            return None
        return (
            parsed.strftime("%Y%m%d%H%M%S"),
            parsed.strftime("%Y-%m-%d %H:%M"),
            parsed.isoformat(),
        )

    if len(compact) >= 10:
        try:
            parsed = datetime(
                _expand_two_digit_year(compact[:2]),
                int(compact[2:4]),
                int(compact[4:6]),
                int(compact[6:8]),
                int(compact[8:10]),
            )
        except ValueError:
            return None
        return (
            parsed.strftime("%Y%m%d%H%M%S"),
            parsed.strftime("%Y-%m-%d %H:%M"),
            parsed.isoformat(),
        )

    if len(compact) >= 8 and _is_plausible_year(compact[:4]):
        try:
            parsed = date(
                int(compact[:4]),
                int(compact[4:6]),
                int(compact[6:8]),
            )
        except ValueError:
            return None
        return (
            parsed.strftime("%Y%m%d") + "000000",
            parsed.strftime("%Y-%m-%d"),
            parsed.isoformat(),
        )

    return None


def _publish_parts_from_value(value: Any) -> tuple[str, str, str] | None:
    if value is None:
        return None

    if isinstance(value, (datetime, date)):
        return _publish_parts_from_datetime(value)

    text = _normalize_text(value)
    if not text:
        return None

    iso_candidate = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(iso_candidate)
    except ValueError:
        try:
            parsed_date = date.fromisoformat(text)
        except ValueError:
            parsed = None
        else:
            return _publish_parts_from_datetime(parsed_date)
    else:
        return _publish_parts_from_datetime(parsed)

    compact = "".join(character for character in text if character.isdigit())
    if not compact:
        return None

    return _publish_parts_from_compact(compact)


def _publish_parts_from_src_uri(src_uri: str) -> tuple[str, str, str] | None:
    base_name = Path(src_uri).stem
    raw = base_name.rsplit("_", 1)[-1] if "_" in base_name else base_name
    return _publish_parts_from_value(raw)


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
        for key in ("description", "excerpt", "date", "cdate", "title", "tags"):
            if key not in meta and key in front_matter:
                meta[key] = front_matter[key]

        publish_parts = _publish_parts_from_value(
            meta.get("date")
            or front_matter.get("date")
            or meta.get("cdate")
            or front_matter.get("cdate")
        )
        if publish_parts is None:
            publish_parts = _publish_parts_from_src_uri(src_uri)

        if publish_parts is not None:
            page.blog_publish_key, page.blog_publish_label, page.blog_publish_iso = publish_parts
        else:
            page.blog_publish_key = ""
            page.blog_publish_label = ""
            page.blog_publish_iso = ""

        description = _normalize_text(
            meta.get("description") or front_matter.get("description")
        )
        excerpt = _normalize_text(meta.get("excerpt") or front_matter.get("excerpt"))
        auto_description = ""

        if src_uri[:1] in {"A", "B", "C", "D"}:
            if Path(src_uri).stem.startswith("000000"):
                collections = config.get("extra", {}).get("collections", {})
                collection = collections.get(src_uri[:1], {})
                auto_description = _normalize_text(collection.get("description"))
            else:
                auto_description = _description_from_markdown(docs_dir / src_uri)
            if not description and auto_description:
                meta["description"] = excerpt or auto_description

        page.blog_description_text = description or excerpt or auto_description
        page.blog_excerpt_text = excerpt
        page.blog_auto_description_text = auto_description
        page.blog_tags_text = _normalize_text(
            meta.get("tags") or front_matter.get("tags")
        )

    return nav


def on_page_context(context, page, config, nav):
    """Restore generated descriptions after MkDocs reloads page front matter."""

    file = getattr(page, "file", None)
    src_uri = getattr(file, "src_uri", "")
    description = _normalize_text(getattr(page, "blog_description_text", ""))
    meta = getattr(page, "meta", None)

    if (
        src_uri[:1] in {"A", "B", "C", "D"}
        and description
        and isinstance(meta, dict)
        and not meta.get("description")
    ):
        meta["description"] = description

    return context
