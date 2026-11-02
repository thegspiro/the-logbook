"""The pure rules behind evaluations: coverage dates, suggested scores, what a
saved answer may hold, what a submitted one must, and the weighted overall."""

from datetime import date
from types import SimpleNamespace

import pytest

from app.schemas.evaluation import PartContent, TemplateDefinition
from app.services.evaluation_data_service import (
    compute_coverage,
    first_full_month,
    sources_used,
    suggested_score,
)
from app.services.evaluation_service import (
    completeness_errors,
    form_definition,
    form_items,
    shape_errors,
    weighted_overall,
)

pytestmark = [pytest.mark.unit]

LEVELS = [{"value": v, "label": f"L{v}", "anchor": f"A{v}"} for v in range(1, 6)]
DEFINITION = TemplateDefinition.model_validate(
    {
        "overall_mode": "weighted",
        "officer_ranks": ["captain"],
        "sections": [
            {
                "key": "core",
                "title": "Core",
                "items": [
                    {
                        "key": "attendance",
                        "label": "Attendance",
                        "tool": "labeled_scale",
                        "levels": LEVELS,
                        "weight": 60,
                        "require_example_for": [5],
                        "data_block": {
                            "source": "training.hours",
                            "scoring_rule": {
                                "bands": [
                                    {"min": 0, "max": 10, "score": 2},
                                    {"min": 10, "score": 4},
                                ]
                            },
                        },
                    },
                    {
                        "key": "teamwork",
                        "label": "Teamwork",
                        "tool": "meets",
                        "weight": 40,
                        "allow_na": True,
                    },
                    {
                        "key": "goals",
                        "label": "Goals",
                        "tool": "goals",
                        "include_in_self_evaluation": False,
                    },
                    {
                        "key": "gear",
                        "label": "Gear",
                        "tool": "checklist",
                        "checklist_options": ["SCBA", "Radio"],
                        "comment": "required",
                    },
                ],
            },
            {
                "key": "leadership",
                "title": "Leadership",
                "officer_only": True,
                "items": [
                    {
                        "key": "lead",
                        "label": "Leads the crew",
                        "tool": "narrative",
                        "data_block": {"source": "positions.held"},
                    }
                ],
            },
        ],
    }
)
EVALUATOR = "evaluator"
SELF = "self_evaluation"


def _content(**answers) -> PartContent:
    return PartContent.model_validate({"answers": answers})


class TestCoverage:
    @pytest.mark.parametrize(
        ("joined", "first"),
        [
            (date(2026, 11, 1), date(2026, 11, 1)),
            (date(2026, 11, 14), date(2026, 12, 1)),
            (date(2026, 12, 31), date(2027, 1, 1)),
            (date(2026, 1, 30), date(2026, 2, 1)),
        ],
    )
    def test_first_full_month(self, joined, first):
        assert first_full_month(joined) == first

    def test_a_member_who_joined_in_november_is_measured_from_december(self):
        coverage = compute_coverage(
            date(2026, 1, 1), date(2026, 12, 31), [(date(2026, 11, 14), None)], []
        )
        assert coverage is not None
        assert (coverage.start, coverage.end) == (date(2026, 12, 1), date(2026, 12, 31))

    def test_a_member_who_joined_after_the_period_has_no_coverage(self):
        assert (
            compute_coverage(
                date(2026, 1, 1), date(2026, 12, 31), [(date(2026, 12, 2), None)], []
            )
            is None
        )

    def test_the_gap_between_stints_and_a_leave_are_excluded(self):
        leave = SimpleNamespace(start_date=date(2026, 8, 10), end_date=None)
        coverage = compute_coverage(
            date(2026, 1, 1),
            date(2026, 12, 31),
            [(date(2019, 3, 1), date(2026, 3, 31)), (date(2026, 6, 20), None)],
            [leave],
        )
        assert coverage is not None
        assert coverage.start == date(2026, 1, 1)
        excluded = [(r.start, r.end, r.reason) for r in coverage.excluded]
        # The rejoining stint is measured from its first full month, July.
        assert excluded == [
            (date(2026, 4, 1), date(2026, 6, 30), "separation"),
            (date(2026, 8, 10), date(2026, 12, 31), "leave"),
        ]
        assert coverage.excludes(date(2026, 5, 5))
        assert not coverage.excludes(date(2026, 7, 5))

    def test_a_separated_member_is_measured_to_their_last_day(self):
        coverage = compute_coverage(
            date(2026, 1, 1),
            date(2026, 12, 31),
            [(date(2020, 1, 1), date(2026, 9, 15))],
            [],
        )
        assert coverage is not None
        assert coverage.end == date(2026, 9, 15)


class TestSuggestedScore:
    RULE = {"bands": [{"min": 0, "max": 50, "score": 2}, {"min": 50, "score": 4}]}

    @pytest.mark.parametrize(
        ("value", "score"), [(0, 2), (49.9, 2), (50, 4), (100, 4), (None, None)]
    )
    def test_bands_are_min_inclusive_max_exclusive(self, value, score):
        assert suggested_score(self.RULE, value) == score

    def test_a_list_or_boolean_is_never_scored(self):
        assert suggested_score(self.RULE, [1]) is None
        assert suggested_score(self.RULE, True) is None


