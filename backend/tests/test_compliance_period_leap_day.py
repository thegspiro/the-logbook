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


def _annual_requirement(**window):
    req = _one_time_requirement()
    req.frequency = RequirementFrequency.ANNUAL
    for key, value in window.items():
        setattr(req, key, value)
    return req


def _march_to_february():
    # A department year of 1 March to 29 February.
    return _annual_requirement(
        period_start_month=3,
        period_start_day=1,
        period_end_month=2,
        period_end_day=29,
    )


def test_an_annual_window_ending_29_february_ends_on_the_28th_otherwise():
    start, end = SchedulingService(MagicMock())._compute_period_bounds(
        _march_to_february(), date(2026, 10, 24)
    )

    assert start == date(2026, 3, 1)
    assert end == date(2027, 2, 28)


def test_an_annual_window_ending_29_february_keeps_it_in_a_leap_year():
    start, end = SchedulingService(MagicMock())._compute_period_bounds(
        _march_to_february(), date(2027, 10, 24)
    )

    assert start == date(2027, 3, 1)
    assert end == date(2028, 2, 29)


def test_a_same_year_window_starting_29_february_starts_on_the_28th():
    req = _annual_requirement(
        period_start_month=2,
        period_start_day=29,
        period_end_month=12,
        period_end_day=31,
    )

    start, end = SchedulingService(MagicMock())._compute_period_bounds(
        req, date(2026, 10, 24)
    )

    assert start == date(2026, 2, 28)
    assert end == date(2026, 12, 31)
