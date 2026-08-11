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
    SkillCriterionSchema,
    SkillTemplateCreate,
)


def test_every_renderable_type_is_accepted():
    for criterion_type in CRITERION_TYPES:
        criterion = SkillCriterionSchema(label="Step", type=criterion_type)
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
