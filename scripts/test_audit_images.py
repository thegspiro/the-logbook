"""Regression tests for the screenshot gutter check's reporting contract.

`check_unpainted_gutter` reported two classes until 2026-09-06: a dark page with
an unpainted gutter (the real defect), and a light page under a dialog scrim
showing a pale strip (structural, unfixable by re-capture). The second was
retired because it could only ever grow — 42 baseline entries, all of it, none
actionable — and these cases pin what that retirement did and did not change.

The synthetic images are built rather than loaded so the contract is tested
independently of whatever `docs/training/images` happens to hold; the script's
own CI run against that directory is what tests it on real captures.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent / "screenshots"))

from audit_images import check_unpainted_gutter  # noqa: E402


def capture(page: tuple[int, int, int], strip: tuple[int, int, int], width: int = 15):
    """A 1440x900 page with a `width`px vertical strip down its right edge."""
    image = Image.new("RGB", (1440, 900), page)
    for x in range(1440 - width, 1440):
        for y in range(900):
            image.putpixel((x, y), strip)
    return image


DARK_PAGE = (18, 18, 20)
SCRIMMED_PAGE = (150, 150, 150)  # a light page dimmed by a dialog overlay
WHITE = (255, 255, 255)
PALE = (250, 250, 250)


class TheRealDefectStillReports(unittest.TestCase):
    """The regression this check exists for: the root carrying a background
    image and no background colour, so the reserved gutter falls back to the
    browser's white. It is a canvas-level property, so it shows on every
    dark-mode capture — which is what makes narrowing to dark pages safe."""

    def test_dark_page_with_an_unpainted_gutter_is_reported(self):
        detail = check_unpainted_gutter(capture(DARK_PAGE, WHITE))
        assert detail is not None
        assert "dark page" in detail
        assert "15px strip" in detail


class TheRetiredTierIsSilent(unittest.TestCase):
    def test_light_page_under_a_scrim_is_not_reported(self):
        assert check_unpainted_gutter(capture(SCRIMMED_PAGE, PALE)) is None

    def test_a_white_strip_on_a_light_page_is_also_silent(self):
        """What the narrowing gives up, pinned deliberately rather than left to
        be rediscovered as a bug. A light-page-only white gutter cannot occur in
        isolation — the cause is the canvas, not any one page — so this costs no
        signal, but it is a real gap and should read as a decision."""
        assert check_unpainted_gutter(capture(SCRIMMED_PAGE, WHITE)) is None


class DetectionIsUnchanged(unittest.TestCase):
    """Narrowing happens after detection, never as a pre-filter. The first
    version of this audit pre-filtered on whole-image brightness and hid 36 real
    defects; these keep the edge-versus-inner comparison honest."""

    def test_no_strip_is_not_reported(self):
        assert check_unpainted_gutter(Image.new("RGB", (1440, 900), DARK_PAGE)) is None

    def test_a_band_too_wide_to_be_a_gutter_is_not_reported(self):
        assert check_unpainted_gutter(capture(DARK_PAGE, WHITE, width=60)) is None

    def test_an_image_too_small_to_judge_is_not_reported(self):
        assert check_unpainted_gutter(Image.new("RGB", (150, 150), DARK_PAGE)) is None


if __name__ == "__main__":
    unittest.main()
