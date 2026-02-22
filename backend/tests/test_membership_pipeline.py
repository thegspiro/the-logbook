"""
Integration tests for the membership pipeline module.

Covers:
  - Pipeline CRUD (create, get, list, update, delete)
  - Step management (add, update, delete, reorder)
  - Prospect CRUD (create, get, list, update, delete)
  - Duplicate email enforcement (per-org uniqueness)
  - Step progression (complete step, advance, auto-advance)
  - Nullable field clearing via update_prospect
  - Delete pipeline safely (detach prospects)
  - Delete step safely (preserve progress records)
  - Stats with orphaned prospects
  - Transfer to membership
  - Activity logging
"""

import pytest
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.membership_pipeline_service import MembershipPipelineService
from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    ProspectiveMember,
    ProspectStepProgress,
    ProspectActivityLog,
    ProspectStatus,
    StepProgressStatus,
    PipelineStepType,
)


# ── Helpers ──────────────────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def setup_org_and_user(db_session: AsyncSession):
    """Create a minimal organization and user for pipeline tests."""
    org_id = _uid()
    user_id = _uid()

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test Pipeline Dept",
            "otype": "fire_department",
            "slug": f"test-pipe-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": "pipeadmin",
            "fn": "Pipe",
            "ln": "Admin",
            "em": "admin@pipeline-test.com",
            "pw": "hashed",
        },
    )
    await db_session.flush()
    return org_id, user_id


@pytest.fixture
async def service(db_session: AsyncSession):
    return MembershipPipelineService(db_session)


@pytest.fixture
async def sample_pipeline(db_session, setup_org_and_user, service):
    """Create a pipeline with 3 steps for testing."""
    org_id, user_id = await setup_org_and_user

    pipeline = await service.create_pipeline(
        organization_id=org_id,
        data={
            "name": "Standard Pipeline",
            "description": "Test pipeline",
            "is_default": True,
        },
        created_by=user_id,
    )

    step1 = await service.add_step(
        pipeline_id=pipeline.id,
        organization_id=org_id,
        data={
            "name": "Application Review",
            "step_type": "checkbox",
            "is_first_step": True,
            "required": True,
            "sort_order": 0,
        },
    )
    step2 = await service.add_step(
        pipeline_id=pipeline.id,
        organization_id=org_id,
        data={
            "name": "Background Check",
            "step_type": "action",
            "action_type": "custom",
            "required": True,
            "sort_order": 1,
        },
    )
    step3 = await service.add_step(
        pipeline_id=pipeline.id,
        organization_id=org_id,
        data={
            "name": "Final Approval",
            "step_type": "checkbox",
            "is_final_step": True,
            "required": True,
            "sort_order": 2,
        },
    )

    # Refresh to get relationships
    refreshed = await service.get_pipeline(pipeline.id, org_id)
    return refreshed, org_id, user_id, [step1, step2, step3]


# ── Pipeline CRUD ────────────────────────────────────────────────────

