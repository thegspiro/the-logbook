"""
Meetings endpoint audit trail (MM-8) and error-detail sanitization (MM-10).

Every other mutation surface this rotation has reviewed (minutes.py's motion/
action-item CRUD — MM-6, medical_supplies.py's category/item updates — MSUP-5)
audits its writes. `meetings.py` was the one file in this feature where every
mutation except `grant_attendance_waiver` left no trace at all: a meeting's
agenda/notes/motions text could be created, edited, approved, or deleted with
no record of who did it or when. These tests pin that every mutation route
now calls `log_audit_event`, and that the one route which forwarded a raw
service-layer error string (`create_meeting_from_event`) sanitizes it first.

Mocked service and session — no DB — so these run in the sandbox.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import meetings
from app.schemas.meetings import (
    ActionItemCreate,
    ActionItemUpdate,
    MeetingAttendeeCreate,
    MeetingCreate,
    MeetingUpdate,
)


def _user():
    user = MagicMock()
    user.id = "u-1"
    user.username = "secretary"
    user.organization_id = "org-1"
    return user


@pytest.fixture
def svc():
    """Patch the service class the router constructs, and capture audit calls."""
    service = AsyncMock()
    with patch.object(meetings, "MeetingsService", return_value=service), patch.object(
        meetings, "log_audit_event", new=AsyncMock()
    ):
        yield service


class TestMeetingAuditTrail:
    async def test_create_logs_an_audit_event(self, svc):
        svc.create_meeting = AsyncMock(
            return_value=(MagicMock(id="m-1", title="Drill Night"), None)
        )

        await meetings.create_meeting(
            MeetingCreate(title="Drill Night", meeting_date="2026-09-01"),
            db=AsyncMock(),
            current_user=_user(),
        )

        meetings.log_audit_event.assert_awaited_once()
        assert (
            meetings.log_audit_event.await_args.kwargs["event_type"]
            == "meeting_created"
        )

    async def test_update_logs_an_audit_event(self, svc):
        svc.update_meeting = AsyncMock(return_value=(MagicMock(id="m-1"), None))

        await meetings.update_meeting(
            "m-1",
            MeetingUpdate(notes="Rescheduled"),
            db=AsyncMock(),
            current_user=_user(),
        )

        meetings.log_audit_event.assert_awaited_once()
        kwargs = meetings.log_audit_event.await_args.kwargs
        assert kwargs["event_type"] == "meeting_updated"
        assert kwargs["event_data"]["changed_fields"] == ["notes"]

    async def test_delete_logs_an_audit_event(self, svc):
        svc.delete_meeting = AsyncMock(return_value=(True, None))

        await meetings.delete_meeting("m-1", db=AsyncMock(), current_user=_user())

        meetings.log_audit_event.assert_awaited_once()
        assert (
            meetings.log_audit_event.await_args.kwargs["event_type"]
            == "meeting_deleted"
        )

    async def test_delete_does_not_log_on_failure(self, svc):
        svc.delete_meeting = AsyncMock(return_value=(False, "Meeting not found"))

        with pytest.raises(HTTPException):
            await meetings.delete_meeting("m-1", db=AsyncMock(), current_user=_user())

        meetings.log_audit_event.assert_not_awaited()

    async def test_approve_logs_an_audit_event(self, svc):
        svc.approve_meeting = AsyncMock(
            return_value=(MagicMock(id="m-1", title="Drill Night"), None)
        )

        await meetings.approve_meeting("m-1", db=AsyncMock(), current_user=_user())

        meetings.log_audit_event.assert_awaited_once()
        assert (
            meetings.log_audit_event.await_args.kwargs["event_type"]
            == "meeting_approved"
        )

    async def test_add_attendee_logs_an_audit_event(self, svc):
        svc.add_attendee = AsyncMock(return_value=(MagicMock(id="a-1"), None))

        await meetings.add_attendee(
            "m-1",
            MeetingAttendeeCreate(user_id="11111111-1111-1111-1111-111111111111"),
            db=AsyncMock(),
            current_user=_user(),
        )

        meetings.log_audit_event.assert_awaited_once()
        assert (
            meetings.log_audit_event.await_args.kwargs["event_type"]
            == "meeting_attendee_added"
        )

    async def test_remove_attendee_logs_an_audit_event(self, svc):
        svc.remove_attendee = AsyncMock(return_value=(True, None))

        await meetings.remove_attendee(
            "m-1", "a-1", db=AsyncMock(), current_user=_user()
        )

        meetings.log_audit_event.assert_awaited_once()
        assert (
            meetings.log_audit_event.await_args.kwargs["event_type"]
            == "meeting_attendee_removed"
        )

    async def test_create_action_item_logs_an_audit_event(self, svc):
        svc.create_action_item = AsyncMock(return_value=(MagicMock(id="i-1"), None))

        await meetings.create_action_item(
            "m-1",
            ActionItemCreate(description="Order gaskets"),
            db=AsyncMock(),
            current_user=_user(),
        )

        meetings.log_audit_event.assert_awaited_once()
        assert (
            meetings.log_audit_event.await_args.kwargs["event_type"]
            == "meeting_action_item_created"
        )

    async def test_update_action_item_logs_an_audit_event(self, svc):
        svc.update_action_item = AsyncMock(return_value=(MagicMock(id="i-1"), None))

        await meetings.update_action_item(
            "i-1",
            ActionItemUpdate(status="completed"),
            db=AsyncMock(),
            current_user=_user(),
        )

        meetings.log_audit_event.assert_awaited_once()
        kwargs = meetings.log_audit_event.await_args.kwargs
        assert kwargs["event_type"] == "meeting_action_item_updated"
        assert kwargs["event_data"]["changed_fields"] == ["status"]

    async def test_delete_action_item_logs_an_audit_event(self, svc):
        svc.delete_action_item = AsyncMock(return_value=(True, None))

        await meetings.delete_action_item("i-1", db=AsyncMock(), current_user=_user())

        meetings.log_audit_event.assert_awaited_once()
        assert (
            meetings.log_audit_event.await_args.kwargs["event_type"]
            == "meeting_action_item_deleted"
        )

    async def test_create_from_event_logs_an_audit_event(self, svc):
        svc.create_from_event = AsyncMock(
            return_value=(
                MagicMock(
                    id="m-1",
                    title="Drill Night",
                    meeting_date=None,
                    status="draft",
                    event_id="e-1",
                ),
                None,
            )
        )

        await meetings.create_meeting_from_event(
            "e-1", db=AsyncMock(), current_user=_user()
        )

        meetings.log_audit_event.assert_awaited_once()
        assert (
            meetings.log_audit_event.await_args.kwargs["event_type"]
            == "meeting_created_from_event"
        )


class TestCreateFromEventErrorSanitization:
    """MM-10: `create_meeting_from_event` forwarded the service's raw error
    string as `detail=error` with no `safe_error_detail`/`sanitize_error_message`
    pass — every sibling endpoint in this file wraps its error, this one didn't.
    `create_from_event`'s own `except Exception as e: return None, str(e)`
    branch means `error` can be an arbitrary exception message, not just the
    two hand-written strings ("Event not found" / "Meeting already exists for
    this event").
    """

    async def test_a_raw_exception_string_is_sanitized(self, svc):
        svc.create_from_event = AsyncMock(
            return_value=(None, "SELECT * FROM meetings WHERE id = 'x'")
        )

        with pytest.raises(HTTPException) as err:
            await meetings.create_meeting_from_event(
                "e-1", db=AsyncMock(), current_user=_user()
            )

        assert "SELECT" not in err.value.detail
        meetings.log_audit_event.assert_not_awaited()

    async def test_the_hand_written_not_found_message_still_passes_through(self, svc):
        svc.create_from_event = AsyncMock(return_value=(None, "Event not found"))

        with pytest.raises(HTTPException) as err:
            await meetings.create_meeting_from_event(
                "e-1", db=AsyncMock(), current_user=_user()
            )

        assert err.value.status_code == 404
        assert err.value.detail == "Event not found"

    async def test_the_already_exists_message_maps_to_400(self, svc):
        svc.create_from_event = AsyncMock(
            return_value=(None, "Meeting already exists for this event")
        )

        with pytest.raises(HTTPException) as err:
            await meetings.create_meeting_from_event(
                "e-1", db=AsyncMock(), current_user=_user()
            )

        assert err.value.status_code == 400
