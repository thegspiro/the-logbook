"""
Room booking is serialized per organization (EV-26).

``check_overlapping_events`` used to be a plain SELECT and the only guard on
booking a room: two coordinators booking the same room for overlapping times
both read "free" off their snapshots and both inserted. It now takes the
organization's room-booking lock and reads with a locking read.

The lock is per organization, not per room, because a locking range read
over ``events`` takes gap locks that two different rooms can share; per-room
parents let bookings of *different* rooms deadlock on each other's inserts.
Both directions are driven here on real connections: the same room must
admit one booking, and different rooms must both succeed without a 1213.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.schemas.event import EventCreate
from app.services.event_service import EventService
from app.services.location_service import LocationService

pytestmark = [pytest.mark.integration]

# How long the first booking holds its locks after inserting, so the second
# is certain to arrive while they are held.
_HOLD_SECONDS = 0.3
_START = datetime(2027, 3, 1, 18, 0, tzinfo=timezone.utc)


async def _seed(rooms: int) -> tuple[str, str, list[str]]:
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    room_ids = [str(uuid.uuid4()) for _ in range(rooms)]
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations "
                    "(id, name, organization_type, slug, timezone, active) "
                    "VALUES (:id, 'Booking Race Dept', 'fire_department', :slug, "
                    "'UTC', 1)"
                ),
                {"id": org_id, "slug": f"booking-race-{org_id[:8]}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) VALUES (:id, :org, "
                    ":un, 'Booking', 'Racer', :em, 'hashed', 'active')"
                ),
                {
                    "id": user_id,
                    "org": org_id,
                    "un": f"booking-race-{user_id[:8]}",
                    "em": f"booking-race-{user_id[:8]}@test.com",
                },
            )
            for index, room_id in enumerate(room_ids):
                await conn.execute(
                    text(
                        "INSERT INTO locations (id, organization_id, name) "
                        "VALUES (:id, :org, :name)"
                    ),
                    {"id": room_id, "org": org_id, "name": f"Room {index}"},
                )
    return org_id, user_id, room_ids


async def _cleanup(org_id: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for statement in (
                "DELETE FROM events WHERE organization_id = :o",
                "DELETE FROM locations WHERE organization_id = :o",
                "DELETE FROM room_booking_locks WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": org_id})


@pytest.fixture
def first_checker_pauses(monkeypatch):
    """Hold the first booking between its overlap check and its insert.

    ``create_event`` commits inside itself, so the race lives entirely
    between the check and the insert. The first caller to finish a check
    signals and then waits there; the second starts on the signal. With the
    lock, the second blocks inside its own check until the first commits;
    without it, both read the room as free.
    """
    checked = asyncio.Event()
    original = LocationService.check_overlapping_events
    calls = []

    async def paused(self, *args, **kwargs):
        result = await original(self, *args, **kwargs)
        calls.append(1)
        if len(calls) == 1:
            checked.set()
            await asyncio.sleep(_HOLD_SECONDS)
        return result

    monkeypatch.setattr(LocationService, "check_overlapping_events", paused)
    return checked


async def _book(org_id, user_id, room_id, *, after=None):
    if after is not None:
        await after.wait()
    async with database_manager.engine.connect() as conn:
        session = AsyncSession(bind=conn, expire_on_commit=False)
        try:
            await EventService(session).create_event(
                event_data=EventCreate(
                    title=f"Booking in {room_id[:8]}",
                    event_type="business_meeting",
                    start_datetime=_START,
                    end_datetime=_START + timedelta(hours=2),
                    location_id=room_id,
                ),
                organization_id=uuid.UUID(org_id),
                created_by=uuid.UUID(user_id),
            )
            await session.commit()
            return "booked"
        except ValueError as exc:
            await session.rollback()
            return "refused" if "already booked" in str(exc) else f"other:{exc}"
        except DBAPIError as exc:
            await session.rollback()
            return "deadlock" if "1213" in str(exc) else f"other:{exc}"
        finally:
            await session.close()


@pytest.mark.usefixtures("_initialize_database")
async def test_two_bookings_of_one_room_admit_exactly_one(first_checker_pauses):
    org_id, user_id, (room,) = await _seed(1)
    try:
        results = await asyncio.gather(
            _book(org_id, user_id, room),
            _book(org_id, user_id, room, after=first_checker_pauses),
        )
    finally:
        await _cleanup(org_id)

    assert results == ["booked", "refused"], (
        f"two overlapping bookings of one room returned {results}. A second "
        "'booked' means both read the room as free off a stale snapshot."
    )


@pytest.mark.usefixtures("_initialize_database")
async def test_bookings_of_different_rooms_both_succeed_without_deadlock(
    monkeypatch,
):
    org_id, user_id, rooms = await _seed(2)
    try:
        for _ in range(3):
            # A fresh pause per round: the fixture form would only pause the
            # first round's first check.
            checked = asyncio.Event()
            original = LocationService.check_overlapping_events
            calls = []

            async def paused(self, *args, _calls=calls, _checked=checked, **kwargs):
                result = await original(self, *args, **kwargs)
                _calls.append(1)
                if len(_calls) == 1:
                    _checked.set()
                    await asyncio.sleep(_HOLD_SECONDS)
                return result

            monkeypatch.setattr(LocationService, "check_overlapping_events", paused)
            results = await asyncio.gather(
                _book(org_id, user_id, rooms[0]),
                _book(org_id, user_id, rooms[1], after=checked),
            )
            monkeypatch.setattr(LocationService, "check_overlapping_events", original)
            assert results == ["booked", "booked"], results
            async with database_manager.engine.connect() as conn:
                async with conn.begin():
                    await conn.execute(
                        text("DELETE FROM events WHERE organization_id = :o"),
                        {"o": org_id},
                    )
    finally:
        await _cleanup(org_id)
