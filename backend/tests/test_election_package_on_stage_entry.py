"""
Election packages are created by the backend when an applicant reaches a vote.

The package used to be created by the frontend store's ``advanceApplicant``,
in a second request after the advance, so it existed only for applicants
moved by a single Advance click. Bulk advance, Skip, Back and placing an
applicant on a stage all landed them on an Election Vote stage with no
package: the drawer promised one would be "auto-generated", none ever was,
the applicant could not be put on a ballot, and — because the election gate
only grades a package that exists — they could be advanced with no vote at
all. Every one of those paths moves the applicant through this service, so
this service is where the package is decided.
"""

import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import ProspectElectionPackage
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


async def _pipeline(svc, org_id, step_types):
    """A pipeline whose stages have the given types, none of them required
    (so Skip is allowed) and the last one final."""
    pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
    steps = []
    for i, step_type in enumerate(step_types):
        data = {
            "name": f"Stage {i + 1} ({step_type})",
            "step_type": step_type,
            "required": False,
        }
        if step_type == "election_vote":
            # A configured field policy, so the test also proves the
            # stage's own configuration governs an automatically created
            # package exactly as it governs one made through the endpoint.
            data["config"] = {"package_fields": {"include_email": False}}
        steps.append(await svc.add_step(pipeline.id, org_id, data))
    return pipeline, steps


async def _prospect(svc, org_id, pipeline_id):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "App",
            "last_name": f"Licant{_uid()[:4]}",
            "email": f"a-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
        },
    )


async def _packages(db: AsyncSession, prospect_id: str):
    result = await db.execute(
        select(ProspectElectionPackage).where(
            ProspectElectionPackage.prospect_id == prospect_id
        )
    )
    return list(result.scalars().all())


async def _package_count(db: AsyncSession, prospect_id: str) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(ProspectElectionPackage)
        .where(ProspectElectionPackage.prospect_id == prospect_id)
    )
    return int(result.scalar_one())


