#!/usr/bin/env python3
"""Check a completed MkDocs build locally, without making network requests.

Usage: python scripts/check_site.py --site-dir site
Configuration is read as data: this command does not load plugins, run a build,
or expand environment variables. Pass the actual build directory explicitly.
"""
from __future__ import annotations

import argparse
from html.parser import HTMLParser
from functools import lru_cache
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote, unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET

import yaml
from mkdocs.structure.files import File


ROOT = Path(__file__).resolve().parents[1]
FRONT_MATTER = re.compile(r"\A---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.S)


class ConfigLoader(yaml.SafeLoader):
    """Read MkDocs YAML without executing Python tags or consulting secrets."""


def _env_default(loader, node):
    values = loader.construct_sequence(node)
    return values[-1] if len(values) > 1 else None


ConfigLoader.add_constructor("!ENV", _env_default)
ConfigLoader.add_multi_constructor("tag:yaml.org,2002:python/name:", lambda *_: None)


def load_config_data(path, seen=()):
    """Read MkDocs inheritance as data, without imports or environment expansion."""
    path = Path(path).resolve()
    if path in seen or len(seen) >= 16:
        raise ValueError("Cyclic or excessive config inheritance")
    config = yaml.load(path.read_text(encoding="utf-8"), Loader=ConfigLoader)
    if not isinstance(config, dict):
        raise ValueError("config must be a YAML mapping")
    inherited = config.pop("INHERIT", None)
    if inherited is None:
        return config
    if not isinstance(inherited, str):
        raise ValueError("INHERIT must be a file path")
    base = load_config_data(path.parent / inherited, (*seen, path))

    def merge(target, updates):
        for key, value in updates.items():
            if isinstance(value, dict) and isinstance(target.get(key), dict):
                merge(target[key], value)
            else:
                target[key] = value
        return target

    return merge(base, config)


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.anchors = set()
        self.references = []
        self.canonicals = []
        self.dataview_count = 0
        self.rss_feeds = []
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.anchors.add(attrs["id"])
        if tag == "a" and attrs.get("name"):
            self.anchors.add(attrs["name"])
        if attrs.get("data-dataview-static") == "incomplete-tasks":
            self.dataview_count += 1
        if tag == "link" and "alternate" in attrs.get("rel", "").split() and attrs.get("type") == "application/rss+xml":
            self.rss_feeds.append(attrs.get("href", ""))
        if tag == "link" and "canonical" in attrs.get("rel", "").split():
            self.canonicals.append(attrs.get("href", ""))
            return
        attributes = ("href", "src", "poster") + (("data",) if tag == "object" else ())
        for attribute in attributes:
            if attrs.get(attribute):
                label = "md-skip" if "md-skip" in attrs.get("class", "").split() else tag
                self.references.append((attrs[attribute], label, self.getpos()[0]))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

def page_url(path):
    """MkDocs directory URLs, including the site homepage."""
    value = path.as_posix()
    if value == "index.html":
        return ""
    return value[:-10] if value.endswith("/index.html") else value


class SiteCheck:
    def __init__(self, site_dir, site_url):
        self.site_dir = Path(site_dir).resolve()
        self.site_url = site_url.rstrip("/") + "/"
        self.base = urlsplit(self.site_url)
        if self.base.scheme not in {"http", "https"} or not self.base.netloc:
            raise ValueError("site_url must be an absolute HTTP(S) URL")
        if self.base.query or self.base.fragment:
            raise ValueError("site_url must not contain a query or fragment")
        self.base_path = unquote(self.base.path)
        self.errors = []
        self.pages = {}
        self.private_targets = set()
        self.feed_excluded_targets = set()
        self.feed_expected_dates = {}

    def error(self, source, message):
        item = f"{source}: {message}"
        if item not in self.errors:
            self.errors.append(item)

    @lru_cache(maxsize=None)
    def destination(self, relative):
        # Every page repeats the navigation. Resolve and stat each destination
        # once, rather than thousands of times for the same generated file.
        candidate = self.site_dir / relative
        if relative.endswith("/") or not relative or candidate.is_dir():
            candidate /= "index.html"
        candidate = candidate.resolve()
        return candidate, candidate.is_file()

    def target(self, ref, current_url, source, *, required=False):
        """Resolve same-site URLs once; external URLs are never fetched."""
        parsed = urlsplit(urljoin(current_url, ref))
        if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() != self.base.netloc.lower():
            if required:
                self.error(source, f"URL is outside site_url: {ref!r}")
            return None
        path = unquote(parsed.path)
        if not path.startswith(self.base_path):
            self.error(source, f"URL is outside site base {self.base.path!r}: {ref!r}")
            return None
        relative = path[len(self.base_path):]
        candidate, exists = self.destination(relative)
        if not candidate.is_relative_to(self.site_dir):
            self.error(source, f"URL escapes build directory: {ref!r}")
            return None
        if candidate in self.private_targets:
            self.error(source, f"draft/private page leaked into output: {ref!r}")
        if not exists:
            self.error(source, f"missing file for {ref!r}")
            return None
        fragment = unquote(parsed.fragment).split(":~:text=", 1)[0]
        if fragment and candidate in self.pages and fragment not in self.pages[candidate].anchors:
            self.error(source, f"missing anchor #{fragment} in {candidate.relative_to(self.site_dir)} ({ref!r})")
        return candidate

    def inspect_sources(self, docs_dir, config):
        """Verify explicit private sources and opted-in static Dataview queries."""
        if not docs_dir.is_dir():
            self.error("source", f"docs directory does not exist: {docs_dir}")
            return
        # Import only the local, pure query helpers, never MkDocs plugin/config hooks.
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from hooks.dataview_static import count_supported_queries, enabled_for_page
        from hooks.post_metadata import _collection_for_src, _publish_parts_from_value, _publish_parts_from_src_uri, BLOG_TIMEZONE
        from shared.content_contract import RULES

        for path in sorted(docs_dir.rglob("*.md")):
            text = path.read_text(encoding="utf-8-sig")
            match = FRONT_MATTER.match(text)
            try:
                metadata = (yaml.safe_load(match.group(1)) or {}) if match else {}
            except yaml.YAMLError as exc:
                self.error(path.relative_to(docs_dir), f"invalid front matter: {exc}")
                continue
            if not isinstance(metadata, dict):
                continue
            src_uri = path.relative_to(docs_dir).as_posix()
            output = File(src_uri, str(docs_dir), str(self.site_dir), config.get("use_directory_urls", True))
            target = Path(output.abs_dest_path).resolve()
            status = str(metadata.get("status") or "").strip().casefold()
            if status in RULES["unlisted_statuses"] or (not status and metadata.get("draft") is True):
                self.feed_excluded_targets.add(target)
            if status in RULES["non_public_statuses"] or (not status and metadata.get("draft") is True):
                self.private_targets.add(target)
                if target.exists():
                    self.error(src_uri, f"draft/private HTML exists: {target.relative_to(self.site_dir)}")
                continue
            collections = config.get("extra", {}).get("collections", {})
            collection, _, is_index = _collection_for_src(src_uri, collections)
            if target in self.pages and collection and not is_index and target not in self.feed_excluded_targets:
                parts = _publish_parts_from_value(metadata.get("published_at") or metadata.get("cdate") or metadata.get("date")) or _publish_parts_from_src_uri(src_uri)
                if parts:
                    stamp = datetime.fromisoformat(parts[2])
                    self.feed_expected_dates[target] = stamp.replace(tzinfo=BLOG_TIMEZONE) if stamp.tzinfo is None else stamp
            # Excluded source documents have no output. Strict MkDocs checks their
            # inclusion; this check concerns queries on pages actually published.
            if target not in self.pages or not enabled_for_page(src_uri, metadata, config):
                continue
            expected = count_supported_queries(text)
            page = self.pages[target]
            if page.dataview_count != expected:
                self.error(src_uri, f"Dataview static output count is {page.dataview_count}, expected {expected}")

    def inspect_html(self):
        for path, page in self.pages.items():
            relative = path.relative_to(self.site_dir)
            current = urljoin(self.site_url, quote(page_url(relative)))
            for ref, label, line in page.references:
                self.target(ref, current, f"{relative}:{line} <{label}>")
            # MkDocs' special 404 has no canonical URL and is absent from sitemap.
            if relative.as_posix() == "404.html" and not page.canonicals:
                continue
            if len(page.canonicals) != 1:
                self.error(relative, f"expected one canonical URL, found {len(page.canonicals)}")
                continue
            canonical = page.canonicals[0]
            parsed = urlsplit(canonical)
            if not parsed.netloc or parsed.scheme != self.base.scheme or parsed.query or parsed.fragment:
                self.error(relative, f"invalid canonical URL: {canonical!r}")
            target = self.target(canonical, self.site_url, f"{relative} canonical", required=True)
            if target is not None and target != path:
                self.error(relative, f"canonical points to another page: {canonical!r}")

    def inspect_search(self):
        path = self.site_dir / "search/search_index.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            entries = data["docs"]
            if not isinstance(entries, list) or not entries:
                raise ValueError("docs must be a nonempty list")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            self.error("search/search_index.json", f"cannot read search entries: {exc}")
            return
        for index, entry in enumerate(entries):
            source = f"search/search_index.json docs[{index}]"
            if not isinstance(entry, dict) or not isinstance(entry.get("location"), str):
                self.error(source, "missing string location")
                continue
            target = self.target(entry["location"], self.site_url, source, required=True)
            if target is not None and target not in self.pages:
                self.error(source, f"search result is not an HTML page: {entry['location']!r}")

    def inspect_sitemap(self):
        try:
            root = ET.parse(self.site_dir / "sitemap.xml").getroot()
        except (OSError, ET.ParseError) as exc:
            self.error("sitemap.xml", f"cannot read sitemap: {exc}")
            return
        locations = root.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
        if not locations:
            self.error("sitemap.xml", "sitemap contains no page URLs")
        for element in locations:
            ref = (element.text or "").strip()
            parsed = urlsplit(ref)
            if not parsed.netloc or parsed.scheme != self.base.scheme or parsed.query or parsed.fragment:
                self.error("sitemap.xml", f"invalid absolute page URL: {ref!r}")
            target = self.target(ref, self.site_url, "sitemap.xml", required=True)
            if target is not None and target not in self.pages:
                self.error("sitemap.xml", f"URL is not an HTML page: {ref!r}")

    def inspect_feed(self, config):
        feed_path = config.get("extra", {}).get("rss_feed")
        if not feed_path:
            return
        if not isinstance(feed_path, str) or feed_path.startswith("/") or ".." in Path(feed_path).parts or urlsplit(feed_path).scheme:
            self.error("rss", "rss_feed must be a relative file path inside the build")
            return
        feed_url = urljoin(self.site_url, feed_path)
        try:
            root = ET.parse(self.site_dir / feed_path).getroot()
        except (OSError, ET.ParseError) as exc:
            self.error(feed_path, f"cannot read RSS: {exc}")
            return
        channel = root.find("channel")
        if root.tag != "rss" or root.get("version") != "2.0" or channel is None:
            self.error(feed_path, "expected RSS 2.0 channel")
            return
        if channel.findtext("link") != self.site_url:
            self.error(feed_path, "channel link must equal site_url")
        if not channel.findtext("title") or not channel.findtext("description"):
            self.error(feed_path, "channel title and description are required")
        atom_link = channel.find("{http://www.w3.org/2005/Atom}link")
        if atom_link is None or atom_link.get("href") != feed_url or atom_link.get("rel") != "self":
            self.error(feed_path, "RSS self link must point to the configured feed")
        targets = set()
        previous = None
        for index, item in enumerate(channel.findall("item")):
            source = f"{feed_path} item[{index}]"
            link = item.findtext("link") or ""
            parsed = urlsplit(link)
            if not parsed.netloc or parsed.scheme != self.base.scheme or parsed.query or parsed.fragment:
                self.error(source, "item link must be an absolute page URL")
            target = self.target(link, self.site_url, source, required=True)
            if target is not None:
                if target not in self.pages:
                    self.error(source, "RSS item does not point to an HTML page")
                if target in targets:
                    self.error(source, "duplicate RSS article")
                if target in self.feed_excluded_targets:
                    self.error(source, "unlisted article must not appear in RSS")
                targets.add(target)
            if not item.findtext("title") or item.findtext("guid") != link:
                self.error(source, "item needs a title and a stable URL guid")
            try:
                published = parsedate_to_datetime(item.findtext("pubDate") or "")
                if published.tzinfo is None:
                    raise ValueError("timezone missing")
                published = published.astimezone(timezone.utc)
                if previous is not None and published > previous:
                    self.error(source, "RSS articles must be newest first")
                previous = published
                # RSS dates carry seconds; writing-room ISO timestamps may
                # contain milliseconds, which format_datetime cannot retain.
                if target in self.feed_expected_dates and published != self.feed_expected_dates[target].replace(microsecond=0):
                    self.error(source, "pubDate differs from the source publication date")
            except (TypeError, ValueError, OverflowError):
                self.error(source, "invalid RSS pubDate")
        if config.get("extra", {}).get("collections"):
            expected = set(self.feed_expected_dates)
            for target in sorted(expected - targets):
                self.error(feed_path, f"dated public article missing from RSS: {target.relative_to(self.site_dir)}")
            for target in sorted(targets - expected):
                self.error(feed_path, f"RSS contains undated or non-article page: {target.relative_to(self.site_dir)}")
        for path, page in self.pages.items():
            if path.name == "404.html":
                continue
            current = urljoin(self.site_url, quote(page_url(path.relative_to(self.site_dir))))
            if len(page.rss_feeds) != 1 or urljoin(current, page.rss_feeds[0]) != feed_url:
                self.error(path.relative_to(self.site_dir), "expected one RSS discovery link to the configured feed")

    def run(self, docs_dir, config):
        if not self.site_dir.is_dir():
            self.error("site", f"build directory does not exist: {self.site_dir}")
            return self.errors
        self.pages = {
            path.resolve(): Page(path.read_text(encoding="utf-8"))
            for path in sorted(self.site_dir.rglob("*.html"))
        }
        if self.site_dir / "index.html" not in self.pages:
            self.error("site", "missing homepage index.html")
        self.inspect_sources(Path(docs_dir), config)
        self.inspect_html()
        self.inspect_search()
        self.inspect_sitemap()
        self.inspect_feed(config)
        return self.errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "mkdocs.yml")
    parser.add_argument("--site-dir", type=Path, required=True)
    parser.add_argument("--site-url")
    parser.add_argument("--docs-dir", type=Path)
    parser.add_argument("--max-errors", type=int, default=40)
    args = parser.parse_args(argv)
    try:
        config = load_config_data(args.config)
        docs_dir = args.docs_dir or args.config.resolve().parent / config.get("docs_dir", "docs")
        check = SiteCheck(args.site_dir, args.site_url or config.get("site_url", ""))
        errors = check.run(docs_dir, config)
    except (OSError, ValueError, TypeError, yaml.YAMLError) as exc:
        print(f"Site artifact check failed: {exc}", file=sys.stderr)
        return 1
    if errors:
        for error in errors[:max(1, args.max_errors)]:
            print(f"ERROR {error}", file=sys.stderr)
        if len(errors) > max(1, args.max_errors):
            print(f"... {len(errors) - max(1, args.max_errors)} additional errors", file=sys.stderr)
        print(f"Site artifact check failed: {len(errors)} errors across {len(check.pages)} HTML pages.", file=sys.stderr)
        return 1
    print(f"Site artifact check passed: {len(check.pages)} HTML pages; links, anchors, search, sitemap, canonical, draft/private exclusion, static Dataview and configured RSS.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
