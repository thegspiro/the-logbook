"""Two simultaneous scans of the guest QR code must record one attendee.

`GuestCheckInService.check_in_guest` finds the guest's existing row and inserts
one only when there is none. That is a read-then-write (CLAUDE.md pitfalls #27
and #36), and the service's own docstring names the trigger: "a duplicate every
time someone taps the QR twice". Two taps -- a double-tap, or a retry of a POST
that timed out after it was processed -- both read "no attendee yet" before
either commits, so both insert. The headcount the event reports, and the
attendance record an officer finalizes, then count the guest twice.

The row to lock is the event: the conflicting attendee does not exist yet, so
there is nothing else to take a lock on. The lookup is itself a locking read,
because the caller resolved the event first and InnoDB's REPEATABLE READ would
otherwise answer the lookup from that earlier snapshot even once the lock is
granted.

The race needs two independently-committing connections, so this uses
`database_manager.engine.connect()` directly rather than the savepoint-wrapped
`db_session` fixture -- the arrangement of `test_onboarding_owner_race.py`.
"""

import asyncio
import inspect
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.models.event import CheckInWindowType, Event, EventType
from app.models.user import Organization
from app.services.guest_check_in_service import GuestCheckInService


@pytest.mark.unit
class TestTheLockIsDeclared:
    """A source-level guard, so the fix cannot be quietly reverted where the
    DB-backed test below is not run."""

    def test_check_in_guest_locks_the_event_before_the_lookup(self):
        source = inspect.getsource(GuestCheckInService.check_in_guest)
        assert "_lock_event(" in source
        assert source.index("_lock_event(") < source.index("_find_existing_attendee(")

    def test_the_lookup_is_a_locking_read(self):
        source = inspect.getsource(GuestCheckInService.check_in_guest)
        assert "for_update=True" in source

    def test_the_event_lock_is_a_locking_read_scoped_to_the_organization(self):
        source = inspect.getsource(GuestCheckInService._lock_event)
        assert "with_for_update()" in source
        assert "organization_id" in source


@pytest.mark.integration
@pytest.mark.asyncio
class TestConcurrentGuestScans:
    async def test_two_simultaneous_scans_record_one_attendee(self, db_session):
        # `db_session` is taken only for its `_initialize_database` dependency.
        marker = uuid.uuid4().hex[:8]
        org_id = str(uuid.uuid4())
        event_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        async with database_manager.engine.connect() as setup_conn:
            setup = AsyncSession(bind=setup_conn, expire_on_commit=False)
            setup.add(
                Organization(id=org_id, name=f"Scan Race {marker}", slug=f"sr-{marker}")
            )
            await setup.flush()
            setup.add(
                Event(
                    id=event_id,
                    organization_id=org_id,
                    title="Open House",
                    event_type=EventType.PUBLIC_EDUCATION,
                    start_datetime=now - timedelta(minutes=10),
                    end_datetime=now + timedelta(hours=2),
                    check_in_window_type=CheckInWindowType.FLEXIBLE,
                    allow_guest_check_in=True,
                    guest_check_in_creates_prospect=False,
                    is_cancelled=False,
                )
            )
            await setup.commit()
            await setup.close()

        arrivals = 0
        both_arrived = asyncio.Event()
        real_find = GuestCheckInService._find_existing_attendee

        async def meet_then_find(self, *args, **kwargs):
            # Hold the first caller at the lookup long enough for a second to
            # reach it. Unlocked, both arrive and both see no row; locked, the
            # second is still waiting on the event row, so the first moves on
            # after the wait and the second then sees its committed row.
            nonlocal arrivals
            arrivals += 1
            if arrivals >= 2:
                both_arrived.set()
            try:
                await asyncio.wait_for(both_arrived.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass
            return await real_find(self, *args, **kwargs)

        async def scan():
            async with database_manager.engine.connect() as conn:
                session = AsyncSession(bind=conn, expire_on_commit=False)
                try:
                    event = await session.get(Event, event_id)
                    attendee, error, _created = await GuestCheckInService(
                        session
                    ).check_in_guest(
                        event=event,
                        organization_id=org_id,
                        first_name="Dana",
                        last_name="Guest",
                        email=f"dana-{marker}@example.com",
                    )
                    return attendee.id if attendee is not None else error
                finally:
                    await session.close()

        try:
            with patch.object(
                GuestCheckInService, "_find_existing_attendee", meet_then_find
            ):
                results = await asyncio.gather(scan(), scan())

            async with database_manager.engine.connect() as check_conn:
                count = (
                    await check_conn.execute(
                        text(
                            "SELECT COUNT(*) FROM event_external_attendees "
                            "WHERE event_id = :e"
                        ),
                        {"e": event_id},
                    )
                ).scalar()
            assert count == 1, (
                f"{count} attendee rows exist after two simultaneous scans by "
                "the same guest, not 1 -- both looked, found nobody, and "
                "inserted"
            )
            assert results[0] == results[1], (
                "the two scans were answered with different attendees; the "
                "second should have found the first's row"
            )
        finally:
            async with database_manager.engine.connect() as cleanup_conn:
                async with cleanup_conn.begin():
                    await cleanup_conn.execute(
                        text(
                            "DELETE FROM event_external_attendees "
                            "WHERE event_id = :e"
                        ),
                        {"e": event_id},
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM events WHERE id = :e"), {"e": event_id}
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM organizations WHERE id = :o"),
                        {"o": org_id},
                    )
