"""Unit tests for the compliance evaluation ("as-of") date helpers."""

from datetime import date

from app.services.training_period import (
    effective_include_current_month,
    resolve_as_of_date,
)


def test_none_requirement_value_inherits_org_default_true():
    assert effective_include_current_month(None, org_default=True) is True


def test_none_requirement_value_inherits_org_default_false():
    assert effective_include_current_month(None, org_default=False) is False


def test_requirement_override_true_beats_org_default_false():
    assert effective_include_current_month(True, org_default=False) is True


def test_requirement_override_false_beats_org_default_true():
    assert effective_include_current_month(False, org_default=True) is False


def test_include_current_month_returns_today_unchanged():
    today = date(2026, 5, 29)
    assert resolve_as_of_date(today, include_current_month=True) == today


def test_exclude_current_month_returns_last_day_of_previous_month():
    # Mid-month -> last day of April
    assert resolve_as_of_date(date(2026, 5, 29), include_current_month=False) == date(
        2026, 4, 30
    )


def test_exclude_on_first_of_month_returns_last_day_of_prior_month():
    assert resolve_as_of_date(date(2026, 5, 1), include_current_month=False) == date(
        2026, 4, 30
    )


def test_exclude_in_january_crosses_year_boundary():
    assert resolve_as_of_date(date(2026, 1, 15), include_current_month=False) == date(
        2025, 12, 31
    )


def test_exclude_in_march_handles_leap_year_february():
    # 2024 is a leap year -> previous month end is Feb 29
    assert resolve_as_of_date(date(2024, 3, 10), include_current_month=False) == date(
        2024, 2, 29
    )


def test_exclude_in_march_non_leap_year():
    assert resolve_as_of_date(date(2025, 3, 10), include_current_month=False) == date(
        2025, 2, 28
    )
