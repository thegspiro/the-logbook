"""
Tests for the meetings service (app/services/meetings_service.py).

Focus on the Event->Meeting attendance bridge (create_from_event, including
the RSVP present/excused mapping and the duplicate guard), attendee
management (org membership check), action-item completion stamping, and
meeting approval. DB mocked; no MySQL.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.models.event import RSVPStatus
from app.models.meeting import ActionItemStatus, MeetingStatus
from app.services.meetings_service import MeetingsService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    db.rollback = AsyncMock()
    return db


def _event():
    return SimpleNamespace(
        title="Monthly Business Meeting",
        start_datetime=datetime(2026, 6, 1, 19, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2026, 6, 1, 21, 0, tzinfo=timezone.utc),
        actual_start_time=None,
        actual_end_time=None,
        location="Station 1",
        location_id=None,
    )


def _rsvp(user_id, checked_in, status):
    return SimpleNamespace(user_id=user_id, checked_in=checked_in, status=status)


class TestCreateFromEvent:
    async def test_event_not_found(self):
        db = _db([_one(None)])
        meeting, err = await MeetingsService(db).create_from_event("e1", "org-1", "u1")
        assert meeting is None
        assert err == "Event not found"

    async def test_duplicate_meeting_rejected(self):
        db = _db([_one(_event()), _one(SimpleNamespace(id="existing"))])
        meeting, err = await MeetingsService(db).create_from_event("e1", "org-1", "u1")
        assert meeting is None
        assert "already exists" in err

    async def test_bridges_event_and_maps_rsvps(self):
        rsvps = [
            _rsvp("u1", True, RSVPStatus.GOING),  # present, not excused
            _rsvp("u2", False, RSVPStatus.NOT_GOING),  # absent, excused
            _rsvp("u3", False, RSVPStatus.GOING),  # absent, not excused
        ]
        db = _db([_one(_event()), _one(None), _scalars(rsvps)])
        meeting, err = await MeetingsService(db).create_from_event("e1", "org-1", "u1")
        assert err is None

        added = [c.args[0] for c in db.add.call_args_list]
        created_meeting = added[0]
        assert created_meeting.title == "Monthly Business Meeting"
        assert created_meeting.meeting_date == datetime(2026, 6, 1).date()
        assert created_meeting.status == MeetingStatus.DRAFT

        attendees = {a.user_id: a for a in added[1:]}
        assert attendees["u1"].present is True
        assert attendees["u1"].excused is False
        assert attendees["u2"].present is False
        assert attendees["u2"].excused is True
        assert attendees["u3"].present is False
        assert attendees["u3"].excused is False


class TestAddAttendee:
    async def test_meeting_not_found(self):
        db = _db([_one(None)])
        ok, err = await MeetingsService(db).add_attendee(
            "m1", "org-1", {"user_id": "u1"}
        )
        assert ok is None
        assert err == "Meeting not found"

    async def test_user_id_required(self):
        db = _db([_one(SimpleNamespace(id="m1"))])
        ok, err = await MeetingsService(db).add_attendee("m1", "org-1", {})
        assert err == "user_id is required"

    async def test_user_not_in_org(self):
        db = _db([_one(SimpleNamespace(id="m1")), _one(None)])
        ok, err = await MeetingsService(db).add_attendee(
            "m1", "org-1", {"user_id": "u1"}
        )
        assert err == "User not found in organization"

    async def test_success(self):
        db = _db([_one(SimpleNamespace(id="m1")), _one(SimpleNamespace(id="u1"))])
        attendee, err = await MeetingsService(db).add_attendee(
            "m1", "org-1", {"user_id": "u1", "present": True}
        )
        assert err is None
        assert attendee.user_id == "u1"
        db.commit.assert_awaited()


class TestRemoveAttendee:
    async def test_not_found(self):
        db = _db([_one(None)])
        ok, err = await MeetingsService(db).remove_attendee("m1", "a1", "org-1")
        assert ok is False
        assert err == "Attendee not found"

    async def test_success(self):
        db = _db([_one(SimpleNamespace(id="a1"))])
        ok, err = await MeetingsService(db).remove_attendee("m1", "a1", "org-1")
        assert ok is True
        db.delete.assert_awaited()


class TestApproveMeeting:
    async def test_not_found(self):
        db = _db([_one(None)])
        meeting, err = await MeetingsService(db).approve_meeting("m1", "org-1", "admin")
        assert meeting is None
        assert err == "Meeting not found"

    async def test_sets_approval_fields(self):
        m = SimpleNamespace(
            id="m1", status=MeetingStatus.DRAFT, approved_by=None, approved_at=None
        )
        db = _db([_one(m)])
        meeting, err = await MeetingsService(db).approve_meeting("m1", "org-1", "admin")
        assert err is None
        assert m.status == MeetingStatus.APPROVED
        assert m.approved_by == "admin"
        assert m.approved_at is not None


class TestUpdateActionItem:
    async def test_not_found(self):
        db = _db([_one(None)])
        item, err = await MeetingsService(db).update_action_item("i1", "org-1", {})
        assert item is None
        assert err == "Action item not found"

    async def test_completing_stamps_completed_at(self):
        item = SimpleNamespace(id="i1", status=ActionItemStatus.OPEN, completed_at=None)
        db = _db([_one(item)])
        out, err = await MeetingsService(db).update_action_item(
            "i1", "org-1", {"status": ActionItemStatus.COMPLETED.value}
        )
        assert err is None
        assert out.completed_at is not None
        assert out.status == ActionItemStatus.COMPLETED.value

    async def test_non_status_update_does_not_stamp(self):
        item = SimpleNamespace(
            id="i1", status=ActionItemStatus.OPEN, completed_at=None, title="old"
        )
        db = _db([_one(item)])
        out, _ = await MeetingsService(db).update_action_item(
            "i1", "org-1", {"title": "new"}
        )
        assert out.title == "new"
        assert out.completed_at is None


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
