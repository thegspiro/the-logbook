"""FAC2-9: a maintenance record's system must belong to the record's facility.

Create and update checked only that ``system_id`` was in the organization, so
a work order for Station 1 could be filed against Station 2's HVAC, and the
system's history then carried work done somewhere else.
"""

import uuid

import pytest

from app.models.facilities import (
    Facility,
    FacilityMaintenanceType,
    FacilityStatus,
    FacilitySystem,
    FacilityType,
)
from app.models.user import Organization
from app.schemas.facilities import FacilityMaintenanceCreate, FacilityMaintenanceUpdate
from app.services.facilities_service import FacilitiesService

pytestmark = pytest.mark.integration


@pytest.fixture
async def scene(db_session):
    org = Organization(name="Systems", slug=f"systems-{uuid.uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    kind = FacilityType(id=str(uuid.uuid4()), organization_id=org.id, name="Station")
    status = FacilityStatus(
        id=str(uuid.uuid4()), organization_id=org.id, name="In service"
    )
    mtype = FacilityMaintenanceType(
        id=str(uuid.uuid4()), organization_id=org.id, name="HVAC service"
    )
    db_session.add_all([kind, status, mtype])
    await db_session.flush()
    stations = []
    for name in ("Station 1", "Station 2"):
        fac = Facility(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name=name,
            facility_type_id=kind.id,
            status_id=status.id,
        )
        db_session.add(fac)
        stations.append(fac)
    await db_session.flush()
    systems = []
    for fac in stations:
        system = FacilitySystem(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            facility_id=fac.id,
            name=f"{fac.name} HVAC",
        )
        db_session.add(system)
        systems.append(system)
    await db_session.flush()
    return org, stations, systems, mtype


def _create(fac, mtype, system):
    return FacilityMaintenanceCreate(
        facility_id=fac.id,
        maintenance_type_id=mtype.id,
        system_id=system.id,
        description="Filter change",
    )


class TestSystemBelongsToTheRecordsFacility:
    async def test_create_refuses_another_facilitys_system(self, db_session, scene):
        org, (station1, _), (_, station2_hvac), mtype = scene

        with pytest.raises(ValueError, match="belongs to a different facility"):
            await FacilitiesService(db_session).create_maintenance_record(
                _create(station1, mtype, station2_hvac), org.id, created_by=None
            )

    async def test_create_accepts_the_facilitys_own_system(self, db_session, scene):
        org, (station1, _), (station1_hvac, _), mtype = scene

        record = await FacilitiesService(db_session).create_maintenance_record(
            _create(station1, mtype, station1_hvac), org.id, created_by=None
        )

        assert record.system_id == station1_hvac.id

    async def test_update_refuses_another_facilitys_system(self, db_session, scene):
        org, (station1, _), (station1_hvac, station2_hvac), mtype = scene
        service = FacilitiesService(db_session)
        record = await service.create_maintenance_record(
            _create(station1, mtype, station1_hvac), org.id, created_by=None
        )

        with pytest.raises(ValueError, match="belongs to a different facility"):
            await service.update_maintenance_record(
                record.id,
                FacilityMaintenanceUpdate(system_id=station2_hvac.id),
                org.id,
                updated_by=None,
            )
