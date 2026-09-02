"""
MP-08 pass 4 (2026-09-02) Codex review — regression tests.

Codex re-reviewed the pass 3 fix commit and raised five findings. Four land
here (the fifth, a CI-breaking fixture path in
``test_membership_pipeline_pass3_codex.py``, was fixed separately in that
file). The first and fourth are two angles on the same mechanism --
``create_election_package``'s ``package_fields`` PII-minimization policy --
and share one fix:

1. The reader treats an absent config as "capture everything" -- correct for
   preserving existing pipelines, but it meant a brand-new, never-configured
   election stage also over-captured PII that ``ElectionVoteConfig.tsx``
   displays as unchecked. Fixed on the frontend (``StageConfigModal.tsx``'s
   "Membership Vote" preset, the only UI path that can actually produce a
   savable, new election_vote stage -- see that file's diff and
   ``StageConfigModal.test.tsx``): a newly created stage now persists the
   same field selection the UI shows as checked, while every existing
   stage's absent ``package_fields`` -- and the capture-everything behavior
   it implies -- is untouched.

4. Separately, the reader resolved policy from whatever ``step_id`` the
   *caller* supplied -- an optional, client-controlled field on
   ``ElectionPackageCreate`` that the endpoint never requires to be the
   prospect's actual current step, or even an election_vote-typed step at
   all. So even after finding 1 above is fixed and a coordinator has saved a
   restrictive ``package_fields``, a caller could still get full capture by
   omitting ``step_id`` or naming a different in-pipeline step -- silently,
   with no error. Fixed in ``membership_pipeline_service.py``: policy is now
   resolved by finding the pipeline's own ``election_vote``-typed step (an
   invariant of the pipeline, not a per-request claim) rather than trusting
   ``step_id`` for anything beyond validating it belongs to the pipeline
   (which pass 3's MP-5 check already did, unrelated to this). ``step_id``
   itself is unchanged as the package's own step reference. This also
   required updating
   ``TestElectionPackagePIIFields::test_package_honors_configured_exclusions``
   in the pass 3 file, whose fixture step never set ``step_type`` and so
   relied on the very trust-the-caller lookup being fixed here.

2. ``update_election_package``'s status-changing path read the election
   package with a plain (unlocked) ``get_election_package`` call, so its
   own state-machine check (added in pass 3, guarding against resetting an
   `added_to_ballot` package back to `ready`) could still validate a stale
   snapshot while a concurrent ``assign_package_to_election`` -- which pass 3
   *did* lock -- committed underneath it. Fixed: locked here too, mirroring
   ``assign_package_to_election``.

3. The reordered document-deletion fix (remove the file from disk, then
   delete the DB row and commit) can still leave the file gone with the row
   surviving if something *after* the successful ``os.remove`` fails (the
   commit itself, most plausibly). Flagged, not fixed -- see
   ``docs/security-review/MP-08-membership-pipeline.md`` and
   ``docs/KNOWN_LIMITATIONS.md`` for the reasoning: the current ordering is
   the one this exact method was deliberately reordered *to* in pass 3 (to
   stop orphaning the file with no DB row left to retry against), so
   reverting the order would reopen that finding, and a full
   rename-to-trash/restore-on-rollback scheme is more machinery than a rare,
   retry-safe compound failure (row survives; a retry is a no-op file check
   followed by a clean delete) justifies as a same-day fix on an
   already-twice-reviewed surface.
"""

import inspect
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election, ElectionStatus
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


async def _pipeline_with_steps(svc, org_id, count=1):
    pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
    steps = [
        await svc.add_step(pipeline.id, org_id, {"name": f"Stage {i + 1}"})
        for i in range(count)
    ]
    return pipeline, steps


async def _prospect(svc, org_id, pipeline_id, **overrides):
    data = {
        "first_name": "App",
        "last_name": f"Licant{_uid()[:4]}",
        "email": f"a-{_uid()[:8]}@example.com",
        "pipeline_id": pipeline_id,
    }
    data.update(overrides)
    return await svc.create_prospect(organization_id=org_id, data=data)


# =========================================================================
# 2. update_election_package's status path was not locked
# =========================================================================


