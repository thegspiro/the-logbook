"""A "this and all future events" edit must not double-book a room.

update_event and postpone_event refuse a move onto a room another booking
already holds. update_future_events moved every later occurrence by the
anchor's shift, or into a newly chosen room, without asking, so one series
edit could double-book a room on every week it reached. Each moved
occurrence is now checked at its own new time and room, ignoring the series'
own occurrences, and a clash refuses the whole save.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.location import Location
from app.schemas.event import EventUpdate
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


async def _room(db: AsyncSession, org: str, name: str) -> str:
    room = Location(organization_id=org, name=name)
    db.add(room)
    await db.flush()
    return str(room.id)


def _start() -> datetime:
    # Read as the test runs (pitfall #40); days ahead so nothing is past.
    return (datetime.now(timezone.utc) + timedelta(days=3)).replace(
        hour=14, minute=0, second=0, microsecond=0
    )


async def _weekly_series(
    db: AsyncSession, org: str, user: str, room: str | None, start: datetime
) -> list:
    data = {
        "title": "Weekly Drill",
        "event_type": "business_meeting",
        "start_datetime": start,
        "end_datetime": start + timedelta(hours=2),
        "requires_rsvp": False,
        "recurrence_pattern": "weekly",
        "recurrence_end_date": start + timedelta(weeks=2, hours=1),
    }
    if room:
        data["location_id"] = room
    events, error = await EventService(db).create_recurring_event(data, org, user)
    assert error is None
    assert len(events) == 3
    await db.commit()
    return sorted(events, key=lambda e: e.start_datetime)


async def _booking(
    db: AsyncSession, org: str, user: str, room: str, title: str, start: datetime
) -> None:
    db.add(
        Event(
            organization_id=org,
            title=title,
            event_type="business_meeting",
            start_datetime=start,
            end_datetime=start + timedelta(hours=1),
            location_id=room,
            requires_rsvp=False,
            created_by=user,
        )
    )
    await db.commit()


async def _starts(db: AsyncSession, ids: list) -> list:
    rows = await db.execute(
        select(Event.id, Event.start_datetime).where(Event.id.in_(ids))
    )
    by_id = {row.id: row.start_datetime.replace(tzinfo=None) for row in rows}
    return [by_id[i] for i in ids]


class TestSeriesRoomOverlap:
    async def test_moving_the_series_onto_a_booked_room_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        room = await _room(db_session, org, "Training Room")
        start = _start()
        series = await _weekly_series(db_session, org, admin, room, start)
        ids = [e.id for e in series]
        before = await _starts(db_session, ids)
        # The third week's new slot, an hour later, is already taken.
        await _booking(
            db_session,
            org,
            admin,
            room,
            "CPR Recertification",
            start + timedelta(weeks=2, hours=2, minutes=30),
        )

        with pytest.raises(ValueError, match='"CPR Recertification"'):
            await EventService(db_session).update_future_events(
                ids[0],
                org,
                EventUpdate(
                    start_datetime=start + timedelta(hours=1),
                    end_datetime=start + timedelta(hours=3),
                ),
                admin,
            )
        await db_session.rollback()

        assert await _starts(db_session, ids) == before

    async def test_moving_the_series_into_a_booked_room_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        old_room = await _room(db_session, org, "Bay 1")
        new_room = await _room(db_session, org, "Classroom")
        start = _start()
        series = await _weekly_series(db_session, org, admin, old_room, start)
        ids = [e.id for e in series]
        await _booking(
            db_session,
            org,
            admin,
            new_room,
            "Board Meeting",
            start + timedelta(weeks=1, minutes=30),
        )

        with pytest.raises(ValueError, match='"Board Meeting"') as refused:
            await EventService(db_session).update_future_events(
                ids[0], org, EventUpdate(location_id=new_room), admin
            )
        assert "1 of 3 occurrences" in str(refused.value)
        await db_session.rollback()

        rooms = (
            await db_session.execute(select(Event.location_id).where(Event.id.in_(ids)))
        ).scalars()
        assert set(rooms) == {old_room}

    async def test_a_shift_overlapping_only_its_own_occurrences_goes_through(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        room = await _room(db_session, org, "Training Room")
        start = _start()
        series = await _weekly_series(db_session, org, admin, room, start)
        ids = [e.id for e in series]

        # Half an hour later overlaps every occurrence's own old slot.
        updated = await EventService(db_session).update_future_events(
            ids[0],
            org,
            EventUpdate(
                start_datetime=start + timedelta(minutes=30),
                end_datetime=start + timedelta(hours=2, minutes=30),
            ),
            admin,
        )

        assert updated == 3
        assert await _starts(db_session, ids) == [
            (start + timedelta(weeks=w, minutes=30)).replace(tzinfo=None)
            for w in range(3)
        ]

    async def test_an_edit_that_moves_nothing_is_not_refused_over_an_old_clash(
        self, db_session, setup_org_and_admin
    ):
        org, admin = setup_org_and_admin
        room = await _room(db_session, org, "Training Room")
        start = _start()
        series = await _weekly_series(db_session, org, admin, room, start)
        ids = [e.id for e in series]
        # A clash that predates this edit: the edit does not create it.
        await _booking(db_session, org, admin, room, "Old Clash", start)

        updated = await EventService(db_session).update_future_events(
            ids[0],
            org,
            EventUpdate(
                description="Bring gloves",
                location_id=room,
                start_datetime=start,
                end_datetime=start + timedelta(hours=2),
            ),
            admin,
        )

        assert updated == 3
