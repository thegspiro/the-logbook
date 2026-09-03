"""`/inventory/summary` reports a per-domain breakdown for the admin hub.

The hub's supply-line cards (PPE, Uniforms) link straight into
``GET /items?item_type=...``. That endpoint reports *rows* and excludes the
medical domain, so the number on the card has to be counted the same way — a
card reading 12 that opens a list of 9 is indistinguishable from a bug.

Three things are pinned here, each of which was a live decision:

  * the count is per ``InventoryCategory.item_type``, not per item column
    (items carry no type of their own);
  * medical is excluded, matching the list endpoint, because EMS stock is
    gated on ``inventory.view_medical`` and this response is not;
  * the member branch leaves the mapping empty rather than absent — the field
    is defaulted precisely so ``get_user_inventory_summary`` keeps validating.
"""

import uuid

import pytest

from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ItemType,
    TrackingType,
)
from app.models.user import Organization, User
from app.schemas.inventory import InventorySummary
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org(db, name="Domain FD"):
    org = Organization(name=name, slug=f"domain-{uuid.uuid4().hex[:8]}")
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


async def _item(db, org, category=None, *, quantity=1, active=True):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        category_id=category.id if category else None,
        name=f"item-{uuid.uuid4().hex[:6]}",
        tracking_type=TrackingType.POOL,
        quantity=quantity,
        active=active,
    )
    db.add(item)
    await db.flush()
    return item


async def test_counts_items_by_category_domain(db_session):
    org = await _org(db_session)
    ppe = await _category(db_session, org, ItemType.PPE)
    uniform = await _category(db_session, org, ItemType.UNIFORM)

    await _item(db_session, org, ppe)
    await _item(db_session, org, ppe)
    await _item(db_session, org, uniform)

    summary = await InventoryService(db_session).get_inventory_summary(org.id)

    assert summary["items_by_type"] == {"ppe": 2, "uniform": 1}


async def test_counts_rows_not_quantities(db_session):
    """Unlike `total_items`, which sums quantities.

    The card carrying this number links to a list that reports rows; matching
    that is the whole point of counting separately.
    """
    org = await _org(db_session)
    uniform = await _category(db_session, org, ItemType.UNIFORM)
    await _item(db_session, org, uniform, quantity=40)

    summary = await InventoryService(db_session).get_inventory_summary(org.id)

    assert summary["items_by_type"] == {"uniform": 1}
    assert summary["total_items"] == 40


async def test_excludes_the_medical_domain(db_session):
    org = await _org(db_session)
    medical = await _category(db_session, org, ItemType.MEDICAL)
    ppe = await _category(db_session, org, ItemType.PPE)
    await _item(db_session, org, medical)
    await _item(db_session, org, ppe)

    summary = await InventoryService(db_session).get_inventory_summary(org.id)

    assert "medical" not in summary["items_by_type"]
    assert summary["items_by_type"] == {"ppe": 1}


async def test_omits_retired_and_uncategorized_items(db_session):
    org = await _org(db_session)
    ppe = await _category(db_session, org, ItemType.PPE)
    await _item(db_session, org, ppe)
    await _item(db_session, org, ppe, active=False)
    # No category, so no domain — it belongs in no bucket rather than a
    # made-up one.
    await _item(db_session, org, None)

    summary = await InventoryService(db_session).get_inventory_summary(org.id)

    assert summary["items_by_type"] == {"ppe": 1}


async def test_does_not_count_another_organizations_items(db_session):
    mine = await _org(db_session, "Mine FD")
    theirs = await _org(db_session, "Theirs FD")
    await _item(db_session, mine, await _category(db_session, mine, ItemType.PPE))
    await _item(db_session, theirs, await _category(db_session, theirs, ItemType.PPE))

    summary = await InventoryService(db_session).get_inventory_summary(mine.id)

    assert summary["items_by_type"] == {"ppe": 1}


async def test_member_summary_still_validates_against_the_schema(db_session):
    """The field is defaulted for this branch, which has no breakdown.

    A required `items_by_type` would 500 every member on a page they are
    entitled to; an empty mapping means "no breakdown for this caller", never
    "no items".
    """
    org = await _org(db_session)
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="Pat",
        last_name="Doe",
        password_hash="x",
    )
    db_session.add(user)
    await db_session.flush()

    summary = await InventoryService(db_session).get_user_inventory_summary(
        org.id, str(user.id)
    )

    assert "items_by_type" not in summary
    assert InventorySummary(**summary).items_by_type == {}