class TestElectionPackageUpdateLocking:
    """MP-08 pass 4 (Codex): assign_package_to_election locks the package
    row (pass 3), but update_election_package -- the other write path that
    changes pkg.status -- still read it with a plain, unlocked
    get_election_package call. Per CLAUDE.md pitfall #27, the lock and the
    decision that depends on it have to be the same statement, so this
    method's own state-machine check (pkg.status in
    ELECTION_PACKAGE_SYSTEM_STATUSES) needs the locked read too, or a
    concurrent assign can still commit underneath a stale status check
    here."""

    def test_update_locks_the_package_before_checking_status(self):
        source = inspect.getsource(MembershipPipelineService.update_election_package)
        assert "lock_for_update=True" in source, (
            "update_election_package no longer locks the election package "
            "row before its status state-machine check"
        )
        lock_at = source.index("lock_for_update=True")
        status_check_at = source.index("ELECTION_PACKAGE_SYSTEM_STATUSES")
        assert lock_at < status_check_at, (
            "update_election_package checks pkg.status against "
            "ELECTION_PACKAGE_SYSTEM_STATUSES before acquiring the row "
            "lock -- the read-then-write race is still open even though a "
            "lock call exists somewhere in the function"
        )

    async def test_update_still_works_for_the_ordinary_non_concurrent_path(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Behavioral regression guard: the added lock must not break a
        normal, single-request status update."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        await svc.create_election_package(prospect.id, org_id, created_by=admin_id)

        ready = await svc.update_election_package(
            prospect.id, org_id, {"status": "ready"}, admin_id
        )
        assert ready.status == "ready"

    async def test_update_still_refuses_reset_after_ballot_assignment(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Belt-and-suspenders with pass 3's state-machine fix: locking the
        read must not have loosened the check it protects."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        await svc.create_election_package(
            prospect.id, org_id, step_id=steps[0].id, created_by=admin_id
        )
        await svc.update_election_package(
            prospect.id, org_id, {"status": "ready"}, admin_id
        )

        now = datetime.now(timezone.utc)
        election = Election(
            id=_uid(),
            organization_id=org_id,
            title="Vote",
            election_type="general",
            start_date=now,
            end_date=now + timedelta(days=14),
            status=ElectionStatus.DRAFT,
        )
        db_session.add(election)
        await db_session.flush()
        await svc.assign_package_to_election(prospect.id, org_id, election.id, admin_id)

        with pytest.raises(ValueError, match="status"):
            await svc.update_election_package(
                prospect.id, org_id, {"status": "ready"}, admin_id
            )


# =========================================================================
# 4. package_fields policy trusted the caller's step_id instead of the
#    pipeline's own election_vote step
# =========================================================================


class TestElectionPackageFieldPolicyIsNotClientChosen:
    """MP-08 pass 4 (Codex): create_election_package looked up
    package_fields on whatever step_id the caller passed -- optional, and
    never checked for actually being the pipeline's election_vote step. A
    caller could defeat a coordinator's configured PII minimization just by
    omitting step_id, or by naming a different (non-election) step in the
    same pipeline, with no error and no sign anything was skipped."""

    async def _pipeline_with_configured_election_step(self, svc, org_id):
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        intake_step = await svc.add_step(
            pipeline.id, org_id, {"name": "Intake", "step_type": "checkbox"}
        )
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
        return pipeline, intake_step, election_step

    async def _prospect_with_pii(self, svc, org_id, pipeline_id):
        return await _prospect(
            svc,
            org_id,
            pipeline_id,
            phone="555-0100",
            mobile="555-0101",
            date_of_birth=date(1990, 1, 1),
            address_street="1 Main St",
            address_city="Anytown",
            address_state="VA",
            address_zip="22042",
        )

    async def test_omitted_step_id_still_honors_the_pipelines_election_stage(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _intake, _election = (
            await self._pipeline_with_configured_election_step(svc, org_id)
        )
        prospect = await self._prospect_with_pii(svc, org_id, pipeline.id)

        # No step_id at all -- the field is optional on ElectionPackageCreate.
        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )

        snapshot = pkg.applicant_snapshot
        assert "phone" not in snapshot
        assert "mobile" not in snapshot
        assert "address_street" not in snapshot
        assert "date_of_birth" not in snapshot
        assert "email" in snapshot

    async def test_wrong_step_id_still_honors_the_pipelines_election_stage(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The caller names a real, in-pipeline step -- just not the
        election_vote one -- so the pass 3 in-org/in-pipeline validation
        passes, and the only thing standing between this request and full
        capture is whether the reader trusts that step's (nonexistent)
        package_fields or looks up the pipeline's actual election step."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, intake_step, _election = (
            await self._pipeline_with_configured_election_step(svc, org_id)
        )
        prospect = await self._prospect_with_pii(svc, org_id, pipeline.id)

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=intake_step.id, created_by=admin_id
        )

        snapshot = pkg.applicant_snapshot
        assert "phone" not in snapshot
        assert "mobile" not in snapshot
        assert "address_street" not in snapshot
        assert "date_of_birth" not in snapshot

    async def test_correct_step_id_still_honors_the_configured_exclusions(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: naming the real election step directly must
        still work exactly as pass 3 intended."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _intake, election_step = (
            await self._pipeline_with_configured_election_step(svc, org_id)
        )
        prospect = await self._prospect_with_pii(svc, org_id, pipeline.id)

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=election_step.id, created_by=admin_id
        )

        assert "phone" not in pkg.applicant_snapshot

    async def test_no_election_step_in_pipeline_still_captures_everything(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: a pipeline with no election_vote step at all
        (every pre-existing pipeline before this feature existed) must keep
        the legacy full-capture behavior -- there is no policy to derive."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id)
        prospect = await self._prospect_with_pii(svc, org_id, pipeline.id)

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=steps[0].id, created_by=admin_id
        )

        assert pkg.applicant_snapshot["phone"] == "555-0100"
