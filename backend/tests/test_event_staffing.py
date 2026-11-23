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
  stands the sheet down — one event, or every occurrence of a series;
* a volunteer is crew, not audience: their RSVP takes no attendee seat, so a
  capped event's audience is not shut out by its own crew (owner decision,
  2026-11-21).
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

    async def _series(self, db, org, officer) -> list[str]:
        """A two-occurrence series, each occurrence with its own sheet."""
        parent = await _event(db, org, officer)
        parent.is_recurring = True
        child = await _event(db, org, officer)
        child.recurrence_parent_id = parent.id
        child.start_datetime = START + timedelta(days=7)
        child.end_datetime = START + timedelta(days=7, hours=2)
        await db.flush()
        sheet_ids = []
        for event in (parent, child):
            await _open(db, officer, event, ("educator", 1))
            sheet_ids.append((await _sheet(db, event)).id)
        return [parent.id, *sheet_ids]

    async def test_cancelling_a_series_stands_every_sheet_down(self, db_session):
        org, officer = await _dept(db_session)
        parent_id, *sheet_ids = await self._series(db_session, org, officer)

        count = await EventService(db_session).cancel_series(
            parent_id, org.id, "Season cancelled"
        )

        assert count == 2
        for sheet_id in sheet_ids:
            shift = await db_session.scalar(select(Shift).where(Shift.id == sheet_id))
            await db_session.refresh(shift)
            assert shift.status == ShiftStatus.CANCELLED

    async def test_deleting_a_series_stands_every_sheet_down(self, db_session):
        org, officer = await _dept(db_session)
        parent_id, *sheet_ids = await self._series(db_session, org, officer)

        count = await EventService(db_session).delete_event_series(parent_id, org.id)

        assert count == 2
        for sheet_id in sheet_ids:
            shift = await db_session.scalar(select(Shift).where(Shift.id == sheet_id))
            await db_session.refresh(shift)
            assert shift.status == ShiftStatus.CANCELLED


async def _rsvp(db, event, user):
    from app.models.event import EventRSVP

    return await db.scalar(
        select(EventRSVP).where(
            EventRSVP.event_id == event.id, EventRSVP.user_id == user.id
        )
    )


