"""The quartermaster's review screen must report the stock it can actually issue.

`available_quantity` on this endpoint decides whether the review screen offers
"Approve & fulfill now". Reading the ledger column alone counted units that
`issue_from_pool` refuses, so the button was offered for a fulfilment that
could only fail.
"""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.inventory import list_equipment_requests
from app.models.inventory import EquipmentRequest, ItemCondition, ItemStatus
from app.services.inventory_service import InventoryService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_member(db_session: AsyncSession):
    org_id, user_id = _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :n, 'fire_department', :s, 'UTC')"
        ),
        {"id": org_id, "n": "Review Dept", "s": f"rev-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :o, :u, 'Sam', 'Reyes', :e, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "o": org_id,
            "u": f"sam{user_id[:6]}",
            "e": f"sam{user_id[:6]}@test.com",
        },
    )
    await db_session.flush()
    # A SimpleNamespace rather than the ORM row: the endpoint reads
    # `current_user.positions` to resolve permissions, and on a real User that
    # is an unloaded relationship whose lazy load raises MissingGreenlet inside
    # the async session. With no positions the caller is not a quartermaster,
    # so the list filters to their own requests -- which is what these fixtures
    # create.
    return org_id, SimpleNamespace(
        id=user_id, organization_id=org_id, positions=[], rank=None
    )


async def _pool_item(svc, org_id, user_id, *, quantity):
    cat, _ = await svc.create_category(
        organization_id=uuid.UUID(org_id),
        category_data={"name": "Gloves", "item_type": "ppe"},
        created_by=uuid.UUID(user_id),
    )
    item, err = await svc.create_item(
        organization_id=uuid.UUID(org_id),
        item_data={
            "name": "Structural Gloves",
            "condition": "good",
            "status": "available",
            "tracking_type": "pool",
            "quantity": quantity,
            "category_id": cat.id,
        },
        created_by=uuid.UUID(user_id),
    )
    assert err is None
    return item


async def _request_for(db_session, org_id, user, item, **extra):
    req = EquipmentRequest(
        id=_uid(),
        organization_id=org_id,
        requester_id=str(user.id),
        item_name=item.name,
        item_id=item.id,
        quantity=1,
        requested_duration="temporary",
        **extra,
    )
    db_session.add(req)
    await db_session.flush()
    return req


async def _review_rows(db_session, user):
    response = await list_equipment_requests(
        status_filter=None,
        mine_only=False,
        skip=0,
        limit=50,
        db=db_session,
        current_user=user,
    )
    return response["requests"]


class TestReviewAvailability:

    @pytest.mark.asyncio
    async def test_issuable_stock_is_reported(self, db_session, org_and_member):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        item = await _pool_item(svc, org_id, str(user.id), quantity=9)
        await _request_for(db_session, org_id, user, item)

        rows = await _review_rows(db_session, user)

        assert rows[0]["requested_item"]["available_quantity"] == 9

    @pytest.mark.asyncio
    async def test_quarantined_stock_reports_zero(self, db_session, org_and_member):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        item = await _pool_item(svc, org_id, str(user.id), quantity=9)
        await _request_for(db_session, org_id, user, item)
        item.status = ItemStatus.IN_MAINTENANCE
        await db_session.flush()

        rows = await _review_rows(db_session, user)

        # Nine on the shelf, none of them issuable — so the review screen must
        # not offer to fulfil from them.
        assert rows[0]["requested_item"]["available_quantity"] == 0

    @pytest.mark.asyncio
    async def test_unserviceable_stock_reports_zero(self, db_session, org_and_member):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        item = await _pool_item(svc, org_id, str(user.id), quantity=9)
        await _request_for(db_session, org_id, user, item)
        item.condition = ItemCondition.DAMAGED
        await db_session.flush()

        rows = await _review_rows(db_session, user)

        assert rows[0]["requested_item"]["available_quantity"] == 0

    @pytest.mark.asyncio
    async def test_the_requested_size_reaches_the_reviewer(
        self, db_session, org_and_member
    ):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        item = await _pool_item(svc, org_id, str(user.id), quantity=4)
        item.size = "l"
        await db_session.flush()
        await _request_for(db_session, org_id, user, item, requested_size="l")

        rows = await _review_rows(db_session, user)

        # Both halves: what the member asked for, and what the row on the shelf
        # actually is, so the picker can point at the matching variant.
        assert rows[0]["requested_size"] == "l"
        assert rows[0]["requested_item"]["size"] == "l"
