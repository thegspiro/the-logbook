"""
Membership Pipeline Flow Tests

Integration tests for the Prospective Member -> Full Member conversion
pipeline: pipeline CRUD, prospect management, step progression, and
the transfer-to-membership workflow.
"""

import asyncio
import inspect
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.models.membership_pipeline import ProspectiveMember, ProspectStatus
from app.models.user import Organization
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def test_step_progress_model_preserves_database_uniqueness():
    """Declarative/test schemas must match the migration's unique index."""
    from app.models.membership_pipeline import ProspectStepProgress

    index = next(
        index
        for index in ProspectStepProgress.__table__.indexes
        if index.name == "idx_step_progress_prospect_step"
    )

    assert index.unique
    assert [column.name for column in index.columns] == ["prospect_id", "step_id"]


def _uid() -> str:
    return str(uuid.uuid4())


# =========================================================================
# 1. Pipeline Management
# =========================================================================


class TestPipelineManagement:

    async def test_create_pipeline(self, db_session: AsyncSession, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id,
            name="Recruit Pipeline",
            description="Standard recruit onboarding",
        )

        assert pipeline is not None
        assert pipeline.name == "Recruit Pipeline"
        assert pipeline.description == "Standard recruit onboarding"
        assert pipeline.organization_id == org_id

    async def test_add_steps_to_pipeline(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="Steps Pipeline"
        )

        step_defs = [
            {
                "name": "Application Review",
                "step_type": "manual_approval",
                "description": "Review the application",
                "sort_order": 0,
                "required": True,
            },
            {
                "name": "Interview",
                "step_type": "manual_approval",
                "description": "Conduct interview",
                "sort_order": 1,
                "required": True,
            },
            {
                "name": "Membership Vote",
                "step_type": "manual_approval",
                "description": "Hold membership vote",
                "sort_order": 2,
                "required": True,
            },
        ]

        created_steps = []
        for sd in step_defs:
            step = await svc.add_step(pipeline.id, org_id, sd)
            assert step is not None
            created_steps.append(step)

        assert len(created_steps) == 3

        refreshed = await svc.get_pipeline(pipeline.id, org_id)
        assert refreshed is not None
        sorted_steps = sorted(refreshed.steps, key=lambda s: s.sort_order)
        assert [s.name for s in sorted_steps] == [
            "Application Review",
            "Interview",
            "Membership Vote",
        ]

    async def test_reorder_steps(self, db_session: AsyncSession, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="Reorder Pipeline"
        )
        step_a = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Step A", "step_type": "checkbox", "sort_order": 0},
        )
        step_b = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Step B", "step_type": "checkbox", "sort_order": 1},
        )
        step_c = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Step C", "step_type": "checkbox", "sort_order": 2},
        )
        assert step_a is not None
        assert step_b is not None
        assert step_c is not None

        # Reverse the order: C, B, A
        reordered = await svc.reorder_steps(
            pipeline.id, org_id, [step_c.id, step_b.id, step_a.id]
        )
        assert reordered is not None
        assert [s.name for s in reordered] == ["Step C", "Step B", "Step A"]

    async def test_reorder_moves_final_flag_to_new_last_step(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """is_final_step is the auto-transfer trigger, so after a reorder it
        must sit on the stage that is actually last — a stale flag left
        mid-pipeline turned completing that stage into a membership grant."""
        org_id, _ = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="Final Flag Pipeline"
        )
        step_a = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Step A", "step_type": "checkbox", "sort_order": 0},
        )
        step_b = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Step B", "step_type": "checkbox", "sort_order": 1},
        )
        step_final = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Approved",
                "step_type": "checkbox",
                "sort_order": 2,
                "is_final_step": True,
            },
        )

        # Move the flagged stage into the middle of the pipeline.
        reordered = await svc.reorder_steps(
            pipeline.id, org_id, [step_a.id, step_final.id, step_b.id]
        )
        assert reordered is not None
        assert [s.name for s in reordered] == ["Step A", "Approved", "Step B"]
        assert [s.is_final_step for s in reordered] == [False, False, True]

    async def test_reorder_does_not_invent_a_final_flag(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """A pipeline with no approval stage configured must stay that way —
        normalization must not switch on an auto-transfer trigger the admin
        never set up."""
        org_id, _ = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="No Final Flag Pipeline"
        )
        step_a = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Step A", "step_type": "checkbox", "sort_order": 0},
        )
        step_b = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Step B", "step_type": "checkbox", "sort_order": 1},
        )

        reordered = await svc.reorder_steps(pipeline.id, org_id, [step_b.id, step_a.id])
        assert reordered is not None
        assert [s.is_final_step for s in reordered] == [False, False]

    async def test_list_pipelines(self, db_session: AsyncSession, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        await svc.create_pipeline(organization_id=org_id, name="Pipeline One")
        await svc.create_pipeline(organization_id=org_id, name="Pipeline Two")

        pipelines = await svc.list_pipelines(org_id)
        names = {p.name for p in pipelines}
        assert "Pipeline One" in names
        assert "Pipeline Two" in names
        assert len(pipelines) >= 2


# =========================================================================
# 2. Prospect Management
# =========================================================================


class TestProspectManagement:

    async def test_create_prospect(self, db_session: AsyncSession, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="Prospect Pipeline"
        )

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Jane",
                "last_name": "Doe",
                "email": "jane.doe@example.com",
                "phone": "555-0100",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )

        assert prospect is not None
        assert prospect.first_name == "Jane"
        assert prospect.last_name == "Doe"
        assert prospect.email == "jane.doe@example.com"
        assert prospect.phone == "555-0100"
        assert prospect.pipeline_id == pipeline.id

    async def test_list_prospects_by_status(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="Filter Pipeline"
        )

        await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Active",
                "last_name": "Member",
                "email": "active@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )
        # Create a second prospect and put it on hold
        prospect_hold = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Hold",
                "last_name": "Member",
                "email": "hold@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )
        await svc.update_prospect(
            prospect_hold.id, org_id, {"status": "on_hold"}, updated_by=admin_id
        )

        active_list, active_count = await svc.list_prospects(org_id, status="active")
        assert active_count >= 1
        assert all(
            str(p.status.value if hasattr(p.status, "value") else p.status) == "active"
            for p in active_list
        )

        hold_list, hold_count = await svc.list_prospects(org_id, status="on_hold")
        assert hold_count >= 1
        assert all(
            str(p.status.value if hasattr(p.status, "value") else p.status) == "on_hold"
            for p in hold_list
        )

    async def test_search_matches_a_full_name_in_either_order(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="Search Pipeline"
        )
        target = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "John",
                "last_name": "Smith",
                "email": "jsmith@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )
        await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "John",
                "last_name": "Baker",
                "email": "jbaker@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )

        for query in ("John Smith", "smith john", "  john   smith  "):
            found, total = await svc.list_prospects(
                org_id, pipeline_id=pipeline.id, search=query
            )
            assert [p.id for p in found] == [target.id], query
            assert total == 1

    async def test_search_still_matches_a_single_field(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="Single Term Pipeline"
        )
        target = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Priya",
                "last_name": "Nandi",
                "email": "priya.nandi@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )

        for query in ("Priya", "nandi", "priya.nandi@example.com"):
            found, _ = await svc.list_prospects(
                org_id, pipeline_id=pipeline.id, search=query
            )
            assert [p.id for p in found] == [target.id], query

    async def test_get_prospect_detail(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="Detail Pipeline"
        )

        created = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Detail",
                "last_name": "Check",
                "email": "detail@example.com",
                "phone": "555-0200",
                "pipeline_id": pipeline.id,
                "interest_reason": "Community service",
            },
            created_by=admin_id,
        )

        fetched = await svc.get_prospect(created.id, org_id)

        assert fetched is not None
        assert fetched.id == created.id
        assert fetched.first_name == "Detail"
        assert fetched.last_name == "Check"
        assert fetched.email == "detail@example.com"
        assert fetched.phone == "555-0200"
        assert fetched.interest_reason == "Community service"
        assert fetched.pipeline_id == pipeline.id