async def _member(db, org, name):
    user = User(
        organization_id=org.id,
        username=f"{name}-{uuid.uuid4().hex[:6]}",
        email=f"{name}-{uuid.uuid4().hex[:6]}@example.test",
        first_name=name.title(),
        last_name="Member",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    return user


class TestVolunteersAreGoing:
    """A member who claims a role is going to the event (owner decision,
    2026-11-20), through the scheduling service every seat change passes."""

    async def _seat(self, db, org, shift, user):
        from app.services.scheduling_service import SchedulingService

        assignment, error = await SchedulingService(db).create_assignment(
            org.id,
            shift.id,
            {"user_id": user.id, "position": "volunteer", "outreach_role": "educator"},
            user.id,
        )
        assert error is None, error
        return assignment

    async def test_claiming_a_seat_makes_the_member_going(self, db_session):
        from app.models.event import RSVPStatus

        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 2))
        shift = await _sheet(db_session, event)
        member = await _member(db_session, org, "jordan")

        await self._seat(db_session, org, shift, member)

        rsvp = await _rsvp(db_session, event, member)
        assert rsvp is not None
        assert rsvp.status == RSVPStatus.GOING

    async def test_giving_the_seat_up_makes_them_not_going(self, db_session):
        from app.models.event import RSVPStatus
        from app.services.scheduling_service import SchedulingService

        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 2))
        shift = await _sheet(db_session, event)
        member = await _member(db_session, org, "jordan")
        assignment = await self._seat(db_session, org, shift, member)

        ok, error = await SchedulingService(db_session).delete_assignment(
            uuid.UUID(assignment.id), org.id
        )
        assert ok, error

        rsvp = await _rsvp(db_session, event, member)
        await db_session.refresh(rsvp)
        assert rsvp.status == RSVPStatus.NOT_GOING

    async def test_declining_makes_them_not_going(self, db_session):
        from app.models.event import RSVPStatus
        from app.services.scheduling_service import SchedulingService

        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 2))
        shift = await _sheet(db_session, event)
        member = await _member(db_session, org, "jordan")
        assignment = await self._seat(db_session, org, shift, member)

        result, error = await SchedulingService(db_session).decline_assignment(
            uuid.UUID(assignment.id), member.id, org.id
        )
        assert error is None, error

        rsvp = await _rsvp(db_session, event, member)
        await db_session.refresh(rsvp)
        assert rsvp.status == RSVPStatus.NOT_GOING

    async def test_a_checked_in_member_is_left_alone(self, db_session):
        from app.models.event import RSVPStatus
        from app.services.event_staffing_service import sync_volunteer_rsvps

        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 2))
        shift = await _sheet(db_session, event)
        member = await _member(db_session, org, "jordan")
        await self._seat(db_session, org, shift, member)
        rsvp = await _rsvp(db_session, event, member)
        rsvp.checked_in = True
        await db_session.flush()

        await sync_volunteer_rsvps(
            db_session, shift.id, org.id, removed_user_ids=[member.id]
        )

        assert rsvp.status == RSVPStatus.GOING

    async def test_running_it_twice_changes_nothing(self, db_session):
        from sqlalchemy import func

        from app.models.event import EventRSVP
        from app.services.event_staffing_service import sync_volunteer_rsvps

        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 2))
        shift = await _sheet(db_session, event)
        member = await _member(db_session, org, "jordan")
        await self._seat(db_session, org, shift, member)

        await sync_volunteer_rsvps(db_session, shift.id, org.id)
        await sync_volunteer_rsvps(db_session, shift.id, org.id)
        await db_session.flush()

        count = await db_session.scalar(
            select(func.count())
            .select_from(EventRSVP)
            .where(EventRSVP.event_id == event.id)
        )
        assert count == 1

    async def test_a_requests_sheet_makes_them_going_to_the_requests_event(
        self, db_session
    ):
        from app.models.event import RSVPStatus
        from app.services.event_request_service import open_staffing_shift

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
            event_end_date=START + timedelta(hours=2),
        )
        db_session.add(request)
        await db_session.flush()
        shift, error = await open_staffing_shift(
            db_session, request, org, [{"role": "educator", "count": 1}], officer.id
        )
        assert error is None, error
        await db_session.flush()
        member = await _member(db_session, org, "jordan")

        await self._seat(db_session, org, shift, member)

        rsvp = await _rsvp(db_session, event, member)
        assert rsvp is not None
        assert rsvp.status == RSVPStatus.GOING


