"""
Tests for the training-waiver period math
(app/services/training_waiver_service.py pure helpers).

These cover the None-safety mechanism that the rest of the codebase relies
on — _to_waiver_period maps a permanent leave/waiver (end_date=None) to the
_PERMANENT_END sentinel so the calendar-overlap math never compares against
None — plus the 15-day-per-month waiver rule, requirement-specific filtering,
month counting, and the proportional requirement adjustment. Pure functions;
no DB.
"""

from datetime import date
from types import SimpleNamespace

from app.services.training_waiver_service import (
    _PERMANENT_END,
    WaiverPeriod,
    _to_waiver_period,
    adjust_required,
    count_waived_months,
    total_months_in_period,
)


class TestToWaiverPeriod:
    def test_permanent_leave_maps_to_sentinel(self):
        obj = SimpleNamespace(
            start_date=date(2026, 1, 1), end_date=None, requirement_ids=None
        )
        wp = _to_waiver_period(obj)
        assert wp.end_date == _PERMANENT_END
        assert wp.start_date == date(2026, 1, 1)

    def test_bounded_period_preserved(self):
        obj = SimpleNamespace(
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 1),
            requirement_ids=["r1"],
        )
        wp = _to_waiver_period(obj)
        assert wp.end_date == date(2026, 3, 1)
        assert wp.requirement_ids == ["r1"]

    def test_missing_requirement_ids_defaults_none(self):
        obj = SimpleNamespace(start_date=date(2026, 1, 1), end_date=date(2026, 2, 1))
        assert _to_waiver_period(obj).requirement_ids is None


class TestCountWaivedMonths:
    PERIOD = (date(2026, 1, 1), date(2026, 12, 31))

    def test_full_months_counted(self):
        waivers = [WaiverPeriod(date(2026, 3, 1), date(2026, 5, 31))]
        assert count_waived_months(waivers, *self.PERIOD) == 3

    def test_fifteen_day_threshold_met(self):
        # March 1-15 = 15 covered days -> counts.
        waivers = [WaiverPeriod(date(2026, 3, 1), date(2026, 3, 15))]
        assert count_waived_months(waivers, *self.PERIOD) == 1

    def test_below_fifteen_days_not_counted(self):
        # March 1-14 = 14 covered days -> does not count.
        waivers = [WaiverPeriod(date(2026, 3, 1), date(2026, 3, 14))]
        assert count_waived_months(waivers, *self.PERIOD) == 0

    def test_permanent_waiver_covers_whole_period(self):
        waivers = [WaiverPeriod(date(2026, 1, 1), _PERMANENT_END)]
        assert count_waived_months(waivers, *self.PERIOD) == 12

    def test_overlapping_waivers_deduped(self):
        waivers = [
            WaiverPeriod(date(2026, 3, 1), date(2026, 4, 30)),
            WaiverPeriod(date(2026, 4, 1), date(2026, 5, 31)),
        ]
        assert count_waived_months(waivers, *self.PERIOD) == 3

    def test_requirement_specific_waiver_skipped_for_other_req(self):
        waivers = [
            WaiverPeriod(date(2026, 3, 1), date(2026, 5, 31), requirement_ids=["other"])
        ]
        assert count_waived_months(waivers, *self.PERIOD, req_id="target") == 0

    def test_blanket_waiver_applies_to_any_req(self):
        waivers = [
            WaiverPeriod(date(2026, 3, 1), date(2026, 5, 31), requirement_ids=None)
        ]
        assert count_waived_months(waivers, *self.PERIOD, req_id="target") == 3

    def test_no_overlap_returns_zero(self):
        waivers = [WaiverPeriod(date(2025, 1, 1), date(2025, 2, 1))]
        assert count_waived_months(waivers, *self.PERIOD) == 0

    def test_empty_period_returns_zero(self):
        assert count_waived_months([], None, None) == 0


class TestTotalMonthsInPeriod:
    def test_single_month(self):
        assert total_months_in_period(date(2026, 5, 1), date(2026, 5, 31)) == 1

    def test_same_year_span(self):
        assert total_months_in_period(date(2026, 1, 1), date(2026, 12, 31)) == 12

    def test_cross_year_span(self):
        assert total_months_in_period(date(2025, 11, 1), date(2026, 2, 1)) == 4

    def test_none_inputs_return_zero(self):
        assert total_months_in_period(None, date(2026, 1, 1)) == 0
        assert total_months_in_period(date(2026, 1, 1), None) == 0


class TestAdjustRequired:
    PERIOD = (date(2026, 1, 1), date(2026, 12, 31))

    def test_no_waivers_unchanged(self):
        adjusted, waived, active = adjust_required(12.0, *self.PERIOD, waivers=[])
        assert (adjusted, waived, active) == (12.0, 0, 12)

    def test_proportional_reduction(self):
        # 3 of 12 months waived -> 12 * (9/12) = 9.0
        waivers = [WaiverPeriod(date(2026, 1, 1), date(2026, 3, 31))]
        adjusted, waived, active = adjust_required(12.0, *self.PERIOD, waivers=waivers)
        assert waived == 3
        assert active == 9
        assert adjusted == 9.0

    def test_period_months_override(self):
        # Explicit period_months overrides the calendar count.
        waivers = [WaiverPeriod(date(2026, 1, 1), date(2026, 1, 31))]
        adjusted, waived, active = adjust_required(
            10.0, *self.PERIOD, waivers=waivers, period_months=10
        )
        assert waived == 1
        assert active == 9
        assert adjusted == 9.0

    def test_zero_base_returns_unchanged(self):
        assert adjust_required(0.0, *self.PERIOD, waivers=[]) == (0.0, 0, 0)


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
