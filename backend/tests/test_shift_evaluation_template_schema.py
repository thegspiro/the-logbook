"""The evaluation template's write-side shape (Pitfall #20).

``ShiftEvaluationTemplateWrite`` is the only way a template reaches the database,
so these pin what it settles: keys kept or minted, the scale sorted and
checked, seats spelled the way the seat columns spell them, and every bound
that keeps the JSON columns a size a shift report can afford to read.
"""

from typing import get_args

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints import shift_evaluation_templates
from app.models.shift_evaluation import (
    EVALUATOR_RULES,
    GENERAL_EVALUATION_MODES,
    STATISTIC_KEYS,
)
from app.schemas.shift_evaluation import (
    MAX_ITEMS_TOTAL,
    EvaluatorRule,
    GeneralShiftEvaluationMode,
    ShiftEvaluationTemplateWrite,
    StatisticKey,
)
from app.services.sample_evaluation_templates import emt_shift_evaluation_example

pytestmark = pytest.mark.unit


def _body(**overrides) -> dict:
    body = {
        "name": "Driver Evaluation",
        "scale": [
            {"value": 1, "label": "Unsatisfactory"},
            {"value": 2, "label": "Needs Improvement"},
            {"value": 3, "label": "Meets Expectations"},
            {"value": 4, "label": "Exceeds Expectations"},
        ],
        "comment_required_at_or_below": 2,
        "sections": [
            {
                "title": "Driving",
                "items": [{"label": "Backing"}, {"label": "Intersections"}],
            }
        ],
    }
    body.update(overrides)
    return body


class TestVocabulariesAgree:
    def test_schema_literals_match_the_model_tuples(self):
        assert set(get_args(EvaluatorRule)) == set(EVALUATOR_RULES)
        assert set(get_args(GeneralShiftEvaluationMode)) == set(
            GENERAL_EVALUATION_MODES
        )
        assert set(get_args(StatisticKey)) == set(STATISTIC_KEYS)


class TestKeys:
    def test_keys_are_minted_for_new_entries(self):
        body = ShiftEvaluationTemplateWrite.model_validate(_body())
        section = body.sections[0]
        assert section.key
        assert len(section.key) == 12
        keys = [item.key for item in section.items]
        assert all(keys)
        assert len(set(keys)) == 2

    def test_keys_sent_back_are_kept(self):
        body = ShiftEvaluationTemplateWrite.model_validate(
            _body(
                sections=[
                    {
                        "key": "driving",
                        "title": "Driving",
                        "items": [{"key": "backing", "label": "Backing (renamed)"}],
                    }
                ]
            )
        )
        assert body.sections[0].key == "driving"
        assert body.sections[0].items[0].key == "backing"
        assert body.sections[0].items[0].label == "Backing (renamed)"

    def test_a_malformed_key_is_refused(self):
        with pytest.raises(ValidationError, match="Keys may use only"):
            ShiftEvaluationTemplateWrite.model_validate(
                _body(
                    sections=[
                        {
                            "title": "Driving",
                            "items": [{"key": "Bad Key", "label": "x"}],
                        }
                    ]
                )
            )

    def test_an_item_key_repeated_across_sections_is_refused(self):
        with pytest.raises(ValidationError, match="same item key"):
            ShiftEvaluationTemplateWrite.model_validate(
                _body(
                    sections=[
                        {"title": "A", "items": [{"key": "dup", "label": "x"}]},
                        {"title": "B", "items": [{"key": "dup", "label": "y"}]},
                    ]
                )
            )


class TestScale:
    def test_the_scale_is_stored_ascending(self):
        body = ShiftEvaluationTemplateWrite.model_validate(
            _body(
                scale=[
                    {"value": 3, "label": "Three"},
                    {"value": 1, "label": "One"},
                    {"value": 2, "label": "Two"},
                ]
            )
        )
        assert [level.value for level in body.scale] == [1, 2, 3]

    def test_a_repeated_value_is_refused(self):
        with pytest.raises(ValidationError, match="only once"):
            ShiftEvaluationTemplateWrite.model_validate(
                _body(
                    scale=[{"value": 1, "label": "A"}, {"value": 1, "label": "B"}],
                    comment_required_at_or_below=None,
                )
            )

    def test_the_comment_threshold_must_be_a_rating_value(self):
        with pytest.raises(ValidationError, match="must be one of the rating values"):
            ShiftEvaluationTemplateWrite.model_validate(
                _body(comment_required_at_or_below=7)
            )

    def test_a_single_level_is_not_a_scale(self):
        with pytest.raises(ValidationError):
            ShiftEvaluationTemplateWrite.model_validate(
                _body(scale=[{"value": 1, "label": "Only"}])
            )

    def test_a_blank_label_is_refused(self):
        with pytest.raises(ValidationError, match="needs a label"):
            ShiftEvaluationTemplateWrite.model_validate(
                _body(scale=[{"value": 1, "label": "  "}, {"value": 2, "label": "Two"}])
            )