class TestPipelineCRUD:

    @pytest.mark.asyncio
    async def test_create_pipeline(self, db_session, setup_org_and_user, service):
        org_id, user_id = await setup_org_and_user

        pipeline = await service.create_pipeline(
            organization_id=org_id,
            data={"name": "New Pipeline", "description": "A test pipeline"},
            created_by=user_id,
        )

        assert pipeline is not None
        assert pipeline.name == "New Pipeline"
        assert pipeline.organization_id == org_id

    @pytest.mark.asyncio
    async def test_list_pipelines(self, db_session, setup_org_and_user, service):
        org_id, user_id = await setup_org_and_user

        await service.create_pipeline(org_id, {"name": "P1"}, user_id)
        await service.create_pipeline(org_id, {"name": "P2"}, user_id)

        pipelines = await service.list_pipelines(org_id)
        names = [p.name for p in pipelines]
        assert "P1" in names
        assert "P2" in names

    @pytest.mark.asyncio
    async def test_update_pipeline(self, db_session, setup_org_and_user, service):
        org_id, user_id = await setup_org_and_user

        pipeline = await service.create_pipeline(org_id, {"name": "Old Name"}, user_id)
        updated = await service.update_pipeline(
            pipeline.id, org_id, {"name": "New Name", "description": "Updated"}
        )

        assert updated.name == "New Name"
        assert updated.description == "Updated"

    @pytest.mark.asyncio
    async def test_update_pipeline_can_clear_nullable_field(self, db_session, setup_org_and_user, service):
        org_id, user_id = await setup_org_and_user

        pipeline = await service.create_pipeline(
            org_id, {"name": "P", "description": "Has desc"}, user_id
        )
        assert pipeline.description == "Has desc"

        updated = await service.update_pipeline(
            pipeline.id, org_id, {"description": None}
        )
        assert updated.description is None

    @pytest.mark.asyncio
    async def test_delete_pipeline_detaches_prospects(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        # Create a prospect in this pipeline
        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Test", "last_name": "User", "email": "test@pipe.com", "pipeline_id": pipeline.id},
            user_id,
        )
        assert prospect.pipeline_id == pipeline.id

        # Delete the pipeline
        result = await service.delete_pipeline(pipeline.id, org_id)
        assert result is True

        # Prospect should still exist but with no pipeline
        refreshed = await service.get_prospect(prospect.id, org_id)
        assert refreshed is not None
        assert refreshed.pipeline_id is None
        assert refreshed.current_step_id is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_pipeline_returns_false(self, db_session, setup_org_and_user, service):
        org_id, _ = await setup_org_and_user
        result = await service.delete_pipeline(_uid(), org_id)
        assert result is False


# ── Step Management ──────────────────────────────────────────────────

class TestStepManagement:

    @pytest.mark.asyncio
    async def test_add_step(self, db_session, sample_pipeline, service):
        pipeline, org_id, _, steps = await sample_pipeline
        assert len(steps) == 3

    @pytest.mark.asyncio
    async def test_reorder_steps(self, db_session, sample_pipeline, service):
        pipeline, org_id, _, steps = await sample_pipeline

        reversed_ids = [steps[2].id, steps[1].id, steps[0].id]
        reordered = await service.reorder_steps(pipeline.id, org_id, reversed_ids)

        assert reordered[0].id == steps[2].id
        assert reordered[0].sort_order == 0
        assert reordered[2].id == steps[0].id
        assert reordered[2].sort_order == 2

    @pytest.mark.asyncio
    async def test_delete_step_preserves_progress(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        # Create a prospect and initialize at first step
        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Jane", "last_name": "Doe", "email": "jane@step.com", "pipeline_id": pipeline.id},
            user_id,
        )

        # Complete the first step
        await service.complete_step(
            prospect.id, org_id, steps[0].id, notes="Done", completed_by=user_id
        )

        # Now delete the first step
        result = await service.delete_step(steps[0].id, pipeline.id, org_id)
        assert result is True

        # Progress record should still exist with step_id = None
        refreshed = await service.get_prospect(prospect.id, org_id)
        completed_progress = [
            p for p in refreshed.step_progress
            if p.status == StepProgressStatus.COMPLETED
        ]
        assert len(completed_progress) >= 1

    @pytest.mark.asyncio
    async def test_delete_step_moves_prospects_to_next(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Bob", "last_name": "Step", "email": "bob@step.com", "pipeline_id": pipeline.id},
            user_id,
        )
        # Prospect should be on step 0 (first step)
        assert str(prospect.current_step_id) == str(steps[0].id)

        # Delete the first step
        await service.delete_step(steps[0].id, pipeline.id, org_id)

        # Prospect should now be on step 1
        refreshed = await service.get_prospect(prospect.id, org_id)
        assert str(refreshed.current_step_id) == str(steps[1].id)


# ── Prospect CRUD ────────────────────────────────────────────────────

