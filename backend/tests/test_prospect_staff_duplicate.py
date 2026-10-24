"""
Adding an applicant whose email an active applicant already holds.

The staff form said "Applicant added to pipeline" while ``create_prospect``
handed back the existing record unchanged, discarding the phone, position and
pipeline the officer typed, and the endpoint wrote a ``prospect_created`` audit
entry for a record nobody created. Owner decision: the staff path warns
instead. ``/check-existing`` names the existing applicant before submit, and
``POST /prospects`` refuses with a 409 whenever the service did not create.

The public application form keeps returning the existing applicant silently
(tests/test_prospect_duplicate_response.py); one test here pins that too.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.api.v1.endpoints import membership_pipeline as endpoints
from app.models.membership_pipeline import (
    ProspectiveMember,
    ProspectStatus,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.membership_pipeline import ProspectCreate
from app.services.membership_pipeline_service import (
    DuplicateApplicantError,
    MembershipPipelineService,
)

pytestmark = [pytest.mark.integration]


def _hex() -> str:
    return uuid.uuid4().hex[:8]


def _request() -> Request:
    return Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1)})


async def _org(db: AsyncSession) -> Organization:
    org = Organization(name="Duplicate Test VFD", slug=f"dup-{_hex()}")
    db.add(org)
    await db.flush()
    return org


async def _officer(db: AsyncSession, org: Organization) -> SimpleNamespace:
    user = User(
        organization_id=org.id,
        username=f"officer-{_hex()}",
        email=f"officer-{_hex()}@example.org",
        first_name="Casey",
        last_name="Officer",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    # Plain values, so the tests' expire_all() cannot turn the caller into a
    # lazy load from outside the async context.
    return SimpleNamespace(
        id=str(user.id), organization_id=str(org.id), username=user.username
    )


async def _pipeline(svc: MembershipPipelineService, org_id: str, name: str):
    pipeline = await svc.create_pipeline(organization_id=org_id, name=name)
    await svc.add_step(pipeline.id, org_id, {"name": "Application"})
    await svc.add_step(pipeline.id, org_id, {"name": "Interview"})
    return pipeline


async def _applicant(svc, org_id: str, email: str, pipeline_id: str) -> str:
    prospect = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Jordan",
            "last_name": "Vale",
            "email": email,
            "pipeline_id": pipeline_id,
        },
    )
    return str(prospect.id)


async def _check(db, officer, email):
    return await endpoints.check_existing_members_for_prospect(
        email=email,
        first_name=None,
        last_name=None,
        db=db,
        current_user=officer,
        hidden_prospect_ids=set(),
    )


async def _staff_create(db, officer, email, pipeline_id):
    return await endpoints.create_prospect(
        data=ProspectCreate(
            first_name="Jordan",
            last_name="Vale",
            email=email,
            phone="555-0100",
            pipeline_id=pipeline_id,
        ),
        request=_request(),
        db=db,
        current_user=officer,
        hidden_prospect_ids=set(),
    )


def _audited(audit: AsyncMock, event_type: str) -> bool:
    return any(c.kwargs.get("event_type") == event_type for c in audit.await_args_list)


async def _count_with_email(db: AsyncSession, org_id: str, email: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(ProspectiveMember)
            .where(
                ProspectiveMember.organization_id == org_id,
                ProspectiveMember.email == email,
            )
        )
    ).scalar_one()


class TestCheckExistingNamesTheApplicant:
    async def test_reports_an_active_applicant_with_pipeline_and_stage(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        org_id = str(org.id)
        officer = await _officer(db_session, org)
        svc = MembershipPipelineService(db_session)
        pipeline = await _pipeline(svc, org_id, "Career Pipeline")
        email = f"jordan-{_hex()}@example.org"
        prospect_id = await _applicant(svc, org_id, email, str(pipeline.id))
        db_session.expire_all()

        # Typed differently from the stored value, as an officer might.
        result = await _check(db_session, officer, f"  {email.upper()} ")

        assert result["existing_applicant"] == {
            "prospect_id": prospect_id,
            "name": "Jordan Vale",
            "pipeline_name": "Career Pipeline",
            "stage_name": "Application",
        }
        # Member matches keep their own meaning; an applicant is not a member.
        assert result["has_matches"] is False
        assert "email" not in result["existing_applicant"]

    async def test_reports_nothing_for_an_unknown_email(self, db_session: AsyncSession):
        org = await _org(db_session)
        officer = await _officer(db_session, org)

        result = await _check(db_session, officer, f"nobody-{_hex()}@example.org")

        assert result["existing_applicant"] is None

    async def test_does_not_report_another_organizations_applicant(
        self, db_session: AsyncSession
    ):
        other = await _org(db_session)
        other_id = str(other.id)
        svc = MembershipPipelineService(db_session)
        pipeline = await _pipeline(svc, other_id, "Their Pipeline")
        email = f"shared-{_hex()}@example.org"
        await _applicant(svc, other_id, email, str(pipeline.id))

        mine = await _org(db_session)
        officer = await _officer(db_session, mine)

        result = await _check(db_session, officer, email)

        assert result["existing_applicant"] is None

    @pytest.mark.parametrize(
        "closed_status",
        [
            ProspectStatus.WITHDRAWN,
            ProspectStatus.TRANSFERRED,
            ProspectStatus.INACTIVE,
            ProspectStatus.REJECTED,
            ProspectStatus.ON_HOLD,
        ],
    )
    async def test_does_not_report_an_applicant_who_is_not_active(
        self, db_session: AsyncSession, closed_status: ProspectStatus
    ):
        """Only ``active`` holds an email — the status the unique index keys on."""
        org = await _org(db_session)
        org_id = str(org.id)
        officer = await _officer(db_session, org)
        svc = MembershipPipelineService(db_session)
        pipeline = await _pipeline(svc, org_id, "Career Pipeline")
        email = f"closed-{_hex()}@example.org"
        prospect_id = await _applicant(svc, org_id, email, str(pipeline.id))
        await db_session.execute(
            update(ProspectiveMember)
            .where(ProspectiveMember.id == prospect_id)
            .values(status=closed_status)
        )
        await db_session.flush()
        db_session.expire_all()

        result = await _check(db_session, officer, email)

        assert result["existing_applicant"] is None


class TestStaffCreateRefusesAnExistingApplicant:
    async def test_duplicate_email_is_a_409_naming_the_applicant(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        org_id = str(org.id)
        officer = await _officer(db_session, org)
        svc = MembershipPipelineService(db_session)
        career = await _pipeline(svc, org_id, "Career Pipeline")
        volunteer = await _pipeline(svc, org_id, "Volunteer Pipeline")
        email = f"jordan-{_hex()}@example.org"
        await _applicant(svc, org_id, email, str(career.id))
        volunteer_id = str(volunteer.id)
        db_session.expire_all()

        audit = AsyncMock()
        with (
            patch.object(endpoints, "log_audit_event", audit),
            patch.object(
                MembershipPipelineService,
                "_notify_duplicate_application",
                AsyncMock(),
            ) as notify,
        ):
            with pytest.raises(HTTPException) as refused:
                await _staff_create(db_session, officer, email, volunteer_id)

        assert refused.value.status_code == 409
        detail = str(refused.value.detail)
        assert "Jordan Vale" in detail
        assert "Career Pipeline" in detail
        assert "Application" in detail
        assert "can't be added with the same email" in detail
        assert email not in detail
        assert not _audited(audit, "membership_pipeline.prospect_created")
        # A refused staff entry is not a re-submitted application, so the
        # applicant is not emailed about it.
        notify.assert_not_awaited()
        assert await _count_with_email(db_session, org_id, email) == 1

    async def test_a_new_email_is_still_created_and_audited(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        org_id = str(org.id)
        officer = await _officer(db_session, org)
        svc = MembershipPipelineService(db_session)
        pipeline = await _pipeline(svc, org_id, "Career Pipeline")
        pipeline_id = str(pipeline.id)
        email = f"fresh-{_hex()}@example.org"

        audit = AsyncMock()
        with patch.object(endpoints, "log_audit_event", audit):
            prospect = await _staff_create(db_session, officer, email, pipeline_id)

        assert prospect.email == email
        assert prospect.phone == "555-0100"
        assert str(prospect.pipeline_id) == pipeline_id
        assert _audited(audit, "membership_pipeline.prospect_created")

    async def test_a_race_caught_by_the_unique_index_is_refused_too(
        self, db_session: AsyncSession
    ):
        """The preflight lookup misses a concurrent insert; the index does not."""
        org = await _org(db_session)
        org_id = str(org.id)
        svc = MembershipPipelineService(db_session)
        pipeline = await _pipeline(svc, org_id, "Career Pipeline")
        pipeline_id = str(pipeline.id)
        email = f"race-{_hex()}@example.org"
        existing_id = await _applicant(svc, org_id, email, pipeline_id)
        db_session.expire_all()

        real_lookup = svc._find_active_prospect_by_email

        async def preflight_misses(organization_id, address, *, current_read=False):
            if not current_read:
                return None
            return await real_lookup(organization_id, address, current_read=True)

        with patch.object(svc, "_find_active_prospect_by_email", preflight_misses):
            with pytest.raises(DuplicateApplicantError) as refused:
                await svc.create_prospect(
                    organization_id=org_id,
                    data={
                        "first_name": "Jordan",
                        "last_name": "Vale",
                        "email": email,
                        "pipeline_id": pipeline_id,
                    },
                    reject_duplicate=True,
                )

        assert str(refused.value.existing.id) == existing_id


class TestPublicPathIsUnchanged:
    async def test_default_create_still_returns_the_existing_applicant(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        org_id = str(org.id)
        svc = MembershipPipelineService(db_session)
        pipeline = await _pipeline(svc, org_id, "Career Pipeline")
        email = f"public-{_hex()}@example.org"
        existing_id = await _applicant(svc, org_id, email, str(pipeline.id))

        with patch.object(
            MembershipPipelineService, "_notify_duplicate_application", AsyncMock()
        ) as notify:
            again = await _applicant(svc, org_id, email, str(pipeline.id))

        assert again == existing_id
        notify.assert_awaited_once()