# =========================================================================
# 3. Prospect Progression
# =========================================================================


class TestProspectProgression:

    async def _make_pipeline_with_steps(self, svc, org_id, step_count=2):
        """Helper: create a pipeline and add the given number of steps."""
        pipeline = await svc.create_pipeline(
            organization_id=org_id, name=f"Progression-{_uid()[:8]}"
        )
        steps = []
        for i in range(step_count):
            step = await svc.add_step(
                pipeline.id,
                org_id,
                {
                    "name": f"Step {i + 1}",
                    "step_type": "manual_approval",
                    "sort_order": i,
                    "required": True,
                },
            )
            steps.append(step)
        return pipeline, steps

    async def test_complete_step(self, db_session: AsyncSession, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline, steps = await self._make_pipeline_with_steps(svc, org_id, 2)

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Step",
                "last_name": "Completer",
                "email": "stepcomplete@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )

        updated = await svc.complete_step(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=steps[0].id,
            completed_by=admin_id,
        )

        assert updated is not None
        # The first step should be completed in the progress records
        first_progress = next(
            (p for p in updated.step_progress if str(p.step_id) == str(steps[0].id)),
            None,
        )
        assert first_progress is not None
        status_val = (
            first_progress.status.value
            if hasattr(first_progress.status, "value")
            else first_progress.status
        )
        assert status_val == "completed"

    async def test_cannot_complete_a_non_current_step(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await self._make_pipeline_with_steps(svc, org_id, 2)
        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Out",
                "last_name": "Of Order",
                "email": "out-of-order@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )

        with pytest.raises(ValueError, match="current step"):
            await svc.complete_step(
                prospect_id=prospect.id,
                organization_id=org_id,
                step_id=steps[1].id,
                completed_by=admin_id,
            )

        await db_session.refresh(prospect)
        assert str(prospect.current_step_id) == str(steps[0].id)

    async def test_advance_prospect(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline, steps = await self._make_pipeline_with_steps(svc, org_id, 3)

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Advance",
                "last_name": "Test",
                "email": "advance@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )
        # Prospect starts on step 0
        assert str(prospect.current_step_id) == str(steps[0].id)

        advanced = await svc.advance_prospect(
            prospect_id=prospect.id,
            organization_id=org_id,
            advanced_by=admin_id,
        )

        assert advanced is not None
        assert str(advanced.current_step_id) == str(steps[1].id)
        departed_progress = next(
            p for p in advanced.step_progress if str(p.step_id) == str(steps[0].id)
        )
        departed_status = (
            departed_progress.status.value
            if hasattr(departed_progress.status, "value")
            else departed_progress.status
        )
        assert departed_status == "completed"

    async def test_regress_reopens_the_previous_stage_and_clears_completion(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """Moving an applicant Back has to undo the advance, not just the pointer.

        The regression: regress reset the previous step to in_progress but left
        its completed_at stamp, and left the step being vacated in_progress. The
        drawer counts completed stamps for "N of M stages completed" and draws a
        green tick per stamp, so an applicant pulled back to stage two still
        read as having finished it, with stage three drawn as live underneath.
        """
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline, steps = await self._make_pipeline_with_steps(svc, org_id, 3)

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Regress",
                "last_name": "Test",
                "email": "regress@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )
        await svc.advance_prospect(
            prospect_id=prospect.id,
            organization_id=org_id,
            advanced_by=admin_id,
        )

        regressed = await svc.regress_prospect(
            prospect_id=prospect.id,
            organization_id=org_id,
            regressed_by=admin_id,
        )

        assert regressed is not None
        assert str(regressed.current_step_id) == str(steps[0].id)

        def progress_for(step):
            record = next(
                p for p in regressed.step_progress if str(p.step_id) == str(step.id)
            )
            status = (
                record.status.value
                if hasattr(record.status, "value")
                else record.status
            )
            return status, record.completed_at

        reopened_status, reopened_completed_at = progress_for(steps[0])
        assert reopened_status == "in_progress"
        assert reopened_completed_at is None

        vacated_status, vacated_completed_at = progress_for(steps[1])
        assert vacated_status == "pending"
        assert vacated_completed_at is None

        # Going forward again has to re-complete the stage the applicant was
        # sent back to. Clearing the stamp on regress is only half of it — if
        # the second advance does not put one back, the applicant's progress
        # track is permanently short a completed stage.
        readvanced = await svc.advance_prospect(
            prospect_id=prospect.id,
            organization_id=org_id,
            advanced_by=admin_id,
        )
        assert readvanced is not None
        recompleted = next(
            p for p in readvanced.step_progress if str(p.step_id) == str(steps[0].id)
        )
        recompleted_status = (
            recompleted.status.value
            if hasattr(recompleted.status, "value")
            else recompleted.status
        )
        assert recompleted_status == "completed"
        assert recompleted.completed_at is not None

    async def test_skip_bypasses_only_the_current_stage(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await self._make_pipeline_with_steps(svc, org_id, 3)
        steps[0].step_type = "checklist"
        steps[0].config = {
            "items": [{"id": "background", "label": "Background check"}],
            "require_all": True,
        }
        # A required stage refuses the skip before its own gate is consulted;
        # this case is about what a skip does once it is allowed to happen.
        steps[0].required = False
        await db_session.commit()

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Skip",
                "last_name": "Test",
                "email": "skip-stage@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )

        with pytest.raises(ValueError, match="checklist items"):
            await svc.advance_prospect(
                prospect.id, org_id, admin_id, notes="Not actually complete"
            )

        skipped = await svc.skip_current_step(
            prospect.id, org_id, admin_id, notes="Coordinator override"
        )
        assert skipped is not None
        assert str(skipped.current_step_id) == str(steps[1].id)
        progress = next(
            p for p in skipped.step_progress if str(p.step_id) == str(steps[0].id)
        )
        progress_status = (
            progress.status.value
            if hasattr(progress.status, "value")
            else progress.status
        )
        assert progress_status == "skipped"
        assert progress.action_result == {"skipped": True}

    async def test_skip_of_a_flagged_stage_never_transfers(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """A stage still carrying is_final_step mid-pipeline (stale data from
        before reorder normalization) combined with auto-transfer must not
        turn a coordinator skip into a membership grant."""
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline = await svc.create_pipeline(
            organization_id=org_id,
            name=f"Stale-Final-{_uid()[:8]}",
            auto_transfer_on_approval=True,
        )
        flagged = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Mis-flagged Stage",
                "step_type": "checkbox",
                "sort_order": 0,
                "is_final_step": True,
                # Skippable on purpose: a required stage is refused outright,
                # and the point here is that an allowed skip does not transfer.
                "required": False,
            },
        )
        await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Real Last Stage", "step_type": "checkbox", "sort_order": 1},
        )

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Never",
                "last_name": "Converted",
                "email": "never-converted@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )
        assert str(prospect.current_step_id) == str(flagged.id)

        skipped = await svc.skip_current_step(
            prospect.id, org_id, admin_id, notes="Coordinator override"
        )
        assert skipped is not None
        status_val = (
            skipped.status.value if hasattr(skipped.status, "value") else skipped.status
        )
        assert status_val == "active"
        user_row = await db_session.execute(
            text("SELECT id FROM users WHERE email = :em OR personal_email = :em"),
            {"em": "never-converted@example.com"},
        )
        assert user_row.fetchone() is None

    async def test_checklist_stage_completes_with_submitted_items(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """A required checklist stage is passable through the ordinary
        complete-step path when the request carries all configured items —
        the gate grades the submitted action_result, not just the stored
        progress row (which nothing ever wrote before completion)."""
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await self._make_pipeline_with_steps(svc, org_id, 2)
        steps[0].step_type = "checklist"
        steps[0].config = {
            "items": [
                {"id": "background", "label": "Background check"},
                {"id": "gear", "label": "Gear issued"},
            ],
            "require_all": True,
        }
        await db_session.commit()

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Checklist",
                "last_name": "Finisher",
                "email": "checklist-finisher@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )

        with pytest.raises(ValueError, match="checklist items"):
            await svc.complete_step(
                prospect_id=prospect.id,
                organization_id=org_id,
                step_id=steps[0].id,
                completed_by=admin_id,
                action_result={"completed_items": ["background"]},
            )

        updated = await svc.complete_step(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=steps[0].id,
            completed_by=admin_id,
            action_result={"completed_items": ["background", "gear"]},
        )
        assert updated is not None
        assert str(updated.current_step_id) == str(steps[1].id)
        progress = next(
            p for p in updated.step_progress if str(p.step_id) == str(steps[0].id)
        )
        progress_status = (
            progress.status.value
            if hasattr(progress.status, "value")
            else progress.status
        )
        assert progress_status == "completed"
        assert progress.action_result == {"completed_items": ["background", "gear"]}

    async def test_complete_all_steps(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        pipeline, steps = await self._make_pipeline_with_steps(svc, org_id, 2)

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "All",
                "last_name": "Steps",
                "email": "allsteps@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )

        # Complete step 1
        await svc.complete_step(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=steps[0].id,
            completed_by=admin_id,
        )
        # Complete step 2
        result = await svc.complete_step(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=steps[1].id,
            completed_by=admin_id,
        )

        assert result is not None
        completed_statuses = [
            (p.status.value if hasattr(p.status, "value") else p.status)
            for p in result.step_progress
        ]
        assert completed_statuses.count("completed") == 2


# =========================================================================
# 4. Transfer to Membership
# =========================================================================


class TestTransferToMembership:

    async def _create_ready_prospect(self, svc, org_id, admin_id, email_prefix):
        """Helper: create a pipeline with one step, a prospect, and
        complete the step so the prospect is ready for transfer."""
        pipeline = await svc.create_pipeline(
            organization_id=org_id, name=f"Transfer-{_uid()[:8]}"
        )
        step = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Final Review",
                "step_type": "manual_approval",
                "sort_order": 0,
                "required": True,
            },
        )

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Transfer",
                "last_name": "Candidate",
                "email": f"{email_prefix}@example.com",
                "phone": "555-0300",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )

        await svc.complete_step(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=step.id,
            completed_by=admin_id,
        )

        return prospect

    def test_transfer_locks_the_prospect_before_checking_status(self):
        """MP-08 pass 2 (2026-08-27, Codex): transfer_to_membership read the
        prospect with a plain (unlocked) get_prospect call, then checked
        ProspectStatus.TRANSFERRED, then created a User row and only *then*
        set the prospect to TRANSFERRED -- a classic check-before-write.
        Two concurrent transfer requests supplying distinct usernames can
        both observe ACTIVE before either commits and each mint a separate
        User account for the same prospect; the loser's write just
        overwrites transferred_user_id (CLAUDE.md pitfall #27's shape, not a
        capacity count but the same read-then-write race). Source-inspected
        rather than driven concurrently, matching this rotation's existing
        lock-wiring guards (test_administrative_rank_restriction.py,
        test_privilege_ceiling_wiring.py) -- a real two-transaction race is
        exercised in test_capacity_locking.py's sibling tests for the
        count-based cases."""
        source = inspect.getsource(MembershipPipelineService.transfer_to_membership)
        assert "lock_for_update=True" in source, (
            "transfer_to_membership no longer locks the prospect row before "
            "checking its status -- reintroduces the double-transfer race"
        )
        lock_at = source.index("lock_for_update=True")
        status_check_at = source.index("ProspectStatus.TRANSFERRED")
        assert lock_at < status_check_at, (
            "transfer_to_membership checks the prospect's status before "
            "acquiring the row lock -- the check-before-write race is still "
            "open even though a lock call exists somewhere in the function"
        )

    def test_update_prospect_locks_before_checking_transferred(self):
        """MP-08 pass 5: update_prospect's generic status guard (MP-9, pass
        1) read the prospect with a plain (unlocked) get_prospect call, then
        checked ``prospect.status == ProspectStatus.TRANSFERRED`` before
        writing a caller-supplied ``status``. Under REPEATABLE READ a plain
        SELECT answers from a snapshot that predates a concurrent
        transfer_to_membership's commit, and the eventual UPDATE this method
        issues has no WHERE on the old status -- so an unlocked read lets
        this endpoint's write silently clobber a transfer that landed in the
        gap between the read and this transaction's own commit, reopening
        the double-transfer race transfer_to_membership's own lock (pass 2)
        exists to prevent, via this update endpoint instead of the transfer
        one. Source-inspected, matching
        test_transfer_locks_the_prospect_before_checking_status above."""
        source = inspect.getsource(MembershipPipelineService.update_prospect)
        assert "lock_for_update=True" in source, (
            "update_prospect no longer locks the prospect row before "
            "checking its status -- reintroduces the double-transfer race"
        )
        lock_at = source.index("lock_for_update=True")
        status_check_at = source.index("ProspectStatus.TRANSFERRED")
        assert lock_at < status_check_at, (
            "update_prospect checks the prospect's status before acquiring "
            "the row lock -- the check-before-write race is still open even "
            "though a lock call exists somewhere in the function"
        )

    def test_set_prospect_status_locks_before_applying_change(self):
        """MP-08 pass 5: same race as
        test_update_prospect_locks_before_checking_transferred, on the
        dedicated single-prospect status endpoint. The TRANSFERRED guard
        itself lives in _apply_status_change, so this asserts the row lock
        is acquired in set_prospect_status before that guard runs, rather
        than comparing string offsets within a single function body."""
        source = inspect.getsource(MembershipPipelineService.set_prospect_status)
        assert "lock_for_update=True" in source, (
            "set_prospect_status no longer locks the prospect row before "
            "applying the status change -- reintroduces the double-transfer "
            "race"
        )
        lock_at = source.index("lock_for_update=True")
        apply_at = source.index("_apply_status_change(")
        assert lock_at < apply_at, (
            "set_prospect_status calls _apply_status_change before "
            "acquiring the row lock -- the check-before-write race is "
            "still open even though a lock call exists somewhere in the "
            "function"
        )

    def test_bulk_set_prospect_status_locks_before_applying_change(self):
        """MP-08 pass 5: same race, on the bulk status endpoint.
        bulk_set_prospect_status's inner _set_status closure received an
        already-fetched, unlocked prospect from _bulk_apply's own read (that
        read exists only to report "not found" per id and to capture
        full_name for the result row) and applied the status change
        directly against it -- the same unlocked-read-then-write shape as
        the single-prospect endpoint, just reached through the bulk path
        instead."""
        source = inspect.getsource(MembershipPipelineService.bulk_set_prospect_status)
        assert "lock_for_update=True" in source, (
            "bulk_set_prospect_status no longer locks the prospect row "
            "before applying the status change -- reintroduces the "
            "double-transfer race"
        )
        lock_at = source.index("lock_for_update=True")
        apply_at = source.index("_apply_status_change(")
        assert lock_at < apply_at, (
            "bulk_set_prospect_status calls _apply_status_change before "
            "acquiring the row lock -- the check-before-write race is "
            "still open even though a lock call exists somewhere in the "
            "function"
        )

    async def test_bulk_apply_releases_the_lock_after_a_rejected_item(self):
        """Codex review, PR #2405: bulk_set_prospect_status's per-item
        callback (_set_status) locks the prospect row with a FOR UPDATE read
        before its ValueError-raising guard. _bulk_apply's own ``except
        ValueError`` branch caught that and moved on to the next id without
        ever ending the transaction -- so the FOR UPDATE lock stayed held
        for the rest of the batch. A selection that includes even one
        already-transferred or already-at-target prospect would hold that
        row locked until a later item's own commit (or the whole request
        ending) released it, blocking every other write against it -- and
        two overlapping batches processed in opposite orders could deadlock
        on each other's held locks.

        Asserts commit(), not rollback(): every current ``apply`` callback
        raises its ValueError from a guard clause before writing anything,
        so there is nothing to discard, and commit() is what is actually
        safe to call here -- rollback() breaks the db_session fixture's
        create_savepoint-mode session with a MissingGreenlet error (see the
        comment at the call site, and
        tests/test_prospect_bulk_actions.py::TestBulkAdvance::
        test_one_failure_does_not_abort_the_rest, which already exercises
        this exact branch through the real database and would have caught
        a rollback() regression here). Unit-level rather than a real
        two-connection lock test: this asserts the one thing that actually
        changed, that the transaction ends before the loop continues past a
        rejected item, using a mocked ``db`` so no real lock needs to be
        held to observe it."""
        service = MembershipPipelineService(db=AsyncMock())
        org_id = str(uuid.uuid4())
        prospect_id = str(uuid.uuid4())
        prospect = SimpleNamespace(id=prospect_id, full_name="Rejected Prospect")

        async def _apply(_prospect):
            raise ValueError("Prospect is already dropped")

        with patch.object(service, "get_prospect", AsyncMock(return_value=prospect)):
            results = await service._bulk_apply([prospect_id], org_id, _apply)

        assert results == [
            {
                "prospect_id": prospect_id,
                "name": "Rejected Prospect",
                "succeeded": False,
                "error": "Prospect is already dropped",
            }
        ]
        service.db.commit.assert_awaited_once()
        service.db.rollback.assert_not_awaited()

    async def test_transfer_creates_user(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        prospect = await self._create_ready_prospect(
            svc, org_id, admin_id, f"transfer-{_uid()[:8]}"
        )

        result = await svc.transfer_to_membership(
            prospect_id=prospect.id,
            organization_id=org_id,
            transferred_by=admin_id,
            send_welcome_email=False,
        )

        assert result is not None
        assert result["success"] is True
        assert "user_id" in result

        # Verify the new User row exists in the database
        user_row = await db_session.execute(
            text("SELECT id, status FROM users WHERE id = :uid"),
            {"uid": result["user_id"]},
        )
        row = user_row.fetchone()
        assert row is not None
        assert row[1] == "active"

    async def test_transfer_preserves_data(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        prospect = await self._create_ready_prospect(
            svc, org_id, admin_id, f"preserve-{_uid()[:8]}"
        )

        result = await svc.transfer_to_membership(
            prospect_id=prospect.id,
            organization_id=org_id,
            transferred_by=admin_id,
            send_welcome_email=False,
        )

        assert result is not None
        assert result["success"] is True

        user_row = await db_session.execute(
            text(
                "SELECT first_name, last_name, email, phone "
                "FROM users WHERE id = :uid"
            ),
            {"uid": result["user_id"]},
        )
        row = user_row.fetchone()
        assert row is not None
        assert row[0] == "Transfer"
        assert row[1] == "Candidate"
        # The primary email may be a generated department email or the
        # prospect's personal email depending on org settings.  Either
        # way, the prospect's original email should be preserved in one
        # of the email columns.
        user_emails = await db_session.execute(
            text("SELECT email, personal_email FROM users WHERE id = :uid"),
            {"uid": result["user_id"]},
        )
        email_row = user_emails.fetchone()
        assert email_row is not None
        prospect_email = prospect.email
        assert prospect_email in (email_row[0], email_row[1])


# =========================================================================
# MP-29 (Codex, PR #2405 round 2): the source-inspection guard tests above
# prove only that `lock_for_update=True` appears textually in the right
# place -- they pass even if the lock never actually blocked anything.
# These use two REAL, independently-committing sessions -- the
# savepoint-based `db_session` fixture never truly commits, so it cannot
# demonstrate cross-transaction visibility -- to drive the actual race
# MP-27 closes, and to confirm MP-28's fix genuinely releases the row lock
# rather than only satisfying a mocked assertion.
# =========================================================================


async def _teardown_membership_race_org(org_id, prospect_ids=()):
    """Deletes the rows a concurrency test committed for real. These tests
    use `database_manager.session_factory` sessions specifically because
    they need genuine cross-transaction visibility -- the savepoint-based
    `db_session` fixture never truly commits, so its rollback cannot stand
    in for cleanup here the way it does everywhere else in this file.
    Matches `test_facility_document_reference_race.py`'s `_teardown_org`:
    a real commit needs a real, explicit delete, or the row (and, for an
    Organization, `OnboardingService.create_organization`'s "one org already
    exists" guard) outlives the test."""
    factory = database_manager.session_factory
    cleanup = factory()
    try:
        for prospect_id in prospect_ids:
            await cleanup.execute(
                ProspectiveMember.__table__.delete().where(
                    ProspectiveMember.id == prospect_id
                )
            )
        await cleanup.execute(
            Organization.__table__.delete().where(Organization.id == org_id)
        )
        await cleanup.commit()
    finally:
        await cleanup.close()


class TestStatusWritesBlockOnAndObserveAConcurrentTransfer:
    """Each status-writing path's new lock must not just exist in source,
    it must actually serialize against an in-flight transfer -- blocking
    until the transfer's row lock releases, then observing the committed
    TRANSFERRED status rather than the pre-transfer snapshot. A plain
    SELECT (the pre-fix shape) would return immediately with the stale
    status and let the write through, silently clobbering the transfer.

    A genuine two-session race test for this exact lock chain has
    precedent in this repository: `test_facility_document_reference_race.py`
    drives real, independently-committing sessions against FAC-29's
    locking reads the same way this class does. Verified against the true
    pre-MP-27 revision (`ae4fe98`, `4107910`'s parent -- `4107910` itself
    is the MP-27 commit and already carries the lock on all three paths, so
    it cannot serve as the "unlocked" baseline): at that revision none of
    the three paths calls `get_prospect` with `lock_for_update=True`, so
    `_tracking_get_prospect` never sets `lock_attempted` -- but
    `writer_task` does not complete either. The unlocked `SELECT` itself
    returns instantly (MVCC reads never wait on another transaction's row
    lock), but the eventual `UPDATE` the write issues at its own flush/
    commit is a real row-level write, which MySQL always serializes via
    genuine locks regardless of isolation level -- so it queues behind
    `locker`'s still-held `FOR UPDATE` lock on that exact row and never
    finishes. Neither task in the `asyncio.wait({lock_wait_task,
    writer_task}, ...)` race below completes, so all three tests below hit
    the explicit `raise asyncio.TimeoutError(...)` for that case, and pass
    against current code."""

    @pytest.fixture
    async def two_sessions(self, _initialize_database):
        """Two independent AsyncSessions, each its own real connection and
        transaction -- matches the fixture in
        test_facility_document_reference_race.py; not hoisted to conftest
        because this is currently the only other file that needs it."""
        factory = database_manager.session_factory
        sessions = [factory(), factory()]
        try:
            yield sessions
        finally:
            for session in sessions:
                await session.rollback()
                await session.close()

    @staticmethod
    async def _make_active_prospect(session):
        org = Organization(name="Race Test VFD", slug=f"mp27-race-{_uid()[:12]}")
        session.add(org)
        await session.flush()
        prospect = ProspectiveMember(
            organization_id=org.id,
            first_name="Race",
            last_name="Candidate",
            email=f"{_uid()}@example.com",
            status=ProspectStatus.ACTIVE,
        )
        session.add(prospect)
        await session.commit()
        return org.id, prospect.id

    async def _run_against_in_flight_transfer(self, two_sessions, run_status_write):
        """Holds the prospect's row lock exactly as a not-yet-committed
        ``transfer_to_membership`` would (locked read, status flipped to
        TRANSFERRED, no commit yet), then runs ``run_status_write`` -- a
        real service call on a second, independent session -- and asserts
        it blocks on that lock rather than reading a stale snapshot.
        Returns whatever ``run_status_write`` returns (or re-raises what
        it raises) once the transfer commits and the write proceeds.
        """
        locker, writer = two_sessions
        org_id, prospect_id = await self._make_active_prospect(locker)

        result = await locker.execute(
            select(ProspectiveMember)
            .where(ProspectiveMember.id == prospect_id)
            .with_for_update()
        )
        prospect = result.scalar_one()
        prospect.status = ProspectStatus.TRANSFERRED

        service = MembershipPipelineService(writer)
        lock_attempted = asyncio.Event()
        original_get_prospect = service.get_prospect

        async def _tracking_get_prospect(*args, **kwargs):
            if kwargs.get("lock_for_update"):
                lock_attempted.set()
            return await original_get_prospect(*args, **kwargs)

        writer_task = None
        try:
            with patch.object(service, "get_prospect", _tracking_get_prospect):
                writer_task = asyncio.create_task(
                    run_status_write(service, prospect_id, org_id)
                )
                lock_wait_task = asyncio.create_task(lock_attempted.wait())
                try:
                    done, _pending = await asyncio.wait(
                        {lock_wait_task, writer_task},
                        timeout=10,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if writer_task in done:
                        # Codex (PR #2408): if the write raises (or even
                        # returns) before ever attempting the locked read
                        # -- e.g. a setup/validation regression -- waiting
                        # out the full 10s for an event that can now never
                        # fire buries the real failure behind a confusing
                        # timeout, and the original exception is left
                        # unretrieved. `.result()` re-raises it immediately;
                        # a clean return with no lock attempt is itself a
                        # bug worth its own message rather than falling
                        # through to the "still blocked" assertion below.
                        writer_task.result()
                        raise AssertionError(
                            "status write returned without ever "
                            "attempting a locked read -- "
                            "lock_for_update was never used"
                        )
                    if lock_wait_task not in done:
                        raise asyncio.TimeoutError(
                            "neither the locked read nor the status "
                            "write completed within 10s"
                        )
                finally:
                    if not lock_wait_task.done():
                        lock_wait_task.cancel()

                # Codex (PR #2408): `lock_attempted` fires the instant the
                # locked query is *issued*, not once it has actually had
                # time to resolve -- so without a beat here, an unlocked
                # regression that returns almost immediately could still
                # look "not done" purely from scheduling latency, passing
                # this assertion for the wrong reason. Same 0.2s observation
                # window as test_facility_document_reference_race.py's
                # FAC-37 fix, for the same reason: give a genuinely-fast
                # unlocked read time to actually complete before checking.
                await asyncio.sleep(0.2)

                # Still blocked on the transfer's lock -- not yet having
                # read (let alone acted on) the row.
                assert not writer_task.done(), (
                    "status write proceeded without waiting for the "
                    "in-flight transfer's row lock to release -- it is "
                    "reading a stale, unlocked snapshot"
                )

                await locker.commit()
                return await asyncio.wait_for(writer_task, timeout=10)
        finally:
            if writer_task is not None and not writer_task.done():
                writer_task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await writer_task
            # Codex (PR #2413): checking `.cancelled()` here, not just
            # whether *this* block performed the cancel, is what catches
            # the case where the `asyncio.wait_for(writer_task, ...)`
            # inside the `try` above timed out -- `wait_for` cancels and
            # awaits the task itself before raising `TimeoutError`, so by
            # the time this `finally` runs the task is already done and
            # the cancel-here branch above never executes, even though
            # the task genuinely was cancelled mid-flight.
            writer_cancelled = writer_task is not None and writer_task.cancelled()
            await locker.rollback()
            if writer_cancelled:
                # invalidate(), not rollback(): cancelling a task
                # mid-DB-read (aiomysql doesn't always unwind that
                # cleanly) can leave the writer's connection unusable,
                # and unlike rollback(), SQLAlchemy guarantees
                # invalidate() does not raise even then -- so it can't
                # prevent the explicit teardown below from running.
                await writer.invalidate()
            else:
                await writer.rollback()
            await _teardown_membership_race_org(org_id, [prospect_id])

    async def test_set_prospect_status_sees_the_committed_transfer(self, two_sessions):
        async def _write(service, prospect_id, org_id):
            return await service.set_prospect_status(
                prospect_id, org_id, "on_hold", changed_by=None
            )

        with pytest.raises(ValueError, match="already a member"):
            await self._run_against_in_flight_transfer(two_sessions, _write)

    async def test_update_prospect_sees_the_committed_transfer(self, two_sessions):
        async def _write(service, prospect_id, org_id):
            return await service.update_prospect(
                prospect_id, org_id, {"status": "on_hold"}, updated_by=None
            )

        with pytest.raises(ValueError, match="cannot be set or cleared"):
            await self._run_against_in_flight_transfer(two_sessions, _write)

    async def test_bulk_set_prospect_status_sees_the_committed_transfer(
        self, two_sessions
    ):
        async def _write(service, prospect_id, org_id):
            return await service.bulk_set_prospect_status(
                [prospect_id], org_id, "on_hold", changed_by=None
            )

        results = await self._run_against_in_flight_transfer(two_sessions, _write)
        assert len(results) == 1
        assert results[0]["succeeded"] is False
        assert "already a member" in results[0]["error"]


class TestBulkApplyReallyReleasesTheLockAfterARejectedItem:
    """MP-28's own guard test (`test_bulk_apply_releases_the_lock_after_a_
    rejected_item`, above) mocks `db` and asserts `commit()` was awaited --
    it proves the fix calls the right method, not that a real InnoDB row
    lock is actually released. This drives the real service call against a
    real database and confirms a second, independent session can acquire
    the same row's lock, using the same two-session technique as the class
    above.

    Codex (PR #2408): checking the lock only after the whole bulk call
    returns cannot distinguish a per-item release from a regression that
    commits once after the entire loop -- both look identical from outside
    a one-item batch, since either way the lock is gone by the time the
    call returns. This uses a **two**-item batch (one rejected, one
    deliberately paused mid-processing) so the checker session attempts the
    rejected item's lock *while the batch is still running* -- a scenario
    only a true per-item release passes."""

    @pytest.fixture
    async def two_sessions(self, _initialize_database):
        factory = database_manager.session_factory
        sessions = [factory(), factory()]
        try:
            yield sessions
        finally:
            for session in sessions:
                await session.rollback()
                await session.close()

    async def test_lock_is_released_before_the_batch_finishes(self, two_sessions):
        bulk_session, checker_session = two_sessions
        org = Organization(name="Race Test VFD", slug=f"mp28-bulk-{_uid()[:12]}")
        bulk_session.add(org)
        await bulk_session.flush()
        # rejected: already at the target status, so _apply_status_change
        # raises before this item's own commit -- the shape MP-28 fixes.
        rejected = ProspectiveMember(
            organization_id=org.id,
            first_name="Bulk",
            last_name="Reject",
            email=f"{_uid()}@example.com",
            status=ProspectStatus.ON_HOLD,
        )
        # paused: a normal, accepted item -- held mid-flight (see below) so
        # the batch is still inside `_bulk_apply`'s loop when the checker
        # session probes the *rejected* item's row.
        paused = ProspectiveMember(
            organization_id=org.id,
            first_name="Bulk",
            last_name="Paused",
            email=f"{_uid()}@example.com",
            status=ProspectStatus.ACTIVE,
        )
        bulk_session.add_all([rejected, paused])
        await bulk_session.flush()
        # Captured as plain strings before any commit: commit() expires
        # every attribute on every object the session has loaded, and an
        # expired attribute can't be lazily refreshed from plain
        # (non-awaited) Python code -- only from inside an actually-awaited
        # ORM call.
        org_id = str(org.id)
        rejected_id = str(rejected.id)
        paused_id = str(paused.id)
        await bulk_session.commit()

        service = MembershipPipelineService(bulk_session)
        rejected_item_done = asyncio.Event()
        resume_paused_item = asyncio.Event()
        original_apply_status_change = service._apply_status_change

        async def _pausing_apply_status_change(
            prospect, target, changed_by, reason, bulk
        ):
            if str(prospect.id) == paused_id:
                # The rejected item has already raised, and _bulk_apply's
                # except-ValueError branch has already ended that item's
                # transaction -- its lock should be releasable right now,
                # even though this second item's own locked read (taken by
                # _set_status just before this call) is still open.
                rejected_item_done.set()
                await resume_paused_item.wait()
            return await original_apply_status_change(
                prospect, target, changed_by, reason, bulk
            )

        bulk_task = None
        try:
            with patch.object(
                service, "_apply_status_change", _pausing_apply_status_change
            ):
                bulk_task = asyncio.create_task(
                    service.bulk_set_prospect_status(
                        [rejected_id, paused_id], org_id, "on_hold", changed_by=None
                    )
                )
                pause_wait_task = asyncio.create_task(rejected_item_done.wait())
                try:
                    done, _pending = await asyncio.wait(
                        {pause_wait_task, bulk_task},
                        timeout=10,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if bulk_task in done:
                        # Codex (PR #2408): if the batch raises (or
                        # returns) before the paused item ever reaches
                        # _pausing_apply_status_change -- e.g. a
                        # _bulk_apply setup regression -- waiting out the
                        # full 10s for an event that can now never fire
                        # buries the real failure behind a confusing
                        # timeout. `.result()` re-raises it immediately.
                        bulk_task.result()
                        pytest.fail(
                            "the batch finished before the paused item "
                            "was ever released -- the pause point was "
                            "never reached"
                        )
                    if pause_wait_task not in done:
                        raise asyncio.TimeoutError(
                            "neither the pause point nor the batch "
                            "completed within 10s"
                        )
                finally:
                    if not pause_wait_task.done():
                        pause_wait_task.cancel()

                # The core assertion: the rejected item's lock must be free
                # *now*, mid-batch, not merely by the time the whole call
                # eventually returns.
                try:
                    await asyncio.wait_for(
                        checker_session.execute(
                            select(ProspectiveMember.id)
                            .where(ProspectiveMember.id == rejected_id)
                            .with_for_update()
                        ),
                        timeout=5,
                    )
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    # A cancelled-mid-read DBAPI call can surface as
                    # CancelledError rather than the TimeoutError
                    # wait_for() normally converts it to (aiomysql doesn't
                    # always unwind a cancelled read cleanly) -- observed
                    # directly against the pre-MP-28 code this test guards
                    # against, so both must be treated as "still locked".
                    #
                    # invalidate(), not rollback(): the connection can be
                    # left unusable by the cancelled-mid-read call above,
                    # and unlike rollback(), SQLAlchemy guarantees
                    # invalidate() does not raise even when the underlying
                    # DBAPI connection is already broken -- so it can't
                    # mask the pytest.fail() below behind a secondary
                    # connection error (or, on the outer fixture's own
                    # rollback() at teardown, a repeat one).
                    await checker_session.invalidate()
                    pytest.fail(
                        "the rejected item's row is still locked while a "
                        "later item in the same batch is still processing "
                        "-- _bulk_apply is not releasing the lock at the "
                        "item boundary"
                    )
                else:
                    # The lock was free -- a normal rollback ends this
                    # read cleanly on an otherwise-healthy connection.
                    await checker_session.rollback()

                resume_paused_item.set()
                results = await asyncio.wait_for(bulk_task, timeout=10)
        finally:
            if bulk_task is not None and not bulk_task.done():
                bulk_task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await bulk_task
            # Codex (PR #2413): `.cancelled()` after the task has settled,
            # not just whether *this* block performed the cancel -- the
            # final `asyncio.wait_for(bulk_task, timeout=10)` above cancels
            # and awaits the task itself on a timeout, so by the time this
            # `finally` runs the task is already done and the cancel-here
            # branch never executes, even though it genuinely was
            # cancelled mid-DB-read.
            bulk_cancelled = bulk_task is not None and bulk_task.cancelled()
            if bulk_cancelled:
                # invalidate(), not rollback(): same reasoning as the
                # class above -- cancelling a task mid-DB-read can leave
                # its connection unusable, and invalidate() is guaranteed
                # not to raise even then, so it can't skip the explicit
                # teardown below.
                await bulk_session.invalidate()
            else:
                await bulk_session.rollback()
            await checker_session.rollback()
            await _teardown_membership_race_org(org_id, [rejected_id, paused_id])

        by_id = {r["prospect_id"]: r for r in results}
        assert by_id[rejected_id]["succeeded"] is False
        assert "already on_hold" in by_id[rejected_id]["error"]
        assert by_id[paused_id]["succeeded"] is True


class TestAddStepSerializesSortOrder:
    """Two add-stage requests for one pipeline must not allocate the same slot.

    ``add_step`` reads the pipeline's steps and writes a value derived from
    them (``max + 1``, or the caller's own value when it does not collide).
    Read unlocked, two coordinators — or one double-click, or two API clients —
    both see the same steps and pick the same number. ``(pipeline_id,
    sort_order)`` carries a plain index rather than a unique constraint, so
    both inserts succeed and the ambiguous ordering the allocation exists to
    prevent comes straight back: with a tie, both the board's column order and
    the destination of an advance depend on how the sort broke it.

    Asserted as "the read takes the lock", the way ``TestTransferStatusRace``
    above asserts MP-27's, because the race itself cannot be forced
    deterministically from outside: ``add_step`` owns its commit, so there is
    no point at which a test can hold one caller between its read and its
    insert. A two-session test written the obvious way passes without the lock
    too and proves nothing — InnoDB takes its own shared lock on the parent
    pipeline row for the child insert's foreign key, so the second caller
    blocks at *insert* time regardless. By then both have already read the
    same steps and chosen the same number, which is the bug.
    """

    async def test_the_allocation_reads_the_pipeline_under_a_row_lock(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(
            organization_id=org_id, name=f"Lock-{_uid()[:8]}"
        )

        locked_reads = []
        original_get_pipeline = service.get_pipeline

        async def _tracking_get_pipeline(*args, **kwargs):
            locked_reads.append(bool(kwargs.get("lock_for_update")))
            return await original_get_pipeline(*args, **kwargs)

        with patch.object(service, "get_pipeline", _tracking_get_pipeline):
            first = await service.add_step(
                pipeline.id, org_id, {"name": "First", "step_type": "checkbox"}
            )
            second = await service.add_step(
                pipeline.id, org_id, {"name": "Second", "step_type": "checkbox"}
            )

        assert locked_reads, "add_step did not read the pipeline at all"
        assert all(locked_reads), (
            "add_step read the pipeline without a row lock, so two concurrent "
            "adds can read the same steps and allocate the same sort_order"
        )
        assert [first.sort_order, second.sort_order] == [0, 1]

    async def test_an_omitted_order_appends_on_a_sparse_pipeline(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """The stage dialog omits sort_order so the server places the stage
        last. That only works if "omitted" survives request validation: the
        schema defaulted it to 0 and the endpoint dumped every field, so the
        server saw an explicit 0 — and on a pipeline whose live stages start
        at 5 that is not even a collision, so the new stage silently went
        first instead of last."""
        from app.schemas.membership_pipeline import PipelineStepCreate

        org_id, _ = setup_org_and_admin
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(
            organization_id=org_id, name=f"Sparse-{_uid()[:8]}"
        )
        for name, order in (("Fifth", 5), ("Sixth", 6)):
            await service.add_step(
                pipeline.id,
                org_id,
                {"name": name, "step_type": "checkbox", "sort_order": order},
            )

        payload = PipelineStepCreate(name="Appended", step_type="checkbox")
        dumped = payload.model_dump(exclude_unset=True)
        assert "sort_order" not in dumped

        appended = await service.add_step(pipeline.id, org_id, dumped)

        assert appended.sort_order == 7
