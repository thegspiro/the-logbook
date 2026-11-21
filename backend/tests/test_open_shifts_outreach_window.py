"""Open Shifts lists outreach signup sheets 60 days ahead, duty shifts 30.

Owner decision, 2026-11-20. An outreach event is booked weeks out behind its
own lead time, so the 30-day default window hid most signup sheets from the
members a coordinator had just asked to staff them; the coordinator's screen
sent them to Open Shifts, and Open Shifts said there was nothing.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.api.v1.endpoints import scheduling
from app.models.training import Shift, ShiftStatus
from app.models.user import Organization
from app.services.scheduling_service import SchedulingService
from tests.clock_support import reread_each_test


def _clock() -> dict[str, Any]:
    """Read as each test starts (tests/clock_support.py), not at import."""
    return {"TODAY": datetime.now(timezone.utc).date()}


(TODAY,) = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Outreach Window FD",
        slug=f"outreach-window-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _shift(db_session, org, days_out: int, *, outreach: bool) -> str:
    day = TODAY + timedelta(days=days_out)
    start = datetime.combine(day, time(18, 0), tzinfo=timezone.utc)
    shift = Shift(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        shift_date=day,
        start_time=start,
        end_time=start + timedelta(hours=2),
        is_finalized=False,
        is_outreach=outreach,
        status=ShiftStatus.SCHEDULED,
    )
    db_session.add(shift)
    await db_session.flush()
    return shift.id


@pytest.mark.integration
class TestTheCandidateWindow:
    async def test_outreach_sheets_reach_further_than_duty_shifts(self, db_session):
        org = await _org(db_session)
        duty_soon = await _shift(db_session, org, 10, outreach=False)
        duty_later = await _shift(db_session, org, 45, outreach=False)
        outreach_later = await _shift(db_session, org, 45, outreach=True)
        outreach_too_far = await _shift(db_session, org, 70, outreach=True)

        shifts = await SchedulingService(db_session)._open_shift_candidates(
            org.id,
            TODAY,
            TODAY + timedelta(days=30),
            outreach_end_date=TODAY + timedelta(days=60),
        )
        found = {s.id for s in shifts}

        assert duty_soon in found
        assert outreach_later in found
        assert duty_later not in found
        assert outreach_too_far not in found

    async def test_without_an_outreach_end_every_shift_keeps_the_window(
        self, db_session
    ):
        org = await _org(db_session)
        outreach_later = await _shift(db_session, org, 45, outreach=True)

        shifts = await SchedulingService(db_session)._open_shift_candidates(
            org.id, TODAY, TODAY + timedelta(days=30)
        )

        assert outreach_later not in {s.id for s in shifts}


@pytest.mark.unit
class TestTheEndpointWindow:
    @staticmethod
    def _patch(monkeypatch, is_manager: bool):
        monkeypatch.setattr(scheduling, "user_has_permission", lambda *_a: is_manager)
        open_shifts = AsyncMock(return_value=[])
        claimable = AsyncMock(return_value=[])
        monkeypatch.setattr(SchedulingService, "get_open_shifts", open_shifts)
        monkeypatch.setattr(SchedulingService, "get_claimable_shifts", claimable)
        monkeypatch.setattr(scheduling, "_enrich_shifts", AsyncMock(return_value=[]))
        return open_shifts if is_manager else claimable

    @pytest.mark.parametrize("is_manager", [True, False])
    async def test_the_default_window_lists_outreach_60_days_out(
        self, monkeypatch, is_manager
    ):
        listed = self._patch(monkeypatch, is_manager)

        await scheduling.get_open_shifts(
            start_date="2027-01-01",
            db=SimpleNamespace(),
            current_user=SimpleNamespace(id="m", organization_id="o"),
        )

        assert listed.await_args.kwargs["outreach_end_date"] == date(2027, 3, 2)
        assert date(2027, 1, 31) in listed.await_args.args

    async def test_a_named_end_date_is_exactly_the_range(self, monkeypatch):
        listed = self._patch(monkeypatch, is_manager=True)

        await scheduling.get_open_shifts(
            start_date="2027-01-01",
            end_date="2027-01-15",
            db=SimpleNamespace(),
            current_user=SimpleNamespace(id="m", organization_id="o"),
        )

        assert listed.await_args.kwargs["outreach_end_date"] is None
