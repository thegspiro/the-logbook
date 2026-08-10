"""
FORM2-1 (app-review B13 pass 3): category / status / field_type / target_module /
integration_type on the forms request schemas map to strict MySQL ENUM columns
but were typed as free str and inserted raw — an out-of-set value 500'd at MySQL.
The prior `category` validator only normalized case (didn't reject unknowns), so
it never actually prevented the 500. Request schemas now normalize AND validate.
DB-free.
"""

import pytest
from pydantic import ValidationError

from app.schemas.forms import (
    FormCreate,
    FormFieldCreate,
    FormFieldUpdate,
    FormIntegrationCreate,
    FormUpdate,
)


class TestFormEnumValidation:
    def test_category_normalizes_legacy_titlecase(self):
        assert FormCreate(name="F", category="Operations").category == "operations"

    def test_category_rejects_unknown(self):
        # Regression: the old normalize-only validator let this reach MySQL and 500.
        with pytest.raises(ValidationError):
            FormCreate(name="F", category="bogus")

    def test_status_rejects_unknown(self):
        with pytest.raises(ValidationError):
            FormUpdate(status="weird")

    def test_status_accepts_valid(self):
        assert FormUpdate(status="published").status == "published"

    def test_field_type_accepts_valid_and_normalizes(self):
        assert FormFieldCreate(label="L", field_type="MULTISELECT").field_type == (
            "multiselect"
        )

    def test_field_type_rejects_unknown(self):
        with pytest.raises(ValidationError):
            FormFieldCreate(label="L", field_type="not_a_type")

    def test_field_update_allows_omitted(self):
        assert FormFieldUpdate(label="x").field_type is None


class TestIntegrationEnumValidation:
    def test_valid(self):
        i = FormIntegrationCreate(
            target_module="membership",
            integration_type="membership_interest",
            field_mappings={},
        )
        assert i.target_module == "membership"

    def test_rejects_bad_target(self):
        with pytest.raises(ValidationError):
            FormIntegrationCreate(
                target_module="galaxy",
                integration_type="membership_interest",
                field_mappings={},
            )

    def test_rejects_bad_integration_type(self):
        with pytest.raises(ValidationError):
            FormIntegrationCreate(
                target_module="membership",
                integration_type="bogus",
                field_mappings={},
            )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
