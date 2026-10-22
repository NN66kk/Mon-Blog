from __future__ import annotations

import os
import re
import hashlib
import logging
import sys
from collections import Counter
from collections.abc import Mapping
from datetime import date, datetime, timedelta, timezone
from email.utils import format_datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin, urlsplit
from xml.etree import ElementTree as ET

import yaml

# MkDocs loads hooks by filename; its CLI need not put the repository on sys.path.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
from shared.content_contract import CONTRACT, RULES

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
LEADING_H1_RE = re.compile(r"\A\s*<h1\b[^>]*>.*?</h1>\s*", re.DOTALL)
H1_OPEN_RE = re.compile(r"<h1(?P<attributes>\b[^>]*)>")
ATX_H1_RE = re.compile(r"^(?P<indent>\s*)#(?!#)(?P<space>\s+)")
FENCE_START_RE = re.compile(r"^\s*(?P<fence>`{3,}|~{3,})")
COLLECTION_KEYS = tuple(CONTRACT["extra"]["collections"])
NON_PUBLIC_STATUSES = set(RULES["non_public_statuses"])
UNLISTED_STATUSES = set(RULES["unlisted_statuses"])
GENERIC_TAGS = set(RULES["generic_tags"])
BLOG_TIMEZONE = timezone(timedelta(minutes=RULES["timezone_offset_minutes"]))
LOG = logging.getLogger("mkdocs.plugins.post_metadata")
_feed_pages: list[Any] = []


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple, set)):
        parts = [_normalize_text(item) for item in value]
        return " ".join(part for part in parts if part).strip()
    return str(value).strip()


def _clean_description(value: Any) -> str:
    """Return only descriptions that are ready to publish."""

    text = _normalize_text(value)
    if not text or TEMPLATE_RE.search(text):
        return ""
    return _truncate_description(text)


def _normalize_tags(value: Any) -> list[str]:
    """Normalize the mixed string/list tag formats used by the vault."""

    if value is None:
        return []

    if isinstance(value, (list, tuple, set)):
        raw_tags = [_normalize_text(item).lstrip("#") for item in value]
    else:
        raw_tags = [
            item.lstrip("#")
            for item in re.split(r"[,，\s]+", _normalize_text(value))
        ]

    tags: list[str] = []
    seen: set[str] = set()
    for tag in raw_tags:
        cleaned = tag.strip()
        key = cleaned.casefold()
        if cleaned and key not in seen:
            seen.add(key)
            tags.append(cleaned)
    return tags


def _status_from_metadata(data: dict[str, Any]) -> str:
    status = _normalize_text(data.get("status")).casefold()
    if status:
        return status
    if data.get("draft") is True:
        return "draft"
    return "published"


def _config_extra(config: Any) -> Mapping[str, Any]:
    try:
        extra = config.get("extra", {})
    except AttributeError:
        extra = {}
    return extra if isinstance(extra, Mapping) else {}


def _collection_for_src(
    src_uri: str, collections: Mapping[str, Any]
) -> tuple[str, Mapping[str, Any] | None, bool]:
    """Match a page to a configured collection without relying on its first byte."""

    normalized = src_uri.replace("\\", "/")
    for key in COLLECTION_KEYS:
        raw_collection = collections.get(key)
        if not isinstance(raw_collection, Mapping):
            continue
        source_dir = _normalize_text(raw_collection.get("source_dir")).strip("/")
        index_src = _normalize_text(raw_collection.get("index_src"))
        if source_dir and normalized.startswith(f"{source_dir}/"):
            return key, raw_collection, normalized == index_src
    return "", None, False


