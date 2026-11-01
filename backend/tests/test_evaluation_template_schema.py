"""The canonical shape of an evaluation template.

``TemplateDefinition`` / ``TemplateWorkflow`` are what every saved draft is
settled through, so these tests pin what they refuse on save (a shape a
reader could not use) separately from what only blocks publishing (an
unfinished form).
"""

import pytest
from pydantic import ValidationError

from app.models.evaluation import EvaluationTemplateKind
from app.schemas.evaluation import (
    EvaluationPeriodCreate,
    EvaluationTemplateCreate,
    TemplateDefinition,
    TemplateWorkflow,
    default_workflow,
    definition_publish_errors,
    workflow_publish_errors,
)

pytestmark = pytest.mark.unit

ANCHORED_LEVELS = [
    {"value": v, "label": label, "anchor": f"Behavior at {v}"}
    for v, label in enumerate(
        ["Unsatisfactory", "Needs improvement", "Meets", "Exceeds", "Exceptional"],
        start=1,
    )
]


def _item(**overrides):
    item = {
        "key": "training",
        "label": "Training participation",
        "tool": "labeled_scale",
        "levels": ANCHORED_LEVELS,
        "weight": 100,
    }
    item.update(overrides)
    return item


def _definition(*items, **overrides):
    body = {
        "sections": [{"key": "training", "title": "Training", "items": list(items)}]
    }
    body.update(overrides)
    return TemplateDefinition.model_validate(body)


class TestShapeRefusedOnSave:
    def test_scale_levels_must_be_consecutive(self):
        levels = [ANCHORED_LEVELS[0], ANCHORED_LEVELS[2]]
        with pytest.raises(ValidationError, match="consecutive"):
            _definition(_item(levels=levels))

    def test_unknown_data_source(self):
        with pytest.raises(ValidationError, match="Unknown data source"):
            _definition(_item(data_block={"source": "training.vibes"}))

    def test_a_list_source_cannot_be_scored(self):
        rule = {"bands": [{"min": 0, "score": 3}]}
        with pytest.raises(ValidationError, match="cannot be scored"):
            _definition(
                _item(
                    data_block={
                        "source": "certifications.current",
                        "scoring_rule": rule,
                    }
                )
            )

    def test_score_bands_cannot_overlap(self):
        rule = {
            "bands": [
                {"min": 0, "max": 50, "score": 2},
                {"min": 40, "score": 4},
            ]
        }
        with pytest.raises(ValidationError, match="overlap"):
            _definition(
                _item(
                    data_block={
                        "source": "training.session_attendance_pct",
                        "scoring_rule": rule,
                    }
                )
            )

    def test_a_band_must_name_a_level_of_the_scale(self):
        rule = {"bands": [{"min": 0, "score": 9}]}
        with pytest.raises(ValidationError, match="level of the scale"):
            _definition(
                _item(data_block={"source": "training.hours", "scoring_rule": rule})
            )

    def test_the_departments_example_rule_is_accepted_and_sorted(self):
        """Attendance under 25% scores 1 ... 100% scores 5, entered out of
        order."""
        bands = [
            {"min": 100, "score": 5},
            {"min": 0, "max": 25, "score": 1},
            {"min": 50, "max": 75, "score": 3},
            {"min": 25, "max": 50, "score": 2},
            {"min": 75, "max": 100, "score": 4},
        ]
        definition = _definition(
            _item(
                data_block={
                    "source": "training.session_attendance_pct",
                    "scoring_rule": {"bands": bands},
                }
            )
        )
        stored = definition.sections[0].items[0].data_block.scoring_rule.bands
        assert [b.score for b in stored] == [1, 2, 3, 4, 5]

    def test_only_rated_items_carry_weight(self):
        with pytest.raises(ValidationError, match="only a rated item"):
            _definition(_item(tool="narrative", levels=[], weight=20))

    def test_item_keys_are_unique_across_sections(self):
        with pytest.raises(ValidationError, match="unique across the template"):
            TemplateDefinition.model_validate(
                {
                    "sections": [
                        {"key": "a", "title": "A", "items": [_item()]},
                        {"key": "b", "title": "B", "items": [_item()]},
                    ]
                }
            )

    def test_keys_are_slugs(self):
        with pytest.raises(ValidationError, match="lowercase"):
            _definition(_item(key="Training Participation"))


