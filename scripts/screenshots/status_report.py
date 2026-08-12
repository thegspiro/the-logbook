#!/usr/bin/env python3
"""
Regenerate `docs/training/SCREENSHOT_STATUS.md`.

Counts, per training guide, how many screenshot placeholders have been replaced
with an image and how many are still outstanding. Run it after
`apply_placeholders.py` so the tracker reflects what is actually in the guides.

`README.md` is excluded: its placeholder block is the format documentation, not
a screenshot to capture.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent.parent.parent / "docs" / "training"
OUTPUT = DOCS_DIR / "SCREENSHOT_STATUS.md"

MARKER = re.compile(
    r"^>\s*\*\*(?:Screenshot placeholder|Screenshot needed|\[SCREENSHOT NEEDED\])",
    re.IGNORECASE,
)
IMAGE = re.compile(r"^!\[.*\]\(\./images/.*\.png\)$")


def main() -> int:
    rows = []
    for guide in sorted(DOCS_DIR.glob("*.md")):
        if guide.name in {"README.md", OUTPUT.name}:
            continue
        lines = guide.read_text().splitlines()
        remaining = sum(1 for line in lines if MARKER.match(line))
        captured = sum(1 for line in lines if IMAGE.match(line))
        if captured or remaining:
            rows.append((guide.name, captured, remaining))

    total_captured = sum(row[1] for row in rows)
    total_remaining = sum(row[2] for row in rows)

    out = [
        "# Screenshot status",
        "",
        "Which training-guide screenshot placeholders have been captured. Generated",
        "by `scripts/screenshots/status_report.py`; see that directory's README for",
        "how to capture more.",
        "",
        "Counts what is **filled**, not what is still **true**. Whether a captured",
        "image still matches the application is tracked by hand in",
        "[SCREENSHOT_CURRENCY.md](./SCREENSHOT_CURRENCY.md) — this file is",
        "regenerated wholesale, so that audit cannot live here.",
        "",
        f"**{total_captured} of {total_captured + total_remaining} placeholders filled** "
        f"({total_remaining} remaining).",
        "",
        "| Guide | Captured | Remaining |",
        "|-------|---------:|----------:|",
    ]
    out += [f"| [{name}](./{name}) | {done} | {left} |" for name, done, left in rows]
    out.append(f"| **Total** | **{total_captured}** | **{total_remaining}** |")
    out.append("")

    OUTPUT.write_text("\n".join(out) + "\n")
    print(f"{total_captured} captured, {total_remaining} remaining -> {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
