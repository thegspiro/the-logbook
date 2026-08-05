"""
Tests for the relative-schedule date math behind multi-class courses
(app/utils/scheduling_dates.py).

Covers offset-to-date resolution, the weekend / blackout roll policies,
meeting-pattern autofill, DST correctness (a class at 19:00 local must stay at
19:00 local on both sides of a transition), and the US federal holiday helper
that seeds the blackout picker. Pure logic; no DB.
"""

from datetime import date

import pytest

from app.utils.scheduling_dates import (
    is_blocked,
    normalize_meeting_days,
    offsets_from_meeting_pattern,
    parse_blackout_dates,
    parse_hhmm,
    resolve_class_datetimes,
    roll_date,
    us_federal_holidays,
    us_federal_holidays_between,
)

NY = "America/New_York"
MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


class TestParseHhmm:
    def test_parses_valid_time(self):
        assert parse_hhmm("19:00").hour == 19
        assert parse_hhmm("07:45").minute == 45

    @pytest.mark.parametrize("bad", ["", None, "nonsense", "25:00", "12:99", "1200"])
    def test_falls_back_on_bad_input(self, bad):
        # A malformed stored value must not make a whole cohort ungeneratable.
        assert parse_hhmm(bad, "09:30").hour == 9
        assert parse_hhmm(bad, "09:30").minute == 30


class TestParseBlackoutDates:
    def test_parses_iso_strings(self):
        assert parse_blackout_dates(["2026-07-04", "2026-12-25"]) == {
            date(2026, 7, 4),
            date(2026, 12, 25),
        }

    def test_drops_unparseable_entries(self):
        assert parse_blackout_dates(["2026-07-04", "garbage", None]) == {
            date(2026, 7, 4)
        }

    def test_accepts_date_objects(self):
        assert parse_blackout_dates([date(2026, 7, 4)]) == {date(2026, 7, 4)}


class TestNormalizeMeetingDays:
    def test_sorts_and_dedupes(self):
        assert normalize_meeting_days([3, 1, 3]) == [1, 3]

    def test_drops_out_of_range(self):
        assert normalize_meeting_days([1, 9, -2]) == [1]

    def test_empty(self):
        assert normalize_meeting_days(None) == []


class TestRollPolicies:
    def test_none_policy_keeps_weekend(self):
        saturday = date(2026, 9, 12)
        assert roll_date(saturday, "none", [], set()) == saturday

    def test_none_policy_still_skips_blackouts(self):
        # A blackout is an explicit "not this day", so it applies regardless of
        # the weekend policy.
        holiday = date(2026, 7, 3)
        assert roll_date(holiday, "none", [], {holiday}) == date(2026, 7, 4)

    def test_next_business_day_rolls_saturday_to_monday(self):
        assert roll_date(date(2026, 9, 12), "next_business_day", [], set()) == date(
            2026, 9, 14
        )

    def test_next_business_day_rolls_sunday_to_monday(self):
        assert roll_date(date(2026, 9, 13), "next_business_day", [], set()) == date(
            2026, 9, 14
        )

    def test_next_meeting_day_snaps_to_pattern(self):
        # Wednesday 2026-09-09 with a Tue/Thu pattern moves to Thursday.
        assert roll_date(date(2026, 9, 9), "next_meeting_day", [TUE, THU], set()) == (
            date(2026, 9, 10)
        )

    def test_next_meeting_day_with_no_pattern_is_a_noop(self):
        wednesday = date(2026, 9, 9)
        assert roll_date(wednesday, "next_meeting_day", [], set()) == wednesday

    def test_rolls_past_consecutive_blackouts(self):
        blackouts = {date(2026, 9, 14), date(2026, 9, 15)}
        assert roll_date(date(2026, 9, 14), "none", [], blackouts) == date(2026, 9, 16)

    def test_is_blocked_reports_weekend_under_business_policy(self):
        assert is_blocked(date(2026, 9, 12), "next_business_day", [], set()) is True
        assert is_blocked(date(2026, 9, 14), "next_business_day", [], set()) is False


