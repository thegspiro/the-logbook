"""The quarter-hour reporting rule, and the two boundaries around it."""

from app.utils.hours import (
    QUARTER_HOUR,
    hours_from_minutes,
    round_hours_exact,
    round_hours_to_quarter,
    sum_hours_to_quarter,
    sum_minutes_to_quarter,
)


class TestRoundHoursToQuarter:
    def test_leaves_a_value_already_on_a_quarter(self):
        assert round_hours_to_quarter(0) == 0.0
        assert round_hours_to_quarter(2.25) == 2.25
        assert round_hours_to_quarter(66.75) == 66.75

    def test_rounds_to_the_nearest_quarter(self):
        assert round_hours_to_quarter(66.7) == 66.75
        assert round_hours_to_quarter(2.9) == 3.0
        assert round_hours_to_quarter(1.1) == 1.0
        assert round_hours_to_quarter(69.6) == 69.5

    def test_breaks_a_tie_upward(self):
        # Python's built-in round() would give 1.0 here (banker's rounding);
        # the frontend's Math.round gives 1.25, and the two must not disagree.
        assert round_hours_to_quarter(1.125) == 1.25
        assert round_hours_to_quarter(0.125) == 0.25

    def test_returns_a_clean_quarter_rather_than_the_drift_it_was_given(self):
        assert round_hours_to_quarter(69.60000000000001) == 69.5
        assert round_hours_to_quarter(0.1 + 0.2) == 0.25

    def test_rounds_toward_positive_infinity_and_never_returns_negative_zero(self):
        assert round_hours_to_quarter(-2.9) == -3.0
        assert round_hours_to_quarter(-1.125) == -1.0
        assert str(round_hours_to_quarter(-0.1)) == "0.0"

    def test_treats_absent_and_non_finite_values_as_zero(self):
        assert round_hours_to_quarter(None) == 0.0
        assert round_hours_to_quarter(float("nan")) == 0.0
        assert round_hours_to_quarter(float("inf")) == 0.0


class TestFromMinutes:
    def test_converts_stored_minutes_to_reportable_hours(self):
        assert hours_from_minutes(60) == 1.0
        assert hours_from_minutes(10) == 0.25
        assert hours_from_minutes(0) == 0.0
        assert hours_from_minutes(None) == 0.0

    def test_sums_the_rounded_parts(self):
        # Three ten-minute entries read 0.25 each; the total must be the 0.75
        # a reader adds up, not the 0.5 the raw aggregate gives.
        assert sum_minutes_to_quarter([10, 10, 10]) == 0.75
        assert round_hours_to_quarter(30 / 60) == 0.5


class TestSumHoursToQuarter:
    def test_totals_the_rounded_parts(self):
        assert sum_hours_to_quarter([0, 66.7, 2.9]) == 69.75

    def test_handles_an_empty_list_and_absent_members(self):
        assert sum_hours_to_quarter([]) == 0.0
        assert sum_hours_to_quarter([None, None, 1.1]) == 1.0


class TestRoundHoursExact:
    def test_keeps_a_derived_average_off_the_quarter(self):
        # 2.5 hours over three shifts. The quarter rule would say 0.75.
        assert round_hours_exact(2.5 / 3) == 0.83
        assert round_hours_to_quarter(2.5 / 3) == 0.75

    def test_trims_float_drift(self):
        assert round_hours_exact(0.1 + 0.2) == 0.3
        assert round_hours_exact(None) == 0.0
        assert round_hours_exact(float("nan")) == 0.0


def test_quarter_hour_is_the_increment_the_rule_is_built_on():
    assert QUARTER_HOUR == 0.25
    assert round_hours_to_quarter(QUARTER_HOUR) == QUARTER_HOUR
