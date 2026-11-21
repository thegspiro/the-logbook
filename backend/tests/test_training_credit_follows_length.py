"""Credit hours that follow an event's length keep following it.

A session with no hours of its own and no course files under the event's
scheduled length, but the stored figure was recomputed only when the
training form sent ``credit_hours: null``. A training manager's edit (which
may not send training details), a "this and all future events" time change
without them, and a postponement each moved the event and left the hours at
the old length — and the form then read the stale figure as typed, so it
never followed again.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import TrainingSession
from app.schemas.event import EventCreate, EventUpdate, RecurringEventCreate
from app.schemas.training_session import TrainingSessionAttach
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, settings) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC', '{}')"
        ),
        {"id": org, "slug": f"org-{org[:8]}"},
    )
    officer = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
            "'Officer', 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": officer,
            "org": org,
            "un": f"officer-{officer[:8]}",
            "em": f"officer-{officer[:8]}@test.com",
        },
    )
    await db_session.flush()
    return org, officer


def _window(days_ahead: int = 7):
    start = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).replace(
        hour=10, minute=0, second=0, microsecond=0
    )
    return start, start + timedelta(hours=2)


async def _drill(db, org, officer, **details) -> str:
    start, end = _window()
    event = await EventService(db).create_event(
        EventCreate(
            title="Pump Drill",
            event_type="training",
            start_datetime=start,
            end_datetime=end,
            requires_rsvp=False,
            training_details=TrainingSessionAttach(**details),
        ),
        organization_id=org,
        created_by=officer,
    )
    return str(event.id)


async def _hours(db, event_id: str) -> float:
    result = await db.execute(
        select(TrainingSession.credit_hours)
        .where(TrainingSession.event_id == event_id)
        .execution_options(populate_existing=True)
    )
    return float(result.scalar_one())


class TestCreditHoursFollowTheLength:
    async def test_an_edit_without_training_details_follows(self, db_session, dept):
        org, officer = dept
        event_id = await _drill(db_session, org, officer)
        assert await _hours(db_session, event_id) == 2.0
        start, _ = _window()

        await EventService(db_session).update_event(
            event_id,
            org,
            EventUpdate(end_datetime=start + timedelta(hours=3)),
            officer,
        )

        assert await _hours(db_session, event_id) == 3.0

    async def test_a_postponement_follows(self, db_session, dept):
        org, officer = dept
        event_id = await _drill(db_session, org, officer)
        start, _ = _window(days_ahead=14)

        await EventService(db_session).postpone_event(
            event_id,
            org,
            start,
            start + timedelta(hours=3),
            "Apparatus out of service",
            send_notifications=False,
            postponed_by=officer,
        )

        assert await _hours(db_session, event_id) == 3.0

    async def test_typed_hours_stay_as_typed(self, db_session, dept):
        org, officer = dept
        event_id = await _drill(db_session, org, officer, credit_hours=1.5)
        start, _ = _window()

        await EventService(db_session).update_event(
            event_id,
            org,
            EventUpdate(end_datetime=start + timedelta(hours=3)),
            officer,
        )

        assert await _hours(db_session, event_id) == 1.5

    async def test_a_series_time_change_follows(self, db_session, dept):
        org, officer = dept
        start, end = _window()
        payload = RecurringEventCreate(
            title="Pump Drill",
            event_type="training",
            start_datetime=start,
            end_datetime=end,
            requires_rsvp=False,
            recurrence_pattern="weekly",
            recurrence_end_date=start + timedelta(weeks=1, hours=1),
            training_details=TrainingSessionAttach(),
        )
        events, error = await EventService(db_session).create_recurring_event(
            payload.model_dump(exclude_unset=True), org, officer
        )
        assert error is None
        ids = [str(e.id) for e in sorted(events, key=lambda e: e.start_datetime)]
        assert len(ids) == 2

        await EventService(db_session).update_future_events(
            ids[0],
            org,
            EventUpdate(start_datetime=start, end_datetime=start + timedelta(hours=3)),
            officer,
        )

        assert [await _hours(db_session, i) for i in ids] == [3.0, 3.0]
