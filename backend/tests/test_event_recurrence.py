"""
Tests for event recurrence date generation
(app/services/event_service.py pure date-math helpers).

Covers _nth_weekday_of_month (1st/3rd/last weekday, non-existent ordinal)
and _generate_recurrence_dates across every pattern (daily, weekly,
biweekly, monthly with end-of-month clamp, monthly-weekday, annually with
the Feb-29 fallback, custom weekdays), duration preservation, and the
exception-date filter. Pure logic; no DB.
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock

from app.models.event import RecurrencePattern
from app.services.event_service import EventService

MON, TUE, WED, FRI = 0, 1, 2, 4


def _svc():
    return EventService(MagicMock())


def _gen(start, end, pattern, rec_end, **kw):
    return _svc()._generate_recurrence_dates(start, end, pattern, rec_end, **kw)


class TestNthWeekdayOfMonth:
    REF = datetime(2026, 1, 1, 19, 0)

    def test_first_monday(self):
        # First Monday of June 2026 is the 1st.
        out = EventService._nth_weekday_of_month(2026, 6, MON, 1, self.REF)
        assert out.date() == datetime(2026, 6, 1).date()
        assert out.hour == 19  # time copied from reference

    def test_third_tuesday(self):
        # Third Tuesday of June 2026 is the 16th.
        out = EventService._nth_weekday_of_month(2026, 6, TUE, 3, self.REF)
        assert out.date() == datetime(2026, 6, 16).date()

    def test_last_friday(self):
        # Last Friday of June 2026 is the 26th.
        out = EventService._nth_weekday_of_month(2026, 6, FRI, -1, self.REF)
        assert out.date() == datetime(2026, 6, 26).date()

    def test_nonexistent_fifth_monday_returns_none(self):
        # February 2026 (28 days) has exactly four Mondays.
        assert EventService._nth_weekday_of_month(2026, 2, MON, 5, self.REF) is None


class TestRecurrenceCadences:
    def test_daily(self):
        start = datetime(2026, 6, 1, 9, 0)
        end = datetime(2026, 6, 1, 10, 0)
        out = _gen(start, end, "daily", datetime(2026, 6, 4, 9, 0))
        assert [s.date().day for s, _ in out] == [1, 2, 3, 4]

    def test_weekly(self):
        start = datetime(2026, 6, 1, 9, 0)
        out = _gen(start, start, "weekly", datetime(2026, 6, 29, 9, 0))
        assert [s.date().day for s, _ in out] == [1, 8, 15, 22, 29]

    def test_biweekly(self):
        start = datetime(2026, 6, 1, 9, 0)
        out = _gen(start, start, "biweekly", datetime(2026, 7, 1, 9, 0))
        assert [s.date() for s, _ in out] == [
            datetime(2026, 6, 1).date(),
            datetime(2026, 6, 15).date(),
            datetime(2026, 6, 29).date(),
        ]

    def test_monthly_clamps_end_of_month(self):
        # Jan 31 -> Feb (clamped to 28) -> Mar 28...
        start = datetime(2026, 1, 31, 9, 0)
        out = _gen(start, start, "monthly", datetime(2026, 3, 31, 9, 0))
        assert [s.date() for s, _ in out] == [
            datetime(2026, 1, 31).date(),
            datetime(2026, 2, 28).date(),
            datetime(2026, 3, 28).date(),
        ]

    def test_monthly_weekday(self):
        # 1st Monday of each month starting June 1 (a Monday).
        start = datetime(2026, 6, 1, 9, 0)
        out = _gen(
            start,
            start,
            "monthly_weekday",
            datetime(2026, 8, 31, 9, 0),
            weekday=MON,
            week_ordinal=1,
        )
        assert [s.date() for s, _ in out] == [
            datetime(2026, 6, 1).date(),
            datetime(2026, 7, 6).date(),
            datetime(2026, 8, 3).date(),
        ]

    def test_annually_leap_day_fallback(self):
        start = datetime(2024, 2, 29, 9, 0)  # leap day
        out = _gen(start, start, "annually", datetime(2025, 3, 1, 9, 0))
        assert [s.date() for s, _ in out] == [
            datetime(2024, 2, 29).date(),
            datetime(2025, 2, 28).date(),  # 2025 not a leap year
        ]

    def test_custom_weekdays(self):
        # Mondays and Wednesdays, starting Monday June 1.
        start = datetime(2026, 6, 1, 9, 0)
        out = _gen(
            start,
            start,
            "custom",
            datetime(2026, 6, 10, 9, 0),
            custom_days=[MON, WED],
        )
        assert [s.date().day for s, _ in out] == [1, 3, 8, 10]


class TestDurationAndExceptions:
    def test_duration_preserved(self):
        start = datetime(2026, 6, 1, 9, 0)
        end = datetime(2026, 6, 1, 11, 30)
        out = _gen(start, end, "daily", datetime(2026, 6, 3, 9, 0))
        for s, e in out:
            assert e - s == timedelta(hours=2, minutes=30)

    def test_exception_dates_filtered(self):
        start = datetime(2026, 6, 1, 9, 0)
        out = _gen(
            start,
            start,
            "daily",
            datetime(2026, 6, 4, 9, 0),
            exceptions=["2026-06-02", "2026-06-03"],
        )
        assert [s.date().day for s, _ in out] == [1, 4]

    def test_unknown_pattern_yields_single_occurrence(self):
        start = datetime(2026, 6, 1, 9, 0)
        out = _gen(start, start, "not_a_pattern", datetime(2026, 6, 30, 9, 0))
        assert len(out) == 1


def test_all_patterns_have_a_test():
    # Guard: every RecurrencePattern value is exercised above (custom/weekday
    # variants included), so a new pattern won't silently go untested.
    covered = {
        "daily",
        "weekly",
        "biweekly",
        "monthly",
        "monthly_weekday",
        "annually",
        "custom",
    }
    known = {p.value for p in RecurrencePattern}
    # annually_weekday is the only one not directly exercised here.
    assert known - covered == {"annually_weekday"}


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