def _page_front_matter(page: Any, docs_dir: Path) -> tuple[str, dict[str, Any]]:
    file = getattr(page, "file", None)
    src_uri = getattr(file, "src_uri", "")
    if not src_uri:
        return "", {}
    return src_uri, _read_front_matter(docs_dir / src_uri)


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
        # Legacy timestamps without an offset are Beijing wall time. Publication
        # timestamps from the writing studio can be UTC and must use the same
        # timezone before producing either a display label or the sorting key.
        value = (
            value.replace(tzinfo=BLOG_TIMEZONE)
            if value.tzinfo is None
            else value.astimezone(BLOG_TIMEZONE)
        )
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
    if len(compact) == 14 and _is_plausible_year(compact[:4]):
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
        return _publish_parts_from_datetime(parsed)

    if len(compact) == 12 and _is_plausible_year(compact[:4]):
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
        return _publish_parts_from_datetime(parsed)

    if len(compact) == 12:
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
        return _publish_parts_from_datetime(parsed)

    if len(compact) == 10:
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
        return _publish_parts_from_datetime(parsed)

    if len(compact) == 8 and _is_plausible_year(compact[:4]):
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


def _discovery_anchor(kind: str, name: str) -> str:
    """Stable, URL-safe IDs, including for Chinese names and punctuation."""

    digest = hashlib.sha256(name.casefold().encode("utf-8")).hexdigest()[:16]
    return f"{kind}-{digest}"


def _series_order(value: Any, src_uri: str) -> int | None:
    if value is None or value == "":
        return None
    if not isinstance(value, bool) and isinstance(value, (int, str)):
        text = str(value).strip()
        if text.isdecimal() and int(text) > 0:
            return int(text)
    LOG.warning("%s: series_order must be a positive integer", src_uri)
    return None


def _discovery_views(posts: list[Any]) -> tuple[list[dict], list[dict]]:
    topics: dict[str, dict] = {}
    series: dict[str, dict] = {}
    for page in posts:
        for tag in page.blog_topic_tags:
            key = tag.casefold()
            topic = topics.setdefault(key, {
                "name": tag, "id": _discovery_anchor("topic", tag), "posts": [],
            })
            topic["posts"].append(page)
            page.blog_topic_links.append(topic)
        if page.blog_series_name:
            key = page.blog_series_name.casefold()
            group = series.setdefault(key, {
                "name": page.blog_series_name,
                "id": _discovery_anchor("series", page.blog_series_name),
                "posts": [],
            })
            group["posts"].append(page)

    for group in series.values():
        group["posts"].sort(key=lambda page: (
            page.blog_series_order is None,
            page.blog_series_order or 0,
            page.blog_publish_key,
            str(page.title).casefold(),
            page.blog_src_uri,
        ))
        orders: set[int] = set()
        for index, page in enumerate(group["posts"]):
            if page.blog_series_order is not None:
                if page.blog_series_order in orders:
                    LOG.warning("%s: duplicate series_order %s in series %s",
                                page.blog_src_uri, page.blog_series_order, group["name"])
                orders.add(page.blog_series_order)
            page.blog_series = group
            page.blog_series_position = index + 1
            page.blog_series_previous = group["posts"][index - 1] if index else None
            page.blog_series_next = (
                group["posts"][index + 1] if index + 1 < len(group["posts"]) else None
            )

    return (
        sorted(topics.values(), key=lambda item: (-len(item["posts"]), item["name"].casefold())),
        sorted(series.values(), key=lambda item: item["name"].casefold()),
    )


def on_files(files, config):
    """Keep explicit drafts out of navigation, search and the generated site."""

    if os.environ.get("MON_BLOG_INCLUDE_DRAFTS") == "1":
        return files

    docs_dir = Path(str(config["docs_dir"]))
    for file in list(files):
        src_uri = getattr(file, "src_uri", "")
        if not src_uri.lower().endswith(".md"):
            continue
        status = _status_from_metadata(_read_front_matter(docs_dir / src_uri))
        if status in NON_PUBLIC_STATUSES:
            files.remove(file)
    return files


