"""A box that asks no intake questions stores NULL, and the review summary
serialises the stored box directly. Workflow review W58 found that NULL took
the summary down with a 500 for every reviewer of such a box, so the Review
tab never appeared for them."""

from types import SimpleNamespace

import pytest

from app.schemas.suggestion import ReviewSummary

pytestmark = pytest.mark.unit


def _box(intake_questions):
    return SimpleNamespace(
        id="box-1",
        name="Station ideas",
        description=None,
        anonymity_mode="allowed",
        follow_up_enabled=True,
        public_board_enabled=True,
        intake_questions=intake_questions,
    )


def test_a_box_with_no_questions_serialises_with_an_empty_list():
    summary = ReviewSummary.model_validate(
        {"is_reviewer": True, "open_count": 2, "boxes": [_box(None)]}
    )

    assert summary.boxes[0].intake_questions == []


def test_a_box_with_questions_keeps_them():
    question = {
        "id": "q1",
        "label": "Which station?",
        "type": "text",
        "required": False,
    }
    summary = ReviewSummary.model_validate(
        {"is_reviewer": True, "open_count": 0, "boxes": [_box([question])]}
    )

    assert summary.boxes[0].intake_questions[0].label == "Which station?"
