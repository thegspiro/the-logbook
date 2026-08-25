"""
Explicit-null updates on NOT NULL medical-screening columns are a clean 400.

`status`/`screening_type` (records) and `name`/`screening_type` (requirements)
are NOT NULL columns, but the request schemas' field validators pass `None`
through untouched (they only validate a *supplied* enum value). Before this
fix, `update_record`/`update_requirement` wrote the field with a bare
`setattr` and no null guard, so an explicit `{"status": null}` reached
`db.flush()` unguarded and 500'd as a raw IntegrityError -- the same failure
shape MS2-5 already fixed for an out-of-enum string, just for the null case.
`apply_updates` now rejects the null before the write with a clean 400.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.schemas.medical_screening import (
    ScreeningRecordUpdate,
    ScreeningRequirementUpdate,
)
from app.services.medical_screening_service import MedicalScreeningService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org(db_session: AsyncSession):
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


@pytest.fixture
async def requirement(db_session: AsyncSession, org):
    req = ScreeningRequirement(
        id=_uid(),
        organization_id=org,
        name="Annual Physical",
        screening_type=ScreeningType.PHYSICAL_EXAM,
    )
    db_session.add(req)
    await db_session.flush()
    return req


@pytest.fixture
async def record(db_session: AsyncSession, org):
    rec = ScreeningRecord(
        id=_uid(),
        organization_id=org,
        screening_type=ScreeningType.PHYSICAL_EXAM,
        status=ScreeningStatus.SCHEDULED,
    )
    db_session.add(rec)
    await db_session.flush()
    return rec


class TestUpdateRecordExplicitNullGuard:
    async def test_null_status_is_refused_not_a_500(
        self, db_session: AsyncSession, org, record
    ):
        svc = MedicalScreeningService(db_session)
        # model_validate reproduces exactly what FastAPI does parsing a real
        # `{"status": null}` request body -- "status" lands in
        # model_fields_set even though its value is None.
        data = ScreeningRecordUpdate.model_validate({"status": None})

        with pytest.raises(ValueError, match="cannot be cleared"):
            await svc.update_record(record.id, org, data)

        # apply_updates raises before writing the field it rejects, so the
        # record was never actually mutated.
        assert record.status == ScreeningStatus.SCHEDULED

    async def test_ordinary_update_still_works(
        self, db_session: AsyncSession, org, record
    ):
        svc = MedicalScreeningService(db_session)
        data = ScreeningRecordUpdate(status="passed", notes="cleared")

        updated = await svc.update_record(record.id, org, data)

        assert updated.status == "passed"
        assert updated.notes == "cleared"


class TestUpdateRequirementExplicitNullGuard:
    async def test_null_name_is_refused_not_a_500(
        self, db_session: AsyncSession, org, requirement
    ):
        svc = MedicalScreeningService(db_session)
        data = ScreeningRequirementUpdate.model_validate({"name": None})

        with pytest.raises(ValueError, match="cannot be cleared"):
            await svc.update_requirement(requirement.id, org, data)

        # apply_updates raises before writing the field it rejects, so the
        # requirement was never actually mutated.
        assert requirement.name == "Annual Physical"

    async def test_ordinary_update_still_works(
        self, db_session: AsyncSession, org, requirement
    ):
        svc = MedicalScreeningService(db_session)
        data = ScreeningRequirementUpdate(name="Updated Physical", is_active=False)

        updated = await svc.update_requirement(requirement.id, org, data)

        assert updated.name == "Updated Physical"
        assert updated.is_active is False
