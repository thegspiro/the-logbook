"""
Membership Pipeline Flow Tests

Integration tests for the Prospective Member -> Full Member conversion
pipeline: pipeline CRUD, prospect management, step progression, and
the transfer-to-membership workflow.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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
