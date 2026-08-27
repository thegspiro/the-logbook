"""Physical return receipt workflow: evidence, inventory state and follow-ups."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.inventory import (
    InventoryItem,
    ItemAssignment,
    ItemCondition,
    ItemIssuance,
    ItemStatus,
    ReturnRequest,
    ReturnRequestStatus,
    ReturnRequestType,
    TrackingType,
)
from app.services.inventory_service import InventoryService


def result(value):
    row = MagicMock()
    row.scalar_one_or_none.return_value = value
    return row


def request(kind=ReturnRequestType.ASSIGNMENT, quantity=1):
    user, item_id, holding_id = str(uuid4()), str(uuid4()), str(uuid4())
    req = ReturnRequest(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        requester_id=user,
        return_type=kind,
        item_id=item_id,
        item_name="Helmet",
        quantity_returning=quantity,
        reported_condition=ItemCondition.GOOD,
        status=ReturnRequestStatus.REQUESTED,
    )
    if kind == ReturnRequestType.ASSIGNMENT:
        req.assignment_id = holding_id
    else:
        req.issuance_id = holding_id
    return req


def service_with(*rows):
    db = AsyncMock()
    db.execute.side_effect = [result(row) for row in rows]
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.flush = AsyncMock()
    return InventoryService(db), db


@pytest.mark.asyncio
async def test_physical_receipt_closes_assignment_and_makes_good_item_available():
    req = request()
    item = InventoryItem(
        id=req.item_id,
        organization_id=req.organization_id,
        name="Helmet",
        tracking_type=TrackingType.INDIVIDUAL,
        barcode="BC-100",
        condition=ItemCondition.GOOD,
        status=ItemStatus.ASSIGNED,
        assigned_to_user_id=req.requester_id,
    )
    hold = ItemAssignment(
        id=req.assignment_id,
        organization_id=req.organization_id,
        item_id=req.item_id,
        user_id=req.requester_id,
        is_active=True,
    )
    svc, db = service_with(req, item, hold)
    ok, error = await svc.review_return_request(
        uuid4(),
        uuid4(),
        uuid4(),
        "received",
        observed_condition="good",
        verified_identifier="BC-100",
    )
    assert (ok, error) == (True, None)
    assert hold.is_active is False
    assert item.status == ItemStatus.AVAILABLE
    assert req.status == ReturnRequestStatus.COMPLETED
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_condition_disagreement_preserves_member_report_and_records_observation():
    req = request()
    item = InventoryItem(
        id=req.item_id,
        organization_id=req.organization_id,
        name="Helmet",
        tracking_type=TrackingType.INDIVIDUAL,
        asset_tag="A-7",
        condition=ItemCondition.GOOD,
        status=ItemStatus.ASSIGNED,
        assigned_to_user_id=req.requester_id,
    )
    hold = ItemAssignment(
        id=req.assignment_id,
        organization_id=req.organization_id,
        item_id=req.item_id,
        user_id=req.requester_id,
        is_active=True,
    )
    svc, _ = service_with(req, item, hold)
    ok, _ = await svc.review_return_request(
        uuid4(),
        uuid4(),
        uuid4(),
        "received",
        observed_condition="fair",
        verified_identifier="A-7",
    )
    assert ok
    assert req.reported_condition == ItemCondition.GOOD
    assert req.observed_condition == ItemCondition.FAIR


@pytest.mark.asyncio
async def test_damaged_gear_creates_follow_up_and_is_not_available():
    req = request()
    item = InventoryItem(
        id=req.item_id,
        organization_id=req.organization_id,
        name="Helmet",
        tracking_type=TrackingType.INDIVIDUAL,
        serial_number="SN-9",
        condition=ItemCondition.GOOD,
        status=ItemStatus.ASSIGNED,
        assigned_to_user_id=req.requester_id,
    )
    hold = ItemAssignment(
        id=req.assignment_id,
        organization_id=req.organization_id,
        item_id=req.item_id,
        user_id=req.requester_id,
        is_active=True,
    )
    svc, db = service_with(req, item, hold)
    ok, _ = await svc.review_return_request(
        uuid4(),
        uuid4(),
        uuid4(),
        "received",
        observed_condition="damaged",
        verified_identifier="SN-9",
        follow_up="auto",
    )
    assert ok
    assert item.status == ItemStatus.IN_MAINTENANCE
    assert req.follow_up_type == "maintenance"
    assert db.add.call_count == 1


@pytest.mark.asyncio
async def test_serialized_item_mismatch_rejects_receipt_without_commit():
    req = request()
    item = InventoryItem(
        id=req.item_id,
        organization_id=req.organization_id,
        name="Helmet",
        tracking_type=TrackingType.INDIVIDUAL,
        barcode="RIGHT",
    )
    svc, db = service_with(req, item)
    ok, error = await svc.review_return_request(
        uuid4(),
        uuid4(),
        uuid4(),
        "received",
        observed_condition="good",
        verified_identifier="WRONG",
    )
    assert not ok
    assert "does not match" in error
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_partial_pool_return_reduces_open_holding_and_validates_quantity():
    req = request(ReturnRequestType.ISSUANCE, quantity=2)
    item = InventoryItem(
        id=req.item_id,
        organization_id=req.organization_id,
        name="Gloves",
        tracking_type=TrackingType.POOL,
        quantity=3,
        quantity_issued=5,
        condition=ItemCondition.GOOD,
    )
    issuance = ItemIssuance(
        id=req.issuance_id,
        organization_id=req.organization_id,
        item_id=req.item_id,
        user_id=req.requester_id,
        quantity_issued=5,
        is_returned=False,
    )
    svc, _ = service_with(req, item, issuance)
    ok, _ = await svc.review_return_request(
        uuid4(),
        uuid4(),
        uuid4(),
        "received",
        observed_condition="good",
        received_quantity=2,
    )
    assert ok
    assert issuance.is_returned is False
    assert issuance.quantity_issued == 3
    assert item.quantity == 5
    assert item.quantity_issued == 3
