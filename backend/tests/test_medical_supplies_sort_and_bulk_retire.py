"""
Medical Supplies: sorting the list, and retiring several supplies at once.

The list is paged on the server, so its sort has to be the server's too. Two
of the new sort keys are computed rather than read off a column: ``category``
orders by the category's name, and ``on_hand`` by the number the list shows —
the in-date lot total for a lot-stocked supply, not the stale ``quantity``
column. Those are exercised against the database.

Bulk retire runs each item through ``retire_item`` on its own, so a supply
that cannot be retired is reported while the rest still are.
"""

import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints import medical_supplies as ms
from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    InventoryLot,
    ItemType,
    TrackingType,
)
from app.models.user import Organization
from app.schemas.inventory import ItemBulkRetireRequest
from app.services.inventory_service import InventoryService
from app.utils.org_timezone import org_today

ORG = "org-1"
A = "11111111-1111-1111-1111-111111111111"
B = "22222222-2222-2222-2222-222222222222"
GEAR = "33333333-3333-3333-3333-333333333333"


def _user():
    user = MagicMock()
    user.id = "u-1"
    user.username = "supply"
    user.organization_id = ORG
    return user


@pytest.fixture
def svc():
    service = AsyncMock()
    service.items_in_domain = AsyncMock(
        side_effect=lambda ids, org, types: {i for i in ids if i in {A, B}}
    )
    service.retire_item = AsyncMock(return_value=(True, None))
    with patch.object(ms, "InventoryService", return_value=service), patch.object(
        ms, "log_audit_event", new=AsyncMock()
    ) as audit:
        service.audit = audit
        yield service


async def _bulk_retire(*ids: str, notes=None):
    return await ms.bulk_retire_medical_items(
        ItemBulkRetireRequest(item_ids=list(ids), notes=notes),
        db=AsyncMock(),
        current_user=_user(),
    )


@pytest.mark.unit
class TestBulkRetire:
    async def test_every_medical_item_is_retired_under_the_domain_lock(self, svc):
        result = await _bulk_retire(A, B, notes="Expired stock")

        assert result.retired == [A, B]
        assert result.failed == []
        for call in svc.retire_item.await_args_list:
            assert call.kwargs["required_item_types"] == MEDICAL_ITEM_TYPES
            assert call.kwargs["notes"] == "Expired stock"

    async def test_a_gear_item_is_not_found_and_never_retired(self, svc):
        result = await _bulk_retire(A, GEAR)

        assert result.retired == [A]
        assert [(f.item_id, f.error) for f in result.failed] == [(GEAR, ms._NOT_FOUND)]
        retired_ids = [
            str(c.kwargs["item_id"]) for c in svc.retire_item.await_args_list
        ]
        assert retired_ids == [A]

    async def test_a_blocked_item_is_reported_and_the_rest_still_retire(self, svc):
        blocked = "Cannot retire: item is currently assigned. Unassign it first."
        svc.retire_item = AsyncMock(
            side_effect=lambda **kw: (
                (False, blocked) if str(kw["item_id"]) == A else (True, None)
            )
        )

        result = await _bulk_retire(A, B)

        assert result.retired == [B]
        assert [(f.item_id, f.error) for f in result.failed] == [(A, blocked)]

    async def test_an_item_that_left_the_domain_under_the_lock_reads_not_found(
        self, svc
    ):
        svc.retire_item = AsyncMock(return_value=(False, "Item not found"))

        result = await _bulk_retire(A)

        assert result.failed[0].error == ms._NOT_FOUND

    async def test_a_repeated_id_is_retired_once(self, svc):
        result = await _bulk_retire(A, A)

        assert result.retired == [A]
        assert svc.retire_item.await_count == 1

    async def test_retired_items_are_audited_together(self, svc):
        await _bulk_retire(A, GEAR)

        kwargs = svc.audit.await_args.kwargs
        assert kwargs["event_type"] == "medical_items_bulk_retired"
        assert kwargs["event_data"] == {"item_ids": [A], "failed": 1}

    async def test_nothing_retired_writes_no_audit_event(self, svc):
        await _bulk_retire(GEAR)

        svc.audit.assert_not_awaited()

    def test_an_empty_or_oversized_selection_is_rejected(self):
        with pytest.raises(ValidationError, match="at least 1"):
            ItemBulkRetireRequest(item_ids=[])
        with pytest.raises(ValidationError, match="at most 200"):
            ItemBulkRetireRequest(item_ids=[str(uuid.uuid4()) for _ in range(201)])


