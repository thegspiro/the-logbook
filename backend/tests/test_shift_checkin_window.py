"""Check-in is bounded by the shift's own times, not only by finalisation.

Attendance used to be refused only once an officer had finalised the shift, so a
link to a shift that ended days earlier still checked somebody in — and stamped
the arrival at the moment they tapped it, not when they were actually there. The
bounds come from the department's checklist-timing settings.

Pure function under test; no DB.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.scheduling_service import SchedulingService

NOW = datetime.now(timezone.utc)


def _shift(start_offset_hours: float, duration_hours: float = 12.0):
    start = NOW + timedelta(hours=start_offset_hours)
    return SimpleNamespace(
        start_time=start,
        end_time=start + timedelta(hours=duration_hours),
    )


def _settings(**timing):
    return {"shift_reports": {"checklist_timing": timing}} if timing else {}


class TestCheckInWindow:
    def test_open_during_the_shift(self):
        # Started two hours ago, runs twelve.
        assert SchedulingService._checkin_window_error(_shift(-2), _settings()) is None

    def test_open_inside_the_default_lead(self):
        # Starts in one hour; the default opens check-in two hours early.
        assert SchedulingService._checkin_window_error(_shift(1), _settings()) is None

    def test_closed_before_the_lead(self):
        # Starts in eight days — the case a stale link or an early tap produces.
        error = SchedulingService._checkin_window_error(_shift(24 * 8), _settings())
        assert error is not None
        assert "has not started yet" in error

    def test_open_shortly_after_the_end(self):
        # Ended an hour ago; the default allows twelve, for late call-backs.
        assert SchedulingService._checkin_window_error(_shift(-13), _settings()) is None

    def test_closed_long_after_the_end(self):
        # Ended eleven days ago: the shift this whole guard exists for.
        error = SchedulingService._checkin_window_error(_shift(-24 * 11), _settings())
        assert error is not None
        assert "ended too long ago" in error

    def test_department_can_widen_the_trailing_bound(self):
        shift = _shift(-24 * 2)  # ended ~36 hours ago
        assert (
            SchedulingService._checkin_window_error(shift, _settings()) is not None
        ), "default 12h should refuse a shift that ended 36 hours ago"
        assert (
            SchedulingService._checkin_window_error(
                shift, _settings(checkin_closes_hours_after=72)
            )
            is None
        )

    def test_department_can_close_the_lead_entirely(self):
        shift = _shift(1)  # starts in an hour
        assert SchedulingService._checkin_window_error(shift, _settings()) is None
        error = SchedulingService._checkin_window_error(
            shift, _settings(checkin_opens_hours_before=0)
        )
        assert error is not None
        assert "when the shift starts" in error

    def test_a_shift_with_no_end_time_is_bounded_by_its_start(self):
        shift = SimpleNamespace(start_time=NOW - timedelta(hours=48), end_time=None)
        error = SchedulingService._checkin_window_error(shift, _settings())
        assert error is not None

    def test_a_shift_with_no_times_is_allowed_through(self):
        # Nothing to measure against; refusing would block check-in on data this
        # rule cannot judge.
        shift = SimpleNamespace(start_time=None, end_time=None)
        assert SchedulingService._checkin_window_error(shift, _settings()) is None

    def test_naive_times_are_read_as_utc(self):
        """MySQL DATETIME has no offset, so these come back naive.

        Comparing a naive shift time against an aware `now` raises TypeError,
        which would 500 every check-in rather than allowing or refusing one.
        """
        naive_now = datetime.now(timezone.utc).replace(tzinfo=None)
        during = SimpleNamespace(
            start_time=naive_now - timedelta(hours=2),
            end_time=naive_now + timedelta(hours=10),
        )
        assert SchedulingService._checkin_window_error(during, _settings()) is None

        long_over = SimpleNamespace(
            start_time=naive_now - timedelta(hours=24 * 11),
            end_time=naive_now - timedelta(hours=24 * 11) + timedelta(hours=12),
        )
        assert (
            SchedulingService._checkin_window_error(long_over, _settings()) is not None
        )
