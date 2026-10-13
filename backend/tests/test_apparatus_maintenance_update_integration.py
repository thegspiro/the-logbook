"""``update_maintenance_record`` write semantics, proved through real SQL.

The request schema types every field ``Optional``, but two of the columns behind
it are ``NOT NULL`` (``maintenance_type_id`` and ``is_completed``). An update
that explicitly sends ``null`` for either therefore has to be refused cleanly:
the service used to apply updates with a bare ``setattr`` loop, which wrote the
``None`` straight onto the row and let the database reject it at commit, so the
caller got an ``IntegrityError`` surfaced as a 500 instead of a 400.

A mocked session cannot show this -- it never evaluates a constraint -- which is
why these run against the real schema. The nullable half is paired with the
NOT NULL half on purpose: without it, a guard that rejected *every* null would
pass this file.
"""

import uuid
from datetime import date

import pytest

from app.models.apparatus import (
    Apparatus,
    ApparatusMaintenanceType,
    ApparatusStatus,
    ApparatusType,
)
from app.models.user import Organization, User
from app.schemas.apparatus import (
    ApparatusMaintenanceCreate,
    ApparatusMaintenanceUpdate,
)
from app.services.apparatus_service import ApparatusService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Mine",
        slug=f"mine-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _actor(db_session, org: Organization) -> str:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"actor-{suffix}",
        email=f"actor-{suffix}@example.org",
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _record(db_session):
    """A saved maintenance record with every clearable column populated."""
    org = await _org(db_session)
    actor = await _actor(db_session, org)

    apparatus_type = ApparatusType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Engine",
        code=f"ENG{uuid.uuid4().hex[:4]}",
    )
    status = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="In Service",
        code=f"IS{uuid.uuid4().hex[:4]}",
    )
    maint_type = ApparatusMaintenanceType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Annual",
        code=f"MT{uuid.uuid4().hex[:4]}",
    )
    db_session.add_all([apparatus_type, status, maint_type])
    await db_session.flush()

    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number=f"E-{uuid.uuid4().hex[:5]}",
        apparatus_type_id=apparatus_type.id,
        status_id=status.id,
    )
    db_session.add(apparatus)
    await db_session.flush()

    service = ApparatusService(db_session)
    record = await service.create_maintenance_record(
        ApparatusMaintenanceCreate(
            apparatus_id=apparatus.id,
            maintenance_type_id=maint_type.id,
            vendor="Acme Fire Pumps",
            notes="Replace the primer valve",
            cost=420,
            due_date=date(2030, 1, 1),
        ),
        org.id,
        created_by=actor,
    )
    return service, org, actor, record, maint_type


class TestUpdateMaintenanceRecordNulls:
    async def test_an_explicit_null_clears_a_nullable_column(self, db_session):
        service, org, actor, record, _ = await _record(db_session)

        updated = await service.update_maintenance_record(
            record.id,
            ApparatusMaintenanceUpdate(vendor=None, notes=None, cost=None),
            org.id,
            updated_by=actor,
        )

        assert updated is not None
        assert updated.vendor is None
        assert updated.notes is None
        assert updated.cost is None

    async def test_a_field_left_out_of_the_payload_is_untouched(self, db_session):
        service, org, actor, record, _ = await _record(db_session)

        updated = await service.update_maintenance_record(
            record.id,
            ApparatusMaintenanceUpdate(vendor="Second Source Pumps"),
            org.id,
            updated_by=actor,
        )

        assert updated is not None
        assert updated.vendor == "Second Source Pumps"
        assert updated.notes == "Replace the primer valve"
        assert float(updated.cost) == 420.0

    async def test_a_null_maintenance_type_is_refused_not_a_500(self, db_session):
        service, org, actor, record, maint_type = await _record(db_session)

        with pytest.raises(ValueError, match="maintenance_type_id"):
            await service.update_maintenance_record(
                record.id,
                ApparatusMaintenanceUpdate(maintenance_type_id=None),
                org.id,
                updated_by=actor,
            )

        await db_session.refresh(record)
        assert record.maintenance_type_id == maint_type.id

    async def test_a_null_is_completed_is_refused_not_a_500(self, db_session):
        service, org, actor, record, _ = await _record(db_session)

        with pytest.raises(ValueError, match="is_completed"):
            await service.update_maintenance_record(
                record.id,
                ApparatusMaintenanceUpdate(is_completed=None),
                org.id,
                updated_by=actor,
            )

        await db_session.refresh(record)
        assert record.is_completed is False
