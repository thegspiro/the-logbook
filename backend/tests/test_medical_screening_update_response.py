"""A medical-screening edit returns the row it saved.

Workflow review W71: editing a record's expiration date was a 500 — after the
endpoint had committed, so the change was saved while the officer was told
it had failed. ``update_record`` and ``update_requirement`` flushed without
the refresh their create paths do, ``onupdate`` expired ``updated_at``, and
the response model's lazy read raised MissingGreenlet.
"""

import uuid
from datetime import date

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
    ScreeningRecordResponse,
    ScreeningRecordUpdate,
    ScreeningRequirementResponse,
    ScreeningRequirementUpdate,
)
from app.services.medical_screening_service import MedicalScreeningService

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def org(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"msu-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def test_editing_a_record_returns_it(db_session: AsyncSession, org):
    record = ScreeningRecord(
        id=str(uuid.uuid4()),
        organization_id=org,
        screening_type=ScreeningType.PHYSICAL_EXAM,
        status=ScreeningStatus.PASSED,
        completed_date=date(2025, 10, 20),
    )
    db_session.add(record)
    await db_session.flush()

    updated = await MedicalScreeningService(db_session).update_record(
        record.id, org, ScreeningRecordUpdate(expiration_date=date(2026, 10, 20))
    )
    response = ScreeningRecordResponse.model_validate(updated)
    assert response.expiration_date == date(2026, 10, 20)


async def test_editing_a_requirement_returns_it(db_session: AsyncSession, org):
    requirement = ScreeningRequirement(
        id=str(uuid.uuid4()),
        organization_id=org,
        name="Annual Physical",
        screening_type=ScreeningType.PHYSICAL_EXAM,
    )
    db_session.add(requirement)
    await db_session.flush()

    updated = await MedicalScreeningService(db_session).update_requirement(
        requirement.id, org, ScreeningRequirementUpdate(frequency_months=12)
    )
    assert ScreeningRequirementResponse.model_validate(updated).frequency_months == 12
