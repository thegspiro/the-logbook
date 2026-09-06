"""Regression tests for the screenshot audit's unpainted-gutter check.

The check had no tests when its "subtle" tier was retired on 2026-09-06, and
that tier's removal is the kind of change that is indistinguishable from
breaking the check outright: both make the audit stop reporting things. These
cases pin the distinction.

The subtle tier reported a light page captured under a modal scrim. That is not
a regression signal and never could be — a scrim is `position: fixed; inset: 0`
and so is laid out against the initial containing block, which excludes the
gutter `scrollbar-gutter: stable` reserves on the root, so the scrim stops 15px
short of the window edge by definition. It reported one constant forever and
failed CI on every new modal screenshot, which is what turned `main` red after a
routine capture refresh (#2320) and blocked four unrelated PRs.

The dark-page tier is a real defect and stays. Retiring one while keeping the
other is the whole content of the change, so both halves are asserted here.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import os
import sys
import unittest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots")
)

try:
    from PIL import Image
except ImportError:  # pragma: no cover - exercised only where Pillow is absent
    Image = None

if Image is not None:
    from audit_images import check_unpainted_gutter
else:  # pragma: no cover
    check_unpainted_gutter = None


GUTTER_PX = 15
SIZE = (400, 400)


def capture(page: tuple[int, int, int], gutter: tuple[int, int, int] | None):
    """A synthetic screenshot: a flat page, optionally with a bright gutter.

    `gutter=None` is the fixed state — the reserved strip painted in the page's
    own colour, which is what the root `background-color` now produces.
    """
    image = Image.new("RGB", SIZE, page)
    if gutter is not None:
        for x in range(SIZE[0] - GUTTER_PX, SIZE[0]):
            for y in range(SIZE[1]):
                image.putpixel((x, y), gutter)
    return image


WHITE = (255, 255, 255)
DARK_PAGE = (20, 22, 28)
# A dimmed page under a dialog scrim: light enough overall to clear the 90-luma
# dark-page threshold, still far enough below the white gutter to trip the
# edge-vs-content comparison. The real captures that drove this change measured
# 134 and 159; an earlier fixture here used (70, 72, 78), which reads as luma 79
# and is therefore a *dark* page — it tested the surviving tier while claiming to
# test the retired one.
SCRIMMED_PAGE = (130, 130, 130)


@unittest.skipIf(Image is None, "Pillow is not installed")
class TestUnpaintedGutter(unittest.TestCase):
    def test_a_dark_page_with_a_white_gutter_is_still_reported(self):
        """The tier that survived. Removing this one would be the real break."""
        detail = check_unpainted_gutter(capture(DARK_PAGE, WHITE))

        assert detail is not None, "the dark-page tier must still fire"
        assert "STARK" in detail
        assert f"{GUTTER_PX}px strip" in detail

    def test_a_light_page_under_a_scrim_is_not_reported(self):
        """The retired tier. A scrim cannot cover the gutter, so this is a
        constant rather than a regression — and every modal capture has it."""
        scrimmed = capture(SCRIMMED_PAGE, WHITE)

        # The fixture really is the shape the old tier caught: bright edge,
        # clearly darker content beside it. Asserting that here means this test
        # cannot pass merely because the image failed the check's entry
        # conditions for some unrelated reason.
        assert scrimmed.getpixel((SIZE[0] - 3, SIZE[1] // 2))[0] > 200
        assert scrimmed.getpixel((SIZE[0] - 40, SIZE[1] // 2))[0] < 165

        assert check_unpainted_gutter(scrimmed) is None

    def test_no_gutter_is_never_reported(self):
        """A page whose reserved strip is painted in the theme colour."""
        assert check_unpainted_gutter(capture(DARK_PAGE, None)) is None
        assert check_unpainted_gutter(capture(SCRIMMED_PAGE, None)) is None

    def test_a_wide_bright_band_is_not_a_gutter(self):
        """Wider than a scrollbar means it is part of the design. Unchanged by
        the tier retirement, and pinned so a rewrite of the severity block
        cannot quietly drop it."""
        image = Image.new("RGB", SIZE, DARK_PAGE)
        for x in range(SIZE[0] - 60, SIZE[0]):
            for y in range(SIZE[1]):
                image.putpixel((x, y), WHITE)

        assert check_unpainted_gutter(image) is None


if __name__ == "__main__":
    unittest.main()
