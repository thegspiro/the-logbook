"""Criterion types are a closed set.

The examiner screen renders one control per known criterion type and nothing at
all for anything else, so a template built from an unrecognized type produces
steps with a notes box and no way to mark them. Under ``require_all_critical``
an unmarked critical step scores as a failure, which made every evaluation run
against such a template a guaranteed fail worth 0%.

The field was a bare ``str`` until this check existed, and a seeder writing
``"checkbox"`` proved the point across a whole demo dataset. These tests hold
the whitelist closed.
"""

import pytest
from pydantic import ValidationError

from app.schemas.skills_testing import (
    CRITERION_TYPES,
    CriterionResultSchema,
    SkillCriterionSchema,
    SkillTemplateCreate,
)


def test_every_renderable_type_is_accepted():
    for criterion_type in CRITERION_TYPES:
        # See the note in test_skill_criterion_type.py: max_score is passed for
        # every type so the "score" case is not rejected for the unrelated
        # reason that a scored step needs a point value.
        criterion = SkillCriterionSchema(label="Step", type=criterion_type, max_score=5)
        assert criterion.type == criterion_type


def test_type_defaults_to_pass_fail():
    assert SkillCriterionSchema(label="Step").type == "pass_fail"


@pytest.mark.parametrize("bad_type", ["checkbox", "boolean", "Pass_Fail", ""])
def test_unknown_type_is_rejected(bad_type):
    with pytest.raises(ValidationError) as exc:
        SkillCriterionSchema(label="Dons the pack", type=bad_type)

    message = str(exc.value)
    assert "Unknown criterion type" in message
    # The accepted values are listed, and Pydantic's error carries the field
    # path — on a nested template that is sections.N.criteria.M.type, which
    # locates the offending step on a sheet with dozens of criteria.
    assert "pass_fail" in message


def test_template_create_rejects_a_nested_unknown_type():
    """The whitelist has to hold through the nesting, not just standalone."""
    with pytest.raises(ValidationError) as exc:
        SkillTemplateCreate(
            name="SCBA Donning",
            sections=[
                {
                    "name": "Donning",
                    "criteria": [
                        {"label": "Inspects cylinder pressure", "type": "pass_fail"},
                        {"label": "Seals the facepiece", "type": "checkbox"},
                    ],
                }
            ],
        )

    assert "Unknown criterion type" in str(exc.value)


def test_whitelist_matches_the_types_the_scorer_handles():
    """A type the scorer treats specially must be one a template can declare.

    The two lists drifting is how the original bug survived: the schema
    accepted anything, so nothing tied the stored value to the set of values
    the scoring and rendering code actually branches on.
    """
    assert set(CRITERION_TYPES) == {
        "pass_fail",
        "score",
        "checklist",
        "time_limit",
        "statement",
    }


class TestScoringBounds:
    """Numbers that cannot produce a meaningful mark.

    The template builder already refuses both of these in the browser, but a
    sheet posted by a script or an import bypassed that entirely — and both
    failures are silent at scoring time, which is why they are rejected at the
    write rather than corrected at the read.
    """

    def test_passing_score_above_the_ceiling_is_rejected(self):
        # A critical scored step passes at passing_score or above, so a
        # threshold over the maximum is a step nobody can pass.
        with pytest.raises(ValidationError) as exc:
            SkillCriterionSchema(
                label="Sets the pressure",
                type="score",
                max_score=5,
                passing_score=8,
            )

        assert "cannot be higher than the maximum" in str(exc.value)

    def test_passing_score_at_the_ceiling_is_accepted(self):
        criterion = SkillCriterionSchema(
            label="Sets the pressure", type="score", max_score=5, passing_score=5
        )

        assert criterion.passing_score == 5

    def test_a_scored_step_without_a_maximum_is_rejected(self):
        # _criterion_point_value reads a scored step's worth entirely off
        # max_score, so one without it carries no points and contributes
        # nothing to the percentage it appears to be scored out of.
        with pytest.raises(ValidationError) as exc:
            SkillCriterionSchema(label="Sets the pressure", type="score")

        assert "needs a maximum score above 0" in str(exc.value)

    def test_a_zero_maximum_is_rejected_on_a_scored_step(self):
        with pytest.raises(ValidationError):
            SkillCriterionSchema(label="Sets the pressure", type="score", max_score=0)

    def test_other_types_may_omit_a_maximum(self):
        # Only a scored step draws its worth from max_score; a pass/fail step
        # in points mode falls back to one point.
        assert SkillCriterionSchema(label="Sets the hydrant").max_score is None


class TestCriterionResultBounds:
    """What an examiner's recording may carry."""

    def test_a_negative_score_is_rejected(self):
        with pytest.raises(ValidationError):
            CriterionResultSchema(criterion_id="criterion-0-0", score=-1)

    def test_a_waiver_needs_a_reason(self):
        # A step dropped from a scorecard without a stated reason is
        # indistinguishable from one skipped to save time, and the officer
        # validating the result has no way to judge it.
        with pytest.raises(ValidationError) as exc:
            CriterionResultSchema(criterion_id="criterion-0-0", waived=True)

        assert "needs a reason" in str(exc.value)

    def test_a_blank_waiver_reason_is_rejected(self):
        with pytest.raises(ValidationError):
            CriterionResultSchema(
                criterion_id="criterion-0-0", waived=True, waive_reason="   "
            )

    def test_a_waiver_with_a_reason_is_accepted(self):
        result = CriterionResultSchema(
            criterion_id="criterion-0-0",
            waived=True,
            waive_reason="the evolution never reached the hydrant",
        )

        assert result.waived is True
