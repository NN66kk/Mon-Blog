#!/usr/bin/env python3
"""Check (default) or refresh publisher mirrors of shared blog rules/assets."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from shared.content_contract import load_contract


def generated_files(root=ROOT):
    contract = load_contract(root / "shared/blog.json")
    yield root / "publisher/lib/blog-contract.json", (json.dumps(contract, ensure_ascii=False, indent=2) + "\n").encode()
    yield root / "publisher/tests/fixtures/path-cases.json", (root / "shared/path-cases.json").read_bytes()
    for name in ("mermaid-theme.mjs", "mermaid-renderer.mjs", "mermaid.css"):
        yield root / "publisher/public/diagrams" / name, (root / "shared/diagrams" / name).read_bytes()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="refresh generated publisher copies")
    mode.add_argument("--check", action="store_true", help="check without writing (default)")
    args = parser.parse_args(argv)
    stale = []
    for path, expected in generated_files():
        if not path.is_file() or path.read_bytes() != expected:
            if args.write:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(expected)
            else:
                stale.append(str(path.relative_to(ROOT)))
    if stale:
        print("Shared mirrors differ; run python scripts/sync_shared.py --write:\n" + "\n".join(stale), file=sys.stderr)
        return 1
    print("Shared rules and diagram mirrors are current.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