@pytest.mark.integration
class TestListSorting:
    @pytest.fixture
    async def catalog(self, db_session):
        org = Organization(name="Sort FD", slug=f"sort-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()

        def category(name):
            row = InventoryCategory(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name=name,
                item_type=ItemType.MEDICAL,
            )
            db_session.add(row)
            return row

        airway, trauma = category("Airway"), category("Trauma")
        await db_session.flush()

        def item(name, cat, quantity, reorder_point=None):
            row = InventoryItem(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                category_id=cat.id,
                name=name,
                tracking_type=TrackingType.POOL,
                quantity=quantity,
                reorder_point=reorder_point,
                active=True,
            )
            db_session.add(row)
            return row

        items = {
            "gauze": item("Gauze", trauma, 50, reorder_point=10),
            # Lot-stocked: a stale column of 1, but 30 in in-date lots.
            "mask": item("Mask", airway, 1),
            # Lot-stocked with only expired lots: 0 ready, whatever the column.
            "cannula": item("Cannula", airway, 99, reorder_point=5),
        }
        await db_session.flush()
        # The department's date, not the runner's: the service decides a lot is
        # expired against org_today, and for the first hours of each UTC day the
        # two disagree -- the "expired yesterday" lot would still be in date.
        today = org_today(org)
        for item_key, quantity, expires in (
            ("mask", 20, today + timedelta(days=90)),
            ("mask", 10, None),
            ("cannula", 40, today - timedelta(days=1)),
        ):
            db_session.add(
                InventoryLot(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    inventory_item_id=items[item_key].id,
                    quantity=quantity,
                    expiration_date=expires,
                )
            )
        await db_session.flush()
        return org, items

    async def _names(self, db_session, org, sort_by, sort_order="asc"):
        rows, _total = await InventoryService(db_session).get_items(
            organization_id=org.id,
            item_types=MEDICAL_ITEM_TYPES,
            sort_by=sort_by,
            sort_order=sort_order,
        )
        return [row.name for row in rows]

    async def test_on_hand_sorts_by_the_stock_the_list_shows(self, db_session, catalog):
        org, _ = catalog

        assert await self._names(db_session, org, "on_hand") == [
            "Cannula",  # 0: its only lot has expired
            "Mask",  # 30 across two in-date lots
            "Gauze",  # 50 in the column, no lots
        ]
        assert await self._names(db_session, org, "on_hand", "desc") == [
            "Gauze",
            "Mask",
            "Cannula",
        ]

    async def test_category_sorts_by_the_category_name(self, db_session, catalog):
        org, _ = catalog

        assert await self._names(db_session, org, "category") == [
            "Cannula",
            "Mask",
            "Gauze",
        ]
        assert (await self._names(db_session, org, "category", "desc"))[0] == "Gauze"

    async def test_supplies_without_a_reorder_point_sort_last_both_ways(
        self, db_session, catalog
    ):
        org, _ = catalog

        assert await self._names(db_session, org, "reorder_point") == [
            "Cannula",
            "Gauze",
            "Mask",
        ]
        assert await self._names(db_session, org, "reorder_point", "desc") == [
            "Gauze",
            "Cannula",
            "Mask",
        ]

    async def test_an_unknown_sort_still_sorts_by_name(self, db_session, catalog):
        org, _ = catalog

        assert await self._names(db_session, org, "bogus") == [
            "Cannula",
            "Gauze",
            "Mask",
        ]
