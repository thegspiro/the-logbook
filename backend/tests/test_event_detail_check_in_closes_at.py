"""The event detail response reports when self check-in closes.

The detail screen hides its check-in QR code once checking in is no longer
possible. That moment is the check-in window's close as
``EventService._get_check_in_window`` defines it — not the scheduled end, since
a "window" event keeps accepting check-ins for ``check_in_minutes_after``
beyond it, and an event ended early stops at its recorded end. The builder must
therefore report the same value the list endpoint and the check-in guard use.

DB-free.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest

from app.api.v1.endpoints.events import _build_event_response
from app.models.event import CheckInWindowType, Event

pytestmark = pytest.mark.unit

START = datetime(2026, 9, 1, 19, 0, tzinfo=dt_timezone.utc)
END = START + timedelta(hours=2)


def make_event(**overrides) -> Event:
    defaults = {
        "id": "22222222-2222-2222-2222-222222222222",
        "organization_id": "11111111-1111-1111-1111-111111111111",
        "title": "Ladder Company Drill",
        "event_type": "training",
        "start_datetime": START,
        "end_datetime": END,
        "actual_start_time": None,
        "actual_end_time": None,
        "requires_rsvp": False,
        "is_mandatory": False,
        "allow_guests": False,
        "send_reminders": False,
        "reminder_target": "all",
        "is_cancelled": False,
        "check_in_window_type": CheckInWindowType.FLEXIBLE,
        "check_in_minutes_before": 60,
        "check_in_minutes_after": 15,
        "require_checkout": False,
        "allow_guest_check_in": False,
        "guest_check_in_creates_prospect": False,
        "created_at": START - timedelta(days=7),
        "updated_at": START - timedelta(days=7),
    }
    defaults.update(overrides)
    event = Event()
    for key, value in defaults.items():
        setattr(event, key, value)
    return event


def test_flexible_event_closes_at_the_scheduled_end():
    response = _build_event_response(make_event())
    assert response.check_in_closes_at == END


def test_window_event_closes_after_the_grace_minutes():
    event = make_event(
        check_in_window_type=CheckInWindowType.WINDOW, check_in_minutes_after=30
    )
    response = _build_event_response(event)
    assert response.check_in_closes_at == END + timedelta(minutes=30)


def test_event_ended_early_closes_at_its_recorded_end():
    ended = START + timedelta(minutes=45)
    response = _build_event_response(make_event(actual_end_time=ended))
    assert response.check_in_closes_at == ended
