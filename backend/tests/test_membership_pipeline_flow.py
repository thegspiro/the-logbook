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


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def setup_org_and_admin(db_session: AsyncSession):
    org_id = _uid()
    admin_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test Dept",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": admin_id,
            "org": org_id,
            "un": f"admin-{org_id[:8]}",
            "fn": "Admin",
            "ln": "User",
            "em": f"admin-{org_id[:8]}@test.com",
            "pw": "hashed",
        },
    )
    await db_session.flush()
    return org_id, admin_id


# =========================================================================
# 1. Pipeline Management
# =========================================================================


class TestPipelineManagement:

    async def test_create_pipeline(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
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

    async def test_reorder_steps(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
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

    async def test_list_pipelines(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
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

    async def test_create_prospect(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
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

        active_list, active_count = await svc.list_prospects(
            org_id, status="active"
        )
        assert active_count >= 1
        assert all(
            str(p.status.value if hasattr(p.status, "value") else p.status) == "active"
            for p in active_list
        )

        hold_list, hold_count = await svc.list_prospects(
            org_id, status="on_hold"
        )
        assert hold_count >= 1
        assert all(
            str(p.status.value if hasattr(p.status, "value") else p.status) == "on_hold"
            for p in hold_list
        )

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

    async def test_complete_step(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
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
            (
                p
                for p in updated.step_progress
                if str(p.step_id) == str(steps[0].id)
            ),
            None,
        )
        assert first_progress is not None
        status_val = (
            first_progress.status.value
            if hasattr(first_progress.status, "value")
            else first_progress.status
        )
        assert status_val == "completed"

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
            (
                p.status.value
                if hasattr(p.status, "value")
                else p.status
            )
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
            text(
                "SELECT email, personal_email FROM users WHERE id = :uid"
            ),
            {"uid": result["user_id"]},
        )
        email_row = user_emails.fetchone()
        assert email_row is not None
        prospect_email = prospect.email
        assert prospect_email in (email_row[0], email_row[1])
