"""Migration c56303befb2c and the model-side derivation of ``document_id``.

The backfill runs against the real database through ``db_session`` (DML only,
so the per-test rollback still discards it). The derivation the model applies
on every write is checked without a database: the backfill and the model must
agree on what counts as a reference, or a pre-migration row and a
post-migration row for the same document would be matched differently.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.facilities import FacilityDocument, FacilityPhoto, shared_document_id

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_c56303befb2c_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

DOC = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e"

# Every spelling UUID() accepts, plus the ones it does not.
_SPELLINGS = {
    f"document:{DOC}": DOC,
    f"document:{DOC.upper()}": DOC,
    f"document:{{{DOC}}}": DOC,
    f"document:{DOC.replace('-', '')}": DOC,
    f"document:urn:uuid:{DOC}": DOC,
    "document:not-a-uuid": None,
    "document:": None,
    f"/uploads/facilities/{DOC}.pdf": None,
}


def _migration():
    spec = importlib.util.spec_from_file_location("_fac41_backfill", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.unit
class TestDerivation:
    @pytest.mark.parametrize(("file_path", "expected"), list(_SPELLINGS.items()))
    def test_model_and_migration_agree(self, file_path, expected):
        assert shared_document_id(file_path) == expected
        assert _migration()._canonical_document_id(file_path) == expected

    @pytest.mark.parametrize("model", [FacilityDocument, FacilityPhoto])
    def test_set_on_construction(self, model):
        row = model(file_path=f"document:{DOC.upper()}", file_name="a.pdf")
        assert row.document_id == DOC

    @pytest.mark.parametrize("model", [FacilityDocument, FacilityPhoto])
    def test_follows_a_reassigned_file_path(self, model):
        row = model(file_path=f"document:{DOC}", file_name="a.pdf")
        row.file_path = "/uploads/legacy.pdf"
        assert row.document_id is None


async def _insert_org(db_session: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Backfill VFD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"fac41-bf-{org_id[:8]}"},
    )
    return org_id


async def _insert_facility(db_session: AsyncSession, org_id: str) -> str:
    type_id, status_id, facility_id = (str(uuid.uuid4()) for _ in range(3))
    await db_session.execute(
        text(
            "INSERT INTO facility_types (id, name, is_system, is_active) "
            "VALUES (:id, 'Station', 1, 1)"
        ),
        {"id": type_id},
    )
    await db_session.execute(
        text(
            "INSERT INTO facility_statuses (id, name, is_system, is_active) "
            "VALUES (:id, 'In service', 1, 1)"
        ),
        {"id": status_id},
    )
    await db_session.execute(
        text(
            "INSERT INTO facilities "
            "(id, organization_id, name, facility_type_id, status_id) "
            "VALUES (:id, :org, 'Station 1', :type_id, :status_id)"
        ),
        {"id": facility_id, "org": org_id, "type_id": type_id, "status_id": status_id},
    )
    return facility_id


async def _insert_rows(db_session, table, org_id, facility_id):
    """Rows as a pre-migration build wrote them: ``document_id`` NULL."""
    ids = {}
    for file_path in _SPELLINGS:
        row_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                f"INSERT INTO {table} "
                "(id, organization_id, facility_id, file_path, file_name) "
                "VALUES (:id, :org, :facility, :path, 'a.pdf')"
            ),
            {"id": row_id, "org": org_id, "facility": facility_id, "path": file_path},
        )
        ids[row_id] = file_path
    return ids


async def _document_ids(db_session, table, org_id):
    result = await db_session.execute(
        text(f"SELECT id, document_id FROM {table} WHERE organization_id = :org"),
        {"org": org_id},
    )
    return dict(result.fetchall())


@pytest.mark.integration
class TestBackfillAgainstARealDatabase:
    @pytest.mark.parametrize("table", ["facility_documents", "facility_photos"])
    async def test_backfills_every_parseable_reference_once(
        self, db_session: AsyncSession, table
    ):
        org_id = await _insert_org(db_session)
        facility_id = await _insert_facility(db_session, org_id)
        rows = await _insert_rows(db_session, table, org_id, facility_id)
        module = _migration()
        connection = await db_session.connection()

        written = await connection.run_sync(
            lambda sync: module.backfill_document_ids(sync, table)
        )
        stored = await _document_ids(db_session, table, org_id)

        assert written >= sum(1 for v in _SPELLINGS.values() if v)
        for row_id, file_path in rows.items():
            assert stored[row_id] == _SPELLINGS[file_path], file_path

        # Idempotent: nothing of this organization's is left to write.
        await connection.run_sync(
            lambda sync: module.backfill_document_ids(sync, table)
        )
        assert await _document_ids(db_session, table, org_id) == stored
