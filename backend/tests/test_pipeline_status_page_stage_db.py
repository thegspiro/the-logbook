"""The Enable Status Page stage end to end, against MySQL.

The unit tests in test_pipeline_status_page_stage.py cover the rules with the
database stubbed. This covers the path a coordinator actually takes: complete
the stage before it, watch the applicant pass through it, and check the public
page answers accordingly. Only the outgoing email is stubbed.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import StepProgressStatus
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return uuid.uuid4().hex


async def _pipeline(svc, org_id):
    """Approval, then an enabling status-page stage, then approval.

    The pipeline-wide switch is left off, so any access the applicant gets
    comes from the stage.
    """
    pipeline = await svc.create_pipeline(
        organization_id=org_id, name=f"Status-{_uid()[:8]}"
    )
    assert pipeline.public_status_enabled is False
    steps = []
    for i, (step_type, config) in enumerate(
        (
            ("manual_approval", None),
            (
                "status_page_toggle",
                {"enable_public_status": True, "custom_message": "Welcome"},
            ),
            ("manual_approval", None),
        )
    ):
        data = {
            "name": f"Stage {i + 1}",
            "step_type": step_type,
            "sort_order": i,
            "required": True,
        }
        if config is not None:
            data["config"] = config
        steps.append(await svc.add_step(pipeline.id, org_id, data))
    return pipeline, steps


async def _prospect(svc, org_id, admin_id, pipeline):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Status",
            "last_name": "Test",
            "email": f"status-{_uid()[:10]}@example.com",
            "pipeline_id": pipeline.id,
        },
        created_by=admin_id,
    )


class TestStatusPageStage:
    async def test_passing_the_stage_opens_the_page_and_moves_on(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(svc, org_id)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)
        token = prospect.status_token

        assert await svc.get_prospect_by_token(token) is None

        with patch.object(
            MembershipPipelineService,
            "_send_status_page_link_email",
            AsyncMock(return_value=True),
        ) as send:
            result = await svc.complete_step(
                prospect_id=prospect.id,
                organization_id=org_id,
                step_id=steps[0].id,
                completed_by=admin_id,
            )

        send.assert_awaited_once()
        assert str(result.current_step_id) == str(steps[2].id)
        progress = {str(p.step_id): p for p in result.step_progress}
        stage = progress[str(steps[1].id)]
        assert stage.status == StepProgressStatus.COMPLETED
        assert stage.action_result["trigger"] == "status_page_applied"
        assert stage.completed_by is None

        page = await svc.get_prospect_by_token(token)
        assert page is not None
        assert page["first_name"] == "Status"

    async def test_moving_back_before_the_stage_closes_the_page(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(svc, org_id)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        with patch.object(
            MembershipPipelineService,
            "_send_status_page_link_email",
            AsyncMock(return_value=True),
        ):
            await svc.complete_step(
                prospect_id=prospect.id,
                organization_id=org_id,
                step_id=steps[0].id,
                completed_by=admin_id,
            )
        assert await svc.get_prospect_by_token(prospect.status_token) is not None

        for _ in range(2):
            await svc.regress_prospect(
                prospect_id=prospect.id,
                organization_id=org_id,
                regressed_by=admin_id,
            )

        assert await svc.get_prospect_by_token(prospect.status_token) is None

    async def test_a_failed_send_leaves_the_stage_for_a_coordinator(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(svc, org_id)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        with patch.object(
            MembershipPipelineService,
            "_send_status_page_link_email",
            AsyncMock(return_value=False),
        ):
            result = await svc.complete_step(
                prospect_id=prospect.id,
                organization_id=org_id,
                step_id=steps[0].id,
                completed_by=admin_id,
            )

        assert str(result.current_step_id) == str(steps[1].id)
        progress = {str(p.step_id): p for p in result.step_progress}
        assert progress[str(steps[1].id)].status == StepProgressStatus.IN_PROGRESS