def on_nav(nav, config, files):
    """Build one stable view model for every editorial template."""

    global _feed_pages
    # Replaced on every live rebuild; never retain entries from a previous build.
    _feed_pages = []
    docs_dir = Path(str(config["docs_dir"]))
    extra = _config_extra(config)
    collections = extra.get("collections", {})
    if not isinstance(collections, Mapping):
        collections = {}
    about_page = _normalize_text(extra.get("about_page")) or "about.md"

    pages = list(getattr(nav, "pages", []))
    posts: list[Any] = []

    # First pass: normalize each page and identify its role.
    for page in pages:
        src_uri, front_matter = _page_front_matter(page, docs_dir)
        if not src_uri:
            continue

        meta = getattr(page, "meta", None)
        if not isinstance(meta, dict):
            meta = {}
            page.meta = meta

        for key in (
            "description",
            "excerpt",
            "date",
            "cdate",
            "published_at",
            "updated_at",
            "title",
            "tags",
            "status",
            "draft",
            "template",
            "collection",
            "series",
            "series_order",
        ):
            if key not in meta and key in front_matter:
                meta[key] = front_matter[key]

        collection_key, collection, is_collection_index = _collection_for_src(
            src_uri, collections
        )
        status = _status_from_metadata({**front_matter, **meta})
        is_about = src_uri == about_page
        is_article = bool(
            collection_key
            and not is_collection_index
            and not is_about
            and status != "redirect"
        )
        is_listed = bool(is_article and status not in UNLISTED_STATUSES)

        publish_parts = _publish_parts_from_value(
            meta.get("published_at")
            or front_matter.get("published_at")
            or meta.get("cdate")
            or front_matter.get("cdate")
            or meta.get("date")
            or front_matter.get("date")
        )
        if publish_parts is None and is_article:
            publish_parts = _publish_parts_from_src_uri(src_uri)

        if publish_parts is not None:
            page.blog_publish_key, page.blog_publish_label, page.blog_publish_iso = publish_parts
        else:
            page.blog_publish_key = ""
            page.blog_publish_label = ""
            page.blog_publish_iso = ""

        updated_parts = _publish_parts_from_value(
            meta.get("updated_at")
            or front_matter.get("updated_at")
            or (
                meta.get("date") or front_matter.get("date")
                if meta.get("cdate") or front_matter.get("cdate")
                else None
            )
        ) or publish_parts
        if updated_parts is not None:
            page.blog_updated_key, page.blog_updated_label, page.blog_updated_iso = updated_parts
        else:
            page.blog_updated_key = ""
            page.blog_updated_label = ""
            page.blog_updated_iso = ""

        description = _clean_description(
            meta.get("description") or front_matter.get("description")
        )
        excerpt = _clean_description(meta.get("excerpt") or front_matter.get("excerpt"))
        auto_description = ""
        if is_collection_index and collection:
            auto_description = _clean_description(collection.get("description"))
        elif is_article or is_about:
            auto_description = _description_from_markdown(docs_dir / src_uri)

        final_description = description or excerpt or auto_description
        if final_description:
            meta["description"] = final_description

        tags = _normalize_tags(meta.get("tags") or front_matter.get("tags"))
        legacy_tag = _normalize_text(collection.get("legacy_tag")) if collection else ""
        topic_tags = [
            tag
            for tag in tags
            if tag.casefold() != legacy_tag.casefold()
            and tag.casefold() not in GENERIC_TAGS
        ]

        page.blog_status = status
        page.blog_src_uri = src_uri
        page.blog_is_about = is_about
        page.blog_is_article = is_article
        page.blog_is_post = is_article
        page.blog_is_listed = is_listed
        page.blog_is_collection_index = is_collection_index
        page.blog_page_type = (
            "redirect"
            if status == "redirect"
            else "home"
            if getattr(page, "is_homepage", False)
            else "about"
            if is_about
            else "collection"
            if is_collection_index
            else "article"
            if is_article
            else "archive"
            if src_uri == "archive.md"
            else "topics"
            if src_uri == "topics.md"
            else "page"
        )
        page.blog_collection_key = collection_key
        page.blog_collection = collection
        page.blog_description_text = final_description
        page.blog_excerpt_text = excerpt
        page.blog_auto_description_text = auto_description
        page.blog_tags = tags
        page.blog_topic_tags = topic_tags
        page.blog_topic_links = []
        page.blog_series_name = _normalize_text(meta.get("series"))
        page.blog_series_order = (
            _series_order(meta.get("series_order"), src_uri)
            if is_listed and page.blog_series_name else None
        )
        page.blog_series = None
        page.blog_series_position = None
        page.blog_series_previous = None
        page.blog_series_next = None
        page.blog_tags_text = " ".join(tags)
        page.blog_newer_page = None
        page.blog_older_page = None
        page.blog_related_pages = []
        page.blog_related_by_topic = bool(topic_tags)

        if is_listed:
            posts.append(page)

    posts.sort(
        key=lambda item: (
            getattr(item, "blog_publish_key", ""),
            _normalize_text(getattr(item, "title", "")),
        ),
        reverse=True,
    )

    # Second pass: reading paths and related notes use the same ordered post set.
    for index, page in enumerate(posts):
        page.blog_newer_page = posts[index - 1] if index > 0 else None
        page.blog_older_page = posts[index + 1] if index + 1 < len(posts) else None

        page_topics = {tag.casefold() for tag in page.blog_topic_tags}
        candidates: list[tuple[int, int, Any]] = []
        for candidate_index, candidate in enumerate(posts):
            if candidate is page:
                continue
            candidate_topics = {tag.casefold() for tag in candidate.blog_topic_tags}
            shared = len(page_topics & candidate_topics)
            same_collection = (
                page.blog_collection_key == candidate.blog_collection_key
            )
            if shared == 0 and (page_topics or not same_collection):
                continue
            score = shared * 100 + (10 if same_collection else 0)
            candidates.append((score, -candidate_index, candidate))
        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        page.blog_related_pages = [item[2] for item in candidates[:3]]

    topics, series = _discovery_views(posts)
    _feed_pages = list(posts)

    collection_order = [
        key
        for key in extra.get("collection_order", COLLECTION_KEYS)
        if key in collections
    ]
    for key in COLLECTION_KEYS:
        if key in collections and key not in collection_order:
            collection_order.append(key)

    posts_by_collection: dict[str, list[Any]] = {
        key: [page for page in posts if page.blog_collection_key == key]
        for key in collection_order
    }
    collection_views: list[dict[str, Any]] = []
    collection_counts: dict[str, int] = {}
    for key in collection_order:
        collection = dict(collections.get(key, {}))
        collection_posts = posts_by_collection.get(key, [])
        tag_counts = Counter(
            tag for page in collection_posts for tag in page.blog_topic_tags
        )
        collection.update(
            {
                "key": key,
                "posts": collection_posts,
                "count": len(collection_posts),
                "topic_tags": [tag for tag, _ in tag_counts.most_common(8)],
            }
        )
        collection_views.append(collection)
        collection_counts[key] = len(collection_posts)

    about = next((page for page in pages if getattr(page, "blog_is_about", False)), None)
    blog = {
        "posts": posts,
        "recent": posts[:7],
        "about": about,
        "count": len(posts),
        "collection_order": collection_order,
        "collections": collection_views,
        "collection_counts": collection_counts,
        "posts_by_collection": posts_by_collection,
        "topics": topics,
        "series": series,
        "feed_count": sum(bool(page.blog_publish_iso) for page in posts),
    }
    nav.blog = blog
    return nav


