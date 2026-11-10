"""
Deleting a screening requirement unlinks its records; it does not delete them.

A record was always meant to outlive the requirement it was filed against.
The ORM relationship once said otherwise: `cascade="all, delete-orphan"` made
SQLAlchemy delete every linked record before the database's SET NULL could
apply, so removing a requirement from the catalogue silently destroyed the
members' medical screening history filed under it.

Since MS-18 (2026-11-06) the link is ciphertext with no foreign key and no
relationship, and `MedicalScreeningService.delete_requirement` clears it in
code; these tests hold that path to the same outcome.
"""

import uuid

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.schemas.medical_screening import ScreeningRecordUpdate
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
        """With the record already in the session, the in-session copy is
        the one unlinked and flushed -- it must not be deleted either."""
        org_id = await _make_org(db_session)
        req_id, rec_id = await _make_requirement_with_record(db_session, org_id)
        loaded = await db_session.get(ScreeningRecord, rec_id)
        assert loaded is not None
        assert loaded.requirement_id == req_id

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
        # Stored as ciphertext (MS-18); still the same link once decrypted.
        record = (
            await db_session.execute(
                select(ScreeningRecord)
                .where(ScreeningRecord.id == rec_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert record.requirement_id == req_id

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


class _ForUpdateLog:
    """Collect the SELECT ... FOR UPDATE statements a block of work runs."""

    def __init__(self, db_session: AsyncSession) -> None:
        self._engine = db_session.bind.sync_engine
        self.locked: list[str] = []

    def _on_execute(self, conn, cursor, statement, params, context, executemany):
        flat = " ".join(statement.split())
        if flat.upper().startswith("SELECT") and "FOR UPDATE" in flat.upper():
            self.locked.append(flat)

    def __enter__(self) -> "_ForUpdateLog":
        event.listen(self._engine, "before_cursor_execute", self._on_execute)
        return self

    def __exit__(self, *exc) -> None:
        event.remove(self._engine, "before_cursor_execute", self._on_execute)

    def locks(self, table: str) -> bool:
        return any(f"FROM {table}" in s for s in self.locked)


class TestDeleteAndLinkAreSerialized:
    """With no foreign key behind the encrypted link (MS-18), a save that
    links a record and a delete of that requirement must not interleave: the
    save checks the requirement exists, the delete unlinks the records it can
    see and removes the requirement, and the save then commits a link to a
    requirement that is gone. Both lock the requirement row, and the delete's
    scan of records is a locking read, so it sees a link committed while it
    waited (pitfall #27)."""

    async def test_delete_locks_the_requirement_and_reads_records_locking(
        self, db_session: AsyncSession
    ):
        org_id = await _make_org(db_session)
        req_id, _ = await _make_requirement_with_record(db_session, org_id)
        db_session.expunge_all()

        with _ForUpdateLog(db_session) as log:
            assert await MedicalScreeningService(db_session).delete_requirement(
                req_id, org_id
            )

        assert log.locks("screening_requirements")
        assert log.locks("screening_records")

    async def test_relinking_a_record_locks_the_requirement(
        self, db_session: AsyncSession
    ):
        org_id = await _make_org(db_session)
        _, rec_id = await _make_requirement_with_record(db_session, org_id)
        other = ScreeningRequirement(
            id=_uid(),
            organization_id=org_id,
            name="Drug Screen",
            screening_type=ScreeningType.DRUG_SCREENING,
        )
        db_session.add(other)
        await db_session.flush()

        with _ForUpdateLog(db_session) as log:
            await MedicalScreeningService(db_session).update_record(
                rec_id, org_id, ScreeningRecordUpdate(requirement_id=other.id)
            )

        assert log.locks("screening_requirements")
