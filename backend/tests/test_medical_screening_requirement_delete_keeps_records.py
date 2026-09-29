"""
Deleting a screening requirement unlinks its records; it does not delete them.

`screening_records.requirement_id` is `ondelete="SET NULL"` and nullable, so a
record was always meant to outlive the requirement it was filed against. The
ORM relationship said otherwise: `cascade="all, delete-orphan"` made
SQLAlchemy delete every linked record before the database's SET NULL could
apply, so removing a requirement from the catalogue silently destroyed the
members' medical screening history filed under it.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.services.medical_screening_service import MedicalScreeningService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_org(db_session: AsyncSession) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"ms-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def _make_requirement_with_record(db_session: AsyncSession, org_id: str):
    req = ScreeningRequirement(
        id=_uid(),
        organization_id=org_id,
        name="Annual Physical",
        screening_type=ScreeningType.PHYSICAL_EXAM,
    )
    db_session.add(req)
    await db_session.flush()
    rec = ScreeningRecord(
        id=_uid(),
        organization_id=org_id,
        requirement_id=req.id,
        screening_type=ScreeningType.PHYSICAL_EXAM,
        status=ScreeningStatus.PASSED,
    )
    db_session.add(rec)
    await db_session.flush()
    return req.id, rec.id


async def _stored_requirement_id(db_session: AsyncSession, record_id: str):
    """Read the row as stored, bypassing any identity-map copy."""
    return (
        await db_session.execute(
            text("SELECT requirement_id FROM screening_records WHERE id = :id"),
            {"id": record_id},
        )
    ).one_or_none()


class TestDeleteRequirementKeepsRecords:
    async def test_linked_record_survives_with_requirement_unlinked(
        self, db_session: AsyncSession
    ):
        org_id = await _make_org(db_session)
        req_id, rec_id = await _make_requirement_with_record(db_session, org_id)
        # Start from a clean session so the delete sees no preloaded
        # collection -- the shape of a real request.
        db_session.expunge_all()

        svc = MedicalScreeningService(db_session)
        assert await svc.delete_requirement(req_id, org_id) is True

        row = await _stored_requirement_id(db_session, rec_id)
        assert row is not None, "the linked screening record was deleted"
        assert row[0] is None

        requirement = await db_session.execute(
            select(ScreeningRequirement).where(ScreeningRequirement.id == req_id)
        )
        assert requirement.scalar_one_or_none() is None

    async def test_loaded_record_survives_too(self, db_session: AsyncSession):
        """With the collection already in the session, the ORM (not the DB)
        decides -- it must unlink rather than delete there as well."""
        org_id = await _make_org(db_session)
        req_id, rec_id = await _make_requirement_with_record(db_session, org_id)
        req = await db_session.get(ScreeningRequirement, req_id)
        await db_session.refresh(req, ["records"])
        assert [r.id for r in req.records] == [rec_id]

        svc = MedicalScreeningService(db_session)
        assert await svc.delete_requirement(req_id, org_id) is True

        row = await _stored_requirement_id(db_session, rec_id)
        assert row is not None, "the linked screening record was deleted"
        assert row[0] is None

    async def test_other_org_cannot_delete_the_requirement(
        self, db_session: AsyncSession
    ):
        org_id = await _make_org(db_session)
        other_org_id = await _make_org(db_session)
        req_id, rec_id = await _make_requirement_with_record(db_session, org_id)

        svc = MedicalScreeningService(db_session)
        assert await svc.delete_requirement(req_id, other_org_id) is False

        row = await _stored_requirement_id(db_session, rec_id)
        assert row is not None
        assert row[0] == req_id

    async def test_unlinked_record_still_lists_and_grades(
        self, db_session: AsyncSession
    ):
        """Readers of the record cope with a NULL requirement: the list
        resolves no requirement name, and compliance still grades by
        screening type against the remaining requirements."""
        org_id = await _make_org(db_session)
        req_id, rec_id = await _make_requirement_with_record(db_session, org_id)
        svc = MedicalScreeningService(db_session)
        await svc.delete_requirement(req_id, org_id)
        db_session.expunge_all()

        records = await svc.list_records(org_id)
        assert [r.id for r in records] == [rec_id]
        assert records[0].requirement_id is None
        assert getattr(records[0], "requirement_name", None) is None
