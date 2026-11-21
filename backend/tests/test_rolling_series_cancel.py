"""Cancelling a rolling series' future stays cancelled.

The nightly job keeps a rolling series twelve months deep by copying its
latest occurrence that is not cancelled and creating every pattern date after
it. ``cancel_series(cancel_future_only=True)`` cancelled the future
occurrences but left the parent rolling, so that night the job took the last
kept occurrence as its template and recreated every cancelled date beside the
cancelled row. Cancelling only the last generated occurrence was undone the
same way.

A retried scheduled task must be a no-op for a cancelled future (CLAUDE.md
pitfall #36): the cancel ends the series, and the job never creates a date the
series already holds, cancelled or not.
"""

from datetime import datetime, timedelta, timezone
from typing import List

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.services.event_service import EventService
from app.services.scheduled_tasks import run_rolling_recurrence_extend

pytestmark = [pytest.mark.integration]


async def _rolling_series(db: AsyncSession, org: str, user: str) -> List[str]:
    """A rolling weekly series whose first night was three weeks ago, oldest
    first."""
    start = (datetime.now(timezone.utc) - timedelta(weeks=3)).replace(
        second=0, microsecond=0
    )
    events, error = await EventService(db).create_recurring_event(
        {
            "title": "Tuesday Drill",
            "event_type": "business_meeting",
            "start_datetime": start,
            "end_datetime": start + timedelta(hours=2),
            "requires_rsvp": False,
            "recurrence_pattern": "weekly",
            "rolling_recurrence": True,
        },
        org,
        user,
    )
    assert error is None
    await db.commit()
    return [str(e.id) for e in sorted(events, key=lambda e: e.start_datetime)]


async def _live_after(db: AsyncSession, org: str, after: datetime) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Event)
        .where(
            Event.organization_id == org,
            Event.is_cancelled.is_(False),
            Event.start_datetime > after,
        )
    )
    return int(result.scalar_one())


async def _live_on(db: AsyncSession, org: str, start: datetime) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Event)
        .where(
            Event.organization_id == org,
            Event.is_cancelled.is_(False),
            Event.start_datetime == start,
        )
    )
    return int(result.scalar_one())


class TestCancelledFutureStaysCancelled:
    async def test_cancelling_the_future_ends_the_series(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _rolling_series(db_session, org, admin)
        now = datetime.now(timezone.utc)

        cancelled = await EventService(db_session).cancel_series(
            ids[0], org, "Drill discontinued", cancel_future_only=True
        )
        assert cancelled > 0

        await run_rolling_recurrence_extend(db_session)

        assert await _live_after(db_session, org, now) == 0
        parent = (
            await db_session.execute(
                select(Event)
                .where(Event.id == ids[0])
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert parent.rolling_recurrence is False
        assert parent.recurrence_end_date is not None

    async def test_cancelling_the_last_occurrence_alone_is_not_undone(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _rolling_series(db_session, org, admin)
        service = EventService(db_session)
        last = (
            await db_session.execute(select(Event).where(Event.id == ids[-1]))
        ).scalar_one()
        last_start = last.start_datetime

        await service.cancel_event(ids[-1], org, "Hall booked")
        await db_session.commit()
        await run_rolling_recurrence_extend(db_session)

        assert await _live_on(db_session, org, last_start) == 0