def _feed_datetime(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=BLOG_TIMEZONE) if parsed.tzinfo is None else parsed


def on_post_build(config):
    """Write RSS from the same public model, without inventing publication dates."""

    feed_path = _normalize_text(_config_extra(config).get("rss_feed"))
    if not feed_path:
        return
    if (Path(feed_path).is_absolute() or ".." in Path(feed_path).parts
            or any(char in feed_path for char in "?#\\")):
        raise ValueError("rss_feed must be a relative output path")
    base = str(config.get("site_url", "")).rstrip("/") + "/"
    parsed_base = urlsplit(base)
    if parsed_base.scheme not in {"http", "https"} or not parsed_base.netloc:
        raise ValueError("RSS requires an absolute HTTP(S) site_url")
    atom = "http://www.w3.org/2005/Atom"
    ET.register_namespace("atom", atom)
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = str(config.get("site_name", ""))
    ET.SubElement(channel, "link").text = base
    ET.SubElement(channel, "description").text = str(config.get("site_description", ""))
    ET.SubElement(channel, "language").text = "zh-CN"
    ET.SubElement(channel, f"{{{atom}}}link", {
        "href": urljoin(base, quote(feed_path, safe="/%")), "rel": "self", "type": "application/rss+xml",
    })
    updates: list[datetime] = []
    for page in _feed_pages:
        if not page.blog_is_listed or page.blog_status in UNLISTED_STATUSES:
            continue
        published = _feed_datetime(page.blog_publish_iso)
        if published is None:
            # An undated note stays discoverable on the site, not in a dated feed.
            continue
        link = urljoin(base, quote(str(page.url).lstrip("/"), safe="/%:@"))
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = HTML_TAG_RE.sub("", str(page.title))
        ET.SubElement(item, "link").text = link
        ET.SubElement(item, "guid", {"isPermaLink": "true"}).text = link
        ET.SubElement(item, "pubDate").text = format_datetime(published)
        ET.SubElement(item, "description").text = page.blog_description_text
        for tag in page.blog_topic_tags:
            ET.SubElement(item, "category").text = tag
        updates.append(_feed_datetime(page.blog_updated_iso) or published)
    if updates:
        ET.SubElement(channel, "lastBuildDate").text = format_datetime(max(updates))
    target = Path(str(config["site_dir"])) / feed_path
    target.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(rss, space="  ")
    ET.ElementTree(rss).write(target, encoding="utf-8", xml_declaration=True)


