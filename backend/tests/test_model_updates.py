"""
Tests for apply_updates — the partial-update helper that decides whether a
field in an update payload is written, cleared, or rejected.

The bug these lock down: the service layer used to guard every update loop
with ``if value is not None``, which silently discarded an explicit null.
Because update payloads are ``exclude_unset`` dumps, a null that reaches the
service means the user cleared the field — dropping it acknowledged the write
with a 200 while the old value stayed in the database.

No database needed: the helper works off the mapper's column metadata and
plain attribute assignment.
"""

import pytest

from app.models.finance import Budget
from app.models.storefront import StoreSettings
from app.utils.model_updates import apply_updates


class TestClearingFields:
    """An explicit null means "the user emptied this box"."""

    def test_null_clears_a_nullable_column(self):
        settings = StoreSettings(
            organization_id="org1",
            store_name="Department Store",
            venmo_handle="@old-treasurer",
        )

        written = apply_updates(settings, {"venmo_handle": None})

        assert settings.venmo_handle is None
        assert written == {"venmo_handle"}

    def test_clearing_one_field_leaves_the_others_alone(self):
        settings = StoreSettings(
            organization_id="org1",
            store_name="Department Store",
            venmo_handle="@treasurer",
            check_payable_to="Falls Church FD",
        )

        apply_updates(settings, {"venmo_handle": None})

        assert settings.check_payable_to == "Falls Church FD"
        assert settings.store_name == "Department Store"

    def test_omitted_fields_are_untouched(self):
        """exclude_unset already dropped them; absence means "leave alone"."""
        settings = StoreSettings(
            organization_id="org1",
            store_name="Department Store",
            tagline="Serving since 1899",
        )

        written = apply_updates(settings, {"store_name": "Company Store"})

        assert settings.tagline == "Serving since 1899"
        assert settings.store_name == "Company Store"
        assert written == {"store_name"}


class TestFalsyValues:
    """Zero and empty string are values, not absences."""

    def test_zero_is_written(self):
        budget = Budget(
            organization_id="org1",
            fiscal_year_id="fy1",
            category_id="cat1",
            amount_budgeted=5000,
        )

        apply_updates(budget, {"amount_budgeted": 0})

        assert budget.amount_budgeted == 0

    def test_empty_string_is_written(self):
        settings = StoreSettings(
            organization_id="org1",
            store_name="Department Store",
            tagline="Serving since 1899",
        )

        apply_updates(settings, {"tagline": ""})

        assert settings.tagline == ""


class TestLoudFailures:
    """A dropped field must be reported, never swallowed."""

    def test_null_on_a_not_null_column_is_rejected(self):
        budget = Budget(
            organization_id="org1",
            fiscal_year_id="fy1",
            category_id="cat1",
            amount_budgeted=5000,
        )

        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(budget, {"fiscal_year_id": None})

    def test_a_rejected_clear_leaves_the_value_intact(self):
        budget = Budget(
            organization_id="org1",
            fiscal_year_id="fy1",
            category_id="cat1",
            amount_budgeted=5000,
        )

        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(budget, {"fiscal_year_id": None})

        assert budget.fiscal_year_id == "fy1"

    def test_unknown_field_is_rejected(self):
        settings = StoreSettings(organization_id="org1", store_name="Store")

        with pytest.raises(ValueError, match="unknown field"):
            apply_updates(settings, {"not_a_real_column": "x"})


class TestSkip:
    """Nested collections stay with the caller's bespoke replace logic."""

    def test_skipped_keys_are_not_written(self):
        settings = StoreSettings(organization_id="org1", store_name="Store")

        written = apply_updates(
            settings,
            {"store_name": "Company Store", "variants": [1, 2]},
            skip={"variants"},
        )

        assert written == {"store_name"}
        assert settings.store_name == "Company Store"

    def test_a_skipped_key_needs_no_matching_attribute(self):
        """'variants' is not a column, so an unskipped one would raise."""
        settings = StoreSettings(organization_id="org1", store_name="Store")

        apply_updates(settings, {"variants": [1, 2]}, skip={"variants"})
