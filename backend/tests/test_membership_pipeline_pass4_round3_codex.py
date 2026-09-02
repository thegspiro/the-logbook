"""
MP-08 — round-3 Codex review on PR #2177 (round 2's fix commit ``da29d880``).

Codex reviewed round 2's fix for ``create_election_package`` (MP-23: prefer
``prospect.current_step`` over the first-found ``election_vote`` step) and
found a residual race: ``advanceApplicant`` (frontend) commits the stage
advance in one request, then makes a *separate* request to create the
election package, naming the stage it just entered as ``step_id``. Between
those two requests, ``prospect.current_step`` can change again — another
advance, or a regression, landing in the gap. When that happens,
``create_election_package`` would resolve the PII-minimization policy from
the *new* ``current_step`` while still persisting the *request's* stale
``step_id`` verbatim on the package — labeling the package for one stage
while a different stage's ``package_fields`` actually governed the snapshot
it stored.

Fixed in ``membership_pipeline_service.py``: when the policy was resolved
from ``current_step`` (i.e. ``current_step`` is itself the pipeline's
election_vote step) and the caller supplied a ``step_id`` that disagrees
with it, ``create_election_package`` now raises ``ValueError`` (-> 400)
instead of silently mixing the two. This never fires when ``step_id`` is
omitted, and never fires for the pass-4 "named step isn't the pipeline's
election step" case (``test_wrong_step_id_still_honors_the_pipelines_
election_stage``), because there the policy comes from the fallback lookup,
not from ``current_step`` — confirmed unaffected by rerunning that suite
alongside this one.
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


class TestElectionPackageStepIdMustMatchCurrentStep:
    """MP-08 round 3 (Codex): a caller-supplied step_id that disagrees with
    the current_step the policy was actually resolved from must be
    rejected, not silently stored alongside a mismatched snapshot."""

    async def _pipeline_with_two_election_stages(self, svc, org_id):
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        stale_step = await svc.add_step(
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
        current_step = await svc.add_step(
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
        return pipeline, stale_step, current_step

    async def test_stale_step_id_is_rejected_when_current_step_moved_on(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The race this round's finding is about: advanceApplicant names
        the stage it just committed to as step_id, but by the time this
        request lands, prospect.current_step has moved again (a regression
        or a second advance). The request's step_id (the stale stage) must
        not be silently persisted alongside a snapshot governed by the new
        current_step's policy."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, stale_step, current_step = (
            await self._pipeline_with_two_election_stages(svc, org_id)
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)

        # Simulate: advanceApplicant's first request landed the applicant on
        # stale_step, but a second transition happened before its follow-up
        # create-package request arrived, moving current_step_id on.
        prospect.current_step_id = current_step.id
        await db_session.flush()

        with pytest.raises(ValueError, match="stage changed"):
            await svc.create_election_package(
                prospect.id, org_id, step_id=stale_step.id, created_by=admin_id
            )

    async def test_matching_step_id_still_succeeds(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: the ordinary, non-racy path (step_id equals
        the applicant's actual current step) must be unaffected."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _stale_step, current_step = (
            await self._pipeline_with_two_election_stages(svc, org_id)
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)

        prospect.current_step_id = current_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=current_step.id, created_by=admin_id
        )

        assert "phone" not in pkg.applicant_snapshot
        assert pkg.step_id == current_step.id

    async def test_omitted_step_id_is_never_rejected(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: step_id is optional on ElectionPackageCreate --
        omitting it must never trigger the mismatch check."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _stale_step, current_step = (
            await self._pipeline_with_two_election_stages(svc, org_id)
        )
        prospect = await _prospect_with_pii(svc, org_id, pipeline.id)

        prospect.current_step_id = current_step.id
        await db_session.flush()

        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        assert "phone" not in pkg.applicant_snapshot
