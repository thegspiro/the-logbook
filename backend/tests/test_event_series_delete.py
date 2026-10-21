"""
Deleting part of a recurring series keeps the rest of it a series.

Two owner decisions, both against a real database because the bug lived in
the ORM's handling of the self-referential ``recurrence_parent_id`` foreign
key, which a mocked session cannot reproduce:

- Deleting the parent (the first occurrence) passes the series to the next
  occurrence. It used to null every child's ``recurrence_parent_id`` and drop
  the pattern, end date, exceptions and rolling flag, which live only on the
  parent — so a later "delete series" from any child removed one row.
- "This and future occurrences" deletes from a chosen occurrence on, keeps
  the earlier ones, and ends the series there so the rolling-extension job
  does not recreate what was deleted.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import List

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, RecurrencePattern
from app.services.event_service import ATTENDANCE_LOCKED_PREFIX, EventService
from app.services.scheduled_tasks import run_rolling_recurrence_extend

pytestmark = [pytest.mark.integration]


async def _series(
    db: AsyncSession,
    org: str,
    user: str,
    *,
    weeks_back: int,
    count: int,
    rolling: bool = False,
) -> List[str]:
    """A weekly series of ``count`` occurrences (or a rolling one), oldest
    first, starting ``weeks_back`` weeks ago."""
    start = (datetime.now(timezone.utc) - timedelta(weeks=weeks_back)).replace(
        second=0, microsecond=0
    )
    data = {
        "title": "Weekly Drill",
        "event_type": "business_meeting",
        "start_datetime": start,
        "end_datetime": start + timedelta(hours=2),
        "requires_rsvp": False,
        "recurrence_pattern": "weekly",
        "rolling_recurrence": rolling,
        "recurrence_end_date": (
            None if rolling else start + timedelta(weeks=count - 1, hours=1)
        ),
    }
    events, error = await EventService(db).create_recurring_event(data, org, user)
    assert error is None
    if not rolling:
        assert len(events) == count
    return [str(e.id) for e in events]


async def _event(db: AsyncSession, event_id: str) -> Event:
    result = await db.execute(
        select(Event)
        .where(Event.id == event_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _ids_in_org(db: AsyncSession, org: str) -> List[str]:
    result = await db.execute(
        select(Event.id)
        .where(Event.organization_id == org)
        .order_by(Event.start_datetime)
    )
    return [str(row[0]) for row in result]


async def _finalize(db: AsyncSession, event_id: str) -> None:
    event = await _event(db, event_id)
    event.attendance_finalized_at = datetime.now(timezone.utc)
    await db.commit()


async def _children_of(db: AsyncSession, parent_id: str) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Event)
        .where(Event.recurrence_parent_id == parent_id)
    )
    return int(result.scalar_one())


class TestDeletingTheParentPassesTheSeriesOn:
    async def test_next_occurrence_inherits_every_series_field(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=1, count=4)

        # Every series-level column, set to something distinguishable, so a
        # field the promotion forgets shows up as a mismatch.
        parent = await _event(db_session, ids[0])
        parent.recurrence_custom_days = [1, 3]
        parent.recurrence_weekday = 2
        parent.recurrence_week_ordinal = -1
        parent.recurrence_month = 6
        parent.recurrence_exceptions = ["2030-01-01"]
        parent.rolling_recurrence = True
        parent.custom_fields = {"series_end_reminder_sent": True}
        await db_session.commit()
        expected_end = parent.recurrence_end_date

        assert await EventService(db_session).delete_event(ids[0], org) is True

        successor = await _event(db_session, ids[1])
        assert successor.recurrence_parent_id is None
        assert successor.is_recurring is True
        assert successor.recurrence_pattern == RecurrencePattern.WEEKLY
        assert successor.recurrence_end_date == expected_end
        assert successor.rolling_recurrence is True
        assert successor.recurrence_custom_days == [1, 3]
        assert successor.recurrence_weekday == 2
        assert successor.recurrence_week_ordinal == -1
        assert successor.recurrence_month == 6
        assert successor.recurrence_exceptions == ["2030-01-01"]
        assert (successor.custom_fields or {}).get("series_end_reminder_sent")

        for child_id in ids[2:]:
            assert (await _event(db_session, child_id)).recurrence_parent_id == ids[1]

    async def test_a_later_series_delete_reaches_every_remaining_occurrence(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=1, count=4)
        service = EventService(db_session)

        await service.delete_event(ids[0], org)
        # What the detail page sends from any occurrence:
        # recurrence_parent_id, which now names the promoted occurrence.
        child = await _event(db_session, ids[3])
        deleted = await service.delete_event_series(child.recurrence_parent_id, org)

        assert deleted == 3
        assert await _ids_in_org(db_session, org) == []

    async def test_deleting_an_occurrence_that_is_not_the_parent_is_unchanged(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=1, count=4)

        assert await EventService(db_session).delete_event(ids[2], org) is True

        assert await _ids_in_org(db_session, org) == [ids[0], ids[1], ids[3]]
        parent = await _event(db_session, ids[0])
        assert parent.recurrence_parent_id is None
        for child_id in (ids[1], ids[3]):
            assert (await _event(db_session, child_id)).recurrence_parent_id == ids[0]

    async def test_a_promoted_rolling_series_keeps_extending(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=2, count=0, rolling=True)
        await EventService(db_session).delete_event(ids[0], org)
        before = await _children_of(db_session, ids[1])

        await run_rolling_recurrence_extend(db_session)

        assert await _children_of(db_session, ids[1]) > before
        assert await _children_of(db_session, ids[0]) == 0


class TestThisAndFutureOccurrences:
    async def test_deletes_from_the_chosen_occurrence_and_keeps_earlier_ones(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=3, count=6)
        # A closed occurrence before the cutoff is kept, so it cannot refuse
        # the delete the way it would refuse a whole-series one.
        await _finalize(db_session, ids[1])

        deleted = await EventService(db_session).delete_event_series(
            ids[0], org, from_event_id=ids[3]
        )

        assert deleted == 3
        assert await _ids_in_org(db_session, org) == ids[:3]
        parent = await _event(db_session, ids[0])
        last_kept = await _event(db_session, ids[2])
        assert parent.recurrence_end_date == last_kept.start_datetime
        assert parent.rolling_recurrence is False

    async def test_a_finalized_occurrence_after_the_cutoff_blocks_it(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=3, count=6)
        await _finalize(db_session, ids[4])

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX):
            await EventService(db_session).delete_event_series(
                ids[0], org, from_event_id=ids[3]
            )

        assert await _ids_in_org(db_session, org) == ids

    async def test_a_cutoff_at_the_parent_deletes_the_whole_series(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=1, count=4)

        deleted = await EventService(db_session).delete_event_series(
            ids[0], org, from_event_id=ids[0]
        )

        assert deleted == 4
        assert await _ids_in_org(db_session, org) == []

    async def test_rolling_extension_does_not_recreate_the_deleted_tail(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=2, count=0, rolling=True)

        await EventService(db_session).delete_event_series(
            ids[0], org, from_event_id=ids[4]
        )
        await run_rolling_recurrence_extend(db_session)

        assert await _ids_in_org(db_session, org) == ids[:4]

    async def test_an_occurrence_of_another_series_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=1, count=3)

        with pytest.raises(ValueError, match="not part of this series"):
            await EventService(db_session).delete_event_series(
                ids[0], org, from_event_id=str(uuid.uuid4())
            )

        assert await _ids_in_org(db_session, org) == ids

    async def test_without_a_cutoff_future_only_still_cuts_at_now(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        ids = await _series(db_session, org, admin, weeks_back=2, count=5)

        deleted = await EventService(db_session).delete_event_series(
            ids[0], org, delete_future_only=True
        )

        # Two weeks ago, one week ago and (whole minutes ago) now are past.
        assert deleted == 2
        assert await _ids_in_org(db_session, org) == ids[:3]
