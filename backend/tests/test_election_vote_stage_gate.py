"""An election stage refuses an advance the ballot has not cleared.

``ProspectElectionPackage.status`` was already the authoritative record of the
membership vote — ``assign_package_to_election`` writes "added_to_ballot", and
``election_service._sync_package_statuses`` tallies the closed ballot into
"elected"/"not_elected" — and nothing read it when deciding whether an
applicant could move. So the one typed stage whose entire purpose is to make
the vote binding was the one typed stage with no completion gate: an applicant
the department had voted *down* advanced on a click, and on a pipeline with
``auto_transfer_on_approval`` a final election stage converted them into a
full member.

The mocked-session equivalents live in ``test_membership_pipeline_service.py``
(``TestElectionVoteGate``). These run the gate's own query against MySQL, so a
shape that only works against an ``AsyncMock`` cannot pass.

Only the two states that reached a ballot are graded. "draft" and "ready" must
keep advancing: a department that holds its vote at a meeting and records the
outcome by hand never assigns a package, and gating those states would refuse
every one of those advances.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import (
    ProspectElectionPackage,
    ProspectStatus,
    ProspectStepProgress,
)
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


async def _election_stage_pipeline(svc, org_id, *, auto_transfer: bool):
    """A two-stage pipeline whose first stage is the election vote.

    A following stage keeps the ordinary pass through ``complete_step`` on the
    advance path rather than the conversion path, so the tests that assert an
    advance and the tests that assert a conversion differ only in which
    pipeline they run against.
    """
    pipeline = await svc.create_pipeline(
        organization_id=org_id,
        name="Membership",
        auto_transfer_on_approval=auto_transfer,
    )
    vote = await svc.add_step(
        pipeline.id,
        org_id,
        {
            "name": "Membership Vote",
            "step_type": "election_vote",
            "config": {"voting_method": "simple_majority"},
            "is_final_step": auto_transfer,
        },
    )
    if not auto_transfer:
        await svc.add_step(pipeline.id, org_id, {"name": "Onboarding"})
    return pipeline, vote


async def _prospect_on_the_vote(svc, org_id, pipeline_id):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "App",
            "last_name": f"Licant{_uid()[:4]}",
            "email": f"a-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
        },
    )


async def _package(db_session, prospect_id, pipeline_id, step_id, status):
    pkg = ProspectElectionPackage(
        id=_uid(),
        prospect_id=prospect_id,
        pipeline_id=pipeline_id,
        step_id=step_id,
        status=status,
    )
    db_session.add(pkg)
    await db_session.flush()
    return pkg


class TestElectionVoteStageGate:
    @pytest.mark.parametrize(
        ("package_status", "fragment"),
        [
            ("added_to_ballot", "has not been decided yet"),
            ("not_elected", "was not elected"),
        ],
    )
    async def test_an_undecided_or_failed_vote_refuses_the_advance(
        self, db_session: AsyncSession, org_and_admin, package_status, fragment
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, vote = await _election_stage_pipeline(
            svc, org_id, auto_transfer=False
        )
        prospect = await _prospect_on_the_vote(svc, org_id, pipeline.id)
        await _package(db_session, prospect.id, pipeline.id, vote.id, package_status)

        with pytest.raises(ValueError, match=fragment):
            await svc.advance_prospect(prospect.id, org_id, admin_id)

        # Refused, and refused without leaving a completion behind.
        progress = (
            (
                await db_session.execute(
                    select(ProspectStepProgress).where(
                        ProspectStepProgress.prospect_id == prospect.id,
                        ProspectStepProgress.step_id == vote.id,
                    )
                )
            )
            .scalars()
            .first()
        )
        assert progress is None or progress.status.value != "completed"

    async def test_a_failed_vote_does_not_convert_on_a_final_stage(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The consequence that made this the most severe of the ungated
        stages: the applicant the department voted down became a member."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, vote = await _election_stage_pipeline(svc, org_id, auto_transfer=True)
        prospect = await _prospect_on_the_vote(svc, org_id, pipeline.id)
        await _package(db_session, prospect.id, pipeline.id, vote.id, "not_elected")

        with pytest.raises(ValueError, match="was not elected"):
            await svc.complete_step(
                prospect_id=prospect.id,
                organization_id=org_id,
                step_id=vote.id,
                completed_by=admin_id,
            )

        after = await svc.get_prospect(prospect.id, org_id)
        assert after.status == ProspectStatus.ACTIVE
        assert after.transferred_user_id is None

    async def test_an_elected_applicant_advances(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, vote = await _election_stage_pipeline(
            svc, org_id, auto_transfer=False
        )
        prospect = await _prospect_on_the_vote(svc, org_id, pipeline.id)
        await _package(db_session, prospect.id, pipeline.id, vote.id, "elected")

        moved = await svc.advance_prospect(prospect.id, org_id, admin_id)

        assert str(moved.current_step_id) != str(vote.id)

    @pytest.mark.parametrize("package_status", ["draft", "ready"])
    async def test_a_package_that_never_reached_a_ballot_advances(
        self, db_session: AsyncSession, org_and_admin, package_status
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, vote = await _election_stage_pipeline(
            svc, org_id, auto_transfer=False
        )
        prospect = await _prospect_on_the_vote(svc, org_id, pipeline.id)
        await _package(db_session, prospect.id, pipeline.id, vote.id, package_status)

        moved = await svc.advance_prospect(prospect.id, org_id, admin_id)

        assert str(moved.current_step_id) != str(vote.id)

    async def test_a_stage_with_no_package_at_all_advances(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The off-platform vote — held at a meeting, recorded by hand. This
        is the backward-compatible case the gate must not break."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, vote = await _election_stage_pipeline(
            svc, org_id, auto_transfer=False
        )
        prospect = await _prospect_on_the_vote(svc, org_id, pipeline.id)

        moved = await svc.advance_prospect(prospect.id, org_id, admin_id)

        assert str(moved.current_step_id) != str(vote.id)

    async def test_the_latest_package_is_the_one_graded(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Matching ``get_election_package``, which is what the applicant
        drawer shows. Grading a different package here would let the drawer
        read "was not elected" beside an Advance that works (Pitfall #29)."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, vote = await _election_stage_pipeline(
            svc, org_id, auto_transfer=False
        )
        prospect = await _prospect_on_the_vote(svc, org_id, pipeline.id)
        stale = await _package(
            db_session, prospect.id, pipeline.id, vote.id, "not_elected"
        )
        newest = await _package(
            db_session, prospect.id, pipeline.id, vote.id, "elected"
        )
        # Order the two rows unambiguously: created_at defaults to the same
        # server timestamp for both when they are flushed in one test.
        await db_session.execute(
            text(
                "UPDATE prospect_election_packages "
                "SET created_at = :ts WHERE id = :id"
            ),
            {"ts": "2026-01-01 00:00:00", "id": stale.id},
        )
        await db_session.execute(
            text(
                "UPDATE prospect_election_packages "
                "SET created_at = :ts WHERE id = :id"
            ),
            {"ts": "2026-06-01 00:00:00", "id": newest.id},
        )
        await db_session.flush()

        moved = await svc.advance_prospect(prospect.id, org_id, admin_id)

        assert str(moved.current_step_id) != str(vote.id)