class TestProspectCRUD:

    @pytest.mark.asyncio
    async def test_create_prospect(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {
                "first_name": "Alice",
                "last_name": "Applicant",
                "email": "alice@test.com",
                "phone": "555-1234",
                "pipeline_id": pipeline.id,
            },
            user_id,
        )

        assert prospect.first_name == "Alice"
        assert prospect.status == ProspectStatus.ACTIVE
        assert prospect.pipeline_id == pipeline.id
        assert prospect.current_step_id is not None

    @pytest.mark.asyncio
    async def test_create_prospect_assigns_first_step(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Bob", "last_name": "First", "email": "bob@first.com", "pipeline_id": pipeline.id},
            user_id,
        )

        # Should be assigned to the first step (lowest sort_order)
        first_step = sorted(steps, key=lambda s: s.sort_order)[0]
        assert str(prospect.current_step_id) == str(first_step.id)

    @pytest.mark.asyncio
    async def test_create_prospect_initializes_progress(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Carol", "last_name": "Init", "email": "carol@init.com", "pipeline_id": pipeline.id},
            user_id,
        )

        assert len(prospect.step_progress) >= 1

    @pytest.mark.asyncio
    async def test_duplicate_email_raises(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        await service.create_prospect(
            org_id,
            {"first_name": "A", "last_name": "B", "email": "dupe@test.com", "pipeline_id": pipeline.id},
            user_id,
        )

        with pytest.raises(ValueError, match="already exists"):
            await service.create_prospect(
                org_id,
                {"first_name": "C", "last_name": "D", "email": "dupe@test.com", "pipeline_id": pipeline.id},
                user_id,
            )

    @pytest.mark.asyncio
    async def test_duplicate_email_case_insensitive(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        await service.create_prospect(
            org_id,
            {"first_name": "A", "last_name": "B", "email": "Case@Test.com", "pipeline_id": pipeline.id},
            user_id,
        )

        with pytest.raises(ValueError, match="already exists"):
            await service.create_prospect(
                org_id,
                {"first_name": "C", "last_name": "D", "email": "case@test.com", "pipeline_id": pipeline.id},
                user_id,
            )

    @pytest.mark.asyncio
    async def test_list_prospects_with_pagination(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        for i in range(5):
            await service.create_prospect(
                org_id,
                {"first_name": f"P{i}", "last_name": "Test", "email": f"p{i}@list.com", "pipeline_id": pipeline.id},
                user_id,
            )

        prospects, total = await service.list_prospects(org_id, limit=2, offset=0)
        assert total == 5
        assert len(prospects) == 2

        prospects2, total2 = await service.list_prospects(org_id, limit=2, offset=2)
        assert total2 == 5
        assert len(prospects2) == 2

    @pytest.mark.asyncio
    async def test_list_prospects_filter_by_status(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        p1 = await service.create_prospect(
            org_id,
            {"first_name": "Active", "last_name": "User", "email": "active@filter.com", "pipeline_id": pipeline.id},
            user_id,
        )
        p2 = await service.create_prospect(
            org_id,
            {"first_name": "Withdrawn", "last_name": "User", "email": "withdrawn@filter.com", "pipeline_id": pipeline.id},
            user_id,
        )
        await service.update_prospect(p2.id, org_id, {"status": "withdrawn"}, user_id)

        active, _ = await service.list_prospects(org_id, status="active")
        assert all(p.status == ProspectStatus.ACTIVE for p in active)

    @pytest.mark.asyncio
    async def test_update_prospect_can_clear_phone(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Clear", "last_name": "Phone", "email": "clear@phone.com",
             "phone": "555-9999", "pipeline_id": pipeline.id},
            user_id,
        )
        assert prospect.phone == "555-9999"

        updated = await service.update_prospect(
            prospect.id, org_id, {"phone": None}, user_id
        )
        assert updated.phone is None

    @pytest.mark.asyncio
    async def test_delete_prospect_rejected(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Del", "last_name": "Me", "email": "del@test.com", "pipeline_id": pipeline.id},
            user_id,
        )
        await service.update_prospect(prospect.id, org_id, {"status": "rejected"}, user_id)

        result = await service.delete_prospect(prospect.id, org_id, user_id)
        assert result is True

        gone = await service.get_prospect(prospect.id, org_id)
        assert gone is None

    @pytest.mark.asyncio
    async def test_delete_prospect_active_fails(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "No", "last_name": "Del", "email": "nodel@test.com", "pipeline_id": pipeline.id},
            user_id,
        )

        result = await service.delete_prospect(prospect.id, org_id, user_id)
        assert result is False


# ── Step Progression ─────────────────────────────────────────────────

class TestStepProgression:

    @pytest.mark.asyncio
    async def test_complete_step(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Step", "last_name": "Forward", "email": "step@fwd.com", "pipeline_id": pipeline.id},
            user_id,
        )

        result = await service.complete_step(
            prospect.id, org_id, steps[0].id,
            notes="Step 1 done", completed_by=user_id,
        )
        assert result is not None

        # Verify the step progress was marked completed
        refreshed = await service.get_prospect(prospect.id, org_id)
        step0_progress = next(
            (p for p in refreshed.step_progress if str(p.step_id) == str(steps[0].id)),
            None,
        )
        assert step0_progress is not None
        assert step0_progress.status == StepProgressStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_advance_creates_progress_for_next_step(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Advance", "last_name": "Test", "email": "adv@test.com", "pipeline_id": pipeline.id},
            user_id,
        )

        # Complete first step
        await service.complete_step(
            prospect.id, org_id, steps[0].id, completed_by=user_id,
        )

        refreshed = await service.get_prospect(prospect.id, org_id)
        # Should now be on step 1
        assert str(refreshed.current_step_id) == str(steps[1].id)

        # A progress record should exist for step 1
        step1_progress = next(
            (p for p in refreshed.step_progress if str(p.step_id) == str(steps[1].id)),
            None,
        )
        assert step1_progress is not None
        assert step1_progress.status == StepProgressStatus.IN_PROGRESS

    @pytest.mark.asyncio
    async def test_advance_prospect_manually(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Manual", "last_name": "Advance", "email": "manual@adv.com", "pipeline_id": pipeline.id},
            user_id,
        )

        result = await service.advance_prospect(prospect.id, org_id, advanced_by=user_id)
        assert result is not None

        refreshed = await service.get_prospect(prospect.id, org_id)
        assert str(refreshed.current_step_id) == str(steps[1].id)


# ── Status Transitions ───────────────────────────────────────────────

class TestStatusTransitions:

    @pytest.mark.asyncio
    async def test_set_on_hold_status(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Hold", "last_name": "Me", "email": "hold@test.com", "pipeline_id": pipeline.id},
            user_id,
        )

        updated = await service.update_prospect(
            prospect.id, org_id, {"status": "on_hold"}, user_id
        )
        assert updated.status == ProspectStatus.ON_HOLD

    @pytest.mark.asyncio
    async def test_set_inactive_status(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Inactive", "last_name": "User", "email": "inactive@test.com", "pipeline_id": pipeline.id},
            user_id,
        )

        updated = await service.update_prospect(
            prospect.id, org_id, {"status": "inactive"}, user_id
        )
        assert updated.status == ProspectStatus.INACTIVE


# ── Pipeline Stats ───────────────────────────────────────────────────

class TestPipelineStats:

    @pytest.mark.asyncio
    async def test_stats_include_new_status_counts(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        # Create 3 prospects with different statuses
        p1 = await service.create_prospect(
            org_id,
            {"first_name": "A1", "last_name": "S", "email": "a1@stats.com", "pipeline_id": pipeline.id},
            user_id,
        )
        p2 = await service.create_prospect(
            org_id,
            {"first_name": "A2", "last_name": "S", "email": "a2@stats.com", "pipeline_id": pipeline.id},
            user_id,
        )
        p3 = await service.create_prospect(
            org_id,
            {"first_name": "A3", "last_name": "S", "email": "a3@stats.com", "pipeline_id": pipeline.id},
            user_id,
        )
        await service.update_prospect(p2.id, org_id, {"status": "on_hold"}, user_id)
        await service.update_prospect(p3.id, org_id, {"status": "inactive"}, user_id)

        stats = await service.get_pipeline_stats(pipeline.id, org_id)
        assert stats is not None
        assert stats["on_hold_count"] == 1
        assert stats["inactive_count"] == 1
        assert stats["active_count"] == 1

    @pytest.mark.asyncio
    async def test_stats_show_orphaned_prospects(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        # Create a prospect
        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Orphan", "last_name": "Test", "email": "orphan@test.com", "pipeline_id": pipeline.id},
            user_id,
        )

        # Delete the step the prospect is on — prospect moves to next step
        await service.delete_step(steps[0].id, pipeline.id, org_id)

        # Now delete the second step too — prospect moves to step[2]
        await service.delete_step(steps[1].id, pipeline.id, org_id)

        stats = await service.get_pipeline_stats(pipeline.id, org_id)
        assert stats is not None
        # The prospect should appear in the remaining step's count
        total_in_steps = sum(s["count"] for s in stats["by_step"])
        assert total_in_steps >= 1


# ── Activity Logging ─────────────────────────────────────────────────

class TestActivityLogging:

    @pytest.mark.asyncio
    async def test_create_logs_activity(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Log", "last_name": "Test", "email": "log@test.com", "pipeline_id": pipeline.id},
            user_id,
        )

        log = await service.get_activity_log(prospect.id, org_id)
        assert len(log) >= 1
        actions = [entry.action for entry in log]
        assert "prospect_created" in actions

    @pytest.mark.asyncio
    async def test_update_logs_activity(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Log", "last_name": "Update", "email": "logup@test.com", "pipeline_id": pipeline.id},
            user_id,
        )
        await service.update_prospect(
            prospect.id, org_id, {"phone": "555-0000"}, user_id
        )

        log = await service.get_activity_log(prospect.id, org_id)
        actions = [entry.action for entry in log]
        assert "prospect_updated" in actions


# ── Transfer to Membership ───────────────────────────────────────────

class TestTransfer:

    @pytest.mark.asyncio
    async def test_transfer_creates_user(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {
                "first_name": "Transfer",
                "last_name": "Me",
                "email": "transfer@test.com",
                "pipeline_id": pipeline.id,
            },
            user_id,
        )

        result = await service.transfer_to_membership(
            prospect.id, org_id, transferred_by=user_id,
        )

        assert result is not None
        assert result["success"] is True
        assert "user_id" in result

        # Prospect status should be transferred
        refreshed = await service.get_prospect(prospect.id, org_id)
        assert refreshed.status == ProspectStatus.TRANSFERRED
        assert refreshed.transferred_user_id is not None

    @pytest.mark.asyncio
    async def test_transfer_already_transferred(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, _ = await sample_pipeline

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Double", "last_name": "Transfer", "email": "double@xfer.com", "pipeline_id": pipeline.id},
            user_id,
        )

        await service.transfer_to_membership(prospect.id, org_id, transferred_by=user_id)

        # Second transfer should fail
        result2 = await service.transfer_to_membership(prospect.id, org_id, transferred_by=user_id)
        assert result2 is not None
        assert result2["success"] is False


# ── Kanban Board ─────────────────────────────────────────────────────

class TestKanbanBoard:

    @pytest.mark.asyncio
    async def test_kanban_returns_columns(self, db_session, sample_pipeline, service):
        pipeline, org_id, user_id, steps = await sample_pipeline

        await service.create_prospect(
            org_id,
            {"first_name": "K1", "last_name": "Board", "email": "k1@kanban.com", "pipeline_id": pipeline.id},
            user_id,
        )

        board = await service.get_kanban_board(pipeline.id, org_id)
        assert board is not None
        assert "columns" in board
        assert len(board["columns"]) == len(steps)
        assert board["total_prospects"] >= 1


# ── Interview Management ────────────────────────────────────────────

class TestInterviewManagement:

    @pytest.fixture
    async def interview_pipeline(self, db_session, setup_org_and_user):
        """Create a pipeline with interview steps for testing."""
        org_id, user_id = await setup_org_and_user
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(
            organization_id=org_id,
            name="Interview Pipeline",
            steps=[
                {"name": "Application", "step_type": "checkbox", "is_first_step": True, "required": True},
                {
                    "name": "Initial Interview",
                    "step_type": "interview",
                    "required": True,
                    "config": {
                        "questions": [
                            {"text": "Why do you want to join?", "type": "preset"},
                            {"text": "Describe your experience", "type": "preset"},
                        ],
                        "allow_view_previous_interviews": True,
                        "required_interviewers_count": 2,
                    },
                },
                {
                    "name": "Final Interview with Chief",
                    "step_type": "interview",
                    "required": True,
                    "config": {
                        "questions": [{"text": "Additional leadership questions", "type": "freeform"}],
                        "allow_view_previous_interviews": True,
                        "required_interviewers_count": 1,
                    },
                },
                {"name": "Approved", "step_type": "checkbox", "is_final_step": True, "required": True},
            ],
            created_by=user_id,
        )
        steps = sorted(pipeline.steps, key=lambda s: s.sort_order)
        return pipeline, org_id, user_id, steps, service

    @pytest.mark.asyncio
    async def test_create_interview(self, db_session, interview_pipeline):
        pipeline, org_id, user_id, steps, service = await interview_pipeline
        interview_step = steps[1]  # Initial Interview

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Jane", "last_name": "Doe", "email": "jane@interview.com", "pipeline_id": pipeline.id},
            user_id,
        )

        scheduled = datetime(2026, 3, 15, 14, 0, tzinfo=timezone.utc)
        interview = await service.create_interview(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=interview_step.id,
            scheduled_at=scheduled,
            location="Station 1 - Conference Room",
            interviewer_ids=[user_id],
            questions=[
                {"text": "Why do you want to join?", "type": "preset"},
                {"text": "Describe your experience", "type": "preset"},
            ],
            created_by=user_id,
        )

        assert interview is not None
        assert interview.prospect_id == prospect.id
        assert interview.step_id == interview_step.id
        assert interview.location == "Station 1 - Conference Room"
        assert interview.status.value == "scheduled"
        assert len(interview.interviewer_ids) == 1
        assert len(interview.questions) == 2

    @pytest.mark.asyncio
    async def test_update_interview_notes(self, db_session, interview_pipeline):
        pipeline, org_id, user_id, steps, service = await interview_pipeline
        interview_step = steps[1]

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Bob", "last_name": "Notes", "email": "bob@notes.com", "pipeline_id": pipeline.id},
            user_id,
        )

        interview = await service.create_interview(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=interview_step.id,
            created_by=user_id,
        )

        updated = await service.update_interview(
            interview_id=interview.id,
            prospect_id=prospect.id,
            organization_id=org_id,
            data={
                "notes": "Candidate shows strong communication skills",
                "questions": [
                    {"text": "Why do you want to join?", "type": "preset", "answer": "Community service"},
                    {"text": "Describe your experience", "type": "preset", "answer": "5 years EMT"},
                ],
            },
            updated_by=user_id,
        )

        assert updated is not None
        assert updated.notes == "Candidate shows strong communication skills"
        assert updated.questions[0]["answer"] == "Community service"
        assert updated.questions[1]["answer"] == "5 years EMT"

    @pytest.mark.asyncio
    async def test_complete_interview(self, db_session, interview_pipeline):
        pipeline, org_id, user_id, steps, service = await interview_pipeline
        interview_step = steps[1]

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Sam", "last_name": "Complete", "email": "sam@complete.com", "pipeline_id": pipeline.id},
            user_id,
        )

        interview = await service.create_interview(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=interview_step.id,
            created_by=user_id,
        )

        completed = await service.update_interview(
            interview_id=interview.id,
            prospect_id=prospect.id,
            organization_id=org_id,
            data={"status": "completed", "notes": "Approved for next round"},
            updated_by=user_id,
        )

        assert completed is not None
        assert completed.status.value == "completed"
        assert completed.completed_at is not None
        assert completed.completed_by == user_id

    @pytest.mark.asyncio
    async def test_get_interview_history(self, db_session, interview_pipeline):
        pipeline, org_id, user_id, steps, service = await interview_pipeline
        step1 = steps[1]  # Initial Interview
        step2 = steps[2]  # Final Interview with Chief

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Hist", "last_name": "Test", "email": "hist@history.com", "pipeline_id": pipeline.id},
            user_id,
        )

        # Create and complete first interview
        iv1 = await service.create_interview(
            prospect_id=prospect.id, organization_id=org_id, step_id=step1.id,
            interviewer_ids=[user_id], created_by=user_id,
        )
        await service.update_interview(
            iv1.id, prospect.id, org_id,
            {"status": "completed", "notes": "Good candidate, recommend moving forward"},
            updated_by=user_id,
        )

        # Create and complete second interview
        iv2 = await service.create_interview(
            prospect_id=prospect.id, organization_id=org_id, step_id=step2.id,
            interviewer_ids=[user_id], created_by=user_id,
        )
        await service.update_interview(
            iv2.id, prospect.id, org_id,
            {"status": "completed", "notes": "Chief approves membership"},
            updated_by=user_id,
        )

        # Get history — should include both interviews in order
        history = await service.get_interview_history(prospect.id, org_id)
        assert len(history) == 2
        assert history[0]["notes"] == "Good candidate, recommend moving forward"
        assert history[1]["notes"] == "Chief approves membership"
        assert history[0]["step_name"] == "Initial Interview"
        assert history[1]["step_name"] == "Final Interview with Chief"
        # Verify interviewer names are resolved
        assert len(history[0]["interviewer_names"]) >= 1

    @pytest.mark.asyncio
    async def test_list_interviews_by_step(self, db_session, interview_pipeline):
        pipeline, org_id, user_id, steps, service = await interview_pipeline
        step1 = steps[1]
        step2 = steps[2]

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "List", "last_name": "Filter", "email": "list@filter.com", "pipeline_id": pipeline.id},
            user_id,
        )

        await service.create_interview(prospect.id, org_id, step1.id, created_by=user_id)
        await service.create_interview(prospect.id, org_id, step2.id, created_by=user_id)

        # All interviews
        all_ivs = await service.list_interviews(prospect.id, org_id)
        assert len(all_ivs) == 2

        # Filter by step
        step1_only = await service.list_interviews(prospect.id, org_id, step_id=step1.id)
        assert len(step1_only) == 1
        assert step1_only[0].step_id == step1.id