class TestEnteringAVoteStageCreatesThePackage:
    async def test_single_advance_creates_exactly_one_package(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(
            svc, org_id, ["checkbox", "election_vote", "checkbox"]
        )
        p = await _prospect(svc, org_id, pipeline.id)

        await svc.advance_prospect(p.id, org_id, admin_id)

        packages = await _packages(db_session, p.id)
        assert len(packages) == 1
        pkg = packages[0]
        assert str(pkg.step_id) == str(steps[1].id)
        assert str(pkg.pipeline_id) == str(pipeline.id)
        assert pkg.status == "draft"
        # The stage's package_fields governed the snapshot.
        assert "email" not in pkg.applicant_snapshot
        # The stage the applicant just completed is in its history — the
        # snapshot is taken after the completion, not before it.
        assert [h["stage_name"] for h in pkg.applicant_snapshot["stage_history"]] == [
            steps[0].name
        ]

    async def test_bulk_advance_creates_exactly_one_package(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(
            svc, org_id, ["checkbox", "election_vote", "checkbox"]
        )
        a = await _prospect(svc, org_id, pipeline.id)
        b = await _prospect(svc, org_id, pipeline.id)

        results = await svc.bulk_advance_prospects([a.id, b.id], org_id, admin_id)

        assert all(r["succeeded"] for r in results), results
        for prospect in (a, b):
            packages = await _packages(db_session, prospect.id)
            assert len(packages) == 1
            assert str(packages[0].step_id) == str(steps[1].id)

    async def test_skip_creates_exactly_one_package(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(
            svc, org_id, ["checkbox", "election_vote", "checkbox"]
        )
        p = await _prospect(svc, org_id, pipeline.id)

        await svc.skip_current_step(p.id, org_id, admin_id)

        packages = await _packages(db_session, p.id)
        assert len(packages) == 1
        assert str(packages[0].step_id) == str(steps[1].id)

    async def test_moving_back_onto_a_vote_stage_creates_one(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Back lands on the previous stage; when that is the vote and no
        package exists for it (the applicant was placed past it), one is
        created."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(
            svc, org_id, ["election_vote", "checkbox", "checkbox"]
        )
        p = await _prospect(svc, org_id, pipeline.id)
        # Created on the vote stage: that is itself an entry.
        assert await _package_count(db_session, p.id) == 1
        await db_session.execute(
            ProspectElectionPackage.__table__.delete().where(
                ProspectElectionPackage.prospect_id == p.id
            )
        )
        await svc.advance_prospect(p.id, org_id, admin_id)
        assert await _package_count(db_session, p.id) == 0

        await svc.regress_prospect(p.id, org_id, admin_id)

        packages = await _packages(db_session, p.id)
        assert len(packages) == 1
        assert str(packages[0].step_id) == str(steps[0].id)

    async def test_a_vote_first_stage_gets_a_package_on_create(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, _ = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(svc, org_id, ["election_vote", "checkbox"])

        p = await _prospect(svc, org_id, pipeline.id)

        packages = await _packages(db_session, p.id)
        assert len(packages) == 1
        assert str(packages[0].step_id) == str(steps[0].id)

    async def test_assigning_a_stageless_applicant_to_a_vote_creates_one(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(
            svc, org_id, ["checkbox", "election_vote", "checkbox"]
        )
        p = await _prospect(svc, org_id, pipeline.id)
        p.current_step_id = None
        await db_session.flush()

        await svc.assign_stage(p.id, org_id, str(steps[1].id), admin_id)

        packages = await _packages(db_session, p.id)
        assert len(packages) == 1
        assert str(packages[0].step_id) == str(steps[1].id)

    async def test_deleting_a_stage_onto_a_vote_creates_one(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Deleting the stage an applicant sits on moves them to the next
        one; when that is the vote, they arrive with a package."""
        org_id, _ = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(
            svc, org_id, ["checkbox", "election_vote", "checkbox"]
        )
        p = await _prospect(svc, org_id, pipeline.id)

        assert await svc.delete_step(str(steps[0].id), str(pipeline.id), org_id)

        packages = await _packages(db_session, p.id)
        assert len(packages) == 1
        assert str(packages[0].step_id) == str(steps[1].id)


class TestReEntryAndOtherStages:
    async def test_re_entering_the_vote_stage_does_not_duplicate(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline(
            svc, org_id, ["checkbox", "election_vote", "checkbox", "checkbox"]
        )
        p = await _prospect(svc, org_id, pipeline.id)

        await svc.advance_prospect(p.id, org_id, admin_id)  # onto the vote
        await svc.regress_prospect(p.id, org_id, admin_id)  # off it, backwards
        await svc.skip_current_step(p.id, org_id, admin_id)  # onto it again
        await svc.advance_prospect(p.id, org_id, admin_id)  # past it
        await svc.regress_prospect(p.id, org_id, admin_id)  # back onto it

        assert await _package_count(db_session, p.id) == 1

    async def test_a_non_election_stage_creates_no_package(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline(
            svc, org_id, ["checkbox", "checkbox", "checkbox", "checkbox"]
        )
        p = await _prospect(svc, org_id, pipeline.id)
        q = await _prospect(svc, org_id, pipeline.id)

        await svc.advance_prospect(p.id, org_id, admin_id)
        await svc.skip_current_step(p.id, org_id, admin_id)
        await svc.regress_prospect(p.id, org_id, admin_id)
        await svc.bulk_advance_prospects([q.id], org_id, admin_id)

        assert await _package_count(db_session, p.id) == 0
        assert await _package_count(db_session, q.id) == 0

    async def test_the_explicit_endpoint_path_still_creates_on_request(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The drawer's Create package action (for applicants who reached the
        stage before this fix) goes through create_election_package, which
        is unchanged in what it returns."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(
            svc, org_id, ["checkbox", "election_vote", "checkbox"]
        )
        p = await _prospect(svc, org_id, pipeline.id)
        await svc.advance_prospect(p.id, org_id, admin_id)
        await db_session.execute(
            ProspectElectionPackage.__table__.delete().where(
                ProspectElectionPackage.prospect_id == p.id
            )
        )

        pkg = await svc.create_election_package(
            p.id,
            org_id,
            pipeline_id=str(pipeline.id),
            step_id=str(steps[1].id),
            created_by=admin_id,
        )

        assert pkg is not None
        assert pkg.created_at is not None
        assert "email" not in pkg.applicant_snapshot
        assert await _package_count(db_session, p.id) == 1
