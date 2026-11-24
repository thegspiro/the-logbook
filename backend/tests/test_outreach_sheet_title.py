"""A community outreach signup sheet is named for its event on the schedule.

Owner decision, 2026-11-24: a station tour is not a duty shift, so the
schedule heads its sheet with the event rather than as a duty crew. The shift
response carries ``outreach_title`` for that. Driven against real rows. Pinned:

* a sheet an event opened directly is named by the event's title;
* a sheet a request opened is named by what was asked for and by whom, until
  the request has an event, and by that event's title afterwards;
* an ordinary duty shift carries no title;
* a member's own assignment and the printed roster name the sheet the same
  way, and the roster lists each volunteer by role.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.api.v1.endpoints.events import open_event_staffing_sheet
from app.api.v1.endpoints.scheduling import _enrich_shifts
from app.models.event import Event, EventType
from app.models.event_request import EventRequest, EventRequestStatus
from app.models.training import Shift
from app.models.user import Organization, User, UserStatus
from app.schemas.event_request import EventRequestStaffingCreate
from app.services.event_request_service import open_staffing_shift
from app.services.print_document_service import build_shift_roster
from app.services.scheduling_service import SchedulingService
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
        name="Title FD",
        slug=f"title-{uuid.uuid4().hex[:10]}",
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


async def _event(db, org, officer, title) -> Event:
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title=title,
        event_type=EventType.PUBLIC_EDUCATION,
        start_datetime=START,
        end_datetime=START + timedelta(hours=2),
        created_by=officer.id,
    )
    db.add(event)
    await db.flush()
    return event


async def _request_with_sheet(db, org, officer) -> EventRequest:
    request = EventRequest(
        organization_id=org.id,
        contact_name="Pat Rivera",
        contact_email="pat@example.test",
        organization_name="Lincoln Elementary",
        outreach_type="station_tour",
        description="Second grade visit",
        status=EventRequestStatus.SCHEDULED,
        event_date=START,
    )
    db.add(request)
    await db.flush()
    shift, error = await open_staffing_shift(
        db, request, org, [{"role": "tour_guide", "count": 2}], officer.id
    )
    assert error is None
    assert shift is not None
    await db.flush()
    return request


async def _title(db, org, shift_id) -> Any:
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    assert shift is not None
    enriched = await _enrich_shifts(SchedulingService(db), org.id, [shift])
    return enriched[0]["outreach_title"]


class TestOutreachSheetTitle:
    async def test_a_sheet_an_event_opened_is_named_by_the_event(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, officer, "Engine at the Fall Festival")
        with patch(
            "app.api.v1.endpoints.events.log_audit_event", AsyncMock(return_value=None)
        ):
            await open_event_staffing_sheet(
                event_id=uuid.UUID(event.id),
                data=EventRequestStaffingCreate(
                    roles=[{"role": "educator", "count": 1}]
                ),
                db=db_session,
                current_user=officer,
            )
        await db_session.refresh(event)

        assert (
            await _title(db_session, org, event.staffing_shift_id)
            == "Engine at the Fall Festival"
        )

    async def test_a_requests_sheet_is_named_by_what_was_asked_and_by_whom(
        self, db_session
    ):
        org, officer = await _dept(db_session)
        request = await _request_with_sheet(db_session, org, officer)

        assert (
            await _title(db_session, org, request.staffing_shift_id)
            == "Station Tour for Lincoln Elementary"
        )

    async def test_a_requests_sheet_takes_its_events_title_once_it_has_one(
        self, db_session
    ):
        org, officer = await _dept(db_session)
        request = await _request_with_sheet(db_session, org, officer)
        event = await _event(db_session, org, officer, "Lincoln Elementary Tour")
        request.event_id = event.id
        await db_session.flush()

        assert (
            await _title(db_session, org, request.staffing_shift_id)
            == "Lincoln Elementary Tour"
        )

    async def test_a_duty_shift_carries_no_title(self, db_session):
        org, officer = await _dept(db_session)
        shift, error = await SchedulingService(db_session).create_shift(
            org.id,
            {
                "shift_date": START.date(),
                "start_time": START,
                "end_time": START + timedelta(hours=12),
            },
            officer.id,
        )
        assert error is None
        assert shift is not None

        assert await _title(db_session, org, shift.id) is None

    async def test_a_members_own_assignment_names_the_event(self, db_session):
        org, officer = await _dept(db_session)
        request = await _request_with_sheet(db_session, org, officer)
        service = SchedulingService(db_session)
        assignment, error = await service.create_assignment(
            org.id,
            request.staffing_shift_id,
            {
                "user_id": officer.id,
                "position": "volunteer",
                "outreach_role": "tour_guide",
            },
            officer.id,
        )
        assert error is None
        assert assignment is not None

        enriched = await service.enrich_assignments_with_shifts([assignment], org.id)

        assert enriched[0]["shift"]["is_outreach"] is True
        assert (
            enriched[0]["shift"]["outreach_title"]
            == "Station Tour for Lincoln Elementary"
        )

    async def test_the_printed_roster_is_headed_by_the_event_and_lists_roles(
        self, db_session
    ):
        org, officer = await _dept(db_session)
        request = await _request_with_sheet(db_session, org, officer)
        assignment, error = await SchedulingService(db_session).create_assignment(
            org.id,
            request.staffing_shift_id,
            {
                "user_id": officer.id,
                "position": "volunteer",
                "outreach_role": "tour_guide",
            },
            officer.id,
        )
        assert error is None
        assert assignment is not None

        doc = await build_shift_roster(
            db_session, org.id, request.staffing_shift_id, "America/Chicago", officer
        )

        assert doc is not None
        assert doc.title == "Station Tour for Lincoln Elementary"
        assert doc.subtitle.startswith("Community outreach | ")
        crew = [row for section in doc.sections for row in section.rows]
        assert ("Casey Morgan (unconfirmed)", "Tour Guide") in [
            (row.left, row.right) for row in crew
        ]
