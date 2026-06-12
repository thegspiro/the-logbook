"""
Tests for event check-in window logic
(app/services/event_service.py pure helpers).

The check-in window gates self-check-in timing, so it is correctness- and
abuse-relevant. Covers _get_check_in_window across all three window types
(flexible / strict / window), the default and custom before/after offsets,
naive->UTC normalization, and _validate_check_in_window (too early, too
late, within window, and localized messaging). Pure logic; no DB.
"""

from datetime import datetime, timedelta
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.models.event import CheckInWindowType
from app.services.event_service import EventService

START = datetime(2026, 6, 1, 19, 0, tzinfo=tz.utc)
END = datetime(2026, 6, 1, 21, 0, tzinfo=tz.utc)


def _event(window_type, before=None, after=None, actual_start=None, actual_end=None):
    return SimpleNamespace(
        check_in_window_type=window_type,
        check_in_minutes_before=before,
        check_in_minutes_after=after,
        start_datetime=START,
        end_datetime=END,
        actual_start_time=actual_start,
        actual_end_time=actual_end,
    )


def _svc():
    return EventService(MagicMock())


class TestGetCheckInWindow:
    def test_flexible_default_30_before_until_end(self):
        start, end = EventService._get_check_in_window(
            _event(CheckInWindowType.FLEXIBLE)
        )
        assert start == START - timedelta(minutes=30)
        assert end == END

    def test_flexible_custom_before(self):
        start, _ = EventService._get_check_in_window(
            _event(CheckInWindowType.FLEXIBLE, before=60)
        )
        assert start == START - timedelta(minutes=60)

    def test_flexible_uses_actual_end_when_present(self):
        actual_end = datetime(2026, 6, 1, 20, 30, tzinfo=tz.utc)
        _, end = EventService._get_check_in_window(
            _event(CheckInWindowType.FLEXIBLE, actual_end=actual_end)
        )
        assert end == actual_end

    def test_strict_uses_actual_start_when_present(self):
        actual_start = datetime(2026, 6, 1, 19, 5, tzinfo=tz.utc)
        start, end = EventService._get_check_in_window(
            _event(CheckInWindowType.STRICT, actual_start=actual_start)
        )
        assert start == actual_start
        assert end == END

    def test_strict_falls_back_to_scheduled(self):
        start, _ = EventService._get_check_in_window(_event(CheckInWindowType.STRICT))
        assert start == START  # no actual_start -> scheduled start, no early window

    def test_window_default_15_each_side(self):
        start, end = EventService._get_check_in_window(_event(CheckInWindowType.WINDOW))
        assert start == START - timedelta(minutes=15)
        assert end == END + timedelta(minutes=15)

    def test_window_custom_offsets(self):
        start, end = EventService._get_check_in_window(
            _event(CheckInWindowType.WINDOW, before=45, after=20)
        )
        assert start == START - timedelta(minutes=45)
        assert end == END + timedelta(minutes=20)

    def test_naive_datetimes_get_utc(self):
        ev = _event(CheckInWindowType.STRICT)
        ev.start_datetime = datetime(2026, 6, 1, 19, 0)  # naive
        ev.end_datetime = datetime(2026, 6, 1, 21, 0)  # naive
        start, end = EventService._get_check_in_window(ev)
        assert start.tzinfo == tz.utc
        assert end.tzinfo == tz.utc


class TestValidateCheckInWindow:
    def test_too_early(self):
        ev = _event(CheckInWindowType.FLEXIBLE)  # window opens 18:30 UTC
        now = datetime(2026, 6, 1, 18, 0, tzinfo=tz.utc)
        ok, msg = _svc()._validate_check_in_window(ev, now)
        assert ok is False
        assert "not available yet" in msg
        assert "UTC" in msg

    def test_too_late(self):
        ev = _event(CheckInWindowType.FLEXIBLE)
        now = datetime(2026, 6, 1, 21, 30, tzinfo=tz.utc)  # after 21:00 end
        ok, msg = _svc()._validate_check_in_window(ev, now)
        assert ok is False
        assert "no longer available" in msg

    def test_within_window(self):
        ev = _event(CheckInWindowType.FLEXIBLE)
        now = datetime(2026, 6, 1, 19, 30, tzinfo=tz.utc)
        ok, msg = _svc()._validate_check_in_window(ev, now)
        assert ok is True
        assert msg is None

    def test_early_message_localized(self):
        ev = _event(CheckInWindowType.FLEXIBLE)
        now = datetime(2026, 6, 1, 18, 0, tzinfo=tz.utc)
        ok, msg = _svc()._validate_check_in_window(ev, now, tz_name="America/New_York")
        assert ok is False
        # 18:30 UTC == 2:30 PM EDT
        assert "02:30 PM" in msg
        assert "EDT" in msg


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