class TestVolunteersAreCrew:
    """A volunteer takes no attendee seat (owner decision, 2026-11-21): the
    sheet's role counts cap the crew, and ``max_attendees`` caps the audience."""

    async def _capped(self, db, max_attendees=1):
        org, officer = await _dept(db)
        event = await _event(db, org, officer)
        event.max_attendees = max_attendees
        event.allow_guests = True
        await db.flush()
        await _open(db, officer, event, ("educator", 2))
        shift = await _sheet(db, event)
        return org, officer, event, shift

    async def _respond(self, db, org, event, user, status="going", guests=0):
        from app.schemas.event import RSVPCreate

        return await EventService(db).create_or_update_rsvp(
            event.id,
            user.id,
            RSVPCreate(status=status, guest_count=guests),
            org.id,
        )

    async def test_a_volunteer_does_not_take_the_audiences_seat(self, db_session):
        from app.models.event import RSVPStatus

        org, _officer, event, shift = await self._capped(db_session)
        volunteer = await _member(db_session, org, "jordan")
        await TestVolunteersAreGoing()._seat(db_session, org, shift, volunteer)
        guest = await _member(db_session, org, "riley")

        rsvp, error = await self._respond(db_session, org, event, guest)

        assert error is None, error
        assert rsvp.status == RSVPStatus.GOING
        crew = await _rsvp(db_session, event, volunteer)
        assert crew.status == RSVPStatus.GOING
        assert crew.is_volunteer is True

    async def test_claiming_a_role_frees_the_seat_for_the_waitlist(self, db_session):
        from app.models.event import RSVPStatus

        org, _officer, event, shift = await self._capped(db_session)
        first = await _member(db_session, org, "jordan")
        second = await _member(db_session, org, "riley")
        await self._respond(db_session, org, event, first)
        waiting, _ = await self._respond(db_session, org, event, second)
        assert waiting.status == RSVPStatus.WAITLISTED

        await TestVolunteersAreGoing()._seat(db_session, org, shift, first)

        await db_session.refresh(waiting)
        assert waiting.status == RSVPStatus.GOING

    async def test_giving_the_role_up_unmarks_them(self, db_session):
        from app.models.event import RSVPStatus
        from app.services.scheduling_service import SchedulingService

        org, _officer, event, shift = await self._capped(db_session)
        volunteer = await _member(db_session, org, "jordan")
        assignment = await TestVolunteersAreGoing()._seat(
            db_session, org, shift, volunteer
        )
        assert (await _rsvp(db_session, event, volunteer)).is_volunteer is True

        ok, error = await SchedulingService(db_session).delete_assignment(
            uuid.UUID(assignment.id), org.id
        )
        assert ok, error

        rsvp = await _rsvp(db_session, event, volunteer)
        await db_session.refresh(rsvp)
        assert rsvp.status == RSVPStatus.NOT_GOING
        assert rsvp.is_volunteer is False

    async def test_a_volunteers_guests_must_fit_and_are_never_waitlisted(
        self, db_session
    ):
        from app.models.event import RSVPStatus

        org, _officer, event, shift = await self._capped(db_session)
        volunteer = await _member(db_session, org, "jordan")
        await TestVolunteersAreGoing()._seat(db_session, org, shift, volunteer)
        audience = await _member(db_session, org, "riley")
        await self._respond(db_session, org, event, audience)

        rsvp, error = await self._respond(db_session, org, event, volunteer, guests=1)

        assert rsvp is None
        assert error is not None
        assert "room for 0 more guests" in error
        crew = await _rsvp(db_session, event, volunteer)
        await db_session.refresh(crew)
        assert crew.status == RSVPStatus.GOING
        assert crew.guest_count == 0

    async def test_the_capacity_figure_leaves_the_crew_out(self, db_session):
        org, _officer, event, shift = await self._capped(db_session, max_attendees=4)
        volunteer = await _member(db_session, org, "jordan")
        await TestVolunteersAreGoing()._seat(db_session, org, shift, volunteer)
        audience = await _member(db_session, org, "riley")
        await self._respond(db_session, org, event, audience)

        stats = await EventService(db_session).get_event_stats(event.id, org.id)

        assert stats.going_count == 2
        assert stats.capacity_percentage == 25.0


class TestTheSheetAMemberSees:
    """Any member can sign up from the event page (2026-11-22): the detail
    response carries the sheet's roles and the caller's own seat, and nobody
    else's name."""

    async def _view(self, db, org, event, user):
        from app.services.event_staffing_service import member_signup_sheet

        return await member_signup_sheet(db, event, org, str(user.id))

    async def test_no_sheet_means_nothing_to_sign_up_for(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        assert await self._view(db_session, org, event, officer) is None

    async def test_a_member_sees_the_roles_and_their_own_seat(self, db_session):
        from app.services.scheduling_service import SchedulingService

        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 2))
        shift = await _sheet(db_session, event)
        jordan = await _member(db_session, org, "jordan")
        riley = await _member(db_session, org, "riley")

        view = await self._view(db_session, org, event, riley)
        assert view is not None
        assert view["shift_id"] == str(shift.id)
        assert [(r["role"], r["remaining"]) for r in view["roles"]] == [("educator", 2)]
        assert view["signed_up"] is False

        _, error = await SchedulingService(db_session).create_assignment(
            org.id,
            shift.id,
            {
                "user_id": jordan.id,
                "position": "volunteer",
                "outreach_role": "educator",
            },
            jordan.id,
        )
        assert error is None, error

        riley_view = await self._view(db_session, org, event, riley)
        assert riley_view["roles"][0]["remaining"] == 1
        assert riley_view["signed_up"] is False
        assert "volunteers" not in riley_view
        assert "Jordan" not in str(riley_view)

        jordan_view = await self._view(db_session, org, event, jordan)
        assert jordan_view["signed_up"] is True
        assert jordan_view["my_role_label"] == "Educator"

    async def test_a_cancelled_event_offers_no_signup(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 1))
        event.is_cancelled = True
        await db_session.flush()
        assert await self._view(db_session, org, event, officer) is None