class TestForm:
    def test_officer_sections_only_for_officers(self):
        assert [s.key for s in form_definition(DEFINITION, False).sections] == ["core"]
        assert [s.key for s in form_definition(DEFINITION, True).sections] == [
            "core",
            "leadership",
        ]

    def test_sources_follow_the_sections_shown(self):
        assert sources_used(DEFINITION, False) == ["training.hours"]
        assert sources_used(DEFINITION, True) == ["training.hours", "positions.held"]

    def test_a_self_evaluation_answers_only_the_items_included_in_it(self):
        items = form_items(form_definition(DEFINITION, False), SELF)
        assert sorted(items) == ["attendance", "gear", "teamwork"]


class TestShape:
    items = form_items(form_definition(DEFINITION, False), EVALUATOR)

    def test_a_rating_off_the_scale_is_refused(self):
        errors = shape_errors(_content(attendance={"rating": 7}), self.items, EVALUATOR)
        assert errors == ["'Attendance': that rating is not on its scale."]

    def test_an_unknown_item_is_refused(self):
        assert shape_errors(_content(lead={"text": "x"}), self.items, EVALUATOR) == [
            "'lead' is not on this form."
        ]

    def test_a_checklist_option_must_be_on_its_list(self):
        errors = shape_errors(
            _content(gear={"checked": ["Axe"]}), self.items, EVALUATOR
        )
        assert errors == ["'Gear': an option checked is not on its list."]

    def test_na_only_where_allowed(self):
        assert (
            shape_errors(_content(teamwork={"na": True}), self.items, EVALUATOR) == []
        )
        assert shape_errors(
            _content(attendance={"na": True}), self.items, EVALUATOR
        ) == ["'Attendance' cannot be marked N/A."]

    def test_only_the_evaluator_justifies_or_gives_an_overall(self):
        items = form_items(form_definition(DEFINITION, False), SELF)
        content = PartContent.model_validate(
            {
                "answers": {"attendance": {"rating": 3, "justification": "x"}},
                "overall_rating": 3,
            }
        )
        assert shape_errors(content, items, SELF) == [
            "'Attendance': only the evaluator justifies a score.",
            "Only the evaluator gives an overall rating.",
        ]

    def test_a_blank_text_field_is_stored_as_none(self):
        assert _content(goals={"text": "   "}).answers["goals"].text is None


class TestCompleteness:
    items = form_items(form_definition(DEFINITION, False), EVALUATOR)

    def test_everything_unanswered_is_listed(self):
        errors = completeness_errors(_content(), self.items, EVALUATOR, "weighted", {})
        assert errors == [
            "Rate 'Attendance'.",
            "Rate 'Teamwork'.",
            "Answer 'Goals'.",
            "'Gear' needs a comment.",
        ]

    def test_departing_from_the_suggested_score_needs_a_reason(self):
        content = _content(
            attendance={"rating": 3},
            teamwork={"rating": 1},
            goals={"text": "Lead a drill"},
            gear={"comment": "All good"},
        )
        errors = completeness_errors(
            content, self.items, EVALUATOR, "weighted", {"attendance": 4}
        )
        assert errors == [
            "'Attendance': explain why the score differs from the 4 the figures suggest."
        ]
        content.answers["attendance"].justification = "Missed two drills."
        assert (
            completeness_errors(
                content, self.items, EVALUATOR, "weighted", {"attendance": 4}
            )
            == []
        )

    def test_a_self_evaluation_needs_no_justification(self):
        items = form_items(form_definition(DEFINITION, False), SELF)
        content = _content(
            attendance={"rating": 3}, teamwork={"rating": 1}, gear={"comment": "ok"}
        )
        assert (
            completeness_errors(content, items, SELF, "weighted", {"attendance": 4})
            == []
        )

    def test_a_level_that_requires_an_example(self):
        content = _content(
            attendance={"rating": 5, "justification": "Strong year"},
            teamwork={"na": True},
            goals={"text": "x"},
            gear={"comment": "ok"},
        )
        assert completeness_errors(content, self.items, EVALUATOR, "weighted", {}) == [
            "'Attendance': describe a specific example."
        ]

    def test_an_evaluator_chosen_overall_is_required(self):
        content = _content(
            attendance={"rating": 3},
            teamwork={"rating": 1},
            goals={"text": "x"},
            gear={"comment": "ok"},
        )
        assert completeness_errors(content, self.items, EVALUATOR, "evaluator", {}) == [
            "Choose an overall rating."
        ]


class TestWeightedOverall:
    items = form_items(form_definition(DEFINITION, False), EVALUATOR)

    def test_each_rating_is_placed_on_its_own_scale(self):
        # Attendance 3 of 1..5 is 50%, teamwork "meets" is 100%:
        # (60 * 50 + 40 * 100) / 100 = 70.
        content = _content(attendance={"rating": 3}, teamwork={"rating": 1})
        assert weighted_overall(content, self.items) == 70.0

    def test_na_shares_its_weight_with_the_rest(self):
        content = _content(attendance={"rating": 5}, teamwork={"na": True})
        assert weighted_overall(content, self.items) == 100.0

    def test_nothing_rated_is_no_overall(self):
        assert weighted_overall(_content(), self.items) is None
