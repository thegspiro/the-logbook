"""
The apparatus sub-resource endpoints accept the camelCase bodies the modals send.

End-to-end counterpart of ``test_apparatus_request_camelcase.py``: drives the
apparatus router over HTTP with the exact key spelling the Operator, Equipment,
Maintenance Record and Fuel Log modals use, and reads the rows back. Before the
request schemas took an alias, every create here was a 422 (``apparatus_id`` /
``user_id`` / ``maintenance_type_id`` / ``fuel_date`` reported missing) and every
update was a 200 that dropped each multi-word key on the floor.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import apparatus as apparatus_endpoints
from app.core.database import get_db
from app.models.apparatus import (
    Apparatus,
    ApparatusEquipment,
    ApparatusFuelLog,
    ApparatusMaintenance,
    ApparatusMaintenanceType,
    ApparatusOperator,
    ApparatusStatus,
    ApparatusType,
    EvocLevel,
)
from app.models.user import User

pytestmark = [pytest.mark.integration]


class _Fleet:
    def __init__(self, user: User, apparatus_id: str, mtype_id: str, evoc_id: str):
        self.user = user
        self.apparatus_id = apparatus_id
        self.maintenance_type_id = mtype_id
        self.evoc_level_id = evoc_id


@pytest.fixture
async def fleet(db_session: AsyncSession) -> _Fleet:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Camel Fleet', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"camel-fleet-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Fleet', 'Officer', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"fleet-{user_id[:8]}",
            "em": f"fleet-{user_id[:8]}@test.example",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Fleet Officer', 'fleet_officer', "
            '\'["apparatus.view", "apparatus.manage"]\')'
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )

    apparatus_type = ApparatusType(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Engine",
        code=f"ENG{uuid.uuid4().hex[:4]}",
    )
    apparatus_status = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="In Service",
        code=f"IS{uuid.uuid4().hex[:4]}",
    )
    maintenance_type = ApparatusMaintenanceType(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Annual pump test",
        code=f"MT{uuid.uuid4().hex[:4]}",
    )
    evoc_level = EvocLevel(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        level_number=2,
        name="EVOC 2",
        code=f"EV{uuid.uuid4().hex[:4]}",
    )
    db_session.add_all([apparatus_type, apparatus_status, maintenance_type, evoc_level])
    await db_session.flush()
    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        unit_number=f"E-{uuid.uuid4().hex[:5]}",
        apparatus_type_id=apparatus_type.id,
        status_id=apparatus_status.id,
    )
    db_session.add(apparatus)
    await db_session.flush()

    user = await db_session.get(User, user_id)
    await db_session.refresh(user, ["positions"])
    return _Fleet(user, apparatus.id, maintenance_type.id, evoc_level.id)


def _client(db_session: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(apparatus_endpoints.router, prefix="/apparatus")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _reload(db_session: AsyncSession, model, row_id: str):
    row = await db_session.get(model, row_id)
    await db_session.refresh(row)
    return row


class TestOperatorEndpointsAcceptCamelCase:
    async def test_create_then_update_and_clear_with_camelcase(
        self, db_session: AsyncSession, fleet: _Fleet
    ):
        async with _client(db_session, fleet.user) as client:
            # The body OperatorModal sends on create, every optional field set.
            resp = await client.post(
                "/apparatus/operators",
                json={
                    "apparatusId": fleet.apparatus_id,
                    "userId": fleet.user.id,
                    "evocLevelId": fleet.evoc_level_id,
                    "isCertified": True,
                    "licenseVerified": True,
                    "hasRestrictions": True,
                    "isActive": True,
                    "certificationDate": "2026-01-15",
                    "certificationExpiration": "2028-01-15",
                    "licenseTypeRequired": "CDL-B",
                    "licenseVerifiedDate": "2026-01-20",
                    "restrictionNotes": "Daylight only",
                    "notes": "Probationary driver",
                },
            )
            assert resp.status_code == 201, resp.text
            operator_id = resp.json()["id"]
            assert resp.json()["licenseTypeRequired"] == "CDL-B"
            assert resp.json()["evocLevelId"] == fleet.evoc_level_id

            # The body OperatorModal sends on edit.
            resp = await client.patch(
                f"/apparatus/operators/{operator_id}",
                json={
                    "isCertified": False,
                    "licenseVerified": False,
                    "hasRestrictions": False,
                    "isActive": True,
                    "certificationExpiration": "2027-06-30",
                    "licenseTypeRequired": "CDL-A",
                },
            )
            assert resp.status_code == 200, resp.text

            # An explicit camelCase null clears the field (CLAUDE.md #1).
            resp = await client.patch(
                f"/apparatus/operators/{operator_id}",
                json={"restrictionNotes": None, "evocLevelId": None},
            )
            assert resp.status_code == 200, resp.text

        operator = await _reload(db_session, ApparatusOperator, operator_id)
        assert operator.is_certified is False
        assert operator.license_verified is False
        assert operator.has_restrictions is False
        assert operator.license_type_required == "CDL-A"
        assert str(operator.certification_expiration) == "2027-06-30"
        assert operator.restriction_notes is None
        assert operator.evoc_level_id is None
        # Omitted keys were left alone.
        assert operator.notes == "Probationary driver"
        assert str(operator.certification_date) == "2026-01-15"


class TestEquipmentEndpointsAcceptCamelCase:
    async def test_create_then_update_and_clear_with_camelcase(
        self, db_session: AsyncSession, fleet: _Fleet
    ):
        async with _client(db_session, fleet.user) as client:
            # The body EquipmentModal sends on create.
            resp = await client.post(
                "/apparatus/equipment",
                json={
                    "apparatusId": fleet.apparatus_id,
                    "name": "Thermal imaging camera",
                    "quantity": 1,
                    "isMounted": True,
                    "isRequired": True,
                    "isPresent": True,
                    "description": "TIC",
                    "locationOnApparatus": "Officer side cab",
                    "serialNumber": "TIC-0042",
                    "assetTag": "A-1001",
                    "notes": "Charge nightly",
                },
            )
            assert resp.status_code == 201, resp.text
            equipment_id = resp.json()["id"]
            assert resp.json()["locationOnApparatus"] == "Officer side cab"

            # The body EquipmentModal sends on edit.
            resp = await client.patch(
                f"/apparatus/equipment/{equipment_id}",
                json={
                    "name": "Thermal imaging camera",
                    "quantity": 2,
                    "isMounted": False,
                    "isRequired": False,
                    "isPresent": False,
                    "locationOnApparatus": "Compartment R1",
                    "assetTag": "A-2002",
                },
            )
            assert resp.status_code == 200, resp.text

            resp = await client.patch(
                f"/apparatus/equipment/{equipment_id}",
                json={"serialNumber": None},
            )
            assert resp.status_code == 200, resp.text

        equipment = await _reload(db_session, ApparatusEquipment, equipment_id)
        assert equipment.quantity == 2
        assert equipment.is_mounted is False
        assert equipment.is_required is False
        assert equipment.is_present is False
        assert equipment.location_on_apparatus == "Compartment R1"
        assert equipment.asset_tag == "A-2002"
        assert equipment.serial_number is None
        assert equipment.notes == "Charge nightly"


class TestMaintenanceEndpointsAcceptCamelCase:
    async def test_create_then_update_and_clear_with_camelcase(
        self, db_session: AsyncSession, fleet: _Fleet
    ):
        # MaintenanceRecordModal builds one payload and sends it to both the
        # create and the update endpoint, so the update body carries
        # `apparatusId` too — a key the update schema does not have.
        body = {
            "apparatusId": fleet.apparatus_id,
            "maintenanceTypeId": fleet.maintenance_type_id,
            "isCompleted": True,
            "scheduledDate": "2026-03-01",
            "dueDate": "2026-03-05",
            "completedDate": "2026-03-04",
            "performedBy": "County Fleet Services",
            "description": "Annual pump test",
            "workPerformed": "Tested at draft",
            "findings": "Within spec",
            "mileageAtService": 41200,
            "hoursAtService": 1820.5,
            "cost": 650,
            "vendor": "County Fleet",
            "invoiceNumber": "INV-77",
            "nextDueDate": "2027-03-04",
            "nextDueMileage": 46000,
            "nextDueHours": 2000,
            "notes": "No issues",
        }
        async with _client(db_session, fleet.user) as client:
            resp = await client.post("/apparatus/maintenance", json=body)
            assert resp.status_code == 201, resp.text
            record_id = resp.json()["id"]
            assert resp.json()["invoiceNumber"] == "INV-77"
            assert resp.json()["isCompleted"] is True

            edited = {
                **body,
                "workPerformed": "Re-tested at draft",
                "mileageAtService": 41250,
                "nextDueMileage": 47000,
            }
            resp = await client.patch(
                f"/apparatus/maintenance/{record_id}", json=edited
            )
            assert resp.status_code == 200, resp.text

            resp = await client.patch(
                f"/apparatus/maintenance/{record_id}",
                json={"invoiceNumber": None, "performedBy": None},
            )
            assert resp.status_code == 200, resp.text

        record = await _reload(db_session, ApparatusMaintenance, record_id)
        assert record.work_performed == "Re-tested at draft"
        assert record.mileage_at_service == 41250
        assert record.next_due_mileage == 47000
        assert str(record.completed_date) == "2026-03-04"
        assert record.invoice_number is None
        assert record.performed_by is None
        assert record.vendor == "County Fleet"


class TestFuelLogEndpointAcceptsCamelCase:
    async def test_create_with_camelcase(self, db_session: AsyncSession, fleet: _Fleet):
        async with _client(db_session, fleet.user) as client:
            # The body FuelLogModal sends.
            resp = await client.post(
                "/apparatus/fuel-logs",
                json={
                    "apparatusId": fleet.apparatus_id,
                    "fuelDate": "2026-04-02T14:30",
                    "fuelType": "diesel",
                    "gallons": 42.5,
                    "pricePerGallon": 4.1,
                    "totalCost": 174.25,
                    "mileageAtFill": 41300,
                    "hoursAtFill": 1825,
                    "isFullTank": False,
                    "stationName": "County Depot",
                    "stationAddress": "1 Depot Rd",
                    "notes": "Top-off",
                },
            )
            assert resp.status_code == 201, resp.text
            log_id = resp.json()["id"]

        log = await _reload(db_session, ApparatusFuelLog, log_id)
        assert log.apparatus_id == fleet.apparatus_id
        assert log.mileage_at_fill == 41300
        assert log.is_full_tank is False
        assert log.station_name == "County Depot"
        assert log.station_address == "1 Depot Rd"
        apparatus = await _reload(db_session, Apparatus, fleet.apparatus_id)
        assert apparatus.current_mileage == 41300


class TestCamelCasePatchOnSnakeCaseSeededRows:
    """The update half on its own, seeded through the snake_case spelling that
    always worked — so before the fix these were 200s that changed nothing,
    rather than tests that never got past a 422 on the create."""

    async def test_operator_patch_persists_camelcase_fields(
        self, db_session: AsyncSession, fleet: _Fleet
    ):
        async with _client(db_session, fleet.user) as client:
            resp = await client.post(
                "/apparatus/operators",
                json={
                    "apparatus_id": fleet.apparatus_id,
                    "user_id": fleet.user.id,
                    "license_type_required": "CDL-B",
                    "restriction_notes": "Daylight only",
                },
            )
            assert resp.status_code == 201, resp.text
            operator_id = resp.json()["id"]
            resp = await client.patch(
                f"/apparatus/operators/{operator_id}",
                json={
                    "isCertified": False,
                    "licenseTypeRequired": "CDL-A",
                    "restrictionNotes": None,
                },
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["licenseTypeRequired"] == "CDL-A"

        operator = await _reload(db_session, ApparatusOperator, operator_id)
        assert operator.is_certified is False
        assert operator.license_type_required == "CDL-A"
        assert operator.restriction_notes is None

    async def test_equipment_patch_persists_camelcase_fields(
        self, db_session: AsyncSession, fleet: _Fleet
    ):
        async with _client(db_session, fleet.user) as client:
            resp = await client.post(
                "/apparatus/equipment",
                json={
                    "apparatus_id": fleet.apparatus_id,
                    "name": "Pike pole",
                    "serial_number": "PP-1",
                },
            )
            assert resp.status_code == 201, resp.text
            equipment_id = resp.json()["id"]
            resp = await client.patch(
                f"/apparatus/equipment/{equipment_id}",
                json={
                    "locationOnApparatus": "Ladder rack",
                    "isPresent": False,
                    "serialNumber": None,
                },
            )
            assert resp.status_code == 200, resp.text

        equipment = await _reload(db_session, ApparatusEquipment, equipment_id)
        assert equipment.location_on_apparatus == "Ladder rack"
        assert equipment.is_present is False
        assert equipment.serial_number is None

    async def test_maintenance_patch_persists_camelcase_fields(
        self, db_session: AsyncSession, fleet: _Fleet
    ):
        async with _client(db_session, fleet.user) as client:
            resp = await client.post(
                "/apparatus/maintenance",
                json={
                    "apparatus_id": fleet.apparatus_id,
                    "maintenance_type_id": fleet.maintenance_type_id,
                    "invoice_number": "INV-1",
                },
            )
            assert resp.status_code == 201, resp.text
            record_id = resp.json()["id"]
            resp = await client.patch(
                f"/apparatus/maintenance/{record_id}",
                json={
                    "workPerformed": "Replaced alternator",
                    "mileageAtService": 40100,
                    "invoiceNumber": None,
                },
            )
            assert resp.status_code == 200, resp.text

        record = await _reload(db_session, ApparatusMaintenance, record_id)
        assert record.work_performed == "Replaced alternator"
        assert record.mileage_at_service == 40100
        assert record.invoice_number is None


class TestSnakeCaseStillWorks:
    async def test_snake_case_equipment_create(
        self, db_session: AsyncSession, fleet: _Fleet
    ):
        async with _client(db_session, fleet.user) as client:
            resp = await client.post(
                "/apparatus/equipment",
                json={
                    "apparatus_id": fleet.apparatus_id,
                    "name": "Halligan",
                    "location_on_apparatus": "Cab",
                    "serial_number": "H-1",
                },
            )
            assert resp.status_code == 201, resp.text
            assert resp.json()["serialNumber"] == "H-1"
            assert resp.json()["locationOnApparatus"] == "Cab"
