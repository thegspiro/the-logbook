"""A "this and all future events" time change must not strand check-ins.

update_event refuses a schedule change that would leave existing check-ins
outside the new check-in window (owner decision, 2026-11-08), because
crediting clamps an early check-in forward to the new start. The series door,
update_future_events, moved every occurrence by the anchor's shift without
that check, so an open drill with members checked in moved a day and credited
them for a date they may never have attended.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, EventRSVP, RSVPStatus
from app.schemas.event import EventUpdate
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


async def _two_week_series(db: AsyncSession, org: str, user: str) -> list:
    start = (datetime.now(timezone.utc) - timedelta(weeks=2)).replace(
        second=0, microsecond=0
    )
    events, error = await EventService(db).create_recurring_event(
        {
            "title": "Weekly Drill",
            "event_type": "business_meeting",
            "start_datetime": start,
            "end_datetime": start + timedelta(hours=2),
            "requires_rsvp": False,
            "recurrence_pattern": "weekly",
            "recurrence_end_date": start + timedelta(weeks=1, hours=1),
        },
        org,
        user,
    )
    assert error is None
    assert len(events) == 2
    await db.commit()
    return sorted(events, key=lambda e: e.start_datetime)


class TestSeriesTimeChangeStrandedCheckIns:
    async def test_moving_the_series_past_an_open_check_in_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        first, second = await _two_week_series(db_session, org, admin)
        first_id, second_id = first.id, second.id
        first_start, first_end = first.start_datetime, first.end_datetime
        second_start = second.start_datetime
        db_session.add(
            EventRSVP(
                id=str(uuid.uuid4()),
                organization_id=org,
                event_id=second_id,
                user_id=admin,
                status=RSVPStatus.GOING,
                checked_in=True,
                checked_in_at=second_start + timedelta(minutes=2),
            )
        )
        await db_session.commit()

        with pytest.raises(
            ValueError, match="already checked in in 1 occurrence at a time outside"
        ):
            await EventService(db_session).update_future_events(
                first_id,
                org,
                EventUpdate(
                    start_datetime=first_start + timedelta(days=1),
                    end_datetime=first_end + timedelta(days=1),
                ),
                admin,
            )
        await db_session.rollback()

        moved = (
            await db_session.execute(
                select(Event.start_datetime).where(Event.id == second_id)
            )
        ).scalar_one()
        assert moved.replace(tzinfo=None) == second_start.replace(tzinfo=None)

    async def test_a_description_edit_with_check_ins_goes_through(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        first, second = await _two_week_series(db_session, org, admin)
        first_id = first.id
        first_start, first_end = first.start_datetime, first.end_datetime
        db_session.add(
            EventRSVP(
                id=str(uuid.uuid4()),
                organization_id=org,
                event_id=second.id,
                user_id=admin,
                status=RSVPStatus.GOING,
                checked_in=True,
                checked_in_at=second.start_datetime,
            )
        )
        await db_session.commit()

        updated = await EventService(db_session).update_future_events(
            first_id,
            org,
            EventUpdate(
                description="Bring gloves",
                start_datetime=first_start,
                end_datetime=first_end,
            ),
            admin,
        )

        assert updated == 2
