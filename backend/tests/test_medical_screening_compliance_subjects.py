"""Two medical-screening compliance contracts, driven against the real schema.

MS-17: ``GET /compliance/{user_id}`` and ``/compliance/prospect/{prospect_id}``
graded any id they were handed. An id naming nobody in the caller's
organization answered 200 with a blank name and a verdict — fully compliant
when no requirement was active — for a member who does not exist. Both routes
now answer 404 for an id that is not a member or prospect of the caller's
organization, including a real one belonging to another organization.

MS2-7: a waived screening counts toward compliance, so one lapsing within 30
days raised ``expiring_soon_count``, while the expiring list that count links
to filtered on passed/completed only and never named it. Owner decision: list
it. The list now carries each row's status, so the screen can mark the waiver.

Integration: the expiring list's status filter is SQL, which a mocked session
does not evaluate.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import medical_screening as ep
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


async def _insert_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, active) VALUES (:id, 'Other FD', 'fire_department', :s, "
            "'UTC', 1)"
        ),
        {"id": org_id, "s": f"other-{org_id[:8]}"},
    )
    return org_id


async def _insert_member(db: AsyncSession, org_id: str) -> str:
    member_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Member', :em, 'x', 'active')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"m-{member_id[:8]}",
            "em": f"m-{member_id[:8]}@test.com",
        },
    )
    return member_id


async def _insert_prospect(db: AsyncSession, org_id: str) -> str:
    prospect_id = _uid()
    await db.execute(
        text(
            "INSERT INTO prospective_members (id, organization_id, first_name, "
            "last_name, email) VALUES (:id, :org, 'Sam', 'Applicant', :em)"
        ),
        {"id": prospect_id, "org": org_id, "em": f"p-{prospect_id[:8]}@test.com"},
    )
    return prospect_id


@pytest.fixture
async def scene(db_session: AsyncSession, setup_org_and_admin):
    org_id, officer_id = setup_org_and_admin
    other_org = await _insert_org(db_session)
    return SimpleNamespace(
        org_id=org_id,
        officer=SimpleNamespace(id=officer_id, organization_id=org_id, username="cpt"),
        member_id=await _insert_member(db_session, org_id),
        prospect_id=await _insert_prospect(db_session, org_id),
        foreign_member_id=await _insert_member(db_session, other_org),
        foreign_prospect_id=await _insert_prospect(db_session, other_org),
    )


class TestComplianceSubjectMustExist:
    """MS-17."""

    async def test_a_member_in_the_org_is_graded(self, db_session, scene):
        summary = await ep.get_user_compliance(
            user_id=scene.member_id, db=db_session, current_user=scene.officer
        )
        assert summary.subject_id == scene.member_id
        assert summary.subject_name == "Pat Member"

    @pytest.mark.parametrize("which", ["unknown", "foreign"])
    async def test_a_member_not_in_the_org_is_404(self, db_session, scene, which):
        user_id = _uid() if which == "unknown" else scene.foreign_member_id
        with pytest.raises(HTTPException) as exc:
            await ep.get_user_compliance(
                user_id=user_id, db=db_session, current_user=scene.officer
            )
        assert exc.value.status_code == 404

    async def test_a_prospect_in_the_org_is_graded(self, db_session, scene):
        summary = await ep.get_prospect_compliance(
            prospect_id=scene.prospect_id, db=db_session, current_user=scene.officer
        )
        assert summary.subject_id == scene.prospect_id
        assert summary.subject_name == "Sam Applicant"

    @pytest.mark.parametrize("which", ["unknown", "foreign"])
    async def test_a_prospect_not_in_the_org_is_404(self, db_session, scene, which):
        prospect_id = _uid() if which == "unknown" else scene.foreign_prospect_id
        with pytest.raises(HTTPException) as exc:
            await ep.get_prospect_compliance(
                prospect_id=prospect_id, db=db_session, current_user=scene.officer
            )
        assert exc.value.status_code == 404


class TestALapsingWaiverIsCountedAndListed:
    """MS2-7."""

    async def test_count_and_list_agree_on_a_waiver(self, db_session, scene):
        db_session.add(
            ScreeningRequirement(
                id=_uid(),
                organization_id=scene.org_id,
                name="Annual drug screen",
                screening_type=ScreeningType.DRUG_SCREENING,
                is_active=True,
            )
        )
        waiver = ScreeningRecord(
            id=_uid(),
            organization_id=scene.org_id,
            user_id=scene.member_id,
            screening_type=ScreeningType.DRUG_SCREENING,
            status=ScreeningStatus.WAIVED,
            completed_date=date.today() - timedelta(days=355),
            expiration_date=date.today() + timedelta(days=10),
        )
        db_session.add(waiver)
        await db_session.flush()
        service = MedicalScreeningService(db_session)

        summary = await service.get_compliance_status(
            scene.org_id, user_id=scene.member_id
        )
        listed = await service.get_expiring_soon(scene.org_id, days=30)

        assert summary.expiring_soon_count == 1
        assert [(row.record_id, row.status) for row in listed] == [
            (waiver.id, "waived")
        ]