def on_page_context(context, page, config, nav):
    """Expose the blog model and restore normalized page metadata."""

    file = getattr(page, "file", None)
    src_uri = getattr(file, "src_uri", "")
    description = _normalize_text(getattr(page, "blog_description_text", ""))
    meta = getattr(page, "meta", None)

    if description and isinstance(meta, dict):
        meta["description"] = description

    context["blog"] = getattr(nav, "blog", {})

    return context


def on_page_markdown(markdown, page, config, files):
    """Demote repeated top-level headings before MkDocs builds the TOC."""

    if not (
        getattr(page, "blog_is_article", False)
        or getattr(page, "blog_is_about", False)
    ):
        return markdown

    lines: list[str] = []
    first_h1_seen = False
    active_fence = ""
    for line in markdown.splitlines(keepends=True):
        fence_match = FENCE_START_RE.match(line)
        if fence_match:
            fence = fence_match.group("fence")
            if not active_fence:
                active_fence = fence[0]
            elif fence[0] == active_fence:
                active_fence = ""
            lines.append(line)
            continue

        if not active_fence and ATX_H1_RE.match(line):
            if first_h1_seen:
                line = ATX_H1_RE.sub(
                    lambda match: f"{match.group('indent')}##{match.group('space')}",
                    line,
                    count=1,
                )
            else:
                first_h1_seen = True
        lines.append(line)
    return "".join(lines)


def on_page_content(html, page, config, files):
    """Preserve title anchors when templates replace Markdown page headers."""

    # MkDocs can reuse Page instances during live rebuilds. A page that no
    # longer begins with an H1 must not retain its previous title anchor.
    page.blog_title_id = ""
    leading_h1 = LEADING_H1_RE.match(html)
    if leading_h1:
        # The TOC (and Material's skip link) already points at this heading.
        # Move its decoded ID onto the template's replacement H1 rather than
        # dropping the target. HTMLParser handles both quote styles/entities;
        # the template escapes the value when writing it back to HTML.
        parser = _TitleAnchorParser()
        parser.feed(leading_h1.group(0))
        page.blog_title_id = parser.title_id

    if not (
        getattr(page, "blog_is_article", False)
        or getattr(page, "blog_is_about", False)
    ):
        return html

    if leading_h1:
        content = html[leading_h1.end():]
    else:
        content = html
    content = H1_OPEN_RE.sub(r"<h2\g<attributes>>", content)
    return content.replace("</h1>", "</h2>")


class _TitleAnchorParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title_id = ""

    def handle_starttag(self, tag, attrs):
        if tag == "h1":
            self.title_id = next(
                (value for name, value in attrs if name == "id" and value), ""
            )
