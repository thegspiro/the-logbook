"""Authorization boundaries for member scheduling requests."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.dependencies import PaginationParams
from app.api.v1.endpoints import scheduling as scheduling_ep


def _user(user_id, organization_id):
    return SimpleNamespace(id=user_id, organization_id=organization_id)


def _service():
    service = MagicMock()
    service.get_swap_requests = AsyncMock(return_value=(["organization swap"], 1))
    service.get_swap_requests_for_user = AsyncMock(return_value=(["member swap"], 1))
    service.get_time_off_requests = AsyncMock(return_value=(["organization leave"], 1))
    service.get_time_off_requests_for_user = AsyncMock(
        return_value=(["member leave"], 1)
    )
    service.enrich_swap_requests = AsyncMock(side_effect=lambda records: records)
    service.enrich_time_off_requests = AsyncMock(side_effect=lambda records: records)
    return service


@pytest.mark.asyncio
async def test_member_lists_are_forced_to_authenticated_identity():
    """An ordinary member cannot broaden either list with query parameters."""
    org_id, member_id, supplied_id = uuid4(), uuid4(), uuid4()
    service = _service()
    with (
        patch.object(scheduling_ep, "SchedulingService", return_value=service),
        patch.object(scheduling_ep, "user_has_permission", return_value=False),
    ):
        swaps = await scheduling_ep.list_swap_requests(
            status_filter=None,
            pagination=PaginationParams(0, 100),
            db=MagicMock(),
            current_user=_user(member_id, org_id),
        )
        leave = await scheduling_ep.list_time_off_requests(
            status_filter=None,
            user_id=supplied_id,
            pagination=PaginationParams(0, 100),
            db=MagicMock(),
            current_user=_user(member_id, org_id),
        )

    assert swaps == {
        "items": ["member swap"],
        "total": 1,
        "skip": 0,
        "limit": 100,
    }
    service.get_swap_requests_for_user.assert_awaited_once_with(
        org_id, member_id, status=None, skip=0, limit=100
    )
    assert leave == {
        "items": ["member leave"],
        "total": 1,
        "skip": 0,
        "limit": 100,
    }
    service.get_time_off_requests_for_user.assert_awaited_once_with(
        org_id, member_id, status=None, skip=0, limit=100
    )
    service.get_time_off_requests.assert_not_awaited()


@pytest.mark.asyncio
async def test_manager_lists_use_organization_review_queue():
    org_id, manager_id = uuid4(), uuid4()
    service = _service()
    with (
        patch.object(scheduling_ep, "SchedulingService", return_value=service),
        patch.object(scheduling_ep, "user_has_permission", return_value=True),
    ):
        swaps = await scheduling_ep.list_swap_requests(
            status_filter=None,
            pagination=PaginationParams(0, 100),
            db=MagicMock(),
            current_user=_user(manager_id, org_id),
        )
        leave = await scheduling_ep.list_time_off_requests(
            status_filter=None,
            pagination=PaginationParams(0, 100),
            db=MagicMock(),
            current_user=_user(manager_id, org_id),
        )

    assert swaps == {
        "items": ["organization swap"],
        "total": 1,
        "skip": 0,
        "limit": 100,
    }
    assert leave == {
        "items": ["organization leave"],
        "total": 1,
        "skip": 0,
        "limit": 100,
    }
    service.get_swap_requests.assert_awaited_once()
    service.get_time_off_requests.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("relationship", ["requester", "target"])
async def test_swap_requester_and_target_can_read_by_id(relationship):
    org_id, member_id, request_id = uuid4(), uuid4(), uuid4()
    record = SimpleNamespace(id=request_id)
    service = _service()
    service.get_swap_request_for_user_by_id = AsyncMock(return_value=record)
    with (
        patch.object(scheduling_ep, "SchedulingService", return_value=service),
        patch.object(scheduling_ep, "user_has_permission", return_value=False),
    ):
        result = await scheduling_ep.get_swap_request(
            request_id, db=MagicMock(), current_user=_user(member_id, org_id)
        )
    assert result is record
    service.get_swap_request_for_user_by_id.assert_awaited_once_with(
        request_id, org_id, member_id
    )


@pytest.mark.asyncio
async def test_unrelated_member_cannot_read_requests_by_id():
    org_id, unrelated_id = uuid4(), uuid4()
    service = _service()
    service.get_swap_request_for_user_by_id = AsyncMock(return_value=None)
    service.get_time_off_for_user_by_id = AsyncMock(return_value=None)
    with (
        patch.object(scheduling_ep, "SchedulingService", return_value=service),
        patch.object(scheduling_ep, "user_has_permission", return_value=False),
    ):
        with pytest.raises(HTTPException) as swap_error:
            await scheduling_ep.get_swap_request(
                uuid4(), db=MagicMock(), current_user=_user(unrelated_id, org_id)
            )
        with pytest.raises(HTTPException) as leave_error:
            await scheduling_ep.get_time_off_request(
                uuid4(), db=MagicMock(), current_user=_user(unrelated_id, org_id)
            )
    assert swap_error.value.status_code == 404
    assert leave_error.value.status_code == 404


@pytest.mark.asyncio
async def test_manager_can_read_any_organization_request_by_id():
    org_id, manager_id = uuid4(), uuid4()
    swap, leave = SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())
    service = _service()
    service.get_swap_request_by_id = AsyncMock(return_value=swap)
    service.get_time_off_by_id = AsyncMock(return_value=leave)
    with (
        patch.object(scheduling_ep, "SchedulingService", return_value=service),
        patch.object(scheduling_ep, "user_has_permission", return_value=True),
    ):
        assert (
            await scheduling_ep.get_swap_request(
                swap.id, db=MagicMock(), current_user=_user(manager_id, org_id)
            )
            is swap
        )
        assert (
            await scheduling_ep.get_time_off_request(
                leave.id, db=MagicMock(), current_user=_user(manager_id, org_id)
            )
            is leave
        )
