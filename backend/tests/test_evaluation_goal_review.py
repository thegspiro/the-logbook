"""The goal-review item: what a form may declare, what a saved and a submitted
answer may hold, how the copied goals enter the record hash, and how the PDF
prints them."""

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.evaluation import ItemAnswer, PartContent, TemplateDefinition
from app.services.evaluation_document_service import _goal_review_answer
from app.services.evaluation_service import (
    completeness_errors,
    content_hash,
    form_items,
    goal_keys_under_review,
    shape_errors,
)

pytestmark = [pytest.mark.unit]

EVALUATOR = "evaluator"
LEVELS = [{"value": v, "label": f"L{v}", "anchor": f"A{v}"} for v in range(1, 6)]
GOAL_REVIEW = {
    "key": "last_goals",
    "label": "Last year's goals",
    "tool": "goal_review",
}
DEFINITION = TemplateDefinition.model_validate(
    {
        "overall_mode": "weighted",
        "sections": [
            {
                "key": "core",
                "title": "Core",
                "items": [
                    {
                        "key": "skills",
                        "label": "Skills",
                        "tool": "labeled_scale",
                        "levels": LEVELS,
                        "weight": 100,
                    },
                    GOAL_REVIEW,
                ],
            }
        ],
    }
)
ITEMS = form_items(DEFINITION, EVALUATOR)
GOALS = frozenset({"goals", "stretch"})
FROZEN = {
    "evaluation_id": "last-year",
    "period_name": "2025 Annual",
    "period_start": "2025-01-01",
    "period_end": "2025-12-31",
    "goals": [
        {"key": "goals", "label": "Goals", "text": "Lead two drills."},
        {"key": "stretch", "label": "Stretch goal", "text": "Earn Officer I."},
    ],
}


def _content(**answers) -> PartContent:
    return PartContent.model_validate({"answers": answers})


def _definition(*items: dict) -> dict:
    return {
        "overall_mode": "none",
        "sections": [{"key": "s", "title": "S", "items": list(items)}],
    }


class TestTheFormDeclaresIt:
    def test_a_goal_review_takes_no_figures(self):
        with pytest.raises(ValidationError, match="takes no figures"):
            TemplateDefinition.model_validate(
                _definition({**GOAL_REVIEW, "data_block": {"source": "training.hours"}})
            )

    def test_each_goal_is_marked_not_applicable_rather_than_the_item(self):
        with pytest.raises(ValidationError, match="not applicable on its own"):
            TemplateDefinition.model_validate(
                _definition({**GOAL_REVIEW, "allow_na": True})
            )

    def test_a_form_has_one_goal_review_at_most(self):
        with pytest.raises(ValidationError, match="Only one item"):
            TemplateDefinition.model_validate(
                _definition(GOAL_REVIEW, {**GOAL_REVIEW, "key": "again"})
            )

    def test_a_goal_review_carries_no_weight(self):
        with pytest.raises(ValidationError, match="only a rated item"):
            TemplateDefinition.model_validate(
                _definition({**GOAL_REVIEW, "weight": 10})
            )


class TestASavedAnswer:
    def test_a_rating_for_a_copied_goal_is_accepted(self):
        content = _content(last_goals={"goal_ratings": {"goals": {"result": "met"}}})
        assert shape_errors(content, ITEMS, EVALUATOR, GOALS) == []

    def test_a_goal_not_copied_into_the_evaluation_is_refused(self):
        content = _content(last_goals={"goal_ratings": {"other": {"result": "met"}}})
        assert shape_errors(content, ITEMS, EVALUATOR, GOALS) == [
            "'Last year's goals': a goal rated is not among the last review's goals."
        ]

    def test_only_a_goal_review_rates_goals(self):
        content = _content(
            skills={"rating": 3, "goal_ratings": {"goals": {"result": "met"}}}
        )
        assert shape_errors(content, ITEMS, EVALUATOR, GOALS) == [
            "'Skills' does not rate goals."
        ]

    def test_an_unknown_result_is_refused(self):
        with pytest.raises(ValidationError):
            ItemAnswer.model_validate({"goal_ratings": {"goals": {"result": "done"}}})

    def test_a_blank_comment_is_stored_as_none(self):
        answer = ItemAnswer.model_validate(
            {"goal_ratings": {"goals": {"result": "met", "comment": "  "}}}
        )
        assert answer.goal_ratings["goals"].comment is None


