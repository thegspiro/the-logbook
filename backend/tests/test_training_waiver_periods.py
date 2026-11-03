"""
Tests for the training-waiver period math
(app/services/training_waiver_service.py pure helpers).

These cover the None-safety mechanism that the rest of the codebase relies
on — _to_waiver_period maps a permanent leave/waiver (end_date=None) to the
_PERMANENT_END sentinel so the calendar-overlap math never compares against
None — plus the three leave month rules a department chooses between
(``ComplianceConfig.leave_month_rule``), requirement-specific filtering, month
counting, and the proportional requirement adjustment, including the
round-down of shift and call targets. Pure functions; no DB.
"""

from datetime import date
from types import SimpleNamespace

import pytest

from app.services.training_waiver_service import (
    _PERMANENT_END,
    SOURCE_LEAVE,
    SOURCE_WAIVER,
    WaiverPeriod,
    _to_waiver_period,
    adjust_required,
    count_waived_months,
    month_waivers,
    total_months_in_period,
)

pytestmark = pytest.mark.unit


def _period(start, end, rule="full_month", source=SOURCE_LEAVE, req_ids=None):
    return WaiverPeriod(start, end, req_ids, source=source, month_rule=rule)


class TestToWaiverPeriod:
    def test_permanent_leave_maps_to_sentinel(self):
        obj = SimpleNamespace(
            start_date=date(2026, 1, 1), end_date=None, requirement_ids=None
        )
        wp = _to_waiver_period(obj, SOURCE_LEAVE)
        assert wp.end_date == _PERMANENT_END
        assert wp.start_date == date(2026, 1, 1)

    def test_bounded_period_preserved(self):
        obj = SimpleNamespace(
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 1),
            requirement_ids=["r1"],
        )
        wp = _to_waiver_period(obj, SOURCE_WAIVER, "half")
        assert wp.end_date == date(2026, 3, 1)
        assert wp.source == SOURCE_WAIVER
        assert wp.month_rule == "half"
        assert wp.requirement_ids == ["r1"]

    def test_missing_requirement_ids_defaults_none(self):
        obj = SimpleNamespace(start_date=date(2026, 1, 1), end_date=date(2026, 2, 1))
        assert _to_waiver_period(obj, SOURCE_LEAVE).requirement_ids is None


class TestCountWaivedMonths:
    PERIOD = (date(2026, 1, 1), date(2026, 12, 31))

    def test_full_months_counted(self):
        waivers = [WaiverPeriod(date(2026, 3, 1), date(2026, 5, 31))]
        assert count_waived_months(waivers, *self.PERIOD) == 3

    def test_one_day_counts_under_full_month_rule(self):
        # The default rule: any day of leave excuses the month.
        waivers = [_period(date(2026, 3, 31), date(2026, 3, 31))]
        assert count_waived_months(waivers, *self.PERIOD) == 1

    def test_half_rule_below_fifteen_days_not_counted(self):
        waivers = [_period(date(2026, 3, 1), date(2026, 3, 14), "half")]
        assert count_waived_months(waivers, *self.PERIOD) == 0

    def test_half_rule_fifteen_days_counted(self):
        waivers = [_period(date(2026, 3, 1), date(2026, 3, 15), "half")]
        assert count_waived_months(waivers, *self.PERIOD) == 1

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


