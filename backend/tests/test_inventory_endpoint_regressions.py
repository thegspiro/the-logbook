"""DB-free regression tests for inventory endpoint query/response behavior."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints.inventory import (
    _build_checkout_response,
    list_equipment_requests,
    list_storage_areas,
)
from app.models.inventory import EquipmentKitItem, StorageArea, StorageLocationType
from app.services.inventory_service import InventoryService


def _rows(values):
    result = MagicMock()
    result.scalars.return_value.all.return_value = values
    result.all.return_value = []
    return result


def _storage_area(org_id: str, name: str, *, parent_id=None, location_id=None):
    return StorageArea(
        id=str(uuid4()),
        organization_id=org_id,
        name=name,
        storage_type=StorageLocationType.CABINET,
        parent_id=parent_id,
        location_id=location_id,
        sort_order=0,
        is_active=True,
    )


@pytest.mark.asyncio
async def test_storage_area_tree_uses_filtered_query_results():
    org_id = str(uuid4())
    location_id = str(uuid4())
    root = _storage_area(org_id, "Station cabinet", location_id=location_id)
    child = _storage_area(
        org_id,
        "Top shelf",
        parent_id=root.id,
        location_id=location_id,
    )

    db = AsyncMock()
    db.execute.side_effect = [_rows([]), _rows([]), _rows([root, child])]
    user = SimpleNamespace(organization_id=org_id)

    response = await list_storage_areas(
        location_id=location_id,
        parent_id=None,
        flat=False,
        db=db,
        current_user=user,
    )

    assert [area["name"] for area in response] == ["Station cabinet"]
    assert [area["name"] for area in response[0]["children"]] == ["Top shelf"]
    # Counts, location names, and one filtered area query: there is no second,
    # unfiltered reload that can replace the requested result set.
    assert db.execute.await_count == 3
    area_query = str(db.execute.await_args_list[-1].args[0])
    assert "storage_areas.location_id" in area_query


@pytest.mark.asyncio
async def test_equipment_request_total_is_count_before_pagination():
    count_result = MagicMock()
    count_result.scalar_one.return_value = 137
    db = AsyncMock()
    db.execute.side_effect = [count_result, _rows([])]
    user = SimpleNamespace(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        positions=[],
        rank=None,
    )

    response = await list_equipment_requests(
        status_filter="pending",
        mine_only=True,
        skip=50,
        limit=25,
        db=db,
        current_user=user,
    )

    assert response == {
        "requests": [],
        "total": 137,
        "skip": 50,
        "limit": 25,
    }
    assert db.execute.await_count == 2


@pytest.mark.asyncio
async def test_equipment_kit_persists_optional_line_flag():
    db = AsyncMock()
    db.add = MagicMock()
    service = InventoryService(db)

    kit, error = await service.create_equipment_kit(
        organization_id=uuid4(),
        created_by=uuid4(),
        data={
            "name": "Recruit kit",
            "line_items": [
                {
                    "item_name": "Optional cap",
                    "quantity": 1,
                    "optional": True,
                }
            ],
        },
    )

    assert error is None
    assert kit is not None
    line_items = [
        call.args[0]
        for call in db.add.call_args_list
        if isinstance(call.args[0], EquipmentKitItem)
    ]
    assert len(line_items) == 1
    assert line_items[0].optional is True


def _checkout(*, due, is_returned=False, is_overdue=False):
    return SimpleNamespace(
        id=str(uuid4()),
        item_id=str(uuid4()),
        item=SimpleNamespace(name="Gas Meter"),
        user_id=str(uuid4()),
        user=SimpleNamespace(first_name="Nadia", last_name="Belhaj"),
        checked_out_at=datetime(2026, 8, 12, tzinfo=timezone.utc),
        expected_return_at=due,
        is_returned=is_returned,
        is_overdue=is_overdue,
        checkout_reason="CO investigation",
    )


def test_checkout_response_reports_a_past_due_loan_as_overdue():
    """The Active tab must not badge a late loan green.

    ``is_overdue`` is only written by a daily task, so a checkout that fell due
    an hour ago still has the column set False while the Overdue tab — which
    compares the due date live — already lists it.
    """
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)

    body = _build_checkout_response(_checkout(due=yesterday, is_overdue=False))

    assert body["is_overdue"] is True


def test_checkout_response_leaves_a_loan_due_later_alone():
    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)

    body = _build_checkout_response(_checkout(due=tomorrow, is_overdue=False))

    assert body["is_overdue"] is False


def test_checkout_response_treats_a_naive_due_date_as_utc():
    """MySQL hands back naive datetimes; comparing them raw would raise."""
    naive_yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).replace(
        tzinfo=None
    )

    body = _build_checkout_response(_checkout(due=naive_yesterday))

    assert body["is_overdue"] is True


def test_checkout_response_falls_back_to_the_stored_flag_without_a_due_date():
    body = _build_checkout_response(_checkout(due=None, is_overdue=True))

    assert body["is_overdue"] is True


def test_checkout_response_never_calls_a_returned_loan_overdue():
    """Returning it late does not leave it outstanding."""
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)

    body = _build_checkout_response(
        _checkout(due=yesterday, is_returned=True, is_overdue=False)
    )

    assert body["is_overdue"] is False
