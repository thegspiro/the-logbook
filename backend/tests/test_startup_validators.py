"""
Tests for application startup validators (app/utils/startup_validators.py).

These validators run at boot to catch schema/config drift early — chiefly
that database ENUM columns match the Python models and follow the project's
lowercase-value convention (see docs/ENUM_CONVENTIONS.md and CLAUDE.md
Pitfall #5). The database session is mocked, so the suite needs no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.user import IdentifierType, OrganizationType
from app.utils.startup_validators import (
    StartupValidationError,
    run_startup_validations,
    validate_enum_case_convention,
    validate_enum_consistency,
)


def _enum_literal(values):
    """Render a MySQL COLUMN_TYPE string, e.g. enum('a','b')."""
    inner = ",".join(f"'{v}'" for v in values)
    return f"enum({inner})"


def _result_with_fetchone(value):
    """A mock SQLAlchemy Result whose fetchone() returns (value,) or None."""
    result = MagicMock()
    result.fetchone.return_value = (value,) if value is not None else None
    return result


def _result_with_fetchall(rows):
    """A mock SQLAlchemy Result whose fetchall() returns the given rows."""
    result = MagicMock()
    result.fetchall.return_value = rows
    return result


def _db_returning(*results):
    """An async DB session whose execute() yields the results in order."""
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    return db


# ---------------------------------------------------------------------------
# validate_enum_consistency — DB enum values must equal the model's values
# ---------------------------------------------------------------------------


class TestValidateEnumConsistency:
    async def test_passes_when_db_matches_models(self):
        # Two checks run (OrganizationType, then IdentifierType), one query each
        db = _db_returning(
            _result_with_fetchone(_enum_literal(e.value for e in OrganizationType)),
            _result_with_fetchone(_enum_literal(e.value for e in IdentifierType)),
        )
        all_valid, warnings = await validate_enum_consistency(db)
        assert all_valid is True
        assert warnings == []

    async def test_flags_case_mismatch(self):
        # Database has UPPERCASE org-type values — the classic drift this guards
        db = _db_returning(
            _result_with_fetchone(
                _enum_literal(e.value.upper() for e in OrganizationType)
            ),
            _result_with_fetchone(_enum_literal(e.value for e in IdentifierType)),
        )
        all_valid, warnings = await validate_enum_consistency(db)
        assert all_valid is False
        assert any("don't match" in w for w in warnings)
        assert any("OrganizationType" in w for w in warnings)

    async def test_warns_when_column_missing(self):
        # No row for the first column, valid for the second
        db = _db_returning(
            _result_with_fetchone(None),
            _result_with_fetchone(_enum_literal(e.value for e in IdentifierType)),
        )
        all_valid, warnings = await validate_enum_consistency(db)
        assert all_valid is False
        assert any("Could not query database enum" in w for w in warnings)

    async def test_non_enum_column_type_is_treated_as_empty(self):
        # A column that isn't an enum (e.g. got altered to varchar) yields []
        db = _db_returning(
            _result_with_fetchone("varchar(50)"),
            _result_with_fetchone(_enum_literal(e.value for e in IdentifierType)),
        )
        all_valid, warnings = await validate_enum_consistency(db)
        assert all_valid is False
        assert any("Could not query database enum" in w for w in warnings)

    async def test_database_error_is_caught_and_reported(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=RuntimeError("connection lost"))
        all_valid, warnings = await validate_enum_consistency(db)
        assert all_valid is False
        assert any("connection lost" in w for w in warnings)


# ---------------------------------------------------------------------------
# validate_enum_case_convention — every DB enum value must be lowercase
# ---------------------------------------------------------------------------


class TestValidateEnumCaseConvention:
    async def test_passes_when_all_values_lowercase(self):
        rows = [
            ("organizations", "organization_type", _enum_literal(["fire_department"])),
            ("events", "event_type", _enum_literal(["training", "business_meeting"])),
        ]
        db = _db_returning(_result_with_fetchall(rows))
        ok, violations = await validate_enum_case_convention(db)
        assert ok is True
        assert violations == []

    async def test_flags_uppercase_value(self):
        rows = [
            ("events", "status", _enum_literal(["ROUTINE", "active"])),
        ]
        db = _db_returning(_result_with_fetchall(rows))
        ok, violations = await validate_enum_case_convention(db)
        assert ok is False
        assert len(violations) == 1
        assert "events.status" in violations[0]
        assert "ROUTINE" in violations[0]
        assert "should be 'routine'" in violations[0]

    async def test_flags_mixed_case_value(self):
        rows = [("t", "c", _enum_literal(["MixedCase"]))]
        db = _db_returning(_result_with_fetchall(rows))
        ok, violations = await validate_enum_case_convention(db)
        assert ok is False
        assert "MixedCase" in violations[0]

    async def test_no_enum_columns_passes(self):
        db = _db_returning(_result_with_fetchall([]))
        ok, violations = await validate_enum_case_convention(db)
        assert ok is True
        assert violations == []

    async def test_database_error_is_caught_and_reported(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=RuntimeError("schema unavailable"))
        ok, violations = await validate_enum_case_convention(db)
        assert ok is False
        assert any("schema unavailable" in v for v in violations)


# ---------------------------------------------------------------------------
# run_startup_validations — orchestration of the two checks
# ---------------------------------------------------------------------------


class TestRunStartupValidations:
    def _all_good_db(self):
        # consistency runs 2 queries, then case-convention runs 1
        return _db_returning(
            _result_with_fetchone(_enum_literal(e.value for e in OrganizationType)),
            _result_with_fetchone(_enum_literal(e.value for e in IdentifierType)),
            _result_with_fetchall(
                [
                    (
                        "organizations",
                        "organization_type",
                        _enum_literal(["fire_department"]),
                    )
                ]
            ),
        )

    async def test_passes_silently_when_all_valid(self):
        # Should not raise even in strict mode when everything is consistent
        await run_startup_validations(self._all_good_db(), strict=True)

    async def test_non_strict_does_not_raise_on_violation(self):
        db = _db_returning(
            _result_with_fetchone(
                _enum_literal(e.value.upper() for e in OrganizationType)
            ),
            _result_with_fetchone(_enum_literal(e.value for e in IdentifierType)),
            _result_with_fetchall([("t", "c", _enum_literal(["BAD"]))]),
        )
        # Non-strict: warnings logged, no exception
        await run_startup_validations(db, strict=False)

    async def test_strict_raises_on_violation(self):
        db = _db_returning(
            _result_with_fetchone(
                _enum_literal(e.value.upper() for e in OrganizationType)
            ),
            _result_with_fetchone(_enum_literal(e.value for e in IdentifierType)),
            _result_with_fetchall([("t", "c", _enum_literal(["BAD"]))]),
        )
        with pytest.raises(StartupValidationError):
            await run_startup_validations(db, strict=True)

    async def test_case_convention_check_is_actually_run(self):
        # Consistency passes, but a lowercase violation alone must fail strict
        # mode — proving the case-convention validator is wired into the runner.
        db = _db_returning(
            _result_with_fetchone(_enum_literal(e.value for e in OrganizationType)),
            _result_with_fetchone(_enum_literal(e.value for e in IdentifierType)),
            _result_with_fetchall([("events", "status", _enum_literal(["ROUTINE"]))]),
        )
        with pytest.raises(StartupValidationError):
            await run_startup_validations(db, strict=True)
