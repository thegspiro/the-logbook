"""
An election package for an applicant who has no current stage.

``current_step_id`` is ``ondelete="SET NULL"``, so deleting the stage an
applicant stood on leaves them with no current step. ``create_election_package``
guards against a stale ``step_id`` by comparing it with the current stage, but
the guard read ``election_step is current_step`` — both ``None`` here — and then
dereferenced ``current_step.id``, so naming a valid stage raised
``AttributeError`` and the endpoint answered 500 instead of creating the package.
The guard is meant to fire only when the current stage *is* the election-vote
stage, which an absent stage never is.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_admin(db_session: AsyncSession):
    org_id = _uid()
    admin_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Admin', 'User', :em, 'hashed', 'active')"
        ),
        {
            "id": admin_id,
            "org": org_id,
            "un": f"admin-{org_id[:8]}",
            "em": f"admin-{org_id[:8]}@test.example",
        },
    )
    await db_session.flush()
    return org_id, admin_id


class TestElectionPackageWithoutCurrentStep:
    async def _applicant_with_no_current_stage(self, svc, db_session, org_id):
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        vote_step = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Membership Vote", "step_type": "election_vote"},
        )
        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "App",
                "last_name": f"Licant{_uid()[:4]}",
                "email": f"a-{_uid()[:8]}@example.com",
                "pipeline_id": pipeline.id,
            },
        )
        # What deleting the applicant's stage leaves behind (SET NULL).
        prospect.current_step_id = None
        await db_session.flush()
        return prospect, vote_step

    async def test_naming_a_stage_creates_the_package(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect, vote_step = await self._applicant_with_no_current_stage(
            svc, db_session, org_id
        )

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=vote_step.id, created_by=admin_id
        )

        assert pkg is not None
        assert str(pkg.step_id) == str(vote_step.id)

    async def test_omitting_the_stage_still_creates_the_package(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect, _vote_step = await self._applicant_with_no_current_stage(
            svc, db_session, org_id
        )

        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        assert pkg is not None
