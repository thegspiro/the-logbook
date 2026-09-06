#!/usr/bin/env python3
"""Find captured screenshots invalidated by a change outside the guides.

The pipeline's usual staleness question is "does this shot still match its
placeholder", and a human answers it by opening the image. This script answers a
different one: **which images did a global style change break?** — where nothing
in any guide changed, no placeholder moved, and so nothing prompts a re-read.

That happened on 2026-08-15. The themed canvas moved from `body` to `html` so it
would also cover the browser's stable scrollbar gutter; before the fix the gutter
showed the browser's default white, which against dark page content read as a
15px white strip down the right edge. It touched no guide and no manifest entry.
The first instinct was to tell the team to triage all 429 images by eye. Running
the check instead took about a second and returned 39, of which exactly one was
worth re-shooting on its own account.

**That is the lesson worth keeping: measure before assigning a sweep.** A vague
"check every image" costs real hours and reliably under-delivers, because a
reviewer looking at 429 images stops seeing a 15px strip somewhere around the
fortieth.

The second lesson is in `check_unpainted_gutter` and cost a wrong answer before
it was learned: the first version of that check reported *three*, because it
pre-filtered on whole-image brightness and so hid every modal capture. Read it
before adding a check of your own.

Usage:
    python3 scripts/screenshots/audit_images.py                  # all checks
    python3 scripts/screenshots/audit_images.py --check edges    # one check
    python3 scripts/screenshots/audit_images.py --dir path/to/images

    # what CI runs: fail only on findings that are not already known
    python3 scripts/screenshots/audit_images.py \
        --baseline scripts/screenshots/audit_baseline.txt

Without `--baseline` every finding is reported and the exit code is 1 if there
are any — the ad-hoc audit. With one, known filenames are reported but tolerated
and only *new* findings fail, which is what makes this runnable against an
existing backlog. A baselined image that no longer flags also fails, so the list
shrinks as work is done instead of silently suppressing future regressions on
those same files.

Requires Pillow, already pinned for the backend (`backend/requirements.txt`).
It is deliberately not part of a capture run — this is an occasional audit.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - dependency is optional by design
    sys.exit("Pillow is required: pip install pillow")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IMAGE_DIR = REPO_ROOT / "docs" / "training" / "images"


# Rec. 709 luma. Perceptual weighting matters here: a mid-blue gradient and a
# mid-grey desk have similar naive RGB averages but read very differently.
def _luma(pixel: tuple[int, int, int]) -> float:
    r, g, b = pixel
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _mean_luma(image: Image.Image, sample: int = 32) -> float:
    """Average brightness of the whole image, from a cheap downscale.

    Reads the raw buffer rather than `getdata()`, which Pillow deprecates in 14
    — the replacement (`get_flattened_data`) does not exist in the pinned 12.3,
    so the buffer is the option that works on both without a warning.
    """
    raw = image.resize((sample, sample)).tobytes()  # RGB, 3 bytes per pixel
    count = len(raw) // 3
    total = sum(_luma((raw[i], raw[i + 1], raw[i + 2])) for i in range(0, count * 3, 3))
    return total / count


def check_unpainted_gutter(image: Image.Image) -> str | None:
    """Flag an unpainted scrollbar gutter on a dark-mode capture.

    Detection triggers on **dark content at the right edge, not a dark page** —
    the edge is compared with the content just inside it, never with the page
    average. That distinction is the whole reason this is a script. The first
    pass pre-filtered on **whole-image** brightness, assuming only dark-mode
    captures could be affected, and reported three images. The real number was
    39: every modal shot is bright overall and dark exactly where it matters. A
    filter that encodes the assumption you are testing will confirm it.

    Detection is deliberately kept that way even though the *report* is now
    narrowed to dark pages — see the note beside the `page >= 90` return, which
    explains why classifying after the fact is not the same mistake, and what
    the narrowing gives up.
    """
    width, height = image.size
    if width < 200 or height < 200:
        return None

    # Sample the vertical middle: page headers and footers are often light even
    # on a dark page, and would mask the strip.
    rows = range(int(height * 0.3), int(height * 0.7), max(1, height // 40))
    if not rows:
        return None

    edge = sum(_luma(image.getpixel((width - 3, y))) for y in rows) / len(list(rows))
    inner = sum(_luma(image.getpixel((width - 40, y))) for y in rows) / len(list(rows))

    # A bright edge against clearly darker content just inside it. The 90-point
    # gap is well above antialiasing on a border or a scrollbar thumb.
    if edge < 200 or (edge - inner) < 90:
        return None

    # Measure the strip so the report can say whether it is the gutter (~15px)
    # or something wider that is probably a real part of the design.
    mid = height // 2
    strip = 0
    for x in range(width - 1, 0, -1):
        if _luma(image.getpixel((x, mid))) > 200:
            strip += 1
        else:
            break

    if strip > 40:
        return None  # too wide to be a scrollbar gutter; likely intentional

    # Severity, so the report can be acted on without opening 39 files. What the
    # gutter changed *to* depends on the capture's theme: on a dark page the old
    # white strip became a dark gradient (obvious), on a light page it became a
    # pale one (a 15px difference nobody will notice). Only the first tier is
    # worth a re-shoot on its own account.
    # Only a dark page is reported. This used to be a severity *label* on a
    # finding that was reported either way, and the light-page half of it was
    # retired on 2026-09-06 because it had stopped carrying information.
    #
    # On a light page the strip is structural, not a defect. A dialog's scrim is
    # `position: fixed; inset: 0`, and a fixed box is laid out against the
    # initial containing block, which excludes the gutter that
    # `scrollbar-gutter: stable` reserves on the root. The scrim stops 15px
    # short of the window edge *by definition*, so the gutter keeps showing the
    # root gradient beside a dimmed page. No re-capture can clear it, and every
    # modal screenshot a guide gains lands here: the baseline reached 42
    # entries, all of them this one case, none actionable. The last screenshot
    # pass re-captured 424 images and produced exactly two findings, both of
    # them this.
    #
    # **This is the page-brightness predicate the docstring warns about, used
    # for the opposite purpose**, which is worth stating plainly rather than
    # leaving for someone to notice. There it was a *pre-filter* deciding which
    # images to examine, and it hid 36 real defects. Here detection is
    # untouched — the edge-versus-inner comparison still runs on every image —
    # and brightness only classifies what was already found.
    #
    # What this gives up: a gutter that went genuinely white on a *light* page
    # would now be silent. That cannot happen on its own. The cause was the root
    # carrying a background image and no background colour, so the reserved
    # gutter fell back to the browser's white — a property of the canvas, not of
    # any one page. A regression paints every dark-mode capture the same way,
    # and those still report here.
    page = _mean_luma(image)
    if page >= 90:
        return None

    return (
        f"{strip}px strip at right edge, page luma {page:.0f} — "
        "dark page, gutter unpainted against dark content"
    )


CHECKS = {
    "edges": (
        check_unpainted_gutter,
        "unpainted scrollbar gutter against dark content",
    ),
}


def load_baseline(path: Path) -> set[str]:
    """Filenames already known to be flagged. Blank lines and `#` are ignored."""
    if not path.exists():
        return set()
    entries = set()
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            entries.add(line)
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dir", type=Path, default=DEFAULT_IMAGE_DIR)
    parser.add_argument(
        "--check",
        choices=sorted(CHECKS),
        action="append",
        help="run only this check (repeatable); default runs all",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        help=(
            "file of already-known flagged filenames. Those are reported but do "
            "not fail; anything new does. This is what makes the check usable in "
            "CI against a backlog."
        ),
    )
    args = parser.parse_args()

    selected = args.check or sorted(CHECKS)
    files = sorted(args.dir.glob("*.png"))
    if not files:
        print(f"No PNGs found in {args.dir}")
        return 0

    findings: list[tuple[str, str, str]] = []
    for path in files:
        try:
            image = Image.open(path).convert("RGB")
        except OSError as exc:
            findings.append((path.name, "unreadable", str(exc)))
            continue
        for name in selected:
            check, _ = CHECKS[name]
            detail = check(image)
            if detail:
                findings.append((path.name, name, detail))

    # `--dir` is documented as taking any directory, so it may well sit outside
    # the repository — relative_to() raises for those, and raising *after* every
    # check has run would throw away the whole audit.
    try:
        shown = args.dir.relative_to(REPO_ROOT)
    except ValueError:
        shown = args.dir

    print(f"Checked {len(files)} images in {shown}")
    for name in selected:
        print(f"  - {name}: {CHECKS[name][1]}")

    if args.baseline is None:
        # Ad-hoc audit: report everything, and say so by exiting non-zero.
        if not findings:
            print("\nNothing flagged.")
            return 0
        print(f"\n{len(findings)} flagged:\n")
        for filename, check_name, detail in findings:
            print(f"  {filename}\n      [{check_name}] {detail}")
        print(
            "\nRecord these in docs/training/SCREENSHOT_CURRENCY.md with the"
            "\nmeasurement, not as 'check everything' — the point of this script"
            "\nis the short list."
        )
        return 1

    known = load_baseline(args.baseline)
    flagged = {name for name, _, _ in findings}
    new = [f for f in findings if f[0] not in known]
    # A baselined image that no longer flags has been fixed. Failing on that is
    # deliberate: it costs one deleted line and keeps the baseline shrinking,
    # whereas tolerating stale entries lets it suppress real regressions on those
    # exact files forever.
    stale = sorted(known - flagged)

    if known:
        print(f"\n{len(known - set(stale))} known, from {args.baseline.name}")

    if not new and not stale:
        print("No new findings.")
        return 0

    if new:
        print(f"\n{len(new)} NEW — not in the baseline:\n")
        for filename, check_name, detail in new:
            print(f"  {filename}\n      [{check_name}] {detail}")
        print(
            "\nEither re-capture these, or add them to"
            f"\n{args.baseline} with a note saying why they are acceptable."
        )

    if stale:
        noun = "entry" if len(stale) == 1 else "entries"
        print(f"\n{len(stale)} baseline {noun} no longer flag — delete:\n")
        for filename in stale:
            print(f"  {filename}")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
