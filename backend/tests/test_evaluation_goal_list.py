"""A Goals item as a list of goals, each with an optional target date: what a
saved answer may hold, how a free-text answer is stored, how the goals are
read for next year's review, and how the PDF prints them."""

from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas.evaluation import ItemAnswer, PartContent, TemplateDefinition
from app.services.evaluation_document_service import _answer, _goal_review_answer
from app.services.evaluation_service import (
    as_goal_list,
    completeness_errors,
    form_items,
    goals_set,
    shape_errors,
)

pytestmark = [pytest.mark.unit]

EVALUATOR = "evaluator"
DEFINITION = TemplateDefinition.model_validate(
    {
        "overall_mode": "none",
        "sections": [
            {
                "key": "dev",
                "title": "Development",
                "items": [
                    {"key": "goals", "label": "Goals", "tool": "goals"},
                    {"key": "notes", "label": "Notes", "tool": "narrative"},
                ],
            }
        ],
    }
)
ITEMS = form_items(DEFINITION, EVALUATOR)
GOALS_ITEM = ITEMS["goals"]


def _content(**answers) -> PartContent:
    return PartContent.model_validate({"answers": answers})


TWO_GOALS = {
    "goals": [
        {"id": "a1", "text": "Lead two drills.", "target_date": "2027-06-30"},
        {"id": "b2", "text": "Earn Officer I."},
    ]
}


class TestASavedAnswer:
    def test_a_list_of_goals_is_accepted_on_a_goals_item(self):
        assert shape_errors(_content(goals=TWO_GOALS), ITEMS, EVALUATOR) == []

    def test_only_a_goals_item_takes_goals(self):
        assert shape_errors(_content(notes=TWO_GOALS), ITEMS, EVALUATOR) == [
            "'Notes' does not take goals."
        ]

    def test_each_goal_needs_its_own_id(self):
        with pytest.raises(ValidationError, match="its own id"):
            ItemAnswer.model_validate(
                {"goals": [{"id": "x", "text": "A"}, {"id": "x", "text": "B"}]}
            )

    @pytest.mark.parametrize("bad", ["", "has space", "a:b", "x" * 41])
    def test_a_goal_id_is_short_and_plain(self, bad):
        with pytest.raises(ValidationError):
            ItemAnswer.model_validate({"goals": [{"id": bad, "text": "A"}]})


class TestTheStoredShape:
    def test_a_free_text_answer_is_stored_as_one_goal(self):
        stored = as_goal_list(_content(goals={"text": "Lead two drills."}), ITEMS)
        answer = stored.answers["goals"]
        assert answer.text is None
        assert [(g.id, g.text, g.target_date) for g in answer.goals] == [
            ("goal-1", "Lead two drills.", None)
        ]

    def test_a_goal_still_blank_is_left_out(self):
        content = _content(
            goals={"goals": [{"id": "a", "text": "Lead."}, {"id": "b", "text": "  "}]}
        )
        assert [g.id for g in as_goal_list(content, ITEMS).answers["goals"].goals] == [
            "a"
        ]

    def test_a_list_is_kept_and_other_items_are_untouched(self):
        content = _content(goals=TWO_GOALS, notes={"text": "Steady."})
        stored = as_goal_list(content, ITEMS)
        assert [g.id for g in stored.answers["goals"].goals] == ["a1", "b2"]
        assert stored.answers["notes"].text == "Steady."
        # The caller's content is not changed in place.
        assert content.answers["goals"].goals[0].id == "a1"


class TestASubmittedAnswer:
    def test_at_least_one_goal_is_needed(self):
        errors = completeness_errors(
            _content(notes={"text": "x"}), ITEMS, EVALUATOR, "none", {}
        )
        assert errors == ["Set at least one goal in 'Goals'."]

    def test_a_goal_on_the_list_or_written_before_satisfies_it(self):
        for goals in (TWO_GOALS, {"text": "Lead two drills."}):
            content = _content(goals=goals, notes={"text": "x"})
            assert completeness_errors(content, ITEMS, EVALUATOR, "none", {}) == []


class TestNextYearsReview:
    def test_each_goal_on_the_list_is_its_own_entry(self):
        assert goals_set(DEFINITION, _content(goals=TWO_GOALS)) == [
            {
                "key": "goals:a1",
                "label": "Goals, goal 1",
                "text": "Lead two drills.",
                "target_date": "2027-06-30",
            },
            {"key": "goals:b2", "label": "Goals, goal 2", "text": "Earn Officer I."},
        ]

    def test_a_single_goal_keeps_the_items_label(self):
        content = _content(goals={"goals": [{"id": "a1", "text": "Lead."}]})
        assert goals_set(DEFINITION, content)[0]["label"] == "Goals"

    def test_goals_written_before_the_list_keep_the_items_key(self):
        content = _content(goals={"text": "Lead two drills."})
        assert goals_set(DEFINITION, content) == [
            {"key": "goals", "label": "Goals", "text": "Lead two drills."}
        ]


class TestThePdf:
    def test_the_goals_print_as_a_numbered_list_with_target_dates(self):
        printed = _answer(GOALS_ITEM, _content(goals=TWO_GOALS), True)
        assert printed is not None
        assert printed["answer"] == (
            "1. Lead two drills. (by Jun 30, 2027)\n2. Earn Officer I."
        )

    def test_a_goal_under_review_prints_its_target(self):
        frozen = {
            "evaluation_id": "last",
            "period_name": "2026 Annual",
            "period_start": "2026-01-01",
            "period_end": "2026-12-31",
            "goals": goals_set(DEFINITION, _content(goals=TWO_GOALS)),
        }
        printed = _goal_review_answer(
            ItemAnswer.model_validate(
                {"goal_ratings": {"goals:a1": {"result": "met"}}}
            ),
            frozen,
        )
        assert printed["notes"] == [
            ("Goals, goal 1", "Lead two drills.\nTarget: Jun 30, 2027\nResult: Met"),
            ("Goals, goal 2", "Earn Officer I.\nResult: Not rated"),
        ]


def test_target_dates_are_dates():
    goal = ItemAnswer.model_validate(TWO_GOALS).goals[0]
    assert goal.target_date == date(2027, 6, 30)
