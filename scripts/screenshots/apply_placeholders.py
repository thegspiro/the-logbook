#!/usr/bin/env python3
"""
Replace screenshot placeholders in the training guides with captured images.

Reads ``capture-report.json`` (written by ``capture.mjs``) and, for every shot
that captured successfully, swaps the corresponding placeholder block for a
markdown image tag.

A placeholder is one of two shapes:

    > **Screenshot placeholder:**
    > _[Description of what to capture]_

    > **[SCREENSHOT NEEDED]:** _Description of what to capture_

Both are blockquotes, so the block runs from the marker line through the last
consecutive ``>`` line.  Replacements are applied bottom-up within each file so
earlier line numbers stay valid, and each one is verified against the marker
text before anything is written — a stale line number is reported, not guessed
at.

Usage:
    python scripts/screenshots/apply_placeholders.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
DOCS_DIR = REPO_ROOT / "docs" / "training"
REPORT = HERE / "capture-report.json"

MARKER = re.compile(
    r"^>\s*\*\*(?:Screenshot placeholder|Screenshot needed|\[SCREENSHOT NEEDED\])",
    re.IGNORECASE,
)


def block_end(lines: list[str], start: int) -> int:
    """Index one past the last line of the blockquote beginning at ``start``."""
    end = start + 1
    while end < len(lines) and lines[end].startswith(">"):
        end += 1
    return end


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--include-empty",
        action="store_true",
        help="also apply shots the capture flagged as showing an empty state",
    )
    args = parser.parse_args()

    if not REPORT.exists():
        print(f"No capture report at {REPORT}. Run capture.mjs first.", file=sys.stderr)
        return 1

    shots = [s for s in json.loads(REPORT.read_text()) if s.get("status") == "ok"]
    by_doc: dict[str, list[dict]] = {}
    held_back = 0
    for shot in shots:
        if not (shot.get("doc") and shot.get("line")):
            continue
        if shot.get("emptyState") and not args.include_empty:
            held_back += 1
            continue
        by_doc.setdefault(shot["doc"], []).append(shot)

    applied = 0
    skipped: list[str] = []
    for doc, doc_shots in sorted(by_doc.items()):
        path = DOCS_DIR / doc
        if not path.exists():
            skipped.append(f"{doc}: file not found")
            continue
        lines = path.read_text().splitlines()
        for shot in sorted(doc_shots, key=lambda s: s["line"], reverse=True):
            index = shot["line"] - 1
            if index >= len(lines) or not MARKER.match(lines[index]):
                # Already replaced on a previous run, or the guide moved on.
                skipped.append(f"{doc}:{shot['line']}: no placeholder ({shot['id']})")
                continue
            replacement = f"![{shot['alt']}](./images/{shot['file']})"
            lines[index : block_end(lines, index)] = [replacement]
            applied += 1
        if not args.dry_run:
            path.write_text("\n".join(lines) + "\n")

    print(f"{applied} placeholder(s) replaced across {len(by_doc)} guide(s).")
    if held_back:
        print(
            f"  - held back {held_back} shot(s) showing an empty state (use --include-empty to override)"
        )
    for note in skipped:
        print(f"  - skipped {note}")
    if args.dry_run:
        print("(dry run — nothing written)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
