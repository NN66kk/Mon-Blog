#!/usr/bin/env python3
"""Inspect isolated Quartz build artifacts; this is not a production CI check."""
from __future__ import annotations

import argparse
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import quote, unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET


class HTML(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.references = []
        self.pre_blocks = []
        self.pre = None
        self.h1 = 0
        self.checkboxes = 0
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "h1":
            self.h1 += 1
        if tag == "pre":
            self.pre = ""
        if tag == "input" and attrs.get("type") == "checkbox":
            self.checkboxes += 1
        for attr in ("href", "src", "poster"):
            if attrs.get(attr):
                self.references.append((tag, attrs[attr]))

    def handle_data(self, value):
        if self.pre is not None:
            self.pre += value

    def handle_endtag(self, tag):
        if tag == "pre" and self.pre is not None:
            self.pre_blocks.append(self.pre)
            self.pre = None


def inspect(trial, quartz):
    trial = Path(trial).resolve()
    site = trial / "public"
    manifest = json.loads((trial / "manifest.json").read_text())
    # Use this exact Quartz version's slug function, rather than reproducing it.
    command = """import fs from 'node:fs';
import {slugifyFilePath} from '@quartz-community/utils';
const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
console.log(JSON.stringify(m.published_inputs.map(x=>({source:x.path,slug:slugifyFilePath(x.path)}))));"""
    mappings = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", command, str(trial / "manifest.json")], cwd=quartz, text=True))
    files = {path.relative_to(site).as_posix() for path in site.rglob("*") if path.is_file()}
    pages = {path: HTML((site / path).read_text(encoding="utf-8")) for path in files if path.endswith(".html")}
    index = json.loads((site / "static/contentIndex.json").read_text())
    errors = set()
    base = "https://nn66kk.github.io/Mon-Blog/"
    for path, page in pages.items():
        current = base + quote(path.removesuffix(".html"), safe="/")
        for tag, reference in page.references:
            parsed = urlsplit(urljoin(current, reference))
            if parsed.scheme not in {"http", "https"} or parsed.netloc != "nn66kk.github.io":
                continue
            decoded = unquote(parsed.path)
            if decoded == "/Mon-Blog":
                decoded += "/"
            if not decoded.startswith("/Mon-Blog/"):
                errors.add((path, tag, reference, "outside-base"))
                continue
            relative = decoded[len("/Mon-Blog/"):]
            candidates = [relative, relative + ".html", relative.rstrip("/") + "/index.html"] if relative else ["index.html"]
            target = next((value for value in candidates if value in files), None)
            if target is None:
                errors.add((path, tag, reference, "missing-file"))
            elif parsed.fragment and target in pages and unquote(parsed.fragment) not in pages[target].ids:
                errors.add((path, tag, reference, "missing-anchor"))
    dataview = []
    mapping = {item["source"]: item["slug"] for item in mappings}
    for entry in manifest["published_inputs"]:
        if not entry["dataview_static"]:
            continue
        page = pages[mapping[entry["path"]] + ".html"]
        dataview.append({"source": entry["path"], "raw_query_visible": any(re.search(r"task\s+where\s+file\.path\s*=\s*this\.file\.path", text) for text in page.pre_blocks), "checkboxes": page.checkboxes})
    legacy_missing = []
    changed_slugs = []
    for item in mappings:
        stem = item["source"][:-3]
        old_destination = stem + "/index.html" if not stem.endswith("index") else stem + ".html"
        if old_destination not in files:
            legacy_missing.append(item["source"])
        if stem != item["slug"]:
            changed_slugs.append({"source": item["source"], "new": item["slug"]})
    rss = ET.parse(site / "index.xml").getroot()
    rss_items = [{"title": item.findtext("title"), "link": item.findtext("link"), "date": item.findtext("pubDate")} for item in rss.findall("channel/item")]
    result = {
        "variant": manifest["variant"], "quartz_commit": manifest["quartz_commit"],
        "markdown_inputs": len(mappings), "html_pages": len(pages), "search_index_entries": len(index),
        "rss_item_count": len(rss_items), "rss_items": rss_items, "dataview_enabled_pages": len(dataview),
        "dataview_raw_query_pages": sum(item["raw_query_visible"] for item in dataview),
        "dataview_pages": dataview,
        "source_pages_with_multiple_h1": sum(pages[item["slug"] + ".html"].h1 > 1 for item in mappings),
        "legacy_directory_url_missing": len(legacy_missing), "legacy_directory_url_missing_sources": legacy_missing,
        "changed_slug_count": len(changed_slugs), "changed_slug_examples": changed_slugs[:10],
        "reference_error_counts": dict(Counter(error[3] for error in errors)),
        "reference_errors": [dict(zip(("page", "tag", "reference", "problem"), error)) for error in sorted(errors)],
        "excluded_real_sources_present_in_search": [item["path"] for item in manifest["excluded"] if item["path"][:-3].lower() in index],
    }
    (trial / "inspection.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key not in {"dataview_pages", "reference_errors", "legacy_directory_url_missing_sources", "rss_items"}}, ensure_ascii=False, indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trial", required=True, type=Path)
    parser.add_argument("--quartz", required=True, type=Path)
    args = parser.parse_args()
    inspect(args.trial, args.quartz)
