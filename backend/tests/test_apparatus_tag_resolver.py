"""The apparatus QR/NFC tag resolves to the shift actually running (SCHED-18).

It used to take the earliest non-finalized shift dated today, with no time
check and no status filter: on a truck with day and night shifts a tap at 2000
landed on the 0600 shift, and a cancelled shift won over the one that ran.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.training import Shift, ShiftStatus
from app.models.user import Organization
from app.services.scheduling_service import SchedulingService

pytestmark = pytest.mark.integration

NOW = datetime.now(timezone.utc).replace(microsecond=0)


async def _org(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Tag Dept",
        slug=f"tag-{uuid.uuid4().hex[:8]}",
        organization_type="fire_department",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


def _shift(org, apparatus, start, end, **kw):
    return Shift(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        apparatus_id=apparatus,
        shift_date=start.date(),
        start_time=start,
        end_time=end,
        **kw,
    )


async def _resolve(db_session, org, apparatus):
    return await SchedulingService(db_session).get_active_shift_for_apparatus(
        apparatus, org.id
    )


async def test_the_running_shift_wins_over_an_earlier_one_and_a_cancelled_one(
    db_session,
):
    org = await _org(db_session)
    truck = str(uuid.uuid4())
    earlier = _shift(org, truck, NOW - timedelta(hours=12), NOW - timedelta(hours=6))
    running = _shift(org, truck, NOW - timedelta(hours=1), NOW + timedelta(hours=5))
    cancelled = _shift(
        org,
        truck,
        NOW - timedelta(minutes=30),
        NOW + timedelta(hours=6),
        status=ShiftStatus.CANCELLED,
    )
    db_session.add_all([earlier, running, cancelled])
    await db_session.flush()

    assert (await _resolve(db_session, org, truck)).id == running.id


async def test_a_shift_that_just_ended_beats_the_next_one(db_session):
    org = await _org(db_session)
    truck = str(uuid.uuid4())
    ended = _shift(org, truck, NOW - timedelta(hours=9), NOW - timedelta(hours=1))
    upcoming = _shift(org, truck, NOW + timedelta(hours=3), NOW + timedelta(hours=9))
    db_session.add_all([ended, upcoming])
    await db_session.flush()

    assert (await _resolve(db_session, org, truck)).id == ended.id


async def test_with_nothing_running_the_next_shift_is_chosen(db_session):
    org = await _org(db_session)
    truck = str(uuid.uuid4())
    long_over = _shift(org, truck, NOW - timedelta(hours=20), NOW - timedelta(hours=10))
    cancelled_now = _shift(
        org,
        truck,
        NOW - timedelta(hours=1),
        NOW + timedelta(hours=1),
        status=ShiftStatus.CANCELLED,
    )
    later = _shift(org, truck, NOW + timedelta(hours=2), NOW + timedelta(hours=8))
    db_session.add_all([long_over, cancelled_now, later])
    await db_session.flush()

    assert (await _resolve(db_session, org, truck)).id == later.id


async def test_a_finalized_shift_is_never_chosen(db_session):
    org = await _org(db_session)
    truck = str(uuid.uuid4())
    db_session.add(
        _shift(
            org,
            truck,
            NOW - timedelta(hours=1),
            NOW + timedelta(hours=1),
            is_finalized=True,
        )
    )
    await db_session.flush()

    assert await _resolve(db_session, org, truck) is None
