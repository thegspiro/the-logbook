"""The shift-compliance window survives 29 February.

A one-time requirement with no start or due date is graded over the year
before the reference date, built as ``date(year - 1, month, day)``. On
29 February that date does not exist, and the ValueError took down the whole
compliance report for the day.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.models.training import DueDateType, RequirementFrequency
from app.services.scheduling_service import SchedulingService

pytestmark = pytest.mark.unit


def _one_time_requirement():
    return SimpleNamespace(
        frequency=RequirementFrequency.ONE_TIME,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        rolling_period_months=None,
        period_start_month=1,
        period_start_day=None,
        period_end_month=None,
        period_end_day=None,
        start_date=None,
        due_date=None,
    )


def test_a_leap_day_reference_starts_the_window_on_28_february():
    start, end = SchedulingService(MagicMock())._compute_period_bounds(
        _one_time_requirement(), date(2028, 2, 29)
    )

    assert start == date(2027, 2, 28)
    assert end == date(2028, 2, 29)


def test_an_ordinary_day_keeps_the_same_calendar_day():
    start, end = SchedulingService(MagicMock())._compute_period_bounds(
        _one_time_requirement(), date(2026, 10, 24)
    )

    assert start == date(2025, 10, 24)
    assert end == date(2026, 10, 24)
