"""Closing out an outreach event (owner decision, 2026-11-20).

Driven against real rows. Pinned:

* finalizing an event's attendance completes the request it came from — only
  a scheduled one, once — and tells the requester as a manual completion does;
* a request cannot be marked completed before its event's date;
* the close-out record (how it went, apparatus, materials, photos) is saved in
  one canonical shape, refused where a headcount would be, and checks every
  apparatus id belongs to the department;
* the Outreach Impact report totals what was handed out and carries each
  event's close-out to its rows.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.dashboard import get_community_engagement
from app.api.v1.endpoints.event_requests import update_event_request_status
from app.api.v1.endpoints.events import set_outreach_closeout
from app.models.event import Event, EventType
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestStatus,
)
from app.models.training import BasicApparatus
from app.models.user import Organization, User, UserStatus
from app.schemas.event import OutreachCloseoutUpdate
from app.schemas.event_request import EventRequestStatusUpdate
from app.services.event_service import EventService

pytestmark = pytest.mark.integration


async def _dept(db):
    org = Organization(
        name="Closeout FD",
        slug=f"closeout-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
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


async def _event(db, org, *, hours_from_now: float, event_type=None) -> Event:
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(
        hours=hours_from_now
    )
    event = Event(
        organization_id=org.id,
        title="Station Tour",
        event_type=event_type or EventType.PUBLIC_EDUCATION,
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
    )
    db.add(event)
    await db.flush()
    return event


async def _request(db, org, event, status=EventRequestStatus.SCHEDULED):
    request = EventRequest(
        organization_id=org.id,
        contact_name="Dana Whitfield",
        contact_email="dana@example.test",
        description="Library visit",
        status=status,
        event_id=event.id,
        event_date=event.start_datetime,
    )
    db.add(request)
    await db.flush()
    return request


NOTIFY = "app.services.event_request_service.send_request_notification"


class TestFinalizingCompletesTheRequest:
    async def test_a_scheduled_request_is_completed_and_the_requester_told(
        self, db_session
    ):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, hours_from_now=-4)
        request = await _request(db_session, org, event)

        with patch(NOTIFY, AsyncMock(return_value=True)) as notify:
            await EventService(db_session).finalize_event_attendance_detailed(
                event.id, org.id, officer.id
            )

        await db_session.refresh(request)
        assert request.status == EventRequestStatus.COMPLETED
        assert notify.await_args.args[2] == "on_completed"
        logged = await db_session.scalar(
            select(EventRequestActivity).where(
                EventRequestActivity.request_id == request.id,
                EventRequestActivity.action == "status_changed_to_completed",
            )
        )
        assert logged.notes == "Completed when the event's attendance was finalized"
        assert logged.performed_by == officer.id

    @pytest.mark.parametrize(
        "status", [EventRequestStatus.CANCELLED, EventRequestStatus.POSTPONED]
    )
    async def test_a_request_not_scheduled_is_left_as_it_is(self, db_session, status):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, hours_from_now=-4)
        request = await _request(db_session, org, event, status=status)

        with patch(NOTIFY, AsyncMock(return_value=True)) as notify:
            await EventService(db_session).finalize_event_attendance_detailed(
                event.id, org.id, officer.id
            )

        await db_session.refresh(request)
        assert request.status == status
        notify.assert_not_awaited()


class TestMarkingCompleted:
    async def _mark(self, db, officer, request):
        with patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(return_value=True),
        ):
            return await update_event_request_status(
                request_id=request.id,
                update=EventRequestStatusUpdate(status="completed"),
                db=db,
                current_user=officer,
            )

    async def test_a_future_event_cannot_be_marked_completed(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, hours_from_now=48)
        request = await _request(db_session, org, event)

        with pytest.raises(HTTPException) as exc:
            await self._mark(db_session, officer, request)
        assert exc.value.status_code == 400
        assert "has not happened yet" in exc.value.detail

    async def test_a_past_event_can_be(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, hours_from_now=-4)
        request = await _request(db_session, org, event)

        result = await self._mark(db_session, officer, request)
        assert result["status"] == "completed"


class TestTheCloseoutRecord:
    async def _save(self, db, officer, event, **fields):
        with patch(
            "app.api.v1.endpoints.events.log_audit_event", AsyncMock(return_value=None)
        ):
            return await set_outreach_closeout(
                event_id=uuid.UUID(event.id),
                body=OutreachCloseoutUpdate(**fields),
                db=db,
                current_user=officer,
            )

    async def test_it_is_saved_in_one_shape(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, hours_from_now=-4)
        engine = BasicApparatus(
            organization_id=org.id,
            unit_number="E1",
            name="Engine 1",
            apparatus_type="engine",
        )
        db_session.add(engine)
        await db_session.flush()

        response = await self._save(
            db_session,
            officer,
            event,
            outcome_note="  Kids loved the hose.  ",
            apparatus_ids=[engine.id, engine.id],
            materials=[
                {"item": "Smoke alarms", "quantity": 12},
                {"item": "smoke alarms", "quantity": 3},
                {"item": "Coloring books", "quantity": 40},
            ],
            photos="consented",
        )

        assert response.outreach_outcome_note == "Kids loved the hose."
        assert response.outreach_apparatus_ids == [engine.id]
        assert response.outreach_materials == [
            {"item": "Smoke alarms", "quantity": 15},
            {"item": "Coloring books", "quantity": 40},
        ]
        assert response.outreach_photos == "consented"

    async def test_an_empty_save_clears_it(self, db_session):
        org, officer = await _dept(db_session)
        event = await _event(db_session, org, hours_from_now=-4)
        await self._save(
            db_session, officer, event, outcome_note="Went well", photos="none"
        )

        response = await self._save(db_session, officer, event)

        assert response.outreach_outcome_note is None
        assert response.outreach_materials is None
        assert response.outreach_photos is None

    @pytest.mark.parametrize("case", ["future", "cancelled", "not_outreach"])
    async def test_it_is_refused_where_a_headcount_would_be(self, db_session, case):
        org, officer = await _dept(db_session)
        event = await _event(
            db_session,
            org,
            hours_from_now=48 if case == "future" else -4,
            event_type=EventType.TRAINING if case == "not_outreach" else None,
        )
        if case == "cancelled":
            event.is_cancelled = True
            await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await self._save(db_session, officer, event, outcome_note="x")
        assert exc.value.status_code == 400

    async def test_another_departments_apparatus_is_refused(self, db_session):
        org, officer = await _dept(db_session)
        other, _ = await _dept(db_session)
        event = await _event(db_session, org, hours_from_now=-4)
        foreign = BasicApparatus(
            organization_id=other.id,
            unit_number="E9",
            name="Engine 9",
            apparatus_type="engine",
        )
        db_session.add(foreign)
        await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await self._save(db_session, officer, event, apparatus_ids=[foreign.id])
        assert exc.value.status_code == 400


class TestTheReport:
    async def test_materials_are_totalled_and_rows_carry_the_closeout(self, db_session):
        org, officer = await _dept(db_session)
        first = await _event(db_session, org, hours_from_now=-30)
        second = await _event(db_session, org, hours_from_now=-6)
        first.outreach_materials = [{"item": "Smoke alarms", "quantity": 10}]
        second.outreach_materials = [
            {"item": "smoke alarms", "quantity": 5},
            {"item": "Flyers", "quantity": 100},
        ]
        second.outreach_outcome_note = "Follow up with the principal"
        second.outreach_photos = "not_consented"
        await db_session.flush()

        report = await get_community_engagement(
            period="all", db=db_session, current_user=officer
        )

        assert [(m.item, m.quantity) for m in report.materials] == [
            ("Flyers", 100),
            ("Smoke alarms", 15),
        ]
        latest = report.recent_events[0]
        assert latest.outcome_note == "Follow up with the principal"
        assert latest.photos == "not_consented"
        assert [(m.item, m.quantity) for m in latest.materials] == [
            ("smoke alarms", 5),
            ("Flyers", 100),
        ]