class TestASubmittedAnswer:
    def test_every_copied_goal_needs_a_result(self):
        content = _content(
            skills={"rating": 3},
            last_goals={"goal_ratings": {"goals": {"result": "met"}}},
        )
        assert completeness_errors(
            content, ITEMS, EVALUATOR, "weighted", {}, GOALS
        ) == ["'Last year's goals': rate each of the last review's goals."]

    def test_a_goal_that_no_longer_applies_counts_as_rated(self):
        content = _content(
            skills={"rating": 3},
            last_goals={
                "goal_ratings": {
                    "goals": {"result": "partly_met"},
                    "stretch": {"result": "not_applicable"},
                }
            },
        )
        assert (
            completeness_errors(content, ITEMS, EVALUATOR, "weighted", {}, GOALS) == []
        )

    def test_nothing_is_needed_when_the_last_review_set_no_goals(self):
        content = _content(skills={"rating": 3})
        assert completeness_errors(content, ITEMS, EVALUATOR, "weighted", {}) == []


def _evaluation(snapshot: dict) -> SimpleNamespace:
    return SimpleNamespace(
        id="ev-1",
        revision=1,
        template_version_id="tv-1",
        member_id="m-1",
        evaluator_id="e-1",
        period_start=date(2025, 1, 1),
        period_end=date(2025, 12, 31),
        coverage_start=date(2025, 1, 1),
        coverage_end=date(2025, 12, 31),
        excluded_ranges=[],
        data_snapshot=snapshot,
    )


PART = SimpleNamespace(
    content={"answers": {"training": {"rating": 4}}},
    status="submitted",
    submitted_at=datetime(2025, 12, 20, tzinfo=timezone.utc),
)
FIGURES = {"values": {"training.hours": {"available": True, "value": 12}}}


class TestTheRecordHash:
    def test_a_record_without_copied_goals_hashes_as_before_goal_reviews(self):
        # Taken from content_hash before goal reviews existed: an evaluation
        # signed then must still verify.
        assert content_hash(_evaluation(FIGURES), {"evaluator": PART}) == (
            "eba124b1e21a3a8f5983b11661ced4a01966b3392873b284301048dee73c6f9c"
        )

    def test_the_copied_goals_are_part_of_what_is_signed(self):
        with_goals = _evaluation({**FIGURES, "previous_goals": FROZEN})
        changed = _evaluation(
            {
                **FIGURES,
                "previous_goals": {
                    **FROZEN,
                    "goals": [{**FROZEN["goals"][0], "text": "Lead one drill."}],
                },
            }
        )
        plain = content_hash(_evaluation(FIGURES), {"evaluator": PART})
        signed = content_hash(with_goals, {"evaluator": PART})
        assert signed != plain
        assert content_hash(changed, {"evaluator": PART}) != signed

    def test_the_goals_copied_are_the_keys_a_rating_may_name(self):
        assert goal_keys_under_review(
            _evaluation({"previous_goals": FROZEN})
        ) == frozenset({"goals", "stretch"})
        assert goal_keys_under_review(_evaluation({})) == frozenset()


class TestThePdf:
    def test_each_goal_is_printed_with_its_result_and_comment(self):
        answer = ItemAnswer.model_validate(
            {
                "goal_ratings": {
                    "goals": {"result": "met", "comment": "Led three."},
                    "stretch": {"result": "not_applicable"},
                }
            }
        )
        printed = _goal_review_answer(answer, FROZEN)

        assert printed["answer"] == "2 goals set in the review for 2025 Annual"
        assert printed["notes"] == [
            ("Goals", "Lead two drills.\nResult: Met\nComment: Led three."),
            ("Stretch goal", "Earn Officer I.\nResult: No longer applies"),
        ]

    def test_a_goal_left_unrated_says_so(self):
        printed = _goal_review_answer(None, FROZEN)
        assert printed["notes"][0] == ("Goals", "Lead two drills.\nResult: Not rated")

    def test_no_copied_goals_is_said_plainly(self):
        assert _goal_review_answer(None, None) == {
            "answer": "The previous review set no goals.",
            "notes": [],
        }
