"""`get_inventory_summary`'s maintenance-due figure must be a COUNT, not a
materialized `.all()` -- the same unbounded-scan shape this rotation already
flagged as INV-22 on `get_fulfillment_options`/`get_requestable_categories`,
but this one *is* cheaply fixable: `get_maintenance_due` was only ever asked
for `len()` of its result here, never the rows themselves.

Reached from a normal HTTP call (`GET /inventory/summary`, the dashboard
widget) and, unauthenticated to any extra gate, the `get_inventory_summary`
MCP tool -- so an inventory manager (or MCP key) triggers an org-wide
`InventoryItem` row materialization on every summary read, purely to compute
one integer.

Two things are pinned:
  * source-inspection, so a future edit that reintroduces the `.all()` scan
    (e.g. "simplify" by calling `get_maintenance_due` again) fails immediately;
  * a real-database correctness check, since a COUNT query has to reproduce
    the exact same filters (org, active, cutoff, `exclude_item_types`) the
    list-based version applied in Python -- getting the domain exclusion
    wrong here would silently overcount or undercount the dashboard figure.
"""

import inspect
import uuid
from datetime import date, timedelta

import pytest

from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    ItemType,
    TrackingType,
)
from app.models.user import Organization
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


def test_get_inventory_summary_does_not_materialize_every_due_item():
    """Regression guard: the maintenance-due figure must come from a COUNT
    query, not `len(await self.get_maintenance_due(...))` -- the latter loads
    every due item in the organization merely to discard everything but its
    length."""
    source = inspect.getsource(InventoryService.get_inventory_summary)
    assert "get_maintenance_due(" not in source, (
        "get_inventory_summary must not call get_maintenance_due() -- that "
        "materializes every due item with .all() merely to compute a count "
        "(the INV-22 shape). Use a bounded COUNT(*) query instead."
    )
    assert "func.count(InventoryItem.id)" in source


async def _org(db, name="Maint Due FD"):
    org = Organization(name=name, slug=f"maintdue-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _category(db, org, item_type: ItemType) -> InventoryCategory:
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"{item_type.value}-{uuid.uuid4().hex[:6]}",
        item_type=item_type,
    )
    db.add(category)
    await db.flush()
    return category


async def _item(db, org, category=None, *, next_inspection_due=None, active=True):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        category_id=category.id if category else None,
        name=f"item-{uuid.uuid4().hex[:6]}",
        tracking_type=TrackingType.POOL,
        quantity=1,
        active=active,
        next_inspection_due=next_inspection_due,
    )
    db.add(item)
    await db.flush()
    return item


async def test_counts_only_items_due_within_the_window(db_session):
    org = await _org(db_session)
    # Only the first of these three should be counted -- the other two exist
    # purely to prove they are excluded (not due for 60 days; never
    # inspected at all).
    await _item(db_session, org, next_inspection_due=date.today() + timedelta(days=1))
    await _item(db_session, org, next_inspection_due=date.today() + timedelta(days=60))
    await _item(db_session, org, next_inspection_due=None)

    summary = await InventoryService(db_session).get_inventory_summary(org.id)

    assert summary["maintenance_due_count"] == 1


async def test_excludes_inactive_items(db_session):
    org = await _org(db_session)
    await _item(
        db_session,
        org,
        next_inspection_due=date.today(),
        active=False,
    )

    summary = await InventoryService(db_session).get_inventory_summary(org.id)

    assert summary["maintenance_due_count"] == 0


async def test_exclude_item_types_carves_out_the_domain(db_session):
    """The dashboard/MCP summary excludes medical stock from every figure --
    the maintenance-due COUNT must apply the same `_outside_domains` filter
    `item_filters` uses for total_items/items_by_status/etc, not just count
    everything due org-wide."""
    org = await _org(db_session)
    medical = await _category(db_session, org, ItemType.MEDICAL)
    ppe = await _category(db_session, org, ItemType.PPE)
    await _item(db_session, org, medical, next_inspection_due=date.today())
    await _item(db_session, org, ppe, next_inspection_due=date.today())

    summary = await InventoryService(db_session).get_inventory_summary(
        org.id, exclude_item_types=MEDICAL_ITEM_TYPES
    )

    assert summary["maintenance_due_count"] == 1
