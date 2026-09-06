"""The location panel on the items page must count what that page lists.

`GET /inventory/summary/by-location` feeds the row of location cards directly
above the item list on `/inventory/admin/items`, and each card filters that
list. `GET /items` carves medical stock out — EMS supplies have their own page
and their own permission — and the panel did not, so a department running both
domains saw cards describing rows the page could never show. Reported from the
field as "82 items" in the header and a 52-unit "Unassigned" card sitting above
a list of 6 items totalling 30 units; the 52 was medical stock with no location
filed against it.

The panel's "Unassigned" bucket also had no filter behind it: `get_items` could
express "at this location" but not "at no location", so the card could only
clear the location filter it looked like it applied.
"""

import uuid

import pytest

from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    ItemType,
    TrackingType,
)
from app.models.location import Location
from app.models.user import Organization
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org(db, name="Panel FD"):
    org = Organization(name=name, slug=f"panel-{uuid.uuid4().hex[:8]}")
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


async def _location(db, org, name="Quartermaster's Storage") -> Location:
    location = Location(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
    )
    db.add(location)
    await db.flush()
    return location


async def _item(db, org, category=None, *, location=None, quantity=1, value=None):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        category_id=category.id if category else None,
        location_id=location.id if location else None,
        name=f"item-{uuid.uuid4().hex[:6]}",
        tracking_type=TrackingType.POOL,
        quantity=quantity,
        current_value=value,
        active=True,
    )
    db.add(item)
    await db.flush()
    return item


def _card(panel, name):
    return next((row for row in panel if row["location_name"] == name), None)


async def test_medical_stock_is_left_out_of_the_unassigned_bucket(db_session):
    """The reported defect, in the shape it was reported."""
    org = await _org(db_session)
    storage = await _location(db_session, org)
    uniform = await _category(db_session, org, ItemType.UNIFORM)
    medical = await _category(db_session, org, ItemType.MEDICAL)

    for _ in range(6):
        await _item(db_session, org, uniform, location=storage, quantity=5)
    await _item(db_session, org, medical, quantity=26)
    await _item(db_session, org, medical, quantity=26)

    service = InventoryService(db_session)
    panel = await service.get_summary_by_location(
        org.id, exclude_item_types=MEDICAL_ITEM_TYPES
    )

    assert _card(panel, "Unassigned") is None
    assert _card(panel, "Quartermaster's Storage") == {
        "location_id": storage.id,
        "location_name": "Quartermaster's Storage",
        "item_count": 6,
        "total_quantity": 30,
        "total_value": 0.0,
    }


async def test_the_panel_totals_match_the_listing_it_sits_above(db_session):
    """Card totals and the list are two views of one set, so they must agree."""
    org = await _org(db_session)
    storage = await _location(db_session, org)
    uniform = await _category(db_session, org, ItemType.UNIFORM)
    medical = await _category(db_session, org, ItemType.MEDICAL)

    for _ in range(6):
        await _item(db_session, org, uniform, location=storage, quantity=5)
    await _item(db_session, org, uniform, quantity=2)
    await _item(db_session, org, medical, quantity=26)

    service = InventoryService(db_session)
    panel = await service.get_summary_by_location(
        org.id, exclude_item_types=MEDICAL_ITEM_TYPES
    )
    _, listed = await service.get_items(
        org.id, exclude_item_types=MEDICAL_ITEM_TYPES, limit=500
    )

    assert sum(row["item_count"] for row in panel) == listed == 7


async def test_a_location_holding_only_medical_stock_gets_no_card(db_session):
    """An inner join, so the card does not appear reading zero."""
    org = await _org(db_session)
    ems = await _location(db_session, org, name="EMS Room")
    medical = await _category(db_session, org, ItemType.MEDICAL)
    await _item(db_session, org, medical, location=ems, quantity=40)

    panel = await InventoryService(db_session).get_summary_by_location(
        org.id, exclude_item_types=MEDICAL_ITEM_TYPES
    )

    assert panel == []


async def test_without_the_carve_out_every_domain_is_counted(db_session):
    """The default is unchanged: the parameter is opt-in per caller."""
    org = await _org(db_session)
    medical = await _category(db_session, org, ItemType.MEDICAL)
    await _item(db_session, org, medical, quantity=26)
    await _item(db_session, org, medical, quantity=26)

    panel = await InventoryService(db_session).get_summary_by_location(org.id)

    assert _card(panel, "Unassigned")["total_quantity"] == 52


async def test_an_uncategorized_item_stays_in_the_panel(db_session):
    """It carries no domain, so it is not the excluded one — and the listing
    keeps it for the same reason. Dropping it here would hide a card for stock
    the page shows."""
    org = await _org(db_session)
    await _item(db_session, org, None, quantity=3)

    panel = await InventoryService(db_session).get_summary_by_location(
        org.id, exclude_item_types=MEDICAL_ITEM_TYPES
    )

    assert _card(panel, "Unassigned")["item_count"] == 1


async def test_unassigned_location_filter_returns_only_location_less_items(db_session):
    org = await _org(db_session)
    storage = await _location(db_session, org)
    uniform = await _category(db_session, org, ItemType.UNIFORM)
    await _item(db_session, org, uniform, location=storage)
    loose = await _item(db_session, org, uniform)

    items, total = await InventoryService(db_session).get_items(
        org.id, unassigned_location=True
    )

    assert total == 1
    assert [item.id for item in items] == [loose.id]


async def test_the_unassigned_flag_is_ignored_when_a_location_is_named(db_session):
    """The two ask for disjoint sets; a request carrying both means the
    location, not nothing at all."""
    org = await _org(db_session)
    storage = await _location(db_session, org)
    uniform = await _category(db_session, org, ItemType.UNIFORM)
    shelved = await _item(db_session, org, uniform, location=storage)
    await _item(db_session, org, uniform)

    items, total = await InventoryService(db_session).get_items(
        org.id, location_id=uuid.UUID(storage.id), unassigned_location=True
    )

    assert total == 1
    assert [item.id for item in items] == [shelved.id]


async def test_the_unassigned_filter_lists_exactly_what_its_card_counts(db_session):
    """The card is a link into the list, so its count is the list's length."""
    org = await _org(db_session)
    storage = await _location(db_session, org)
    uniform = await _category(db_session, org, ItemType.UNIFORM)
    medical = await _category(db_session, org, ItemType.MEDICAL)
    await _item(db_session, org, uniform, location=storage, quantity=5)
    await _item(db_session, org, uniform, quantity=2)
    await _item(db_session, org, uniform, quantity=4)
    await _item(db_session, org, medical, quantity=26)

    service = InventoryService(db_session)
    panel = await service.get_summary_by_location(
        org.id, exclude_item_types=MEDICAL_ITEM_TYPES
    )
    _, total = await service.get_items(
        org.id, exclude_item_types=MEDICAL_ITEM_TYPES, unassigned_location=True
    )

    assert _card(panel, "Unassigned")["item_count"] == total == 2
