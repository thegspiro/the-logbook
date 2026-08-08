"""
Prospect Bulk Action Tests

Covers the two ways the pipeline used to tell coordinators something had
happened when it had not:

* ``advance`` returned 200 and wrote a ``prospect_advanced`` audit entry for a
  prospect that was already at the final stage, so the UI reported a movement
  that never occurred.
* Bulk actions were sequential client-side loops that swallowed every error,
  and bulk rejection pushed a hardcoded reason through the update endpoint as
  ``notes`` — overwriting the coordinator notes on every selected record.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import ProspectActivityLog, ProspectStatus
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


async def _pipeline_with_steps(svc, org_id, count=2):
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
# 1. advance reports a no-op as a no-op
# =========================================================================


class TestAdvanceRejectsNoOps:

    async def test_advancing_from_the_final_stage_is_refused(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, count=2)
        p = await _prospect(svc, org_id, pipeline.id)
        await svc.advance_prospect(p.id, org_id, admin_id)  # -> final stage

        with pytest.raises(ValueError, match="already at the final stage"):
            await svc.advance_prospect(p.id, org_id, admin_id)

    async def test_advancing_with_no_current_stage_is_refused(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id, count=2)
        p = await _prospect(svc, org_id, pipeline.id)
        await svc.update_prospect(p.id, org_id, {"current_step_id": None})
        p.current_step_id = None
        await db_session.flush()

        with pytest.raises(ValueError, match="no current stage"):
            await svc.advance_prospect(p.id, org_id, admin_id)

    async def test_a_refused_advance_writes_no_activity_entry(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The audit trail exists to reconstruct who moved whom; a movement
        that did not happen must not appear in it."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id, count=2)
        p = await _prospect(svc, org_id, pipeline.id)
        await svc.advance_prospect(p.id, org_id, admin_id)

        before = await _count_activity(db_session, p.id, "prospect_advanced")
        with pytest.raises(ValueError, match="already at the final stage"):
            await svc.advance_prospect(p.id, org_id, admin_id)
        after = await _count_activity(db_session, p.id, "prospect_advanced")

        assert before == after == 1


async def _count_activity(db_session, prospect_id, action):
    from sqlalchemy import func, select

    return await db_session.scalar(
        select(func.count(ProspectActivityLog.id)).where(
            ProspectActivityLog.prospect_id == prospect_id,
            ProspectActivityLog.action == action,
        )
    )


# =========================================================================
# 2. Bulk actions itemize their outcomes
# =========================================================================


class TestBulkAdvance:

    async def test_one_failure_does_not_abort_the_rest(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, count=3)
        movable = await _prospect(svc, org_id, pipeline.id)
        at_end = await _prospect(svc, org_id, pipeline.id)
        await svc.advance_prospect(at_end.id, org_id, admin_id)
        await svc.advance_prospect(at_end.id, org_id, admin_id)
        missing = _uid()

        results = await svc.bulk_advance_prospects(
            [at_end.id, movable.id, missing], org_id, admin_id
        )

        by_id = {r["prospect_id"]: r for r in results}
        assert by_id[movable.id]["succeeded"] is True
        assert by_id[at_end.id]["succeeded"] is False
        assert "final stage" in by_id[at_end.id]["error"]
        assert by_id[missing]["succeeded"] is False
        assert by_id[missing]["error"] == "Prospect not found"

        # The movable one really moved, despite being queued behind a failure.
        refreshed = await svc.get_prospect(movable.id, org_id)
        assert str(refreshed.current_step_id) == str(steps[1].id)

    async def test_failures_carry_the_applicant_name(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The old toast said "Failed to advance 4 applicant(s)" and named
        none of them, so there was no way to retry intelligently."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id, count=2)
        at_end = await _prospect(svc, org_id, pipeline.id, first_name="Dana")
        await svc.advance_prospect(at_end.id, org_id, admin_id)

        results = await svc.bulk_advance_prospects([at_end.id], org_id, admin_id)

        assert results[0]["name"].startswith("Dana")


class TestBulkStatus:

    async def test_bulk_rejection_preserves_coordinator_notes(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The regression this endpoint exists to prevent: the client-side
        path sent the reason as ``notes``, destroying what had been written
        about each applicant."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(
            svc, org_id, pipeline.id, notes="Strong reference from Capt. Ruiz"
        )

        await svc.bulk_set_prospect_status(
            [p.id], org_id, "rejected", admin_id, reason="Did not meet residency"
        )

        refreshed = await svc.get_prospect(p.id, org_id)
        assert refreshed.status == ProspectStatus.REJECTED
        assert refreshed.notes == "Strong reference from Capt. Ruiz"

    async def test_the_reason_lands_in_the_activity_log(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        await svc.bulk_set_prospect_status(
            [p.id], org_id, "rejected", admin_id, reason="Did not meet residency"
        )

        entries = await svc.get_activity_log(p.id, org_id)
        changed = [e for e in entries if e.action == "prospect_status_changed"]
        assert len(changed) == 1
        assert changed[0].details["reason"] == "Did not meet residency"
        assert changed[0].details["to"] == "rejected"
        assert changed[0].details["bulk"] is True

    async def test_a_redundant_status_change_is_reported_not_silently_counted(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        results = await svc.bulk_set_prospect_status([p.id], org_id, "active", admin_id)

        assert results[0]["succeeded"] is False
        assert "already active" in results[0]["error"]

    async def test_an_unknown_status_is_rejected_outright(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        with pytest.raises(ValueError, match="Invalid status"):
            await svc.bulk_set_prospect_status([p.id], org_id, "elected", admin_id)

    async def test_reactivating_several_inactive_prospects(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        a = await _prospect(svc, org_id, pipeline.id)
        b = await _prospect(svc, org_id, pipeline.id)
        await svc.bulk_set_prospect_status([a.id, b.id], org_id, "inactive", admin_id)

        results = await svc.bulk_set_prospect_status(
            [a.id, b.id], org_id, "active", admin_id, reason="Re-engaged"
        )

        assert all(r["succeeded"] for r in results)
        for pid in (a.id, b.id):
            assert (await svc.get_prospect(pid, org_id)).status == ProspectStatus.ACTIVE


class TestBulkCrossTenantIsolation:

    async def test_another_org_prospect_is_not_touched(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        other_org = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"o-{other_org[:8]}"},
        )
        await db_session.flush()
        svc = MembershipPipelineService(db_session)
        their_pipeline, _ = await _pipeline_with_steps(svc, other_org)
        theirs = await _prospect(svc, other_org, their_pipeline.id)

        results = await svc.bulk_set_prospect_status(
            [theirs.id], org_id, "rejected", admin_id
        )

        assert results[0]["succeeded"] is False
        assert results[0]["error"] == "Prospect not found"
        assert (
            await svc.get_prospect(theirs.id, other_org)
        ).status == ProspectStatus.ACTIVE