class TestMonthWaivers:
    """The owner's cases: a leave ending on the 1st, and one starting mid-month."""

    PERIOD = (date(2025, 11, 1), date(2026, 10, 31))

    def test_leave_ending_on_first_waives_that_month_under_full_month(self):
        months = month_waivers(
            [_period(date(2025, 7, 1), date(2026, 9, 1))], *self.PERIOD
        )
        assert (2026, 9) in months
        assert months[(2026, 9)].share == 1.0
        assert len(months) == 11  # Nov 2025 - Sep 2026

    def test_leave_starting_mid_month_waives_it_under_full_month(self):
        months = month_waivers(
            [_period(date(2026, 7, 15), date(2026, 8, 31))], *self.PERIOD
        )
        assert months[(2026, 7)].share == 1.0

    def test_proportional_share_by_days(self):
        # Sep 1 only: 1 of 30 days.
        months = month_waivers(
            [_period(date(2026, 9, 1), date(2026, 9, 1), "proportional")],
            *self.PERIOD,
        )
        assert months[(2026, 9)].share == pytest.approx(1 / 30)
        assert months[(2026, 9)].days_covered == 1
        assert months[(2026, 9)].days_in_window == 30

    def test_proportional_full_month_is_whole(self):
        months = month_waivers(
            [_period(date(2026, 6, 1), date(2026, 6, 30), "proportional")],
            *self.PERIOD,
        )
        assert months[(2026, 6)].share == 1.0
        assert not months[(2026, 6)].partial

    @pytest.mark.parametrize(
        ("end_day", "share"),
        [(1, None), (14, None), (15, 0.5), (29, 0.5), (30, 1.0)],
    )
    def test_half_rule(self, end_day, share):
        months = month_waivers(
            [_period(date(2026, 6, 1), date(2026, 6, end_day), "half")],
            *self.PERIOD,
        )
        if share is None:
            assert (2026, 6) not in months
        else:
            assert months[(2026, 6)].share == share

    def test_overlapping_days_counted_once_and_sources_merged(self):
        months = month_waivers(
            [
                _period(date(2026, 3, 1), date(2026, 3, 10), "proportional"),
                _period(
                    date(2026, 3, 5),
                    date(2026, 3, 20),
                    "proportional",
                    source=SOURCE_WAIVER,
                ),
            ],
            *self.PERIOD,
        )
        assert months[(2026, 3)].days_covered == 20
        assert months[(2026, 3)].sources == {SOURCE_LEAVE, SOURCE_WAIVER}

    def test_window_opening_mid_month_measures_days_in_window(self):
        # A rolling window opening Mar 16 leaves 16 March days in it; leave
        # covering all of them excuses the whole month.
        months = month_waivers(
            [_period(date(2026, 3, 1), date(2026, 3, 31), "proportional")],
            date(2026, 3, 16),
            date(2027, 3, 15),
        )
        assert months[(2026, 3)].days_in_window == 16
        assert months[(2026, 3)].share == 1.0


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

    def test_owner_example_full_month(self):
        # LOA 2025-07-01 to 2026-09-01, window Nov 2025 - Oct 2026, 72 hrs a
        # year: 11 months excused, 1 active, 6 hrs owed.
        waivers = [_period(date(2025, 7, 1), date(2026, 9, 1))]
        assert adjust_required(
            72.0, date(2025, 11, 1), date(2026, 10, 31), waivers
        ) == (6.0, 11, 1)

    def test_proportional_partial_month(self):
        # 10 of 30 June days on leave: 12 * (11 + 2/3) / 12 = 11.67.
        waivers = [_period(date(2026, 6, 1), date(2026, 6, 10), "proportional")]
        adjusted, waived, active = adjust_required(12.0, *self.PERIOD, waivers)
        assert waived == 1
        assert active == pytest.approx(11.67)
        assert adjusted == pytest.approx(11.67)

    def test_half_rule_partial_month(self):
        waivers = [_period(date(2026, 6, 1), date(2026, 6, 20), "half")]
        adjusted, waived, active = adjust_required(12.0, *self.PERIOD, waivers)
        assert (adjusted, waived, active) == (11.5, 1, 11.5)

    def test_whole_units_round_down(self):
        # 3 shifts a year, half a month excused: 3 * 11.5 / 12 = 2.875 -> 2.
        waivers = [_period(date(2026, 6, 1), date(2026, 6, 20), "half")]
        adjusted, _, _ = adjust_required(3.0, *self.PERIOD, waivers, whole_units=True)
        assert adjusted == 2.0

    def test_whole_units_exact_value_not_rounded_below_itself(self):
        # 12 shifts, 3 months excused: exactly 9, not 8 through float error.
        waivers = [_period(date(2026, 1, 1), date(2026, 3, 31))]
        adjusted, _, _ = adjust_required(12.0, *self.PERIOD, waivers, whole_units=True)
        assert adjusted == 9.0

    def test_whole_units_can_round_to_zero(self):
        # 1 call a year, 11 months excused: 1/12 rounds down to nothing owed.
        waivers = [_period(date(2026, 1, 1), date(2026, 11, 30))]
        adjusted, _, _ = adjust_required(1.0, *self.PERIOD, waivers, whole_units=True)
        assert adjusted == 0.0


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
