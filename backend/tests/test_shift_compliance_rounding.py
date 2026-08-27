"""Regression coverage for raw attendance grading in shift compliance."""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.models.training import RequirementType
from app.services.scheduling_service import SchedulingService


class _Result:
    def __init__(self, *, scalar_rows=None, rows=None):
        self._scalar_rows = scalar_rows or []
        self._rows = rows or []

    def scalars(self):
        return SimpleNamespace(all=lambda: self._scalar_rows)

    def all(self):
        return self._rows


@pytest.mark.asyncio
async def test_hours_compliance_uses_raw_minutes_before_display_rounding():
    user_id = str(uuid4())
    requirement = SimpleNamespace(
        id=str(uuid4()),
        name="One hour",
        requirement_type=RequirementType.HOURS.value,
        required_hours=1.0,
        applies_to_all=True,
        due_date_type=None,
        rolling_period_months=None,
        frequency="annual",
    )
    user = SimpleNamespace(
        id=user_id,
        first_name="Short",
        last_name="Member",
        full_name="Short Member",
        rank=None,
    )
    attendance = SimpleNamespace(user_id=user_id, shift_count=1, total_minutes=53)
    db = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                _Result(scalar_rows=[requirement]),
                _Result(scalar_rows=[user]),
                _Result(rows=[]),
                _Result(rows=[attendance]),
            ]
        )
    )
    service = SchedulingService(db)
    service._compute_period_bounds = lambda *_: (date(2026, 1, 1), date(2026, 12, 31))

    result = await service.get_shift_compliance(uuid4(), date(2026, 8, 25))

    member = result[0]["members"][0]
    assert member["completed_value"] == 1.0
    assert member["total_hours"] == 1.0
    assert member["compliant"] is False
    assert result[0]["compliant_count"] == 0
