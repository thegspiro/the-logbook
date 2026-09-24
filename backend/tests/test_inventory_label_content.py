"""What an inventory label carries besides its code, built against MySQL.

The storage-area line is resolved from the caller's own areas, so an item
whose area id points outside its organization prints no path rather than
another department's shelf names.
"""

import uuid

import pytest
from sqlalchemy import text

from app.models.inventory import InventoryItem, StorageArea, StorageLocationType
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _make_org(db, name: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": name, "slug": f"{name}-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _area(db, org_id, name, parent=None):
    area = StorageArea(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        storage_type=list(StorageLocationType)[0],
        parent_id=parent.id if parent else None,
        barcode=f"SA-{uuid.uuid4().hex[:6]}",
    )
    db.add(area)
    await db.flush()
    return area


async def _item(db, org_id, area):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Portable Radio",
        quantity=1,
        barcode=f"INV-{uuid.uuid4().hex[:6]}",
        asset_tag="AT-77",
        serial_number="SN-123",
        size="Large",
        storage_area_id=area.id,
    )
    db.add(item)
    await db.flush()
    return item


async def test_prints_the_shelf_path_and_size_and_can_drop_identifiers(db_session):
    org = await _make_org(db_session, "label-content")
    rack = await _area(db_session, org, "Rack A")
    shelf = await _area(db_session, org, "Shelf 2", parent=rack)
    item = await _item(db_session, org, shelf)

    specs, _ = await InventoryService(db_session).build_label_specs(
        [item.id],
        org,
        ["storage_area", "size", "no_serial_number"],
        persist=False,
    )

    spec = specs[0]
    assert spec.extra == "Rack A > Shelf 2 | Large"
    assert spec.asset_tag == "AT-77"
    assert spec.serial_number is None


async def test_both_identifiers_print_by_default(db_session):
    org = await _make_org(db_session, "label-default")
    item = await _item(db_session, org, await _area(db_session, org, "Bin 1"))

    specs, _ = await InventoryService(db_session).build_label_specs(
        [item.id], org, None, persist=False
    )

    assert (specs[0].asset_tag, specs[0].serial_number) == ("AT-77", "SN-123")
    assert specs[0].extra is None


async def test_another_orgs_shelf_is_never_named(db_session):
    org = await _make_org(db_session, "label-home")
    other = await _make_org(db_session, "label-other")
    foreign_shelf = await _area(db_session, other, "Their Shelf")
    item = await _item(db_session, org, foreign_shelf)

    specs, _ = await InventoryService(db_session).build_label_specs(
        [item.id], org, ["storage_area"], persist=False
    )

    assert specs[0].extra is None
