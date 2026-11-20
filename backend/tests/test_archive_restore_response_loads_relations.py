"""Archive and restore must return a record whose nested type and status serialize.

``archive_apparatus``, ``archive_facility`` and ``restore_facility`` load the
row without its relationships and finish with a bare ``refresh``, while the
response models nest the type and status. Serializing the result lazy-loaded
them on the async session (MissingGreenlet), so each call answered 500 after the
archive or restore had already committed.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import apparatus as apparatus_endpoints
from app.api.v1.endpoints import facilities as facility_endpoints
from app.models.apparatus import Apparatus, ApparatusStatus, ApparatusType
from app.models.facilities import Facility, FacilityStatus, FacilityType
from app.models.user import Organization, User, UserStatus
from app.schemas.apparatus import ApparatusArchive, ApparatusResponse

pytestmark = pytest.mark.integration


def _uid():
    return str(uuid.uuid4())


async def _department(db):
    suffix = uuid.uuid4().hex[:8]
    org = Organization(id=_uid(), name="Archive Dept", slug=f"archive-{suffix}")
    db.add(org)
    await db.flush()
    officer = User(
        id=_uid(),
        organization_id=org.id,
        username=f"officer-{suffix}",
        email=f"{suffix}@archive.test",
        first_name="Casey",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(officer)
    await db.flush()
    return org, officer


async def _fresh_officer(db, officer_id):
    """Clear the identity map, as a new request starts with nothing loaded."""
    db.expunge_all()
    result = await db.execute(
        select(User)
        .options(selectinload(User.positions), selectinload(User.roles))
        .where(User.id == officer_id)
    )
    return result.scalar_one()


class TestApparatusArchive:
    async def test_archive_returns_the_unit_with_its_type_and_status(self, db_session):
        org, officer = await _department(db_session)
        suffix = uuid.uuid4().hex[:8]
        engine = ApparatusType(
            id=_uid(), organization_id=org.id, name="Engine", code=f"E{suffix}"
        )
        in_service = ApparatusStatus(
            id=_uid(), organization_id=org.id, name="In Service", code=f"I{suffix}"
        )
        sold = ApparatusStatus(
            id=_uid(),
            organization_id=org.id,
            name="Sold",
            code=f"S{suffix}",
            is_archived_status=True,
            is_active=True,
        )
        db_session.add_all([engine, in_service, sold])
        await db_session.flush()
        unit = Apparatus(
            id=_uid(),
            organization_id=org.id,
            unit_number=f"E1-{suffix}",
            apparatus_type_id=engine.id,
            status_id=in_service.id,
        )
        db_session.add(unit)
        await db_session.flush()
        officer = await _fresh_officer(db_session, officer.id)

        archived = await apparatus_endpoints.archive_apparatus(
            apparatus_id=unit.id,
            archive_data=ApparatusArchive(disposal_method="sold"),
            db=db_session,
            current_user=officer,
        )

        body = ApparatusResponse.model_validate(archived).model_dump()
        assert body["is_archived"] is True
        assert body["apparatus_type"]["name"] == "Engine"
        # The service picks any active archived status, and a system-wide one
        # may come first, so check the kind rather than the name.
        assert body["status_record"]["id"] == body["status_id"]
        assert body["status_record"]["is_archived_status"] is True


class TestFacilityArchiveAndRestore:
    async def _facility(self, db_session):
        org, officer = await _department(db_session)
        station = FacilityType(id=_uid(), organization_id=org.id, name="Station")
        operational = FacilityStatus(
            id=_uid(), organization_id=org.id, name="Operational"
        )
        db_session.add_all([station, operational])
        await db_session.flush()
        facility = Facility(
            id=_uid(),
            organization_id=org.id,
            name="Station 1",
            facility_type_id=station.id,
            status_id=operational.id,
        )
        db_session.add(facility)
        await db_session.flush()
        return officer, facility.id

    async def test_archive_returns_the_facility_with_its_type_and_status(
        self, db_session
    ):
        officer, facility_id = await self._facility(db_session)
        officer = await _fresh_officer(db_session, officer.id)

        body = await facility_endpoints.archive_facility(
            facility_id=facility_id, db=db_session, current_user=officer
        )

        assert body.is_archived is True
        assert body.facility_type.name == "Station"
        assert body.status_record.name == "Operational"

    async def test_restore_returns_the_facility_with_its_type_and_status(
        self, db_session
    ):
        officer, facility_id = await self._facility(db_session)
        officer = await _fresh_officer(db_session, officer.id)
        await facility_endpoints.archive_facility(
            facility_id=facility_id, db=db_session, current_user=officer
        )
        officer = await _fresh_officer(db_session, officer.id)

        body = await facility_endpoints.restore_facility(
            facility_id=facility_id, db=db_session, current_user=officer
        )

        assert body.is_archived is False
        assert body.facility_type.name == "Station"
        assert body.status_record.name == "Operational"