class TestCompletenessCheckedAtPublish:
    def test_a_finished_form_publishes(self):
        assert definition_publish_errors(_definition(_item())) == []

    def test_an_empty_form_saves_but_does_not_publish(self):
        definition = TemplateDefinition()
        assert "Add at least one item." in definition_publish_errors(definition)

    def test_every_labeled_level_needs_its_behavior(self):
        levels = [dict(level, anchor=None) for level in ANCHORED_LEVELS]
        errors = definition_publish_errors(_definition(_item(levels=levels)))
        assert any("describe the behavior" in e for e in errors)

    def test_weights_must_add_up_to_100(self):
        errors = definition_publish_errors(_definition(_item(weight=60)))
        assert "Item weights add up to 60%, not 100%." in errors

    def test_officer_sections_need_ranks(self):
        definition = TemplateDefinition.model_validate(
            {
                "sections": [
                    {"key": "core", "title": "Core", "items": [_item()]},
                    {
                        "key": "leadership",
                        "title": "Leadership",
                        "officer_only": True,
                        "items": [_item(key="leads", weight=0)],
                    },
                ]
            }
        )
        errors = definition_publish_errors(definition)
        assert any("officer-only" in e for e in errors)


class TestWorkflow:
    def test_the_defaults_publish(self):
        for kind in EvaluationTemplateKind:
            assert workflow_publish_errors(default_workflow(kind), kind) == []

    def test_only_the_member_writes_the_self_evaluation(self):
        with pytest.raises(ValidationError, match="cannot act on this step"):
            TemplateWorkflow.model_validate(
                {
                    "steps": [
                        {
                            "key": "self",
                            "type": "self_evaluation",
                            "label": "Self",
                            "actor": {"kind": "evaluator"},
                            "due_days": 14,
                        }
                    ]
                }
            )

    def test_steps_cannot_run_out_of_order(self):
        steps = default_workflow(EvaluationTemplateKind.ANNUAL).model_dump()["steps"]
        steps.reverse()
        with pytest.raises(ValidationError, match="Steps run in order"):
            TemplateWorkflow.model_validate({"steps": steps})

    def test_a_later_step_cannot_be_due_first(self):
        steps = default_workflow(EvaluationTemplateKind.ANNUAL).model_dump()["steps"]
        steps[1]["due_days"] = 5
        with pytest.raises(ValidationError, match="due before"):
            TemplateWorkflow.model_validate({"steps": steps})

    def test_an_annual_evaluation_ends_with_the_acknowledgement(self):
        workflow = default_workflow(EvaluationTemplateKind.INTERIM)
        errors = workflow_publish_errors(workflow, EvaluationTemplateKind.ANNUAL)
        assert any("acknowledgement" in e for e in errors)

    def test_a_check_in_carries_no_signatures(self):
        workflow = default_workflow(EvaluationTemplateKind.ANNUAL)
        errors = workflow_publish_errors(workflow, EvaluationTemplateKind.INTERIM)
        assert any("check-in" in e for e in errors)

    def test_an_approval_names_a_position(self):
        with pytest.raises(ValidationError, match="position is named"):
            TemplateWorkflow.model_validate(
                {
                    "steps": [
                        {
                            "key": "chief",
                            "type": "approval",
                            "label": "Chief",
                            "actor": {"kind": "position"},
                            "due_days": 40,
                        }
                    ]
                }
            )


class TestMatchingAndPeriods:
    def test_matching_is_normalized_and_checked(self):
        data = EvaluationTemplateCreate(
            name=" Probationary ", member_class="", member_status="Probationary"
        )
        assert (data.name, data.member_class, data.member_status) == (
            "Probationary",
            None,
            "probationary",
        )
        with pytest.raises(ValidationError, match="Unknown member class"):
            EvaluationTemplateCreate(name="X", member_class="volunteer")

    def test_a_period_cannot_end_before_it_starts(self):
        with pytest.raises(ValidationError, match="end before it starts"):
            EvaluationPeriodCreate(
                name="2026", start_date="2026-12-31", end_date="2026-01-01"
            )
