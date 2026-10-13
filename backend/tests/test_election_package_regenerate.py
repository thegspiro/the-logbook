"""
Regenerating an election package replaces it (MP-10), and an ambiguous
election stage is refused with 422 (MP-26).

MP-10: every ``POST /prospects/{id}/election-package`` used to insert another
package, each carrying a PII-bearing applicant snapshot, so regenerating
after editing notes grew the table without bound. The owner chose
(2026-10-05) that regenerating replaces the prospect's draft/ready package.
Packages already on a ballot or decided are vote history and stay.

MP-26: with more than one ``election_vote`` stage in the pipeline and the
applicant on none of them, the package's ``package_fields`` policy used to
come from the first such stage by ``sort_order`` — a guess. The owner chose
(2026-10-05) to require ``step_id`` in exactly that case and answer 422.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.membership_pipeline import (
    create_election_package as create_election_package_endpoint,
)
from app.models.membership_pipeline import ProspectElectionPackage
from app.schemas.membership_pipeline import ElectionPackageCreate
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


async def _prospect(svc, org_id, pipeline_id):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "App",
            "last_name": f"Licant{_uid()[:4]}",
            "email": f"a-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
            "phone": "555-0100",
        },
    )


async def _package_rows(db_session, prospect_id):
    result = await db_session.execute(
        select(ProspectElectionPackage).where(
            ProspectElectionPackage.prospect_id == prospect_id
        )
    )
    return list(result.scalars().all())


class TestRegenerateReplaces:
    async def _setup(self, svc, org_id):
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Membership Vote", "step_type": "election_vote"},
        )
        return pipeline

    async def test_regenerating_leaves_one_package(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await self._setup(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        first = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )
        first_id = first.id
        second = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )
        third = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        rows = await _package_rows(db_session, prospect.id)
        assert [r.id for r in rows] == [third.id]
        assert second.id != third.id
        assert first_id != third.id
        assert third.status == "draft"

    async def test_a_ready_package_is_replaced_too(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await self._setup(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        await svc.create_election_package(prospect.id, org_id, created_by=admin_id)
        await svc.update_election_package(prospect.id, org_id, {"status": "ready"})
        fresh = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        rows = await _package_rows(db_session, prospect.id)
        assert [r.id for r in rows] == [fresh.id]

    async def test_coordinator_notes_and_config_survive_the_regenerate(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await self._setup(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        await svc.create_election_package(
            prospect.id,
            org_id,
            coordinator_notes="Strong candidate",
            package_config={"supporting_statement": "Recommended by Station 2"},
            created_by=admin_id,
        )
        fresh = await svc.create_election_package(
            prospect.id, org_id, package_config={}, created_by=admin_id
        )

        assert fresh.coordinator_notes == "Strong candidate"
        assert fresh.package_config == {
            "supporting_statement": "Recommended by Station 2"
        }

    async def test_values_supplied_on_regenerate_win(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await self._setup(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        await svc.create_election_package(
            prospect.id,
            org_id,
            coordinator_notes="Old",
            package_config={"supporting_statement": "Old", "keep": 1},
            created_by=admin_id,
        )
        fresh = await svc.create_election_package(
            prospect.id,
            org_id,
            coordinator_notes="New",
            package_config={"supporting_statement": "New"},
            created_by=admin_id,
        )

        assert fresh.coordinator_notes == "New"
        assert fresh.package_config == {"supporting_statement": "New", "keep": 1}

    async def test_a_package_on_a_ballot_is_kept(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await self._setup(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        balloted = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )
        balloted_id = balloted.id
        # Set directly: the caller path cannot reach a system status, and
        # assignment needs a whole election; what matters is the status.
        balloted.status = "added_to_ballot"
        await db_session.flush()

        fresh = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        ids = {r.id for r in await _package_rows(db_session, prospect.id)}
        assert ids == {balloted_id, fresh.id}

    async def test_another_applicants_package_is_untouched(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await self._setup(svc, org_id)
        a = await _prospect(svc, org_id, pipeline.id)
        b = await _prospect(svc, org_id, pipeline.id)

        b_pkg = await svc.create_election_package(b.id, org_id, created_by=admin_id)
        b_pkg_id = b_pkg.id
        await svc.create_election_package(a.id, org_id, created_by=admin_id)
        await svc.create_election_package(a.id, org_id, created_by=admin_id)

        assert [r.id for r in await _package_rows(db_session, b.id)] == [b_pkg_id]

    async def test_the_replacement_is_recorded_in_the_activity_log(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await self._setup(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        first = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )
        first_id = str(first.id)
        await svc.create_election_package(prospect.id, org_id, created_by=admin_id)

        count = await db_session.execute(
            text(
                "SELECT COUNT(*) FROM prospect_activity_log "
                "WHERE prospect_id = :pid AND action = 'election_package_created' "
                "AND JSON_CONTAINS(details, JSON_QUOTE(:old), "
                "'$.replaced_package_ids')"
            ),
            {"pid": prospect.id, "old": first_id},
        )
        assert count.scalar_one() == 1


class TestAmbiguousElectionStage:
    async def _two_vote_stages(self, svc, org_id):
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        first_vote = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Committee Vote", "step_type": "election_vote"},
        )
        second_vote = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Membership Vote", "step_type": "election_vote"},
        )
        onboarding = await svc.add_step(
            pipeline.id, org_id, {"name": "Onboarding", "step_type": "checkbox"}
        )
        return pipeline, first_vote, second_vote, onboarding

    async def test_endpoint_answers_422_without_a_step_id(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _first, _second, onboarding = await self._two_vote_stages(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        prospect.current_step_id = onboarding.id
        await db_session.flush()
        # Placing the applicant on the first (vote) stage made its package.
        before = {r.id for r in await _package_rows(db_session, prospect.id)}

        with pytest.raises(HTTPException) as exc:
            await create_election_package_endpoint(
                prospect_id=uuid.UUID(prospect.id),
                data=ElectionPackageCreate(prospect_id=uuid.UUID(prospect.id)),
                db=db_session,
                current_user=SimpleNamespace(id=admin_id, organization_id=org_id),
            )

        assert exc.value.status_code == 422
        assert "more than one election vote stage" in exc.value.detail
        after = {r.id for r in await _package_rows(db_session, prospect.id)}
        assert after == before

    async def test_naming_a_vote_stage_resolves_it(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _first, second, onboarding = await self._two_vote_stages(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        prospect.current_step_id = onboarding.id
        await db_session.flush()

        pkg = await create_election_package_endpoint(
            prospect_id=uuid.UUID(prospect.id),
            data=ElectionPackageCreate(
                prospect_id=uuid.UUID(prospect.id), step_id=uuid.UUID(second.id)
            ),
            db=db_session,
            current_user=SimpleNamespace(id=admin_id, organization_id=org_id),
        )

        assert pkg.step_id == second.id

    async def test_on_a_vote_stage_no_step_id_is_needed(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, first, _second, _onboarding = await self._two_vote_stages(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        prospect.current_step_id = first.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        assert pkg is not None

    async def test_one_vote_stage_never_needs_a_step_id(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P1")
        await svc.add_step(
            pipeline.id, org_id, {"name": "Vote", "step_type": "election_vote"}
        )
        onboarding = await svc.add_step(
            pipeline.id, org_id, {"name": "Onboarding", "step_type": "checkbox"}
        )
        prospect = await _prospect(svc, org_id, pipeline.id)
        prospect.current_step_id = onboarding.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        assert pkg is not None
        count = await db_session.execute(
            select(func.count())
            .select_from(ProspectElectionPackage)
            .where(ProspectElectionPackage.prospect_id == prospect.id)
        )
        assert count.scalar_one() == 1
