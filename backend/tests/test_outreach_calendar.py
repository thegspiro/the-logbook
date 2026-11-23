"""The Outreach Overview's calendar: which events it lists, and what it says of each.

Every rule here belongs to another screen (pitfall #29): the events are the
ones Outreach Impact counts, sheet fill is what the requests list shows, crew
fill is what the nights lists show. These tests pin that the calendar agrees
with each of them, against real rows.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.events import get_outreach_calendar
from app.models.apparatus import Apparatus, ApparatusStatus, ApparatusType
from app.models.apparatus_event import (
    EventApparatusPlan,
    EventApparatusSeat,
    EventApparatusUnit,
)
from app.models.event import Event, EventType
from app.models.event_request import EventRequest, EventRequestStatus
from app.models.location import Location
from app.models.training import (
    AssignmentStatus,
    Shift,
    ShiftAssignment,
    ShiftStatus,
)
from app.models.user import Organization, User, UserStatus
from app.services.outreach_calendar_service import (
    MAX_RANGE_DAYS,
    OutreachCalendarService,
)
from tests.clock_support import reread_each_test

pytestmark = pytest.mark.integration


def _clock() -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return {"NOW": now, "IN_A_WEEK": now + timedelta(days=7)}


NOW, IN_A_WEEK = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)


async def _org(db_session, label):
    org = Organization(
        name=f"{label} FD",
        slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
        settings={},
    )
    db_session.add(org)
    await db_session.flush()
    members = []
    for i in range(3):
        user = User(
            organization_id=org.id,
            username=f"{label.lower()}{i}-{org.id[:8]}",
            email=f"{label.lower()}{i}-{org.id[:8]}@example.test",
            first_name="Member",
            last_name=str(i),
            status=UserStatus.ACTIVE,
        )
        db_session.add(user)
        members.append(user)
    await db_session.flush()
    return org, members


@pytest.fixture
async def dept(db_session):
    return await _org(db_session, "Plan")


async def _event(db_session, org, title, start, **kwargs):
    event = Event(
        organization_id=org.id,
        title=title,
        event_type=kwargs.pop("event_type", EventType.PUBLIC_EDUCATION),
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        **kwargs,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _request(db_session, org, event, **kwargs):
    req = EventRequest(
        organization_id=org.id,
        contact_name="Pat Requester",
        contact_email="pat@example.test",
        description="Outreach",
        status=EventRequestStatus.SCHEDULED,
        event_id=event.id,
        **kwargs,
    )
    db_session.add(req)
    await db_session.flush()
    return req


async def _sheet(db_session, org, start, seats, filled_by, **kwargs):
    shift = Shift(
        organization_id=org.id,
        shift_date=start.date(),
        start_time=start,
        end_time=start + timedelta(hours=2),
        positions=[{"position": "volunteer", "required": True}] * seats,
        status=kwargs.pop("status", ShiftStatus.SCHEDULED),
    )
    db_session.add(shift)
    await db_session.flush()
    for user in filled_by:
        db_session.add(
            ShiftAssignment(
                organization_id=org.id,
                shift_id=shift.id,
                user_id=user.id,
                position="volunteer",
                assignment_status=AssignmentStatus.ASSIGNED,
            )
        )
    await db_session.flush()
    return shift


async def _crew(db_session, org, event, seats, filled_by):
    suffix = uuid.uuid4().hex[:6]
    unit_type = ApparatusType(
        id=str(uuid.uuid4()), organization_id=org.id, name="Engine", code=f"T{suffix}"
    )
    status = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="In Service",
        code=f"S{suffix}",
        is_available=True,
    )
    db_session.add_all([unit_type, status])
    await db_session.flush()
    engine = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number=f"E1-{suffix}",
        apparatus_type_id=unit_type.id,
        status_id=status.id,
    )
    db_session.add(engine)
    await db_session.flush()
    plan = EventApparatusPlan(
        organization_id=org.id, event_id=event.id, series_id=str(uuid.uuid4())
    )
    db_session.add(plan)
    await db_session.flush()
    unit = EventApparatusUnit(
        organization_id=org.id,
        plan_id=plan.id,
        event_id=event.id,
        apparatus_id=engine.id,
        sort_order=0,
    )
    db_session.add(unit)
    await db_session.flush()
    for i in range(seats):
        holder = filled_by[i] if i < len(filled_by) else None
        db_session.add(
            EventApparatusSeat(
                organization_id=org.id,
                event_id=event.id,
                unit_id=unit.id,
                name=f"Seat {i}",
                seat_type="general",
                sort_order=i,
                user_id=holder.id if holder else None,
            )
        )
    await db_session.flush()
    return engine


async def _calendar(db_session, viewer, start=None, end=None):
    return await get_outreach_calendar(
        start=start or NOW - timedelta(days=30),
        end=end or NOW + timedelta(days=60),
        db=db_session,
        current_user=viewer,
    )


def _by_title(items):
    return {item.title: item for item in items}


class TestWhichEvents:
    async def test_lists_the_events_outreach_impact_counts(self, db_session, dept):
        org, members = dept
        await _event(db_session, org, "School visit", IN_A_WEEK)
        await _event(
            db_session,
            org,
            "Pancake breakfast",
            IN_A_WEEK,
            event_type=EventType.FUNDRAISER,
        )
        await _event(
            db_session,
            org,
            "Board meeting",
            IN_A_WEEK,
            event_type=EventType.BUSINESS_MEETING,
        )
        linked = await _event(
            db_session, org, "Tour at a meeting", IN_A_WEEK, event_type=EventType.OTHER
        )
        await _request(db_session, org, linked)
        await _event(db_session, org, "Called off", IN_A_WEEK, is_cancelled=True)

        titles = set(_by_title(await _calendar(db_session, members[0])))

        assert titles == {"School visit", "Pancake breakfast", "Tour at a meeting"}

    async def test_another_departments_events_are_not_listed(self, db_session, dept):
        org, members = dept
        other, _ = await _org(db_session, "Other")
        await _event(db_session, other, "Their school visit", IN_A_WEEK)

        assert await _calendar(db_session, members[0]) == []

    async def test_only_events_overlapping_the_range(self, db_session, dept):
        org, members = dept
        await _event(db_session, org, "Inside", IN_A_WEEK)
        await _event(db_session, org, "Before", NOW - timedelta(days=40))
        await _event(db_session, org, "After", NOW + timedelta(days=70))
        # Starts before the range and ends inside it.
        await _event(db_session, org, "Straddles", NOW - timedelta(days=30, hours=1))

        titles = set(_by_title(await _calendar(db_session, members[0])))

        assert titles == {"Inside", "Straddles"}

    async def test_a_draft_is_listed_and_flagged(self, db_session, dept):
        org, members = dept
        await _event(db_session, org, "Not yet published", IN_A_WEEK, is_draft=True)

        item = _by_title(await _calendar(db_session, members[0]))["Not yet published"]

        assert item.is_draft is True

    async def test_earliest_first(self, db_session, dept):
        org, members = dept
        await _event(db_session, org, "Later", IN_A_WEEK + timedelta(days=2))
        await _event(db_session, org, "Sooner", IN_A_WEEK)

        items = await _calendar(db_session, members[0])

        assert [i.title for i in items] == ["Sooner", "Later"]


class TestStaffing:
    async def test_a_request_events_sheet_is_read_from_the_request(
        self, db_session, dept
    ):
        org, members = dept
        event = await _event(db_session, org, "Station tour", IN_A_WEEK)
        sheet = await _sheet(db_session, org, IN_A_WEEK, 4, members[:3])
        req = await _request(
            db_session,
            org,
            event,
            staffing_shift_id=sheet.id,
            organization_name="Oak Elementary",
        )

        item = _by_title(await _calendar(db_session, members[0]))["Station tour"]

        assert (item.volunteers_filled, item.volunteers_total) == (3, 4)
        assert item.request_id == req.id
        assert item.request_organization == "Oak Elementary"

    async def test_an_events_own_sheet_is_read_from_the_event(self, db_session, dept):
        org, members = dept
        sheet = await _sheet(db_session, org, IN_A_WEEK, 2, members[:1])
        await _event(
            db_session, org, "Fair booth", IN_A_WEEK, staffing_shift_id=sheet.id
        )

        item = _by_title(await _calendar(db_session, members[0]))["Fair booth"]

        assert (item.volunteers_filled, item.volunteers_total) == (1, 2)
        assert item.request_id is None

    async def test_no_sheet_and_a_cancelled_sheet_both_read_as_null(
        self, db_session, dept
    ):
        org, members = dept
        await _event(db_session, org, "No sheet", IN_A_WEEK)
        stood_down = await _sheet(
            db_session, org, IN_A_WEEK, 3, [], status=ShiftStatus.CANCELLED
        )
        await _event(
            db_session, org, "Stood down", IN_A_WEEK, staffing_shift_id=stood_down.id
        )

        items = _by_title(await _calendar(db_session, members[0]))

        for title in ("No sheet", "Stood down"):
            assert items[title].volunteers_filled is None
            assert items[title].volunteers_total is None

    async def test_an_apparatus_crew_reports_its_seats_and_units(
        self, db_session, dept
    ):
        org, members = dept
        event = await _event(db_session, org, "Santa run", IN_A_WEEK)
        engine = await _crew(db_session, org, event, 4, members[:2])

        item = _by_title(await _calendar(db_session, members[0]))["Santa run"]

        assert (item.crew_filled, item.crew_total) == (2, 4)
        assert item.unit_numbers == [engine.unit_number]

    async def test_no_crew_plan_reads_as_null(self, db_session, dept):
        org, members = dept
        await _event(db_session, org, "Booth", IN_A_WEEK)

        item = _by_title(await _calendar(db_session, members[0]))["Booth"]

        assert item.crew_filled is None
        assert item.crew_total is None
        assert item.unit_numbers == []


class TestDetail:
    async def test_closed_out_follows_attendance_finalized(self, db_session, dept):
        org, members = dept
        last_week = NOW - timedelta(days=7)
        await _event(
            db_session, org, "Finalized", last_week, attendance_finalized_at=NOW
        )
        await _event(db_session, org, "Waiting", last_week)

        items = _by_title(await _calendar(db_session, members[0]))

        assert items["Finalized"].attendance_finalized is True
        assert items["Waiting"].attendance_finalized is False

    async def test_location_name_comes_from_the_location_record(self, db_session, dept):
        org, members = dept
        hall = Location(organization_id=org.id, name="Station 1 Bay")
        db_session.add(hall)
        await db_session.flush()
        await _event(db_session, org, "At the station", IN_A_WEEK, location_id=hall.id)
        await _event(
            db_session, org, "At the park", IN_A_WEEK, location="Memorial Park"
        )

        items = _by_title(await _calendar(db_session, members[0]))

        assert items["At the station"].location == "Station 1 Bay"
        assert items["At the park"].location == "Memorial Park"


class TestRange:
    async def test_a_range_ending_before_it_starts_is_refused(self, db_session, dept):
        _, members = dept
        with pytest.raises(HTTPException) as caught:
            await _calendar(db_session, members[0], start=IN_A_WEEK, end=NOW)
        assert caught.value.status_code == 400

    async def test_a_range_wider_than_the_cap_is_refused(self, db_session, dept):
        _, members = dept
        with pytest.raises(HTTPException) as caught:
            await _calendar(
                db_session,
                members[0],
                start=NOW,
                end=NOW + timedelta(days=MAX_RANGE_DAYS + 1),
            )
        assert caught.value.status_code == 400

    async def test_a_naive_bound_is_read_as_utc(self, db_session, dept):
        org, members = dept
        await _event(db_session, org, "School visit", IN_A_WEEK)

        rows = await OutreachCalendarService(db_session).calendar(
            org.id,
            (NOW - timedelta(days=1)).replace(tzinfo=None),
            (NOW + timedelta(days=30)).replace(tzinfo=None),
        )

        assert [r["title"] for r in rows] == ["School visit"]
