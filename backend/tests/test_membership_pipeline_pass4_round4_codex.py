"""
MP-08 — round-4 Codex review on PR #2177 (round 3's fix commit ``0d9a981a``).

Codex reviewed ``create_election_package`` and found that its *fallback*
branch — reached when ``prospect.current_step`` is not itself the pipeline's
``election_vote`` step, e.g. because the applicant already advanced past
every vote stage — ignored a caller-supplied ``step_id`` entirely and always
guessed the pipeline's first-configured ``election_vote`` step by
``sort_order``. That discarded information MP-5 (pass 3) had already
validated: ``step_id``, when supplied, is confirmed to belong to this exact
pipeline. ``advanceApplicant`` (the only frontend caller) always sends
``step_id`` as the ``election_vote`` stage the applicant just entered, so on
the same kind of race MP-24 (round 3) guards on the ``current_step``-governed
side — a second advance moving ``current_step`` past every ``election_vote``
stage before this request lands — the fallback used to pick whichever
``election_vote`` step sorts first instead of the one the request actually
named and the applicant actually just passed through. With a pipeline
configured so an earlier stage is more permissive than a later one, that
mis-selection over-captures PII a coordinator configured the applicant's real
stage to exclude.

Fixed in ``membership_pipeline_service.py``: within the fallback branch (i.e.
only once ``current_step`` has already failed to govern), a supplied
``step_id`` is now re-checked for being an ``election_vote`` step of the
governing pipeline — MP-5's check only confirmed pipeline membership, not
step_type — and preferred over the sort-order guess when it is. A ``step_id``
naming a real, in-pipeline step of the *wrong* type (the pass-4 "wrong
step_id" case, ``test_wrong_step_id_still_honors_the_pipelines_election_
stage``) is left alone and still falls through to the sort-order guess,
confirmed unaffected by rerunning that suite alongside this one.

MP-24's mismatch check (round 3) does not apply here and needed no change:
it only fires when ``current_step`` itself governed the policy
(``election_step is current_step``), which is never true once this fallback
is reached.

The remaining, narrower residual case — a pipeline with multiple
``election_vote`` stages where neither ``current_step`` nor a supplied
``step_id`` identifies one of them (``step_id`` omitted, or naming a
non-election step) — is still genuinely ambiguous by construction and stays
documented, not "fixed", in ``docs/security-review/MP-08-membership-
pipeline.md`` and ``docs/KNOWN_LIMITATIONS.md``.
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


async def _prospect_with_pii(svc, org_id, pipeline_id):
    data = {
        "first_name": "App",
        "last_name": f"Licant{_uid()[:4]}",
        "email": f"a-{_uid()[:8]}@example.com",
        "pipeline_id": pipeline_id,
        "phone": "555-0100",
        "mobile": "555-0101",
        "date_of_birth": "1990-01-01",
        "address_street": "1 Main St",
        "address_city": "Anytown",
        "address_state": "VA",
        "address_zip": "22042",
    }
    return await svc.create_prospect(organization_id=org_id, data=data)


class TestElectionPackageFallbackPrefersAValidatedStepId:
    """MP-08 round 4 (Codex): the fallback branch (current_step doesn't
    govern) must prefer a supplied, type-checked step_id over an
    arbitrary sort-order guess."""

    async def _pipeline_with_two_election_stages_and_a_later_stage(self, svc, org_id):
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        # Added first -> earlier sort_order -> what the old fallback picked
        # regardless of step_id. Permissive: every PII field on.
        permissive_step = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Committee Vote",
                "step_type": "election_vote",
                "config": {
                    "package_fields": {
                        "include_email": True,
                        "include_phone": True,
                        "include_address": True,
                        "include_date_of_birth": True,
                        "include_documents": True,
                        "include_stage_history": True,
                    }
                },
            },
        )
        # Added second -> later sort_order -> the stage the applicant
        # actually just passed through in these tests, and the stricter one
        # that must govern once step_id names it.
        strict_step = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Membership Vote",
                "step_type": "election_vote",
                "config": {
                    "package_fields": {
                        "include_email": True,
                        "include_phone": False,
                        "include_address": False,
                        "include_date_of_birth": False,
                        "include_documents": True,
                        "include_stage_history": True,
                    }
                },
            },
        )
        # Added third -> what current_step actually is: a non-election
        # stage the applicant advanced to after passing both vote stages.
        onboarding_step = await svc.add_step(
            pipeline.id, org_id, {"name": "Onboarding", "step_type": "checkbox"}
        )
        return pipeline, permissive_step, strict_step, onboarding_step

    async def test_step_id_naming_the_later_election_stage_governs_over_sort_order(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The core regression: the applicant has already moved to a
        non-election stage (current_step doesn't govern), and the request
        supplies the later, stricter of two election_vote step ids. The
        fallback must honor that validated step_id, not silently fall back
        to the earlier, more permissive stage found first by sort_order."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _permissive, strict_step, onboarding_step = (
            await self._pipeline_with_two_election_stages_and_a_later_stage(svc, org_id)
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)

        # Simulate the race: the applicant has already advanced past both
        # election_vote stages by the time this request is processed.
        prospect.current_step_id = onboarding_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=strict_step.id, created_by=admin_id
        )

        snapshot = pkg.applicant_snapshot
        assert "phone" not in snapshot
        assert "mobile" not in snapshot
        assert "address_street" not in snapshot
        assert "date_of_birth" not in snapshot
        assert "email" in snapshot
        assert pkg.step_id == strict_step.id

    async def test_step_id_naming_the_earlier_election_stage_still_honors_it(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Mirror case, proving this is "prefer the named stage", not
        "prefer whichever stage is stricter": naming the earlier, permissive
        stage's step_id must still capture its fields."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, permissive_step, _strict, onboarding_step = (
            await self._pipeline_with_two_election_stages_and_a_later_stage(svc, org_id)
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)

        prospect.current_step_id = onboarding_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=permissive_step.id, created_by=admin_id
        )

        assert pkg.applicant_snapshot["phone"] == "555-0100"
        assert pkg.applicant_snapshot["address_street"] == "1 Main St"

    async def test_wrong_type_step_id_still_falls_through_to_the_sort_order_guess(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: a step_id naming a real, in-pipeline step that
        is *not* an election_vote step must not be trusted as the policy
        source -- it still falls through to the existing sort-order
        fallback, exactly as the pass-4 "wrong step_id" case requires."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, permissive_step, _strict, onboarding_step = (
            await self._pipeline_with_two_election_stages_and_a_later_stage(svc, org_id)
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)

        prospect.current_step_id = onboarding_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=onboarding_step.id, created_by=admin_id
        )

        # Falls through to the sort-order guess, which picks the first
        # configured election_vote step -- the permissive one -- unchanged
        # from pass 4 / round 2 behavior.
        assert pkg.applicant_snapshot["phone"] == "555-0100"

    async def test_omitted_step_id_still_falls_through_to_the_sort_order_guess(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: the residual ambiguous case (no step_id, no
        current_step match, multiple election_vote steps) is unchanged --
        still a best-effort sort-order guess, not an error."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, permissive_step, _strict, onboarding_step = (
            await self._pipeline_with_two_election_stages_and_a_later_stage(svc, org_id)
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)

        prospect.current_step_id = onboarding_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        assert pkg.applicant_snapshot["phone"] == "555-0100"

    async def test_single_election_vote_stage_fallback_is_unaffected(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard for the common case: with only one
        election_vote step, a step_id naming it in the fallback branch
        (current_step past it) must resolve identically to before."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P2")
        election_step = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Vote",
                "step_type": "election_vote",
                "config": {
                    "package_fields": {
                        "include_email": True,
                        "include_phone": False,
                        "include_address": False,
                        "include_date_of_birth": False,
                        "include_documents": True,
                        "include_stage_history": True,
                    }
                },
            },
        )
        onboarding_step = await svc.add_step(
            pipeline.id, org_id, {"name": "Onboarding", "step_type": "checkbox"}
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)
        prospect.current_step_id = onboarding_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=election_step.id, created_by=admin_id
        )

        assert "phone" not in pkg.applicant_snapshot
