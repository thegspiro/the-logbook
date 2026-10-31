"""Swap requests report their shifts' start times as UTC instants.

``enrich_swap_requests`` reads the shifts' start times with a column-tuple
``select``, which bypasses the ORM load event that tags naive MySQL datetimes
as UTC. The value went out as ``str(naive)`` — "2026-11-04 13:00:00", with no
offset — and the Requests tab's ``new Date()`` read it as the *browser's*
local time. A 7:00 AM Central shift therefore showed as 3:00 PM to a member
whose browser ran in Los Angeles; only a browser set to UTC saw it right.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import Shift, ShiftSwapRequest, SwapRequestStatus
from app.models.user import Organization
from app.services.scheduling_service import SchedulingService
from tests.test_finance_budget_owners import _user

pytestmark = pytest.mark.integration


async def test_swap_request_start_times_carry_a_utc_offset(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Swap Times VFD",
        slug=f"swap-times-{uuid.uuid4().hex[:8]}",
        timezone="America/Chicago",
    )
    db_session.add(org)
    await db_session.flush()
    requester = await _user(db_session, org.id, "requester", [])
    target = await _user(db_session, org.id, "target", [])

    offering = Shift(
        organization_id=org.id,
        shift_date=date(2026, 11, 4),
        start_time=datetime(2026, 11, 4, 13, 0, tzinfo=timezone.utc),
    )
    wanted = Shift(
        organization_id=org.id,
        shift_date=date(2026, 11, 7),
        start_time=datetime(2026, 11, 7, 13, 0, tzinfo=timezone.utc),
    )
    db_session.add_all([offering, wanted])
    await db_session.flush()

    swap = ShiftSwapRequest(
        organization_id=org.id,
        requesting_user_id=requester.id,
        target_user_id=target.id,
        offering_shift_id=offering.id,
        requesting_shift_id=wanted.id,
        status=SwapRequestStatus.PENDING,
    )
    db_session.add(swap)
    await db_session.flush()

    [enriched] = await SchedulingService(db_session).enrich_swap_requests([swap])

    assert enriched["offering_shift_start_time"] == "2026-11-04T13:00:00+00:00"
    assert enriched["requesting_shift_start_time"] == "2026-11-07T13:00:00+00:00"