# ── Reference Check Management ──────────────────────────────────────

class TestReferenceCheckManagement:

    @pytest.fixture
    async def refcheck_pipeline(self, db_session, setup_org_and_user):
        org_id, user_id = await setup_org_and_user
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(
            organization_id=org_id,
            name="RefCheck Pipeline",
            steps=[
                {"name": "Application", "step_type": "checkbox", "is_first_step": True, "required": True},
                {
                    "name": "Reference Checks",
                    "step_type": "reference_check",
                    "required": True,
                    "config": {
                        "required_references_count": 3,
                        "questions": [{"text": "How long have you known them?", "type": "preset"}],
                    },
                },
                {"name": "Approved", "step_type": "checkbox", "is_final_step": True, "required": True},
            ],
            created_by=user_id,
        )
        steps = sorted(pipeline.steps, key=lambda s: s.sort_order)
        return pipeline, org_id, user_id, steps, service

    @pytest.mark.asyncio
    async def test_create_reference_check(self, db_session, refcheck_pipeline):
        pipeline, org_id, user_id, steps, service = await refcheck_pipeline
        ref_step = steps[1]

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Ref", "last_name": "Check", "email": "ref@check.com", "pipeline_id": pipeline.id},
            user_id,
        )

        check = await service.create_reference_check(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=ref_step.id,
            reference_name="John Smith",
            reference_phone="555-0100",
            reference_email="john@ref.com",
            reference_relationship="Former supervisor",
            created_by=user_id,
        )

        assert check is not None
        assert check.reference_name == "John Smith"
        assert check.reference_phone == "555-0100"
        assert check.reference_relationship == "Former supervisor"
        assert check.status.value == "pending"

    @pytest.mark.asyncio
    async def test_update_reference_check_result(self, db_session, refcheck_pipeline):
        pipeline, org_id, user_id, steps, service = await refcheck_pipeline
        ref_step = steps[1]

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Up", "last_name": "Ref", "email": "up@ref.com", "pipeline_id": pipeline.id},
            user_id,
        )

        check = await service.create_reference_check(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=ref_step.id,
            reference_name="Mary Jones",
            created_by=user_id,
        )

        updated = await service.update_reference_check(
            check_id=check.id,
            prospect_id=prospect.id,
            organization_id=org_id,
            data={
                "status": "completed",
                "contact_method": "phone",
                "notes": "Very positive reference, highly recommended",
                "verification_result": "positive",
            },
            updated_by=user_id,
        )

        assert updated is not None
        assert updated.status.value == "completed"
        assert updated.contact_method == "phone"
        assert updated.verification_result == "positive"
        assert updated.contacted_at is not None

    @pytest.mark.asyncio
    async def test_list_reference_checks_by_step(self, db_session, refcheck_pipeline):
        pipeline, org_id, user_id, steps, service = await refcheck_pipeline
        ref_step = steps[1]

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Multi", "last_name": "Ref", "email": "multi@ref.com", "pipeline_id": pipeline.id},
            user_id,
        )

        await service.create_reference_check(prospect.id, org_id, ref_step.id, "Ref One", created_by=user_id)
        await service.create_reference_check(prospect.id, org_id, ref_step.id, "Ref Two", created_by=user_id)
        await service.create_reference_check(prospect.id, org_id, ref_step.id, "Ref Three", created_by=user_id)

        checks = await service.list_reference_checks(prospect.id, org_id, step_id=ref_step.id)
        assert len(checks) == 3
        names = [c.reference_name for c in checks]
        assert "Ref One" in names
        assert "Ref Two" in names
        assert "Ref Three" in names


