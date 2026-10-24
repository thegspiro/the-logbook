"""The open-shift board does not list a shift that has already ended.

An admin viewing Open Shifts at night was offered a live Sign Up button on an
L-4 shift that had ended at 20:00. The candidate query filtered on
``shift_date`` alone — calendar days — so every shift dated today stayed on the
board however long ago it ended. These pin the instant-based rule: a shift with
an ``end_time`` is over at it, and an open-ended one a cushion after its start
(the same rule the close-out backlog selects the opposite half of).
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.training import Shift, ShiftStatus
from app.models.user import Organization
from app.services.scheduling_service import SchedulingService

pytestmark = pytest.mark.integration

NOW = datetime.now(timezone.utc).replace(microsecond=0)


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Open Shifts Test Department",
        slug=f"open-shifts-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={"modules": {"scheduling": True, "_user_configured": True}},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _shift(db_session, org, *, start: datetime, end: datetime | None) -> Shift:
    shift = Shift(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        shift_date=NOW.date(),
        start_time=start,
        end_time=end,
        is_finalized=False,
        status=ShiftStatus.SCHEDULED,
    )
    db_session.add(shift)
    await db_session.flush()
    return shift


async def _candidates(db_session, org):
    # A window of today alone: every shift here is dated today, so only the
    # end-instant rule can tell them apart.
    shifts = await SchedulingService(db_session)._open_shift_candidates(
        org.id, NOW.date(), NOW.date(), now=NOW
    )
    return {s.id for s in shifts}


class TestOpenShiftCandidatesExcludeEndedShifts:
    async def test_a_shift_that_ended_earlier_today_is_not_listed(self, db_session):
        org = await _org(db_session)
        ended = await _shift(
            db_session,
            org,
            start=NOW - timedelta(hours=14),
            end=NOW - timedelta(hours=2),
        )

        assert ended.id not in await _candidates(db_session, org)

    async def test_a_shift_still_running_is_listed(self, db_session):
        org = await _org(db_session)
        running = await _shift(
            db_session,
            org,
            start=NOW - timedelta(hours=2),
            end=NOW + timedelta(hours=10),
        )

        assert running.id in await _candidates(db_session, org)

    async def test_a_shift_not_yet_started_is_listed(self, db_session):
        org = await _org(db_session)
        upcoming = await _shift(
            db_session,
            org,
            start=NOW + timedelta(minutes=30),
            end=NOW + timedelta(hours=12, minutes=30),
        )

        assert upcoming.id in await _candidates(db_session, org)

    async def test_an_open_ended_shift_inside_the_cushion_is_listed(self, db_session):
        org = await _org(db_session)
        open_ended = await _shift(
            db_session, org, start=NOW - timedelta(hours=1), end=None
        )

        assert open_ended.id in await _candidates(db_session, org)

    async def test_an_open_ended_shift_past_the_cushion_is_not_listed(self, db_session):
        org = await _org(db_session)
        # Dated today but started well over the twelve-hour floor ago: kept on
        # the same shift_date so only the cushion decides.
        stale = await _shift(db_session, org, start=NOW - timedelta(hours=20), end=None)

        assert stale.id not in await _candidates(db_session, org)
