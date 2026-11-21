"""An outreach event created directly can open a volunteer signup sheet.

Owner decision, 2026-11-20. Driven against real rows. Pinned:

* an outreach event with no request behind it opens the same role-based sheet
  a request does, and reports it with no ``request_id``;
* an event scheduled from a request reports the request's sheet and names the
  request — and refuses a second sheet of its own;
* only an outreach event, not cancelled, without a sheet already, can open one,
  and only with the department's own roles;
* a member's chosen role is checked against the event's roles at signup;
* editing the event's time moves its sheet; cancelling or deleting the event
  stands the sheet down.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.events import (
    get_event_staffing_sheet,
    open_event_staffing_sheet,
)
from app.models.event import Event, EventType
from app.models.event_request import EventRequest, EventRequestStatus
from app.models.training import Shift, ShiftStatus
from app.models.user import Organization, User, UserStatus
from app.schemas.event import EventUpdate
from app.schemas.event_request import EventRequestStaffingCreate
from app.services.event_request_service import resolve_outreach_signup_role
from app.services.event_service import EventService
from tests.clock_support import reread_each_test

pytestmark = pytest.mark.integration


def _clock() -> dict[str, Any]:
    """Read as each test starts (tests/clock_support.py), not at import."""
    start = (datetime.now(timezone.utc) + timedelta(days=20)).replace(
        hour=15, minute=0, second=0, microsecond=0
    )
    return {"START": start}


(START,) = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)


async def _dept(db):
    org = Organization(
        name="Staffing FD",
        slug=f"staffing-{uuid.uuid4().hex[:10]}",
        timezone="America/Chicago",
        settings={},
    )
    db.add(org)
    await db.flush()
    officer = User(
        organization_id=org.id,
        username=f"officer-{org.id[:8]}",
        email=f"officer-{org.id[:8]}@example.test",
        first_name="Casey",
        last_name="Morgan",
        status=UserStatus.ACTIVE,
    )
    db.add(officer)
    await db.flush()
    return org, officer


async def _event(db, org, officer, event_type=EventType.PUBLIC_EDUCATION) -> Event:
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Engine at the Fall Festival",
        event_type=event_type,
        start_datetime=START,
        end_datetime=START + timedelta(hours=2),
        location="Riverside Park",
        created_by=officer.id,
    )
    db.add(event)
    await db.flush()
    return event


def _roles(*pairs):
    return EventRequestStaffingCreate(
        roles=[{"role": role, "count": count} for role, count in pairs]
    )


async def _open(db, officer, event, *pairs):
    with patch(
        "app.api.v1.endpoints.events.log_audit_event", AsyncMock(return_value=None)
    ):
        return await open_event_staffing_sheet(
            event_id=uuid.UUID(event.id),
            data=_roles(*pairs),
            db=db,
            current_user=officer,
        )


async def _sheet(db, event) -> Shift:
    await db.refresh(event)
    shift = await db.scalar(select(Shift).where(Shift.id == event.staffing_shift_id))
    assert shift is not None
    return shift


class TestOpeningASheet:
    async def test_an_outreach_event_opens_a_role_based_sheet(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)

        state = await _open(db_session, officer, event, ("educator", 2), ("greeter", 1))

        assert state["request_id"] is None
        assert state["slots_total"] == 3
        assert [(r["role"], r["total"]) for r in state["roles"]] == [
            ("educator", 2),
            ("greeter", 1),
        ]
        shift = await _sheet(db_session, event)
        assert shift.is_outreach is True
        assert shift.open_to_all_members is True
        assert shift.start_time.replace(tzinfo=timezone.utc) == START
        assert event.staffing_roles == [
            {"role": "educator", "count": 2},
            {"role": "greeter", "count": 1},
        ]

        read_back = await get_event_staffing_sheet(
            event_id=uuid.UUID(event.id), db=db_session, current_user=officer
        )
        assert read_back["shift_id"] == shift.id

    @pytest.mark.parametrize(
        "case",
        ["not_outreach", "cancelled", "already_open", "unknown_role"],
    )
    async def test_it_is_refused_where_a_sheet_cannot_be_opened(self, db_session, case):
        org, officer = await _dept(db_session)
        event = await _event(
            db_session,
            org,
            officer,
            (
                EventType.TRAINING
                if case == "not_outreach"
                else EventType.PUBLIC_EDUCATION
            ),
        )
        if case == "cancelled":
            event.is_cancelled = True
            await db_session.flush()
        if case == "already_open":
            await _open(db_session, officer, event, ("educator", 1))

        role = "puppeteer" if case == "unknown_role" else "educator"
        with pytest.raises(HTTPException) as exc:
            await _open(db_session, officer, event, (role, 1))
        assert exc.value.status_code == 400

    async def test_an_event_from_a_request_uses_the_requests_sheet(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        request = EventRequest(
            organization_id=org.id,
            contact_name="Pat Rivera",
            contact_email="pat@example.test",
            description="Fire safety night",
            status=EventRequestStatus.SCHEDULED,
            event_id=event.id,
            event_date=START,
        )
        db_session.add(request)
        await db_session.flush()

        state = await get_event_staffing_sheet(
            event_id=uuid.UUID(event.id), db=db_session, current_user=officer
        )
        assert state["request_id"] == request.id

        with pytest.raises(HTTPException) as exc:
            await _open(db_session, officer, event, ("educator", 1))
        assert exc.value.status_code == 400
        assert "from a public request" in exc.value.detail

    async def test_another_departments_event_is_not_found(self, db_session):
        org, officer = await _dept(db_session)
        _other, outsider = await _dept(db_session)
        event = await _event(db_session, org, officer)

        with pytest.raises(HTTPException) as exc:
            await _open(db_session, outsider, event, ("educator", 1))
        assert exc.value.status_code == 404


class TestSigningUp:
    async def test_a_role_is_checked_against_the_events_roles(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 1))
        shift = await _sheet(db_session, event)

        assert (
            await resolve_outreach_signup_role(db_session, shift, "educator", org.id)
            == "educator"
        )
        with pytest.raises(ValueError, match="not one of the roles"):
            await resolve_outreach_signup_role(db_session, shift, "greeter", org.id)
        with pytest.raises(ValueError, match="Choose what you would like to do"):
            await resolve_outreach_signup_role(db_session, shift, None, org.id)


class TestTheSheetFollowsTheEvent:
    async def test_editing_the_events_time_moves_its_sheet(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 1))

        later = START + timedelta(days=3)
        await EventService(db_session).update_event(
            event.id,
            org.id,
            EventUpdate(start_datetime=later, end_datetime=later + timedelta(hours=3)),
            updated_by=officer.id,
        )

        shift = await _sheet(db_session, event)
        assert shift.start_time.replace(tzinfo=timezone.utc) == later
        assert shift.end_time.replace(tzinfo=timezone.utc) == later + timedelta(hours=3)

    async def test_cancelling_the_event_stands_its_sheet_down(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 1))
        sheet_id = event.staffing_shift_id

        await EventService(db_session).cancel_event(event.id, org.id, "Rained out")

        shift = await db_session.scalar(select(Shift).where(Shift.id == sheet_id))
        assert shift.status == ShiftStatus.CANCELLED

    async def test_deleting_the_event_stands_its_sheet_down(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 1))
        sheet_id = event.staffing_shift_id

        assert await EventService(db_session).delete_event(event.id, org.id)

        shift = await db_session.scalar(select(Shift).where(Shift.id == sheet_id))
        assert shift.status == ShiftStatus.CANCELLED