class TestResolveClassDatetimes:
    def test_offset_zero_is_the_start_date(self):
        start, end, warning = resolve_class_datetimes(
            start_date=date(2026, 9, 8),
            day_offset=0,
            start_time="19:00",
            duration_minutes=180,
            tz_name=NY,
        )
        # 19:00 EDT (UTC-4) is 23:00 UTC the same day.
        assert (start.year, start.month, start.day, start.hour) == (2026, 9, 8, 23)
        assert (end - start).total_seconds() == 180 * 60
        assert warning is None

    def test_offset_advances_the_date(self):
        start, _, _ = resolve_class_datetimes(
            start_date=date(2026, 9, 8),
            day_offset=3,
            start_time="09:00",
            duration_minutes=60,
            tz_name=NY,
        )
        assert start.date() == date(2026, 9, 11)

    def test_wall_clock_survives_a_dst_transition(self):
        """A 19:00 class stays at 19:00 local across the November DST change.

        This is the whole reason times are stored as wall clock and converted
        at generation rather than as a fixed UTC offset: the same syllabus row
        lands at 23:00 UTC in September and 00:00 UTC in December.
        """
        september, _, _ = resolve_class_datetimes(
            start_date=date(2026, 9, 8),
            day_offset=0,
            start_time="19:00",
            duration_minutes=60,
            tz_name=NY,
        )
        december, _, _ = resolve_class_datetimes(
            start_date=date(2026, 9, 8),
            day_offset=90,
            start_time="19:00",
            duration_minutes=60,
            tz_name=NY,
        )
        assert september.hour == 23  # EDT, UTC-4
        assert december.hour == 0  # EST, UTC-5 — next UTC day
        assert december.date() == date(2026, 12, 8)

    def test_weekend_roll_reports_a_warning(self):
        start, _, warning = resolve_class_datetimes(
            start_date=date(2026, 9, 7),
            day_offset=5,  # 2026-09-12, a Saturday
            start_time="09:00",
            duration_minutes=60,
            tz_name=NY,
            roll_policy="next_business_day",
        )
        assert start.date() == date(2026, 9, 14)
        assert warning is not None
        assert "weekend" in warning

    def test_blackout_roll_reports_a_warning(self):
        _, _, warning = resolve_class_datetimes(
            start_date=date(2026, 9, 8),
            day_offset=0,
            start_time="09:00",
            duration_minutes=60,
            tz_name=NY,
            blackout_dates=["2026-09-08"],
        )
        assert warning is not None
        assert "blackout" in warning

    def test_falls_back_to_defaults(self):
        start, end, _ = resolve_class_datetimes(
            start_date=date(2026, 9, 8),
            day_offset=0,
            start_time=None,
            duration_minutes=None,
            tz_name=NY,
            default_start_time="18:30",
            default_duration_minutes=120,
        )
        assert (end - start).total_seconds() == 120 * 60
        # 18:30 EDT is 22:30 UTC.
        assert (start.hour, start.minute) == (22, 30)

    def test_unknown_timezone_falls_back_rather_than_raising(self):
        start, _, _ = resolve_class_datetimes(
            start_date=date(2026, 9, 8),
            day_offset=0,
            start_time="09:00",
            duration_minutes=60,
            tz_name="Not/AZone",
        )
        assert start.tzinfo is not None

    def test_negative_offset_is_clamped_to_the_start_date(self):
        start, _, _ = resolve_class_datetimes(
            start_date=date(2026, 9, 8),
            day_offset=-5,
            start_time="09:00",
            duration_minutes=60,
            tz_name=NY,
        )
        assert start.date() == date(2026, 9, 8)


class TestMeetingPatternAutofill:
    def test_tuesday_thursday_from_a_monday_start(self):
        # Course starts Monday; first class is the next day (Tue), then Thu,
        # then the following Tue, and so on.
        assert offsets_from_meeting_pattern(6, [TUE, THU], start_weekday=MON) == [
            1,
            3,
            8,
            10,
            15,
            17,
        ]

    def test_start_weekday_is_honoured(self):
        # Starting on a Tuesday, the first class is offset 0.
        assert offsets_from_meeting_pattern(3, [TUE, THU], start_weekday=TUE) == [
            0,
            2,
            7,
        ]

    def test_no_pattern_falls_back_to_consecutive_days(self):
        assert offsets_from_meeting_pattern(4, []) == [0, 1, 2, 3]

    def test_zero_classes(self):
        assert offsets_from_meeting_pattern(0, [TUE]) == []

    def test_fifteen_class_recruit_school(self):
        # The motivating case: fifteen classes two evenings a week runs about
        # seven and a half weeks.
        offsets = offsets_from_meeting_pattern(15, [TUE, THU], start_weekday=MON)
        assert len(offsets) == 15
        assert offsets == sorted(offsets)
        assert offsets[-1] == 50


class TestUsFederalHolidays:
    def test_2026_set(self):
        holidays = us_federal_holidays(2026)
        assert date(2026, 1, 1) in holidays  # New Year's Day
        assert date(2026, 1, 19) in holidays  # MLK Day, 3rd Monday
        assert date(2026, 5, 25) in holidays  # Memorial Day, last Monday
        assert date(2026, 9, 7) in holidays  # Labor Day, 1st Monday
        assert date(2026, 11, 26) in holidays  # Thanksgiving, 4th Thursday
        assert date(2026, 12, 25) in holidays

    def test_saturday_holiday_observed_on_friday(self):
        # July 4 2026 is a Saturday, so the observed holiday is July 3.
        holidays = us_federal_holidays(2026)
        assert date(2026, 7, 3) in holidays
        assert date(2026, 7, 4) not in holidays

    def test_between_filters_and_sorts(self):
        found = us_federal_holidays_between(date(2026, 9, 1), date(2026, 12, 31))
        assert found == sorted(found)
        assert date(2026, 9, 7) in found
        assert date(2026, 1, 1) not in found

    def test_between_spans_years(self):
        found = us_federal_holidays_between(date(2026, 12, 1), date(2027, 1, 31))
        assert date(2026, 12, 25) in found
        assert date(2027, 1, 1) in found

    def test_between_rejects_reversed_range(self):
        assert us_federal_holidays_between(date(2026, 12, 1), date(2026, 1, 1)) == []
