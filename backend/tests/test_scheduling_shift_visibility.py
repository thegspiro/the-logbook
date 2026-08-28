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


@pytest.mark.parametrize(
    ("endpoint", "service_method", "endpoint_kwargs"),
    [
        (scheduling.get_week_calendar, "get_week_shifts", {"week_start": "2026-08-24"}),
        (
            scheduling.get_month_calendar,
            "get_month_shifts",
            {"year": 2026, "month": 8},
        ),
    ],
)
async def test_calendar_filters_before_enriching(
    monkeypatch, shifts, endpoint, service_method, endpoint_kwargs
):
    service = SimpleNamespace()
    setattr(service, service_method, AsyncMock(return_value=shifts))
    monkeypatch.setattr(scheduling, "SchedulingService", lambda _db: service)
    visible = AsyncMock(return_value=[shifts[1]])
    enrich = AsyncMock(return_value=[{"id": "admin"}])
    monkeypatch.setattr(scheduling, "_member_visible_shifts", visible)
    monkeypatch.setattr(scheduling, "_enrich_shifts", enrich)
    user = SimpleNamespace(id="member", organization_id="org")

    result = await endpoint(db=object(), current_user=user, **endpoint_kwargs)

    assert result == [{"id": "admin"}]
    visible.assert_awaited_once_with(service, user, shifts)
    enrich.assert_awaited_once_with(service, "org", [shifts[1]])


async def test_direct_detail_refuses_ineligible_member(monkeypatch):
    monkeypatch.setattr(scheduling, "user_has_permission", lambda *_args: False)
    monkeypatch.setattr(
        scheduling.ShiftEligibilityService,
        "get_eligible_positions",
        AsyncMock(return_value=[]),
    )
    user = SimpleNamespace(id="member", organization_id="org")
    assignment_result = SimpleNamespace(scalar_one_or_none=lambda: None)
    service = SimpleNamespace(
        db=SimpleNamespace(execute=AsyncMock(return_value=assignment_result))
    )

    with pytest.raises(scheduling.HTTPException) as exc:
        await scheduling._ensure_member_can_view_shift(
            service,
            user,
            SimpleNamespace(id="ordinary", shift_officer_id=None),
        )

    assert exc.value.status_code == 403


async def test_direct_detail_preserves_assignee_visibility(monkeypatch):
    monkeypatch.setattr(scheduling, "user_has_permission", lambda *_args: False)
    eligibility = AsyncMock(
        side_effect=AssertionError("assignee eligibility must not run")
    )
    monkeypatch.setattr(
        scheduling.ShiftEligibilityService, "get_eligible_positions", eligibility
    )
    assignment_result = SimpleNamespace(scalar_one_or_none=lambda: "assignment")
    service = SimpleNamespace(
        db=SimpleNamespace(execute=AsyncMock(return_value=assignment_result))
    )
    user = SimpleNamespace(id="member", organization_id="org")

    await scheduling._ensure_member_can_view_shift(
        service, user, SimpleNamespace(id="ordinary", shift_officer_id=None)
    )

    eligibility.assert_not_awaited()


async def test_direct_detail_preserves_shift_officer_visibility(monkeypatch):
    monkeypatch.setattr(scheduling, "user_has_permission", lambda *_args: False)
    service = SimpleNamespace(db=SimpleNamespace(execute=AsyncMock()))
    user = SimpleNamespace(id="officer", organization_id="org")

    await scheduling._ensure_member_can_view_shift(
        service, user, SimpleNamespace(id="ordinary", shift_officer_id="officer")
    )

    service.db.execute.assert_not_awaited()
