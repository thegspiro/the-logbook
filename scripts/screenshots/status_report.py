#!/usr/bin/env python3
"""
Regenerate `docs/training/SCREENSHOT_STATUS.md`.

Counts, per training guide, how many screenshot placeholders have been replaced
with an image and how many are still outstanding. Run it after
`apply_placeholders.py` so the tracker reflects what is actually in the guides.

Files that *document* the marker syntax are excluded, because their examples are
not requests. `README.md` was already skipped for that reason; `SCREENSHOT_CURRENCY.md`
and `TRAINING_MATERIALS_REVIEW.md` were not, so three syntax examples were counted
as outstanding capture work — and the tracker listed the currency audit itself as
a guide needing two screenshots.

That is the same failure the 2026-08-17 marker fix corrected from the other
direction: there the regex was too narrow and undercounted by 41; here it is
applied to files that are not guides and overcounts. A tracker is only useful if
its number means "captures somebody must go and take".
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent.parent.parent / "docs" / "training"
OUTPUT = DOCS_DIR / "SCREENSHOT_STATUS.md"

# Keep in step with apply_placeholders.py, which explains why the `[` is
# optional and unterminated: descriptive `**[SCREENSHOT NEEDED — …]**` markers
# were invisible to this count, so the tracker read as nearly complete while 41
# requested captures went unscheduled.
MARKER = re.compile(
    r"^>\s*\*\*\[?(?:Screenshot placeholder|Screenshot needed)",
    re.IGNORECASE,
)
IMAGE = re.compile(r"^!\[.*\]\(\./images/.*\.png\)$")

# Documents *about* the pipeline. Their markers are illustrations of the syntax,
# so counting them reports work that does not exist.
NOT_A_GUIDE = {
    "README.md",
    "SCREENSHOT_STATUS.md",
    "SCREENSHOT_CURRENCY.md",
    "TRAINING_MATERIALS_REVIEW.md",
}


def main() -> int:
    rows = []
    for guide in sorted(DOCS_DIR.glob("*.md")):
        if guide.name in NOT_A_GUIDE:
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
