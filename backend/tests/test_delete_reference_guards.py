"""Deletes that used to fail at a RESTRICT foreign key, or quietly strip one.

Each of these deleted a row other rows still point at. The database refused
with an IntegrityError the endpoint turned into a 500 (and the screen into a
misleading toast), or — for a location's events, which the ORM nulled before
deleting — succeeded and silently erased where those events happened. Proved
against a real database because the failure *is* the constraint: a mocked
session accepts any delete.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.apparatus import (
    Apparatus,
    ApparatusLocationHistory,
    ApparatusStatus,
    ApparatusStatusHistory,
    ApparatusType,
)
from app.models.event import Event, EventTemplate, EventType
from app.models.facilities import Facility, FacilityStatus, FacilityType
from app.models.inventory import (
    EquipmentKit,
    InventoryItem,
    InventoryLot,
    ReorderReceipt,
    ReorderRequest,
    StorageArea,
    StorageLocationType,
)
from app.models.location import Location
from app.models.user import Organization, User
from app.schemas.facilities import FacilityRoomCreate
from app.services.apparatus_service import ApparatusService, ApparatusStatusInUseError
from app.services.facilities_service import FacilitiesService
from app.services.inventory_service import (
    InventoryService,
    LotReceivedAgainstReorderError,
    StorageAreaNotEmptyError,
)
from app.services.location_service import LocationInUseError, LocationService

pytestmark = [pytest.mark.integration]


def _id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org(db_session) -> Organization:
    organization = Organization(
        id=_id(), name="Delete Guards", slug=f"delete-guards-{uuid.uuid4().hex[:8]}"
    )
    db_session.add(organization)
    await db_session.flush()
    return organization


@pytest.fixture
async def actor(db_session, org) -> str:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=_id(),
        organization_id=org.id,
        username=f"actor-{suffix}",
        email=f"actor-{suffix}@example.org",
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _location(db_session, org, name="Station 1") -> Location:
    location = Location(id=_id(), organization_id=org.id, name=name)
    db_session.add(location)
    await db_session.flush()
    return location


async def _apparatus(db_session, org, **fields) -> Apparatus:
    apparatus_type = ApparatusType(
        id=_id(), organization_id=org.id, name="Engine", code=f"E{_id()[:6]}"
    )
    status = ApparatusStatus(
        id=_id(), organization_id=org.id, name="In Service", code=f"S{_id()[:6]}"
    )
    db_session.add_all([apparatus_type, status])
    await db_session.flush()
    apparatus = Apparatus(
        id=_id(),
        organization_id=org.id,
        unit_number=f"E-{uuid.uuid4().hex[:5]}",
        apparatus_type_id=apparatus_type.id,
        status_id=status.id,
        **fields,
    )
    db_session.add(apparatus)
    await db_session.flush()
    return apparatus


async def _event(db_session, org, location_id: str) -> Event:
    start = datetime.now(timezone.utc) + timedelta(days=3)
    event = Event(
        id=_id(),
        organization_id=org.id,
        title="Drill",
        event_type=EventType.OTHER,
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        location_id=location_id,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _location_state(db_session, location_id: str):
    """(exists, is_active) read fresh from the database."""
    db_session.expire_all()
    row = (
        await db_session.execute(
            select(Location.is_active).where(Location.id == location_id)
        )
    ).first()
    return (False, None) if row is None else (True, row[0])


class TestLocationDeleteDeactivatesWhenReferenced:
    async def test_unreferenced_location_is_deleted(self, db_session, org):
        location_id = (await _location(db_session, org)).id

        assert await LocationService(db_session).delete_location(location_id, org.id)

        assert await _location_state(db_session, location_id) == (False, None)

    async def test_event_reference_deactivates_and_keeps_the_event_location(
        self, db_session, org
    ):
        location_id = (await _location(db_session, org)).id
        event_id = (await _event(db_session, org, location_id)).id

        assert await LocationService(db_session).delete_location(location_id, org.id)

        assert await _location_state(db_session, location_id) == (True, False)
        assert (
            await db_session.scalar(
                select(Event.location_id).where(Event.id == event_id)
            )
            == location_id
        )

    @pytest.mark.parametrize(
        "reference", ["primary_station", "current_location", "history", "template"]
    )
    async def test_restricting_reference_deactivates(self, db_session, org, reference):
        location_id = (await _location(db_session, org)).id
        if reference == "primary_station":
            await _apparatus(db_session, org, primary_station_id=location_id)
        elif reference == "current_location":
            await _apparatus(db_session, org, current_location_id=location_id)
        elif reference == "history":
            apparatus = await _apparatus(db_session, org)
            db_session.add(
                ApparatusLocationHistory(
                    id=_id(),
                    organization_id=org.id,
                    apparatus_id=apparatus.id,
                    location_id=location_id,
                    assigned_date=datetime.now(timezone.utc),
                )
            )
        else:
            db_session.add(
                EventTemplate(
                    id=_id(),
                    organization_id=org.id,
                    name="Monthly drill",
                    default_location_id=location_id,
                )
            )
        await db_session.flush()

        # Was an IntegrityError (a 500) for all four.
        assert await LocationService(db_session).delete_location(location_id, org.id)

        assert await _location_state(db_session, location_id) == (True, False)

    async def test_a_reference_that_races_the_check_is_refused_not_nulled(
        self, db_session, org
    ):
        """An event created after the count must hit the constraint, not have
        its location nulled by the ORM on the way to a successful delete."""
        location = await _location(db_session, org)
        location_id = location.id
        event_id = (await _event(db_session, org, location_id)).id
        # Committed (a savepoint release under the fixture) so the rollback
        # the refusal performs does not take the setup rows with it.
        await db_session.commit()
        service = LocationService(db_session)
        # Load the collection, as any code touching location.events would:
        # loaded children are what the ORM used to null.
        await db_session.refresh(location, ["events"])

        async def no_references(_location_id):
            return 0

        service.location_reference_count = no_references

        with pytest.raises(LocationInUseError):
            await service.delete_location(location_id, org.id)

        assert await _location_state(db_session, location_id) == (True, True)
        assert (
            await db_session.scalar(
                select(Event.location_id).where(Event.id == event_id)
            )
            == location_id
        )


class TestFacilityRoomDeleteUsesTheLocationRule:
    async def _room(self, db_session, org, actor):
        facility_type = FacilityType(id=_id(), organization_id=org.id, name="Station")
        facility_status = FacilityStatus(
            id=_id(), organization_id=org.id, name="Operational"
        )
        db_session.add_all([facility_type, facility_status])
        await db_session.flush()
        facility = Facility(
            id=_id(),
            organization_id=org.id,
            name="Station 1",
            facility_type_id=facility_type.id,
            status_id=facility_status.id,
        )
        db_session.add(facility)
        await db_session.flush()
        service = FacilitiesService(db_session)
        room = await service.create_room(
            FacilityRoomCreate(facility_id=facility.id, name="Training Room"),
            org.id,
            actor,
        )
        location_id = await db_session.scalar(
            select(Location.id).where(Location.facility_room_id == room.id)
        )
        assert location_id is not None
        return service, room.id, location_id

    async def test_unreferenced_linked_location_is_deleted(
        self, db_session, org, actor
    ):
        service, room_id, location_id = await self._room(db_session, org, actor)

        assert await service.delete_room(room_id, org.id)

        assert await _location_state(db_session, location_id) == (False, None)

    async def test_event_keeps_its_location_and_the_location_is_deactivated(
        self, db_session, org, actor
    ):
        service, room_id, location_id = await self._room(db_session, org, actor)
        event_id = (await _event(db_session, org, location_id)).id

        assert await service.delete_room(room_id, org.id)

        assert await _location_state(db_session, location_id) == (True, False)
        assert (
            await db_session.scalar(
                select(Event.location_id).where(Event.id == event_id)
            )
            == location_id
        )

    async def test_apparatus_reference_no_longer_fails_the_delete(
        self, db_session, org, actor
    ):
        service, room_id, location_id = await self._room(db_session, org, actor)
        await _apparatus(db_session, org, primary_station_id=location_id)

        assert await service.delete_room(room_id, org.id)

        assert await _location_state(db_session, location_id) == (True, False)


class TestLotReceivedAgainstReorder:
    async def _lot(self, db_session, org, *, received: bool):
        item = InventoryItem(id=_id(), organization_id=org.id, name="Gloves")
        db_session.add(item)
        await db_session.flush()
        lot = InventoryLot(
            id=_id(), organization_id=org.id, inventory_item_id=item.id, quantity=10
        )
        db_session.add(lot)
        await db_session.flush()
        if received:
            request = ReorderRequest(
                id=_id(),
                organization_id=org.id,
                item_name="Gloves",
                item_id=item.id,
                purchase_order_number="PO-77",
            )
            db_session.add(request)
            await db_session.flush()
            db_session.add(
                ReorderReceipt(
                    id=_id(),
                    organization_id=org.id,
                    reorder_request_id=request.id,
                    inventory_lot_id=lot.id,
                    idempotency_key=uuid.uuid4().hex,
                    quantity=10,
                )
            )
            await db_session.flush()
        return lot.id

    async def test_received_lot_is_refused_with_the_reorder_named(
        self, db_session, org
    ):
        lot_id = await self._lot(db_session, org, received=True)

        with pytest.raises(LotReceivedAgainstReorderError) as exc_info:
            await InventoryService(db_session).delete_lot(lot_id, org.id)

        message = str(exc_info.value)
        assert '"Gloves" (PO PO-77)' in message
        assert "Adjust its quantity to 0 instead" in message
        db_session.expire_all()
        assert await db_session.get(InventoryLot, lot_id) is not None

    async def test_unreceived_lot_is_still_deleted(self, db_session, org):
        lot_id = await self._lot(db_session, org, received=False)

        assert await InventoryService(db_session).delete_lot(lot_id, org.id)

        db_session.expire_all()
        assert await db_session.get(InventoryLot, lot_id) is None


class TestApparatusStatusWithHistory:
    async def test_status_recorded_in_history_is_refused(self, db_session, org):
        apparatus = await _apparatus(db_session, org)
        retired = ApparatusStatus(
            id=_id(), organization_id=org.id, name="Retired", code=f"R{_id()[:6]}"
        )
        db_session.add(retired)
        await db_session.flush()
        retired_id = retired.id
        db_session.add(
            ApparatusStatusHistory(
                id=_id(),
                organization_id=org.id,
                apparatus_id=apparatus.id,
                status_id=retired_id,
            )
        )
        await db_session.flush()

        with pytest.raises(ApparatusStatusInUseError, match="history"):
            await ApparatusService(db_session).delete_apparatus_status(
                retired_id, org.id
            )

        db_session.expire_all()
        assert await db_session.get(ApparatusStatus, retired_id) is not None

    async def test_unused_status_is_deleted(self, db_session, org):
        unused = ApparatusStatus(
            id=_id(), organization_id=org.id, name="Spare", code=f"P{_id()[:6]}"
        )
        db_session.add(unused)
        await db_session.flush()
        unused_id = unused.id

        assert await ApparatusService(db_session).delete_apparatus_status(
            unused_id, org.id
        )

        db_session.expire_all()
        assert await db_session.get(ApparatusStatus, unused_id) is None


class TestDeletedEquipmentKit:
    async def test_a_deleted_kit_cannot_be_issued(self, db_session, org, actor):
        kit = EquipmentKit(id=_id(), organization_id=org.id, name="Recruit kit")
        db_session.add(kit)
        await db_session.flush()
        kit_id = uuid.UUID(kit.id)
        service = InventoryService(db_session)

        deleted, _ = await service.delete_equipment_kit(kit_id, org.id)
        assert deleted

        issuances, error = await service.issue_kit_to_member(
            kit_id, uuid.UUID(actor), org.id, uuid.UUID(actor)
        )
        assert issuances is None
        assert error == "Equipment kit not found"
        # Still readable by id: that is how a deleted kit is inspected.
        assert await service.get_equipment_kit_by_id(kit_id, org.id) is not None


class TestStorageAreaDeleteRefusesWhileInUse:
    async def _area(self, db_session, org, parent_id=None) -> str:
        area = StorageArea(
            id=_id(),
            organization_id=org.id,
            name="Shelf",
            storage_type=StorageLocationType.SHELF,
            parent_id=parent_id,
        )
        db_session.add(area)
        await db_session.flush()
        return area.id

    async def test_area_holding_items_is_refused(self, db_session, org):
        area_id = await self._area(db_session, org)
        db_session.add(
            InventoryItem(
                id=_id(), organization_id=org.id, name="Axe", storage_area_id=area_id
            )
        )
        await db_session.flush()

        with pytest.raises(StorageAreaNotEmptyError, match="1 item"):
            await InventoryService(db_session).deactivate_storage_area(area_id, org.id)

        db_session.expire_all()
        assert (await db_session.get(StorageArea, area_id)).is_active is True

    async def test_area_with_nested_areas_is_refused(self, db_session, org):
        area_id = await self._area(db_session, org)
        await self._area(db_session, org, parent_id=area_id)

        with pytest.raises(StorageAreaNotEmptyError, match="1 nested area"):
            await InventoryService(db_session).deactivate_storage_area(area_id, org.id)

    async def test_empty_area_is_deactivated(self, db_session, org):
        area_id = await self._area(db_session, org)

        area = await InventoryService(db_session).deactivate_storage_area(
            area_id, org.id
        )

        assert area is not None
        db_session.expire_all()
        assert (await db_session.get(StorageArea, area_id)).is_active is False
