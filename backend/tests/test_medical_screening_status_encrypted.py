"""``screening_records.status`` is ciphertext at rest (MS-18, owner decision 2026-11-04).

The provider, results and notes were already encrypted, but the status beside
them was a plain ENUM, so a dump of the table still read "Jordan Avery —
physical — failed". The column is now ``EncryptedEnum``: the database cannot
compare it, so every reader that filtered on it in SQL now filters in Python.
These tests pin what is stored, and that the filters that moved still answer
the same. The expiring list, the Members hub's missed-appointment item and the
pipeline's screening gate keep their own suites, which run on the new path.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningStatus,
    ScreeningType,
)
from app.schemas.medical_screening import ScreeningRecordCreate
from app.services.medical_screening_service import MedicalScreeningService
from app.utils.enum_normalization import _TARGET_COLUMNS as NORMALIZED_ENUM_COLUMNS

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def scene(db_session, setup_org_and_admin):
    org_id, _ = setup_org_and_admin
    member_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Jordan', 'Avery', :em, 'x', 'active')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"m-{member_id[:8]}",
            "em": f"m-{member_id[:8]}@test.com",
        },
    )
    return SimpleNamespace(org_id=org_id, member_id=member_id)


async def _raw_status(db, record_id: str) -> str:
    return (
        await db.execute(
            text("SELECT status FROM screening_records WHERE id = :id"),
            {"id": record_id},
        )
    ).scalar_one()


class TestWhatIsStored:
    async def test_a_failed_result_is_ciphertext_in_the_table(self, db_session, scene):
        record = await MedicalScreeningService(db_session).create_record(
            scene.org_id,
            ScreeningRecordCreate(
                user_id=scene.member_id,
                screening_type=ScreeningType.PHYSICAL_EXAM,
                status=ScreeningStatus.FAILED,
                completed_date=date.today() - timedelta(days=3),
            ),
        )

        raw = await _raw_status(db_session, record.id)

        assert raw.startswith("$gcm2$")
        assert "fail" not in raw.lower()
        reread = (
            await db_session.execute(
                select(ScreeningRecord)
                .where(ScreeningRecord.id == record.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert reread.status is ScreeningStatus.FAILED

    async def test_an_edit_writes_ciphertext_too(self, db_session, scene):
        service = MedicalScreeningService(db_session)
        record = await service.create_record(
            scene.org_id,
            ScreeningRecordCreate(
                user_id=scene.member_id,
                screening_type=ScreeningType.DRUG_SCREENING,
                status=ScreeningStatus.SCHEDULED,
            ),
        )
        before = await _raw_status(db_session, record.id)

        from app.schemas.medical_screening import ScreeningRecordUpdate

        await service.update_record(
            record.id,
            scene.org_id,
            ScreeningRecordUpdate(status=ScreeningStatus.PASSED),
        )

        after = await _raw_status(db_session, record.id)
        assert after.startswith("$gcm2$")
        assert after != before
        assert "pass" not in after.lower()


class TestTheRecordsFilter:
    """``GET /records?status=`` filtered in SQL; it now filters, then pages."""

    async def _seed(self, db, scene):
        service = MedicalScreeningService(db)
        statuses = [
            ScreeningStatus.FAILED,
            ScreeningStatus.PASSED,
            ScreeningStatus.FAILED,
            ScreeningStatus.SCHEDULED,
            ScreeningStatus.FAILED,
        ]
        ids = []
        for status in statuses:
            record = await service.create_record(
                scene.org_id,
                ScreeningRecordCreate(
                    user_id=scene.member_id,
                    screening_type=ScreeningType.PHYSICAL_EXAM,
                    status=status,
                ),
            )
            ids.append((record.id, status))
        return service, ids

    async def test_returns_only_the_status_asked_for(self, db_session, scene):
        service, ids = await self._seed(db_session, scene)

        failed = await service.list_records(scene.org_id, status="failed")

        assert {r.id for r in failed} == {
            rid for rid, s in ids if s is ScreeningStatus.FAILED
        }
        assert all(r.status is ScreeningStatus.FAILED for r in failed)

    async def test_pages_after_filtering(self, db_session, scene):
        """Paging in SQL before filtering in Python would hand back a short or
        empty page while matches existed further on."""
        service, _ = await self._seed(db_session, scene)
        everything = await service.list_records(scene.org_id, status="failed")

        page = await service.list_records(
            scene.org_id, status="failed", skip=1, limit=1
        )

        assert [r.id for r in page] == [everything[1].id]

    async def test_an_unknown_status_matches_nothing(self, db_session, scene):
        service, _ = await self._seed(db_session, scene)

        assert await service.list_records(scene.org_id, status="approved") == []


def test_startup_enum_repair_leaves_the_encrypted_column_alone():
    """``normalize_legacy_enum_case`` treats any non-ENUM column it lists as
    broken and rewrites it to ``VARCHAR(64)``, then back to an ENUM: on
    ciphertext that is every row truncated or refused on each startup."""
    listed = {(c.table, c.column) for c in NORMALIZED_ENUM_COLUMNS}

    assert ("screening_records", "status") not in listed
    # The type is ciphertext too since 2026-11-06 (see
    # test_medical_screening_type_encrypted.py); the requirement's stays an ENUM.
    assert ("screening_records", "screening_type") not in listed
    assert ("screening_requirements", "screening_type") in listed
