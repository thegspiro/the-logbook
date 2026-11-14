"""A prospect's screenings follow them into membership (W71b-2, owner decision).

Some departments screen applicants before the membership election, others
after they join. Screenings recorded after joining are filed against the
member already. Those recorded before were filed against the prospect, and
the transfer left them there: the new member read "0 of N met" and owed a
pre-membership drug screen they had passed a week earlier, while the records
sat on a TRANSFERRED prospect that no roster shows.

The transfer now sets ``user_id`` on the prospect's screening records and
keeps ``prospect_id``, so the pipeline's history of the applicant is intact
and every member-side read (compliance, roster, expiring list, anonymization)
finds them. Migration ``beedcad5b36a`` does the same for prospects
transferred before this change.
"""

import uuid
from datetime import date, timedelta

import pytest
from dateutil.relativedelta import relativedelta
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.services.medical_screening_service import MedicalScreeningService
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db_session: AsyncSession) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def _prospect(svc: MembershipPipelineService, org_id: str, pipeline_id: str):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Rowan",
            "last_name": f"Vale{_uid()[:4]}",
            "email": f"r-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
        },
    )


def _screening(
    org_id, prospect_id, kind, completed, expiration=None, requirement_id=None
):
    return ScreeningRecord(
        id=_uid(),
        organization_id=org_id,
        prospect_id=prospect_id,
        requirement_id=requirement_id,
        screening_type=kind,
        status=ScreeningStatus.PASSED,
        completed_date=completed,
        expiration_date=expiration,
    )


async def _records(db_session, prospect_id):
    return (
        (
            await db_session.execute(
                select(ScreeningRecord).where(
                    ScreeningRecord.prospect_id == str(prospect_id)
                )
            )
        )
        .scalars()
        .all()
    )


class TestTransferCarriesScreenings:
    async def test_the_new_member_holds_the_screenings_passed_as_an_applicant(
        self, db_session
    ):
        org_id = await _org(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        prospect = await _prospect(svc, org_id, str(pipeline.id))
        physical = ScreeningRequirement(
            id=_uid(),
            organization_id=org_id,
            name="Annual Physical",
            screening_type=ScreeningType.PHYSICAL_EXAM,
            frequency_months=12,
            is_active=True,
        )
        drug = ScreeningRequirement(
            id=_uid(),
            organization_id=org_id,
            name="Drug Screen",
            screening_type=ScreeningType.DRUG_SCREENING,
            is_active=True,
        )
        db_session.add_all([physical, drug])
        await db_session.flush()
        # Each linked to its requirement: a record counts only toward the
        # requirement it is linked to (owner decision 2026-11-01).
        db_session.add_all(
            [
                _screening(
                    org_id,
                    str(prospect.id),
                    ScreeningType.PHYSICAL_EXAM,
                    date.today() - timedelta(days=12),
                    date.today() + relativedelta(months=12),
                    requirement_id=physical.id,
                ),
                _screening(
                    org_id,
                    str(prospect.id),
                    ScreeningType.DRUG_SCREENING,
                    date.today() - timedelta(days=10),
                    requirement_id=drug.id,
                ),
            ]
        )
        await db_session.flush()

        result = await svc.transfer_to_membership(
            prospect_id=str(prospect.id),
            organization_id=org_id,
            transferred_by=None,
        )
        assert result["success"] is True, result
        user_id = result["user_id"]

        records = await _records(db_session, prospect.id)
        assert len(records) == 2
        assert {r.user_id for r in records} == {user_id}
        assert {r.prospect_id for r in records} == {str(prospect.id)}

        summary = await MedicalScreeningService(db_session).get_compliance_status(
            org_id, user_id=user_id
        )
        assert summary.compliant_count == 2
        assert summary.is_fully_compliant is True

    async def test_other_applicants_records_are_left_alone(self, db_session):
        org_id = await _org(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        joining = await _prospect(svc, org_id, str(pipeline.id))
        waiting = await _prospect(svc, org_id, str(pipeline.id))
        db_session.add(
            _screening(
                org_id,
                str(waiting.id),
                ScreeningType.DRUG_SCREENING,
                date.today() - timedelta(days=3),
            )
        )
        await db_session.flush()

        result = await svc.transfer_to_membership(
            prospect_id=str(joining.id),
            organization_id=org_id,
            transferred_by=None,
        )
        assert result["success"] is True, result

        (untouched,) = await _records(db_session, waiting.id)
        assert untouched.user_id is None

    async def test_a_prospect_with_no_screenings_transfers_as_before(self, db_session):
        org_id = await _org(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        prospect = await _prospect(svc, org_id, str(pipeline.id))

        result = await svc.transfer_to_membership(
            prospect_id=str(prospect.id),
            organization_id=org_id,
            transferred_by=None,
        )

        assert result["success"] is True, result
        assert await _records(db_session, prospect.id) == []
