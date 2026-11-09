"""An edit that moves an event's start lets its reminders go out again.

Workflow review W80-16: ``custom_fields.reminders_sent`` lists the reminder
intervals already sent for an event, and the reminder task skips them. They
were sent for the old time, so a drill moved later through Edit got no
reminder for its new one. Owner decision 2026-11-08: reset the marker whenever
the start moves; leave it for any other edit.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.schemas.event import EventCreate, EventUpdate
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org, "slug": f"org-{org[:8]}"},
    )
    officer = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Officer', 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": officer,
            "org": org,
            "un": f"o-{officer[:8]}",
            "em": f"o-{officer[:8]}@t.com",
        },
    )
    await db_session.flush()
    return org, officer


def _start(days: int = 3) -> datetime:
    return (datetime.now(timezone.utc) + timedelta(days=days)).replace(
        hour=19, minute=0, second=0, microsecond=0
    )


async def _event(db, org, officer, start, **extra) -> str:
    event = await EventService(db).create_event(
        EventCreate(
            title="Monthly Drill",
            event_type="training",
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            requires_rsvp=False,
            **extra,
        ),
        organization_id=org,
        created_by=officer,
    )
    return str(event.id)


async def _mark_reminders_sent(db, event_id: str) -> None:
    event = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one()
    event.custom_fields = {"reminders_sent": [24, 1], "dress": "Class B"}
    await db.commit()


async def _custom(db, event_id: str) -> dict:
    db.expire_all()
    event = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one()
    return event.custom_fields or {}


class TestSingleEventEdit:
    async def test_moving_the_start_forgets_the_reminders_sent(self, db_session, dept):
        org, officer = dept
        start = _start()
        event_id = await _event(db_session, org, officer, start)
        await _mark_reminders_sent(db_session, event_id)

        moved = start + timedelta(days=1)
        await EventService(db_session).update_event(
            event_id,
            org,
            EventUpdate(start_datetime=moved, end_datetime=moved + timedelta(hours=2)),
            officer,
        )

        assert await _custom(db_session, event_id) == {"dress": "Class B"}

    async def test_a_title_fix_keeps_them(self, db_session, dept):
        org, officer = dept
        event_id = await _event(db_session, org, officer, _start())
        await _mark_reminders_sent(db_session, event_id)

        await EventService(db_session).update_event(
            event_id, org, EventUpdate(title="Monthly Drill (Engine 2)"), officer
        )

        assert (await _custom(db_session, event_id))["reminders_sent"] == [24, 1]

    async def test_the_form_resending_the_same_start_keeps_them(self, db_session, dept):
        """The edit form resends every field it shows; an unchanged start is
        not a move, even in another representation."""
        org, officer = dept
        start = _start()
        event_id = await _event(db_session, org, officer, start)
        await _mark_reminders_sent(db_session, event_id)

        await EventService(db_session).update_event(
            event_id,
            org,
            EventUpdate(
                title="Monthly Drill",
                start_datetime=start,
                end_datetime=start + timedelta(hours=3),
            ),
            officer,
        )

        assert (await _custom(db_session, event_id))["reminders_sent"] == [24, 1]


class TestSeriesEdit:
    async def test_moving_a_series_forgets_each_occurrences_reminders(
        self, db_session, dept
    ):
        org, officer = dept
        first = _start(3)
        parent_id = await _event(db_session, org, officer, first)
        child_id = await _event(db_session, org, officer, first + timedelta(days=7))
        child = (
            await db_session.execute(select(Event).where(Event.id == child_id))
        ).scalar_one()
        child.recurrence_parent_id = parent_id
        await db_session.commit()
        for event_id in (parent_id, child_id):
            await _mark_reminders_sent(db_session, event_id)

        later = first + timedelta(hours=1)
        await EventService(db_session).update_future_events(
            uuid.UUID(parent_id),
            org,
            EventUpdate(start_datetime=later, end_datetime=later + timedelta(hours=2)),
            officer,
        )

        assert await _custom(db_session, parent_id) == {"dress": "Class B"}
        assert await _custom(db_session, child_id) == {"dress": "Class B"}
