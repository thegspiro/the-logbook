"""
Medical Supplies: where a supply is kept, on the shelf and on the trucks.

Storage areas nest (room → cabinet → shelf) and only the top of a tree names
its room, so the room and the readable path are resolved by walking parents.
The apparatus side is the checklist link read from the supply: which active
templates carry it, and what is aboard.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import medical_supplies as ms
from app.models.apparatus import (
    Apparatus,
    ApparatusStatus,
    ApparatusType,
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    ItemType,
    StorageArea,
    StorageLocationType,
    TrackingType,
)
from app.models.location import Location
from app.models.user import Organization
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def dept(db_session):
    """Station 1 › Supply Room holds Cabinet B › Shelf 2 (and a retired bin)."""
    org = Organization(id=_uid(), name="Store FD", slug=f"store-{_uid()[:8]}")
    db_session.add(org)
    await db_session.flush()
    room = Location(id=_uid(), organization_id=org.id, name="Supply Room")
    bay = Location(id=_uid(), organization_id=org.id, name="Apparatus Bay")
    db_session.add_all([room, bay])
    await db_session.flush()
    cabinet = StorageArea(
        id=_uid(),
        organization_id=org.id,
        name="Cabinet B",
        storage_type=StorageLocationType.CABINET,
        location_id=room.id,
        is_active=True,
    )
    db_session.add(cabinet)
    await db_session.flush()
    shelf = StorageArea(
        id=_uid(),
        organization_id=org.id,
        name="Shelf 2",
        storage_type=StorageLocationType.SHELF,
        parent_id=cabinet.id,
        is_active=True,
    )
    retired = StorageArea(
        id=_uid(),
        organization_id=org.id,
        name="Old Bin",
        storage_type=StorageLocationType.BIN,
        location_id=bay.id,
        is_active=False,
    )
    db_session.add_all([shelf, retired])
    medical = InventoryCategory(
        id=_uid(), organization_id=org.id, name="Airway", item_type=ItemType.MEDICAL
    )
    gear = InventoryCategory(
        id=_uid(), organization_id=org.id, name="Tools", item_type=ItemType.TOOL
    )
    db_session.add_all([medical, gear])
    await db_session.flush()

    def item(name, cat=medical, **kw):
        row = InventoryItem(
            id=_uid(),
            organization_id=org.id,
            category_id=cat.id,
            name=name,
            tracking_type=TrackingType.POOL,
            quantity=5,
            active=True,
            **kw,
        )
        db_session.add(row)
        return row

    items = {
        # On the shelf, filed by a form that set the area but not the room.
        "gauze": item("Gauze", storage_area_id=shelf.id, reorder_point=10),
        "cannula": item("Cannula", location_id=room.id),
        "mask": item("Mask", storage_area_id=cabinet.id, location_id=room.id),
        "shears": item("Shears", storage_location="Top drawer"),
        "rope": item("Rope", cat=gear, storage_area_id=shelf.id),
    }
    await db_session.flush()
    return SimpleNamespace(
        org=org,
        room=room,
        bay=bay,
        cabinet=cabinet,
        shelf=shelf,
        retired=retired,
        items=items,
    )


def _user(org):
    return SimpleNamespace(id="u-1", username="supply", organization_id=org.id)


async def _list(db_session, org, **kwargs):
    params = dict(
        category_id=None,
        status_filter=None,
        condition=None,
        location_id=None,
        storage_area_id=None,
        search=None,
        active_only=True,
        sort_by="name",
        sort_order="asc",
        skip=0,
        limit=100,
        fuzzy=False,
        low_stock=False,
    )
    params.update(kwargs)
    return await ms.list_medical_items(**params, db=db_session, current_user=_user(org))


async def _apparatus(db_session, org, unit):
    kind = ApparatusType(id=_uid(), organization_id=org.id, name="Medic", code=unit)
    state = ApparatusStatus(
        id=_uid(), organization_id=org.id, name="In Service", code=f"IS{unit}"
    )
    db_session.add_all([kind, state])
    await db_session.flush()
    rig = Apparatus(
        id=_uid(),
        organization_id=org.id,
        unit_number=unit,
        name=unit,
        apparatus_type_id=kind.id,
        status_id=state.id,
    )
    db_session.add(rig)
    await db_session.flush()
    return rig


async def _carry(
    db_session, org, rig, inventory_item, *, active=True, nested=False, **kw
):
    template = EquipmentCheckTemplate(
        id=_uid(),
        organization_id=org.id,
        name=f"{rig.name if rig else 'Type'} Daily",
        check_timing="start_of_shift",
        is_active=active,
        apparatus_id=rig.id if rig else None,
        apparatus_type=None if rig else "ambulance",
    )
    db_session.add(template)
    await db_session.flush()
    parent = None
    if nested:
        parent = CheckTemplateCompartment(
            id=_uid(), template_id=template.id, name="Main Compartment"
        )
        db_session.add(parent)
        await db_session.flush()
    compartment = CheckTemplateCompartment(
        id=_uid(),
        template_id=template.id,
        name="Jump Bag",
        parent_compartment_id=parent.id if parent else None,
    )
    db_session.add(compartment)
    await db_session.flush()
    line = CheckTemplateItem(
        id=_uid(),
        compartment_id=compartment.id,
        name=inventory_item.name,
        check_type="count",
        inventory_item_id=inventory_item.id,
        **kw,
    )
    db_session.add(line)
    await db_session.flush()
    return line


class TestStorageOptions:
    async def test_lists_rooms_and_active_areas_with_room_and_path(
        self, db_session, dept
    ):
        options = await ms.list_medical_storage_options(
            db=db_session, current_user=_user(dept.org)
        )

        assert {r.name for r in options.rooms} == {"Supply Room", "Apparatus Bay"}
        by_name = {a.name: a for a in options.areas}
        # The retired bin is not offered.
        assert set(by_name) == {"Cabinet B", "Shelf 2"}
        # The shelf inherits its cabinet's room.
        assert by_name["Shelf 2"].location_id == dept.room.id
        assert by_name["Shelf 2"].location_name == "Supply Room"
        assert by_name["Shelf 2"].path == "Cabinet B › Shelf 2"

    async def test_shows_nothing_from_another_department(self, db_session, dept):
        other = Organization(id=_uid(), name="Other", slug=f"other-{_uid()[:8]}")
        db_session.add(other)
        await db_session.flush()

        options = await ms.list_medical_storage_options(
            db=db_session, current_user=_user(other)
        )

        assert options.rooms == []
        assert options.areas == []


class TestListShowsWhereItIs:
    async def test_storage_path_from_room_and_area(self, db_session, dept):
        result = await _list(db_session, dept.org)

        paths = {i.name: i.storage_path for i in result.items}
        assert paths == {
            # Room inherited from the shelf's cabinet.
            "Gauze": "Supply Room › Cabinet B › Shelf 2",
            "Cannula": "Supply Room",
            "Mask": "Supply Room › Cabinet B",
            "Shears": None,
        }

    async def test_counts_the_apparatus_that_carry_each_supply(self, db_session, dept):
        medic1 = await _apparatus(db_session, dept.org, "Medic 1")
        medic2 = await _apparatus(db_session, dept.org, "Medic 2")
        gauze = dept.items["gauze"]
        await _carry(db_session, dept.org, medic1, gauze)
        # Two positions on one truck are still one truck.
        await _carry(db_session, dept.org, medic1, gauze)
        await _carry(db_session, dept.org, medic2, gauze)
        # A draft template is not a truck carrying it yet.
        await _carry(db_session, dept.org, medic2, dept.items["mask"], active=False)
        # A template for an apparatus type counts as one place.
        await _carry(db_session, dept.org, None, dept.items["cannula"])

        result = await _list(db_session, dept.org)

        counts = {i.name: i.apparatus_count for i in result.items}
        assert counts == {"Gauze": 2, "Cannula": 1, "Mask": 0, "Shears": 0}

    async def test_names_each_place_as_the_checklist_does(self, db_session, dept):
        medic1 = await _apparatus(db_session, dept.org, "Medic 1")
        medic2 = await _apparatus(db_session, dept.org, "Medic 2")
        gauze = dept.items["gauze"]
        await _carry(db_session, dept.org, medic2, gauze)
        await _carry(db_session, dept.org, medic1, gauze, nested=True)
        await _carry(db_session, dept.org, None, dept.items["cannula"])

        result = await _list(db_session, dept.org)

        places = {i.name: i.apparatus_places for i in result.items}
        assert places["Gauze"] == [
            "Medic 1 › Main Compartment › Jump Bag",
            "Medic 2 › Jump Bag",
        ]
        assert places["Cannula"] == ["Any ambulance › Jump Bag"]
        assert places["Shears"] == []


class TestStorageFilter:
    async def test_a_room_finds_supplies_on_any_area_inside_it(self, db_session, dept):
        result = await _list(db_session, dept.org, location_id=dept.room.id)

        assert [i.name for i in result.items] == ["Cannula", "Gauze", "Mask"]

    async def test_an_area_finds_supplies_on_areas_nested_in_it(self, db_session, dept):
        result = await _list(db_session, dept.org, storage_area_id=dept.cabinet.id)

        assert [i.name for i in result.items] == ["Gauze", "Mask"]

    async def test_combines_with_the_low_stock_filter(self, db_session, dept):
        result = await _list(
            db_session, dept.org, storage_area_id=dept.cabinet.id, low_stock=True
        )

        assert [i.name for i in result.items] == ["Gauze"]

    async def test_an_area_from_another_department_finds_nothing(
        self, db_session, dept
    ):
        other = Organization(id=_uid(), name="Other", slug=f"other-{_uid()[:8]}")
        db_session.add(other)
        await db_session.flush()

        result = await _list(db_session, other, storage_area_id=dept.cabinet.id)

        assert result.items == []
        assert result.total == 0

    async def test_never_returns_gear(self, db_session, dept):
        ids = await InventoryService(db_session).item_ids_stored_in(
            dept.org.id, MEDICAL_ITEM_TYPES, storage_area_id=dept.shelf.id
        )

        assert ids == [dept.items["gauze"].id]


class TestPlacements:
    async def test_lists_each_truck_with_what_is_aboard(self, db_session, dept):
        medic1 = await _apparatus(db_session, dept.org, "Medic 1")
        await _carry(
            db_session,
            dept.org,
            medic1,
            dept.items["gauze"],
            nested=True,
            expected_quantity=4,
            quantity_on_truck=3,
        )

        rows = await ms.list_medical_item_placements(
            item_id=dept.items["gauze"].id,
            db=db_session,
            current_user=_user(dept.org),
        )

        (row,) = rows
        assert row["apparatus_name"] == "Medic 1"
        assert row["compartment_name"] == "Jump Bag"
        assert row["compartment_path"] == ["Main Compartment", "Jump Bag"]
        assert row["target_quantity"] == 4
        assert row["quantity_on_truck"] == 3

    async def test_refuses_gear_and_another_departments_supply(self, db_session, dept):
        other = Organization(id=_uid(), name="Other", slug=f"other-{_uid()[:8]}")
        db_session.add(other)
        await db_session.flush()

        with pytest.raises(HTTPException) as gear:
            await ms.list_medical_item_placements(
                item_id=dept.items["rope"].id,
                db=db_session,
                current_user=_user(dept.org),
            )
        with pytest.raises(HTTPException) as foreign:
            await ms.list_medical_item_placements(
                item_id=dept.items["gauze"].id,
                db=db_session,
                current_user=_user(other),
            )

        assert gear.value.status_code == 404
        assert foreign.value.status_code == 404
