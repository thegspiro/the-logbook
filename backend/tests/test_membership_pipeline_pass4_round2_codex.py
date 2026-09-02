"""
MP-08 — round-2 Codex review on PR #2177 (pass 4's fix commit ``6c9bb09e``).

Codex re-reviewed pass 4's ``create_election_package`` fix (which resolves
``package_fields`` PII-minimization policy from "the pipeline's own
election_vote step") and found the resolution still assumed a pipeline has
*at most one* such step. ``add_step`` has no uniqueness constraint on
``step_type``, so a pipeline with multiple ``election_vote`` stages is a
reachable configuration, and ``next(...)`` over ``effective_pipeline.steps``
(ordered by ``sort_order``) always returns the *first* one — not necessarily
the stage the applicant, and this specific package, actually reached. An
earlier, more permissive stage's ``package_fields`` (or an earlier stage with
none configured, i.e. capture-everything) then silently governs a package
that should have followed a later, stricter stage's configuration.

Fixed in ``membership_pipeline_service.py``: policy now prefers
``prospect.current_step`` — set only by ``create_prospect``/
``advance_prospect``/``regress_prospect``, and protected from the generic
update path (``_PROSPECT_PROTECTED_FIELDS``), so nothing here is
client-controlled — when that step both belongs to the governing pipeline and
is itself an ``election_vote`` step. The old first-found lookup remains as a
fallback for when the prospect's current step isn't an election_vote step at
package-creation time (e.g. requested after the applicant already advanced
past the vote stage), which is also what keeps the single-election_vote-stage
case (the overwhelmingly common one) behaving exactly as pass 4 left it.

The residual case — a pipeline with multiple election_vote stages where the
prospect's current step doesn't match any of them — remains ambiguous by
construction (there is no single correct answer) and is documented, not
"fixed", in ``docs/security-review/MP-08-membership-pipeline.md`` and
``docs/KNOWN_LIMITATIONS.md``.
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


class TestElectionPackageFieldPolicyWithMultipleElectionVoteStages:
    """MP-08 round 2 (Codex): a pipeline with more than one election_vote
    step defeats the pass-4 fix's ``next(...)`` lookup, which always takes
    the first configured stage rather than the one this package's applicant
    actually reached."""

    async def _pipeline_with_two_election_stages(self, svc, org_id):
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        # Added first -> earlier sort_order -> what the old next() picked.
        # Permissive: every PII field on, same as an unconfigured stage.
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
        # Added second -> later sort_order -> the stage the applicant is
        # actually on in these tests, and the stricter one that must govern.
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
        return pipeline, permissive_step, strict_step

    async def test_current_step_governs_over_an_earlier_permissive_stage(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The regression this round's finding is about: the applicant's
        actual current stage (later, stricter) must not be overridden by an
        earlier, more permissive election_vote stage in the same pipeline."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _permissive, strict_step = (
            await self._pipeline_with_two_election_stages(svc, org_id)
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)

        # Simulate the applicant having actually reached the second
        # (stricter) election_vote stage -- current_step_id is server-only
        # and would normally be set here by advance_prospect.
        prospect.current_step_id = strict_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        snapshot = pkg.applicant_snapshot
        assert "phone" not in snapshot
        assert "mobile" not in snapshot
        assert "address_street" not in snapshot
        assert "date_of_birth" not in snapshot
        assert "email" in snapshot

    async def test_current_step_on_the_permissive_stage_still_captures_its_fields(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard, opposite direction: when the applicant really
        is on the earlier (permissive) stage, that stage's own
        configuration must still be honored -- this is not a "always prefer
        the stricter stage" rule, it is "prefer the applicant's actual
        stage"."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, permissive_step, _strict = (
            await self._pipeline_with_two_election_stages(svc, org_id)
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)

        prospect.current_step_id = permissive_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        assert pkg.applicant_snapshot["phone"] == "555-0100"
        assert pkg.applicant_snapshot["address_street"] == "1 Main St"

    async def test_single_election_vote_stage_is_unaffected(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard for the common case: with only one
        election_vote step, behavior must be identical to pass 4 regardless
        of whether current_step_id happens to point at it."""
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
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)
        prospect.current_step_id = election_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        assert "phone" not in pkg.applicant_snapshot
