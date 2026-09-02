"""Member-facing shift lists use the same eligibility answer as signup."""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api.v1.endpoints import scheduling
from app.services.scheduling_service import (
    MEMBER_SHIFT_WINDOW_DAYS,
    SchedulingService,
)


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


async def test_member_pagination_happens_after_visibility_filter(monkeypatch, shifts):
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: shifts))
    db = SimpleNamespace(execute=AsyncMock(return_value=result))
    bulk = AsyncMock(return_value={"ordinary": [], "admin": ["support"]})
    monkeypatch.setattr(
        scheduling.ShiftEligibilityService,
        "get_eligible_positions_bulk",
        bulk,
    )
    # SchedulingService imports the same class locally on this path.
    service = SchedulingService(db)
    user = SimpleNamespace(id="member", organization_id="org")

    page, total = await service.get_member_visible_shifts(user, "org", skip=0, limit=1)

    assert page == [shifts[1]]
    assert total == 1


class TestCandidateWindowIsBounded:
    """Eligibility cannot be a WHERE clause, so the date window is the bound.

    Every candidate row has to be fetched before it can be filtered, and the
    officer path on this same endpoint paginates in SQL — so an unbounded
    member request read the organization's whole shift table for one page,
    invisibly to anyone testing as an admin.
    """

    def test_an_open_ended_pair_looks_forward_from_today(self):
        start, end = SchedulingService._bound_shift_window(None, None)

        assert start == date.today()
        assert end - start == timedelta(days=MEMBER_SHIFT_WINDOW_DAYS)

    def test_an_open_end_is_anchored_on_the_start_the_caller_gave(self):
        start, end = SchedulingService._bound_shift_window(date(2026, 3, 1), None)

        assert start == date(2026, 3, 1)
        assert end == date(2026, 3, 1) + timedelta(days=MEMBER_SHIFT_WINDOW_DAYS)

    def test_an_open_start_looks_back_from_the_end(self):
        start, end = SchedulingService._bound_shift_window(None, date(2026, 3, 1))

        assert end == date(2026, 3, 1)
        assert start == date(2026, 3, 1) - timedelta(days=MEMBER_SHIFT_WINDOW_DAYS)

    def test_a_range_inside_the_window_is_left_exactly_as_asked(self):
        given = (date(2026, 3, 1), date(2026, 3, 8))

        assert SchedulingService._bound_shift_window(*given) == given

    def test_an_oversized_range_is_clamped_not_rejected(self):
        # A 400 here would mean a member gets an error where an officer, on
        # the same endpoint, gets a page.
        start, end = SchedulingService._bound_shift_window(
            date(2026, 1, 1), date(2030, 1, 1)
        )

        assert start == date(2026, 1, 1)
        assert end == date(2026, 1, 1) + timedelta(days=MEMBER_SHIFT_WINDOW_DAYS)

    async def test_the_query_carries_both_bounds_when_the_caller_gave_none(
        self, monkeypatch, shifts
    ):
        result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: shifts))
        db = SimpleNamespace(execute=AsyncMock(return_value=result))
        monkeypatch.setattr(
            scheduling.ShiftEligibilityService,
            "get_eligible_positions_bulk",
            AsyncMock(return_value={"ordinary": [], "admin": ["support"]}),
        )
        user = SimpleNamespace(id="member", organization_id="org")

        await SchedulingService(db).get_member_visible_shifts(user, "org")

        bounds = sorted(
            value
            for value in db.execute.await_args[0][0].compile().params.values()
            if isinstance(value, date)
        )

        assert bounds == [
            date.today(),
            date.today() + timedelta(days=MEMBER_SHIFT_WINDOW_DAYS),
        ]


def test_event_resource_seats_preserve_administrative_access():
    slots = SchedulingService.normalize_positions(
        {
            "resources": [
                {
                    "quantity": 1,
                    "positions": [
                        {
                            "position": "support",
                            "required": True,
                            "allow_administrative_members": True,
                        }
                    ],
                }
            ]
        }
    )

    assert slots == [
        {
            "position": "support",
            "required": True,
            "allow_administrative_members": True,
        }
    ]


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
