"""
Unit tests for the screenshot placeholder applier's placement rule.

`apply_placeholders.py` rewrites the training guides, so a mistake here does
not fail loudly — it stamps an image into the wrong section under a caption
that describes something else, and the run reports it as a success. The rule
worth pinning is the one that decides *which* placeholder a shot fills.
"""

import importlib.util
from pathlib import Path

import pytest

pytestmark = [pytest.mark.unit]

SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "scripts"
    / "screenshots"
    / "apply_placeholders.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("apply_placeholders", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


apply_placeholders = _load()


GUIDE = [
    "## Reviewers",
    "",
    "> **[SCREENSHOT NEEDED]:** _Screenshot of the Flagged tab showing",
    "> previously flagged reports with a Re-Review Report button._",
    "",
    "**For Trainees:**",
    "",
    "> **[SCREENSHOT NEEDED]:** _Screenshot of the review modal showing",
    "> review status options, redaction checkboxes and reviewer notes._",
    "",
]


def test_hint_is_used_when_it_lands_on_this_shot():
    index = apply_placeholders.locate(
        GUIDE,
        {"line": 8, "anchor": "Screenshot of the review modal showing"},
    )
    assert index == 7


def test_a_hint_pointing_at_another_placeholder_is_not_trusted():
    """The bug: any marker at the hinted line was accepted.

    Editing the prose above pushes a placeholder down, the stale line number
    lands on its neighbour, and the image is stamped into the wrong section.
    The anchor has to agree before the hint is believed.
    """
    index = apply_placeholders.locate(
        GUIDE,
        # Line 3 is the *Flagged* placeholder, not the review modal's.
        {"line": 3, "anchor": "Screenshot of the review modal showing"},
    )
    assert index == 7


def test_falls_back_to_the_anchor_when_the_hint_misses_entirely():
    index = apply_placeholders.locate(
        GUIDE,
        {"line": 999, "anchor": "Screenshot of the Flagged tab showing"},
    )
    assert index == 2


def test_an_anchor_matching_two_placeholders_places_neither():
    """Guessing between them would put the image in the wrong section."""
    index = apply_placeholders.locate(
        GUIDE,
        {"line": 999, "anchor": "Screenshot of the"},
    )
    assert index is None


def test_a_shot_with_no_anchor_still_honours_its_hint():
    index = apply_placeholders.locate(GUIDE, {"line": 3, "anchor": ""})
    assert index == 2


def test_a_hint_on_ordinary_prose_finds_nothing_without_an_anchor():
    index = apply_placeholders.locate(GUIDE, {"line": 1, "anchor": ""})
    assert index is None
