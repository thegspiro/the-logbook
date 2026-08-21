"""Regression tests for startup enum normalization recovery."""

from unittest.mock import AsyncMock, Mock

import pytest

from app.models.medical_screening import ScreeningStatus
from app.utils.enum_normalization import (
    _current_enum_values,
    _EnumColumn,
    _normalize_one,
)


@pytest.mark.asyncio
async def test_current_enum_values_distinguishes_varchar_from_missing_column():
    db = AsyncMock()
    result = Mock()
    result.fetchone.side_effect = [("varchar(64)",), None]
    db.execute.return_value = result

    assert await _current_enum_values(db, "logbook", "records", "status") == []
    assert await _current_enum_values(db, "logbook", "missing", "status") is None


@pytest.mark.asyncio
async def test_normalize_one_repairs_varchar_left_by_partial_failure():
    db = AsyncMock()
    result = Mock()
    result.fetchone.return_value = ("varchar(64)",)
    db.execute.return_value = result
    spec = _EnumColumn("screening_records", "status", ScreeningStatus, "scheduled")

    assert await _normalize_one(db, "logbook", spec) is True

    statements = [str(call.args[0]) for call in db.execute.await_args_list]
    assert any("UPDATE `screening_records`" in statement for statement in statements)
    expected_enum = (
        "ENUM(" + ", ".join(f"'{member.value}'" for member in ScreeningStatus) + ")"
    )
    assert any(expected_enum in statement for statement in statements)
    db.commit.assert_awaited_once()
