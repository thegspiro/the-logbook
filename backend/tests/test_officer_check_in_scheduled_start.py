"""An officer's check-in credits the member from the scheduled start.

The live Check In dialog lists every eligible member, and an officer often works
through it after the event has begun. Each click used to stamp the moment of the
click, so a member who was there from the first minute was credited only from
whenever the officer reached their name. An officer checking someone in is
vouching for their attendance, so the check-in is recorded at the scheduled
start instead (owner decision, 2026-11-16). A member who really did arrive late
is corrected with Edit Times.

Self check-ins are unchanged: a member tapping in late still counts from the
tap. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.event_service import EventService

pytestmark = pytest.mark.unit


def _one(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _event(start, end, **overrides):
    fields = {
        "id": "event-1",
        "organization_id": "org-1",
        "custom_fields": {},
        "attendance_finalized_at": None,
        "start_datetime": start,
        "end_datetime": end,
        "actual_start_time": None,
        "actual_end_time": None,
        "is_cancelled": False,
        "check_in_window_type": None,
        "check_in_minutes_before": 60,
        "check_in_minutes_after": 15,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _rsvp():
    return SimpleNamespace(
        checked_in=False,
        checked_in_at=None,
        override_check_in_at=None,
        override_check_out_at=None,
        override_duration_minutes=None,
        attendance_duration_minutes=None,
    )


def _service(event, rsvp):
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _one(event),
            _one(SimpleNamespace(timezone="UTC")),
            _one(SimpleNamespace(id="user-1")),
            _one(rsvp),
        ]
    )
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()
    svc = EventService(db)
    svc._auto_create_training_record = AsyncMock()
    return svc


class TestOfficerCheckInAfterTheStart:
    async def test_records_the_scheduled_start_not_the_click(self):
        now = datetime.now(timezone.utc)
        start = now - timedelta(minutes=45)
        event = _event(start, now + timedelta(hours=1))
        rsvp = _rsvp()

        result, err = await _service(event, rsvp).check_in_attendee(
            "event-1", "user-1", "org-1"
        )

        assert err is None
        assert result is rsvp
        assert rsvp.checked_in is True
        assert rsvp.checked_in_at == start

    async def test_credits_the_full_session_from_the_start(self):
        """What the department sees at finalize: the whole event, not the
        minutes left after the officer reached this member's name."""
        now = datetime.now(timezone.utc)
        start = now - timedelta(minutes=45)
        end = now + timedelta(hours=1)
        event = _event(start, end)
        rsvp = _rsvp()

        await _service(event, rsvp).check_in_attendee("event-1", "user-1", "org-1")

        assert EventService._credited_check_in_time(event, rsvp) == start
        assert EventService.credited_minutes(event, rsvp, end) == 105

    async def test_is_not_marked_as_an_edited_time(self):
        """Stored as the check-in, not an override, so the attendance row does
        not read "(times edited)" and the approval page does not list it as a
        correction."""
        now = datetime.now(timezone.utc)
        event = _event(now - timedelta(minutes=30), now + timedelta(hours=1))
        rsvp = _rsvp()

        await _service(event, rsvp).check_in_attendee("event-1", "user-1", "org-1")

        assert rsvp.override_check_in_at is None

    async def test_naive_start_from_mysql_is_read_as_utc(self):
        """MySQL DATETIME comes back without an offset; comparing it with an
        aware clock would raise TypeError on the check-in."""
        now = datetime.now(timezone.utc)
        start = now - timedelta(minutes=20)
        event = _event(start.replace(tzinfo=None), now + timedelta(hours=1))
        rsvp = _rsvp()

        _, err = await _service(event, rsvp).check_in_attendee(
            "event-1", "user-1", "org-1"
        )

        assert err is None
        assert rsvp.checked_in_at == start


class TestOfficerCheckInBeforeTheStart:
    async def test_keeps_the_time_of_the_check_in(self):
        """Before the start there is nothing to move: crediting already clamps
        an early check-in forward to the scheduled start."""
        now = datetime.now(timezone.utc)
        start = now + timedelta(minutes=30)
        event = _event(start, start + timedelta(hours=2))
        rsvp = _rsvp()

        before = datetime.now(timezone.utc)
        await _service(event, rsvp).check_in_attendee("event-1", "user-1", "org-1")
        after = datetime.now(timezone.utc)

        assert before <= rsvp.checked_in_at <= after
        assert EventService._credited_check_in_time(event, rsvp) == start
