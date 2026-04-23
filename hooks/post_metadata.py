from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml

FRONT_MATTER_RE = re.compile(r"\A---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.DOTALL)
POST_SECTION_PREFIXES = ("A", "B", "C", "D")


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
        for key in ("description", "excerpt", "date", "title"):
            if key not in meta and key in front_matter:
                meta[key] = front_matter[key]

        publish_parts = _publish_parts_from_value(meta.get("date") or front_matter.get("date"))
        if publish_parts is None:
            publish_parts = _publish_parts_from_src_uri(src_uri)

        if publish_parts is not None:
            page.blog_publish_key, page.blog_publish_label, page.blog_publish_iso = publish_parts
        else:
            page.blog_publish_key = ""
            page.blog_publish_label = ""
            page.blog_publish_iso = ""

        page.blog_description_text = _normalize_text(
            meta.get("description") or front_matter.get("description")
        )
        page.blog_excerpt_text = _normalize_text(
            meta.get("excerpt") or front_matter.get("excerpt")
        )

        if (
            not meta.get("template")
            and src_uri[:1] in POST_SECTION_PREFIXES
            and page.blog_publish_label
        ):
            meta["template"] = "post.html"

    return nav