class TestASwapMovesTheRsvp:
    """A seat traded by a swap moves the going RSVP with it (2026-11-22)."""

    async def test_a_handed_over_seat_moves_the_rsvp(self, db_session):
        from app.models.event import RSVPStatus
        from app.services.scheduling_service import SchedulingService

        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 2))
        shift = await _sheet(db_session, event)
        giver = await _member(db_session, org, "jordan")
        taker = await _member(db_session, org, "riley")
        await TestVolunteersAreGoing()._seat(db_session, org, shift, giver)

        service = SchedulingService(db_session)
        offer, error = await service.create_swap_request(
            org.id,
            giver.id,
            {"offering_shift_id": shift.id, "target_user_id": taker.id},
        )
        assert error is None, error
        accepted, error = await service.respond_to_swap_offer(
            uuid.UUID(offer.id), org.id, taker.id, accept=True
        )
        assert error is None, error

        gone = await _rsvp(db_session, event, giver)
        await db_session.refresh(gone)
        assert gone.status == RSVPStatus.NOT_GOING
        assert gone.is_volunteer is False
        arrived = await _rsvp(db_session, event, taker)
        assert arrived is not None
        assert arrived.status == RSVPStatus.GOING
        assert arrived.is_volunteer is True


class TestTheEventsOwnVolunteerCall:
    """An event's own sheet can email the membership for help (2026-11-22)."""

    async def _send(self, db, event, org, email_service):
        from app.services.event_staffing_service import send_event_volunteer_call

        with patch(
            "app.services.email_service.EmailService",
            return_value=email_service,
        ):
            return await send_event_volunteer_call(
                db, event, org, message="Bring the smoke trailer."
            )

    async def test_it_emails_the_details_and_records_the_send(self, db_session):
        from unittest.mock import MagicMock

        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        await _open(db_session, officer, event, ("educator", 2))
        await db_session.refresh(event)
        email_service = MagicMock()
        email_service.send_email = AsyncMock()

        result = await self._send(db_session, event, org, email_service)

        assert result["recipients"] >= 1
        assert event.volunteer_call_sent_at is not None
        kwargs = email_service.send_email.await_args.kwargs
        assert officer.email in kwargs["to_emails"]
        assert kwargs["subject"].startswith("Can you help? Engine at the Fall Festival")
        assert "2 x Educator" in kwargs["text_body"]
        assert "Where: Riverside Park" in kwargs["text_body"]
        assert "Bring the smoke trailer." in kwargs["text_body"]
        assert "/scheduling?tab=open-shifts" in kwargs["text_body"]
        state = await get_event_staffing_sheet(
            event_id=uuid.UUID(event.id), db=db_session, current_user=officer
        )
        assert state["volunteer_call_sent_at"] is not None

    @pytest.mark.parametrize(
        ("case", "reason"),
        [
            ("no_sheet", "Open volunteer signups"),
            ("from_request", "came from a public request"),
            ("cancelled", "was cancelled"),
        ],
    )
    async def test_it_is_refused_where_it_cannot_be_sent(
        self, db_session, case, reason
    ):
        from unittest.mock import MagicMock

        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer)
        if case != "no_sheet":
            await _open(db_session, officer, event, ("educator", 1))
            await db_session.refresh(event)
        if case == "from_request":
            db_session.add(
                EventRequest(
                    organization_id=org.id,
                    contact_name="Pat Rivera",
                    contact_email="pat@example.test",
                    description="Fire safety night",
                    status=EventRequestStatus.SCHEDULED,
                    event_id=event.id,
                    event_date=START,
                )
            )
            await db_session.flush()
        if case == "cancelled":
            event.is_cancelled = True
            await db_session.flush()
        email_service = MagicMock()
        email_service.send_email = AsyncMock()

        with pytest.raises(ValueError, match=reason):
            await self._send(db_session, event, org, email_service)
        email_service.send_email.assert_not_awaited()
