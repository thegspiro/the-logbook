"""
Tests for criterion-type validation on skill templates.

The scorer recognises exactly five criterion types and the examiner screen
renders exactly five. The schema used to accept any string up to 50 characters,
so a template authored through the API with a type outside that set — the demo
seeder wrote "checkbox" — was stored happily, rendered by the fallback branch,
and contributed nothing to any percentage. The resulting scorecard reported
"No percentage could be calculated" on a sheet that looked fully scored.

Pure Pydantic; no database.
"""

import pytest
from pydantic import ValidationError

from app.schemas.skills_testing import (
    CRITERION_TYPES,
    SkillCriterionSchema,
    SkillTemplateCreate,
)


@pytest.mark.parametrize("criterion_type", CRITERION_TYPES)
def test_accepts_every_known_type(criterion_type):
    criterion = SkillCriterionSchema(label="Seals the facepiece", type=criterion_type)
    assert criterion.type == criterion_type


def test_defaults_to_pass_fail():
    assert SkillCriterionSchema(label="Checks cylinder pressure").type == "pass_fail"


def test_rejects_a_type_the_scorer_cannot_read():
    with pytest.raises(ValidationError) as exc:
        SkillCriterionSchema(label="Checks cylinder pressure", type="checkbox")

    message = str(exc.value)
    assert "checkbox" in message
    # The error names the accepted set — an author who guessed the wrong word
    # should not have to read the scorer to find the right one.
    assert "pass_fail" in message
    assert "score" in message


def test_rejection_reaches_the_template_payload():
    with pytest.raises(ValidationError):
        SkillTemplateCreate(
            name="SCBA Donning",
            sections=[
                {
                    "name": "Donning",
                    "criteria": [{"label": "Dons the pack", "type": "checkbox"}],
                }
            ],
        )
