"""Skill sheets and their results have item caps (SKT4-1, SKT4-2).

The request-body byte ceiling alone admits roughly a million small items, each
materialized, stored and later iterated for scoring and CSV export. The caps
are generous: the largest shipped sheet is a fraction of them.
"""

import pytest
from pydantic import ValidationError

from app.schemas.skills_testing import (
    MAX_CHECKLIST_ITEMS,
    MAX_RESULT_VIEWER_POSITIONS,
    MAX_SECTION_CRITERIA,
    MAX_TEMPLATE_SECTIONS,
    SectionResultSchema,
    SkillTemplateCreate,
    SkillTemplateUpdate,
    SkillTestCreate,
    SkillTestUpdate,
)

pytestmark = pytest.mark.unit

_TEMPLATE_ID = "7d1f2c4e-1111-4a5b-9c1d-000000000001"
_CANDIDATE_ID = "7d1f2c4e-1111-4a5b-9c1d-000000000002"


def _criterion(checklist=0):
    return {"label": "Step", "checklist_items": ["item"] * checklist}


def _section(criteria=1, checklist=0):
    return {"name": "Section", "criteria": [_criterion(checklist)] * criteria}


def _template(sections=1, criteria=1, checklist=0):
    return {"name": "Sheet", "sections": [_section(criteria, checklist)] * sections}


class TestTemplateCaps:
    def test_a_sheet_at_every_cap_is_accepted(self):
        SkillTemplateCreate.model_validate(
            _template(MAX_TEMPLATE_SECTIONS, 1, MAX_CHECKLIST_ITEMS)
        )
        SkillTemplateCreate.model_validate(_template(1, MAX_SECTION_CRITERIA))

    @pytest.mark.parametrize(
        "shape",
        [
            (MAX_TEMPLATE_SECTIONS + 1, 1, 0),
            (1, MAX_SECTION_CRITERIA + 1, 0),
            (1, 1, MAX_CHECKLIST_ITEMS + 1),
        ],
    )
    def test_a_sheet_over_a_cap_is_refused(self, shape):
        with pytest.raises(ValidationError):
            SkillTemplateCreate.model_validate(_template(*shape))

    def test_an_update_is_capped_too(self):
        with pytest.raises(ValidationError):
            SkillTemplateUpdate.model_validate(
                {"sections": [_section()] * (MAX_TEMPLATE_SECTIONS + 1)}
            )


class TestResultCaps:
    def test_results_matching_a_full_sheet_are_accepted(self):
        SkillTestUpdate.model_validate(
            {
                "section_results": [
                    {
                        "criteria_results": [
                            {"checklist_completed": [True] * MAX_CHECKLIST_ITEMS}
                        ]
                        * MAX_SECTION_CRITERIA
                    }
                ]
                * 2
            }
        )

    def test_too_many_section_results_are_refused(self):
        with pytest.raises(ValidationError):
            SkillTestUpdate.model_validate(
                {"section_results": [{}] * (MAX_TEMPLATE_SECTIONS + 1)}
            )

    def test_too_many_criterion_results_are_refused(self):
        with pytest.raises(ValidationError):
            SectionResultSchema.model_validate(
                {"criteria_results": [{}] * (MAX_SECTION_CRITERIA + 1)}
            )

    def test_too_many_checklist_marks_are_refused(self):
        with pytest.raises(ValidationError):
            SectionResultSchema.model_validate(
                {
                    "criteria_results": [
                        {"checklist_completed": [True] * (MAX_CHECKLIST_ITEMS + 1)}
                    ]
                }
            )

    @pytest.mark.parametrize("model", [SkillTestCreate, SkillTestUpdate])
    def test_viewer_positions_are_capped(self, model):
        base = (
            {"template_id": _TEMPLATE_ID, "candidate_id": _CANDIDATE_ID}
            if model is SkillTestCreate
            else {}
        )
        model.model_validate(
            {**base, "result_viewer_positions": ["p"] * MAX_RESULT_VIEWER_POSITIONS}
        )
        with pytest.raises(ValidationError):
            model.model_validate(
                {
                    **base,
                    "result_viewer_positions": ["p"]
                    * (MAX_RESULT_VIEWER_POSITIONS + 1),
                }
            )
