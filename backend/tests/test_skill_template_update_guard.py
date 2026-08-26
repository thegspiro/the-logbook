"""
Nullability guard for updating a skill template.

`SkillTemplateUpdate` declares `name`, `sections` and `score_pass_fail_criteria`
as `Optional` so a client can omit them, but the `SkillTemplate` model has all
three `nullable=False`. Before this fix, `update_template` applied the payload
with a blind `for field, value in update_data.items(): setattr(template, field,
value)` loop, so an explicit JSON `null` for any of the three reached `flush()`
and raised an unhandled `IntegrityError` (500) instead of a clean 400. This
mirrors FAC-7's `TestNullabilityGuard` in `test_facilities_service.py`.

DB is mocked; no MySQL.
"""

import inspect

import pytest

from app.api.v1.endpoints import skills_testing as endpoint
from app.models.skills_testing import SkillTemplate
from app.utils.model_updates import apply_updates


def _template(**overrides):
    base = {
        "organization_id": "org-1",
        "name": "SCBA Donning",
        "sections": [{"name": "Donning", "criteria": []}],
        "score_pass_fail_criteria": False,
    }
    base.update(overrides)
    return SkillTemplate(**base)


class TestNullabilityGuard:
    def test_name_cannot_be_nulled(self):
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(_template(), {"name": None})

    def test_sections_cannot_be_nulled(self):
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(_template(), {"sections": None})

    def test_score_pass_fail_criteria_cannot_be_nulled(self):
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(_template(), {"score_pass_fail_criteria": None})

    def test_nullable_fields_still_clear(self):
        """The guard is specific to NOT NULL columns — description is nullable
        and clearing it must still work."""
        template = _template(description="Old copy")
        apply_updates(template, {"description": None})
        assert template.description is None

    def test_update_template_routes_through_the_shared_guard(self):
        """Must not regress to a hand-rolled `setattr` loop that skips the
        NOT NULL check."""
        source = inspect.getsource(endpoint.update_template)
        assert "apply_updates(" in source
        assert "for field, value in update_data.items()" not in source