# ── Transfer Email Assignment ────────────────────────────────────────

class TestTransferEmailAssignment:

    @pytest.fixture
    async def transfer_env(self, db_session, setup_org_and_user):
        org_id, user_id = await setup_org_and_user
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(
            organization_id=org_id,
            name="Transfer Pipeline",
            steps=[
                {"name": "Apply", "step_type": "checkbox", "is_first_step": True, "is_final_step": True, "required": True},
            ],
            created_by=user_id,
        )
        return pipeline, org_id, user_id, service

    @pytest.mark.asyncio
    async def test_transfer_default_email(self, db_session, transfer_env):
        """Default: prospect email becomes User.email, no personal_email set."""
        pipeline, org_id, user_id, service = await transfer_env

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Default", "last_name": "Email", "email": "default@personal.com", "pipeline_id": pipeline.id},
            user_id,
        )

        result = await service.transfer_to_membership(prospect.id, org_id, transferred_by=user_id)
        assert result["success"] is True
        assert result["primary_email"] == "default@personal.com"
        assert result.get("personal_email") is None

    @pytest.mark.asyncio
    async def test_transfer_with_department_email(self, db_session, transfer_env):
        """Explicit dept email becomes primary; prospect email becomes personal."""
        pipeline, org_id, user_id, service = await transfer_env

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Dept", "last_name": "Email", "email": "personal@home.com", "pipeline_id": pipeline.id},
            user_id,
        )

        result = await service.transfer_to_membership(
            prospect.id, org_id, transferred_by=user_id,
            department_email="dept.email@firedept.org",
        )
        assert result["success"] is True
        assert result["primary_email"] == "dept.email@firedept.org"
        assert result["personal_email"] == "personal@home.com"

    @pytest.mark.asyncio
    async def test_transfer_use_personal_as_primary(self, db_session, transfer_env):
        """When use_personal_as_primary, same email is used for both fields."""
        pipeline, org_id, user_id, service = await transfer_env

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Pers", "last_name": "Primary", "email": "mine@gmail.com", "pipeline_id": pipeline.id},
            user_id,
        )

        result = await service.transfer_to_membership(
            prospect.id, org_id, transferred_by=user_id,
            use_personal_as_primary=True,
        )
        assert result["success"] is True
        assert result["primary_email"] == "mine@gmail.com"
        assert result["personal_email"] == "mine@gmail.com"

    @pytest.mark.asyncio
    async def test_transfer_auto_generate_department_email(self, db_session, transfer_env):
        """When org has settings.email.domain, auto-generate a dept email."""
        pipeline, org_id, user_id, service = await transfer_env

        # Set org email domain
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :oid"),
            {"s": '{"email": {"domain": "testfire.org"}}', "oid": org_id},
        )
        await db_session.flush()

        prospect = await service.create_prospect(
            org_id,
            {"first_name": "Auto", "last_name": "Gen", "email": "auto@personal.com", "pipeline_id": pipeline.id},
            user_id,
        )

        result = await service.transfer_to_membership(prospect.id, org_id, transferred_by=user_id)
        assert result["success"] is True
        assert result["primary_email"] == "auto.gen@testfire.org"
        assert result["personal_email"] == "auto@personal.com"
