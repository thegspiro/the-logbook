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


class TestCreateFromEventLocking:
    """Pitfall #27 (TOCTOU shape): two coordinators bridging the same event
    concurrently must not both pass the "no meeting yet" check and both
    insert one. Locking the event row serializes them so the second one's
    existence check sees the first's committed meeting."""

    async def test_event_fetch_is_locked_before_the_existence_check(self):
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _one(_event())
            if len(captured) == 2:
                return _one(None)
            return _scalars([])

        db = MagicMock()
        db.execute = execute
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        meeting, err = await MeetingsService(db).create_from_event("e1", "org-1", "u1")

        assert err is None
        assert len(captured) >= 2
        assert "FOR UPDATE" in str(captured[0])
        assert "events" in str(captured[0]).lower()


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


class TestUpdateMeeting:
    async def test_not_found(self):
        db = _db([_one(None)])
        meeting, err = await MeetingsService(db).update_meeting("m1", "org-1", {})
        assert meeting is None
        assert err == "Meeting not found"

    async def test_rejects_null_title(self):
        """update_meeting now routes through apply_updates instead of a
        blind setattr loop: an explicit null against title (NOT NULL)
        must raise a clean error, not an unhandled IntegrityError at
        commit."""
        from app.models.meeting import Meeting

        meeting = Meeting(
            id="m1", organization_id="org-1", title="Old Title", meeting_type="business"
        )
        db = _db([_one(meeting)])

        result, err = await MeetingsService(db).update_meeting(
            "m1", "org-1", {"title": None}
        )
        assert result is None
        assert "cannot be cleared" in err.lower()

    async def test_clears_a_nullable_field(self):
        from app.models.meeting import Meeting

        meeting = Meeting(
            id="m1", organization_id="org-1", title="Old Title", notes="stale notes"
        )
        db = _db([_one(meeting)])

        result, err = await MeetingsService(db).update_meeting(
            "m1", "org-1", {"notes": None}
        )
        assert err is None
        assert result.notes is None


class TestUpdateActionItem:
    async def test_not_found(self):
        db = _db([_one(None)])
        item, err = await MeetingsService(db).update_action_item("i1", "org-1", {})
        assert item is None
        assert err == "Action item not found"

    async def test_reassigning_to_a_foreign_user_is_rejected(self):
        """MM-4 (XC-1): update_action_item now validates a reassigned
        `assigned_to`, matching create_action_item's existing check."""
        from app.models.meeting import MeetingActionItem

        item = MeetingActionItem(
            id="i1", organization_id="org-1", description="Do the thing"
        )
        db = _db([_one(item), _one(None)])  # item fetch, then is_in_org's User query

        result, err = await MeetingsService(db).update_action_item(
            "i1", "org-1", {"assigned_to": "u-other-org"}
        )
        assert result is None
        assert "invalid" in err.lower()

    async def test_rejects_null_description(self):
        from app.models.meeting import MeetingActionItem

        item = MeetingActionItem(
            id="i1", organization_id="org-1", description="Do the thing"
        )
        db = _db([_one(item)])

        result, err = await MeetingsService(db).update_action_item(
            "i1", "org-1", {"description": None}
        )
        assert result is None
        assert "cannot be cleared" in err.lower()

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


class TestAttachCreatorNames:
    """BXC-2: MeetingResponse.creator_name is declared and rendered ("Created by
    …") but the ORM row only has created_by — populate it org-scoped."""

    async def test_populates_creator_name(self):
        m1 = SimpleNamespace(created_by="u1", creator_name=None)
        m2 = SimpleNamespace(created_by="u2", creator_name=None)
        rows = MagicMock()
        rows.all.return_value = [("u1", "Dana", "Reyes")]  # u2 out-of-org
        db = _db([rows])
        await MeetingsService(db).attach_creator_names("org-1", [m1, m2])
        assert m1.creator_name == "Dana Reyes"
        assert m2.creator_name is None

    async def test_empty_list_makes_no_query(self):
        db = _db([])
        await MeetingsService(db).attach_creator_names("org-1", [])
        db.execute.assert_not_awaited()


class TestAttachChildCounts:
    """Same gap as creator_name: the list response declares attendee_count and
    action_item_count, and the cards render them, but the list query loads no
    children — so every card read "0 attendees   0 action items" over a
    meeting whose detail showed eight and two."""

    async def test_populates_both_counts(self):
        m1 = SimpleNamespace(id="m1", attendee_count=0, action_item_count=0)
        m2 = SimpleNamespace(id="m2", attendee_count=0, action_item_count=0)
        attendees = MagicMock()
        attendees.all.return_value = [("m1", 8)]
        actions = MagicMock()
        actions.all.return_value = [("m1", 2)]
        db = _db([attendees, actions])

        await MeetingsService(db).attach_child_counts([m1, m2])

        assert (m1.attendee_count, m1.action_item_count) == (8, 2)
        # A meeting with no children keeps zeroes rather than going None.
        assert (m2.attendee_count, m2.action_item_count) == (0, 0)

    async def test_empty_list_makes_no_query(self):
        db = _db([])
        await MeetingsService(db).attach_child_counts([])
        db.execute.assert_not_awaited()


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
