"""Member-facing shift lists use the same eligibility answer as signup."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api.v1.endpoints import scheduling


@pytest.fixture
def shifts():
    return [SimpleNamespace(id="ordinary"), SimpleNamespace(id="admin")]


async def test_member_list_omits_shifts_without_eligible_positions(monkeypatch, shifts):
    monkeypatch.setattr(scheduling, "user_has_permission", lambda *_args: False)
    bulk = AsyncMock(return_value={"ordinary": [], "admin": ["support"]})
    monkeypatch.setattr(
        scheduling.ShiftEligibilityService,
        "get_eligible_positions_bulk",
        bulk,
    )
    user = SimpleNamespace(id="member", organization_id="org")
    service = SimpleNamespace(db=object())

    visible = await scheduling._member_visible_shifts(service, user, shifts)

    assert visible == [shifts[1]]


async def test_scheduling_manager_retains_complete_schedule(monkeypatch, shifts):
    monkeypatch.setattr(scheduling, "user_has_permission", lambda *_args: True)
    bulk = AsyncMock(side_effect=AssertionError("manager eligibility must not run"))
    monkeypatch.setattr(
        scheduling.ShiftEligibilityService,
        "get_eligible_positions_bulk",
        bulk,
    )
    user = SimpleNamespace(id="manager", organization_id="org")
    service = SimpleNamespace(db=object())

    assert await scheduling._member_visible_shifts(service, user, shifts) == shifts
    bulk.assert_not_awaited()


async def test_direct_detail_refuses_ineligible_member(monkeypatch):
    monkeypatch.setattr(scheduling, "user_has_permission", lambda *_args: False)
    monkeypatch.setattr(
        scheduling.ShiftEligibilityService,
        "get_eligible_positions",
        AsyncMock(return_value=[]),
    )
    user = SimpleNamespace(id="member", organization_id="org")

    with pytest.raises(scheduling.HTTPException) as exc:
        await scheduling._ensure_member_can_view_shift(
            SimpleNamespace(db=object()), user, SimpleNamespace(id="ordinary")
        )

    assert exc.value.status_code == 403
