"""A screening record's type and requirement link are ciphertext at rest
(MS-18, owner decision 2026-11-06: "type + link + audit").

With the status already encrypted, a dump still read "this member —
psychological evaluation", and the plain ``requirement_id`` led to a
requirement named "Pre-membership Drug Screen" anyway. Both columns are now
encrypted, the database foreign key on the link is gone, and every reader
matches them in Python. These tests pin what is stored, the type filter that
moved out of SQL, and the requirement deletion that now clears links in code.
"""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.schemas.medical_screening import ScreeningRecordCreate
from app.services.medical_screening_service import MedicalScreeningService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"mt-{org_id[:8]}"},
    )
    return org_id


async def _member(db, org_id: str) -> str:
    member_id = _uid()
    await db.execute(
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
    return member_id


async def _requirement(db, org_id: str, kind=ScreeningType.PSYCHOLOGICAL) -> str:
    req = ScreeningRequirement(
        id=_uid(),
        organization_id=org_id,
        name="Psychological Evaluation",
        screening_type=kind,
        frequency_months=12,
    )
    db.add(req)
    await db.flush()
    return req.id


@pytest.fixture
async def scene(db_session):
    org_id = await _org(db_session)
    member_id = await _member(db_session, org_id)
    req_id = await _requirement(db_session, org_id)
    return SimpleNamespace(org_id=org_id, member_id=member_id, req_id=req_id)


async def _raw(db, record_id: str):
    return (
        await db.execute(
            text(
                "SELECT screening_type, requirement_id FROM screening_records "
                "WHERE id = :id"
            ),
            {"id": record_id},
        )
    ).one()


async def _reread(db, record_id: str) -> ScreeningRecord:
    return (
        await db.execute(
            select(ScreeningRecord)
            .where(ScreeningRecord.id == record_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _create(db, scene, kind=ScreeningType.PSYCHOLOGICAL, linked=True):
    return await MedicalScreeningService(db).create_record(
        scene.org_id,
        ScreeningRecordCreate(
            user_id=scene.member_id,
            requirement_id=scene.req_id if linked else None,
            screening_type=kind,
            status=ScreeningStatus.PASSED,
        ),
    )


class TestWhatIsStored:
    async def test_type_and_link_are_ciphertext_and_read_back(self, db_session, scene):
        record = await _create(db_session, scene)

        raw_type, raw_link = await _raw(db_session, record.id)

        assert raw_type.startswith("$gcm2$") and "psych" not in raw_type
        assert raw_link.startswith("$gcm2$") and scene.req_id not in raw_link
        reread = await _reread(db_session, record.id)
        assert reread.screening_type is ScreeningType.PSYCHOLOGICAL
        assert reread.requirement_id == scene.req_id

    async def test_an_unlinked_record_stores_null(self, db_session, scene):
        record = await _create(db_session, scene, linked=False)

        _, raw_link = await _raw(db_session, record.id)

        assert raw_link is None

    async def test_the_database_has_no_foreign_key_on_the_link(self, db_session):
        rows = await db_session.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'screening_records' "
                "AND COLUMN_NAME = 'requirement_id' "
                "AND REFERENCED_TABLE_NAME IS NOT NULL"
            )
        )
        assert rows.scalar_one() == 0

    def test_sql_comparison_on_either_column_is_refused(self):
        with pytest.raises(TypeError, match="encrypted at rest"):
            _ = ScreeningRecord.screening_type == "psychological"
        with pytest.raises(TypeError, match="encrypted at rest"):
            ScreeningRecord.requirement_id.in_(["x"])


class TestTheTypeFilter:
    async def test_filters_after_decryption_then_pages(self, db_session, scene):
        service = MedicalScreeningService(db_session)
        kinds = [
            ScreeningType.PSYCHOLOGICAL,
            ScreeningType.DRUG_SCREENING,
            ScreeningType.PSYCHOLOGICAL,
            ScreeningType.PHYSICAL_EXAM,
            ScreeningType.PSYCHOLOGICAL,
        ]
        for kind in kinds:
            await _create(db_session, scene, kind=kind, linked=False)

        psych = await service.list_records(scene.org_id, screening_type="psychological")
        page = await service.list_records(
            scene.org_id, screening_type="psychological", skip=1, limit=1
        )

        assert len(psych) == 3
        assert all(r.screening_type is ScreeningType.PSYCHOLOGICAL for r in psych)
        assert [r.id for r in page] == [psych[1].id]

    async def test_type_and_status_filters_combine(self, db_session, scene):
        service = MedicalScreeningService(db_session)
        await _create(
            db_session, scene, kind=ScreeningType.DRUG_SCREENING, linked=False
        )

        assert (
            await service.list_records(
                scene.org_id, screening_type="drug_screening", status="failed"
            )
            == []
        )
        assert (
            len(
                await service.list_records(
                    scene.org_id, screening_type="drug_screening", status="passed"
                )
            )
            == 1
        )


class TestDeletingARequirementClearsLinksInCode:
    async def test_the_records_survive_unlinked(self, db_session, scene):
        record = await _create(db_session, scene)
        db_session.expunge_all()

        assert await MedicalScreeningService(db_session).delete_requirement(
            scene.req_id, scene.org_id
        )

        _, raw_link = await _raw(db_session, record.id)
        assert raw_link is None
        reread = await _reread(db_session, record.id)
        assert reread.screening_type is ScreeningType.PSYCHOLOGICAL

    async def test_another_organizations_records_are_not_touched(
        self, db_session, scene
    ):
        """The clear is org-scoped: it reads only the deleting org's records.
        A record elsewhere carrying the same id (written another way) keeps it."""
        other_org = await _org(db_session)
        other_member = await _member(db_session, other_org)
        stray = ScreeningRecord(
            id=_uid(),
            organization_id=other_org,
            user_id=other_member,
            requirement_id=scene.req_id,
            screening_type=ScreeningType.PSYCHOLOGICAL,
            status=ScreeningStatus.PASSED,
        )
        db_session.add(stray)
        await db_session.flush()

        await MedicalScreeningService(db_session).delete_requirement(
            scene.req_id, scene.org_id
        )

        reread = await _reread(db_session, stray.id)
        assert reread.requirement_id == scene.req_id