class TestHeaderFields:
    def test_a_choice_field_needs_two_options(self):
        with pytest.raises(ValidationError, match="at least two options"):
            ShiftEvaluationTemplateWrite.model_validate(
                _body(
                    header_fields=[
                        {"label": "Shift", "type": "choice", "options": ["A", " "]}
                    ]
                )
            )

    def test_choice_options_are_trimmed_and_deduplicated(self):
        body = ShiftEvaluationTemplateWrite.model_validate(
            _body(
                header_fields=[
                    {"label": "Shift", "type": "choice", "options": [" A", "B", "A"]}
                ]
            )
        )
        assert body.header_fields[0].options == ["A", "B"]

    def test_a_text_field_keeps_no_options(self):
        body = ShiftEvaluationTemplateWrite.model_validate(
            _body(header_fields=[{"label": "Notes", "type": "text", "options": ["x"]}])
        )
        assert body.header_fields[0].options == []


class TestSeatsAndStatistics:
    def test_seats_are_spelled_as_the_seat_columns_spell_them(self):
        body = ShiftEvaluationTemplateWrite.model_validate(
            _body(evaluated_seats=["EMT", "ems", " Driver ", "Tiller Operator", ""])
        )
        assert body.evaluated_seats == ["ems", "driver", "Tiller Operator"]

    def test_statistics_are_deduplicated_in_order(self):
        body = ShiftEvaluationTemplateWrite.model_validate(
            _body(statistics=["transports", "calls", "transports"])
        )
        assert body.statistics == ["transports", "calls"]

    def test_an_unknown_statistic_is_refused(self):
        with pytest.raises(ValidationError):
            ShiftEvaluationTemplateWrite.model_validate(_body(statistics=["fires"]))


class TestBoundsAndCleanup:
    def test_too_many_items_overall_is_refused(self):
        sections = [
            {"title": f"S{i}", "items": [{"label": f"I{i}-{j}"} for j in range(50)]}
            for i in range(4)
        ]
        assert 4 * 50 > MAX_ITEMS_TOTAL
        with pytest.raises(ValidationError, match="at most"):
            ShiftEvaluationTemplateWrite.model_validate(_body(sections=sections))

    def test_a_hint_without_a_closing_section_is_dropped(self):
        body = ShiftEvaluationTemplateWrite.model_validate(
            _body(closing_comments_label="  ", closing_comments_hint="Strengths")
        )
        assert body.closing_comments_label is None
        assert body.closing_comments_hint is None

    def test_column_values_hold_plain_json(self):
        values = ShiftEvaluationTemplateWrite.model_validate(_body()).column_values()
        assert values["scale"][0] == {"value": 1, "label": "Unsatisfactory"}
        assert set(values["sections"][0]["items"][0]) == {
            "key",
            "label",
            "description",
            "comment_always_required",
        }


class TestExample:
    def test_the_example_is_the_paper_form(self):
        example = emt_shift_evaluation_example()
        assert [level.value for level in example.scale] == [1, 2, 3, 4]
        assert example.comment_required_at_or_below == 2
        assert example.not_applicable_label == "Not Observed"
        assert [s.title for s in example.sections] == [
            "Clinical Performance",
            "Professionalism & Affect",
            "Communication & Teamwork",
        ]
        assert [len(s.items) for s in example.sections] == [8, 5, 3]
        als = example.sections[0].items[0]
        assert als.key == "als_assist"
        assert als.comment_always_required is True
        assert example.statistics == ["calls", "transports", "refusals"]


class TestRouteOrder:
    def test_fixed_paths_are_declared_before_the_id_route(self):
        # FastAPI matches in declaration order; /settings below /{template_id}
        # would be parsed as an id and answer 422.
        paths = [route.path for route in shift_evaluation_templates.router.routes]
        id_route = paths.index("/{template_id}")
        assert paths.index("/settings") < id_route
        assert paths.index("/example") < id_route
