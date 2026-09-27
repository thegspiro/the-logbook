"""An automated-email stage completes itself once its email is sent.

The stage used to be sent on arrival and then left ``in_progress`` until a
coordinator clicked past it — a stage with nothing left for anyone to do,
holding the applicant up. It now completes through ``complete_step`` as soon
as the send succeeds, and stays open when the send fails so a coordinator can
see the applicant never received it.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.models.membership_pipeline import (
    PipelineStepType,
    ProspectiveMember,
    ProspectStatus,
    ProspectStepProgress,
    StepProgressStatus,
)
from app.models.user import Organization
from app.services.membership_pipeline_service import MembershipPipelineService


def _step(step_id, sort_order, step_type, is_final_step=False):
    return SimpleNamespace(
        id=step_id,
        name=step_id,
        sort_order=sort_order,
        step_type=step_type,
        action_type=None,
        config={},
        is_final_step=is_final_step,
    )


def _prospect(steps):
    return SimpleNamespace(
        id="prospect-1",
        current_step_id=steps[0].id,
        pipeline=SimpleNamespace(steps=steps),
        step_progress=[],
    )


def _service():
    db = SimpleNamespace(flush=AsyncMock())
    svc = MembershipPipelineService(db)
    svc._auto_link_event_for_step = AsyncMock()
    return svc


@pytest.mark.unit
class TestAdvanceReportsSentEmailStage:
    async def test_returns_email_stage_when_send_succeeds(self):
        steps = [
            _step("s1", 0, PipelineStepType.CHECKBOX),
            _step("s2", 1, PipelineStepType.AUTOMATED_EMAIL),
        ]
        svc = _service()
        svc._send_stage_email = AsyncMock(return_value=True)

        result = await svc._advance_current_step(_prospect(steps), "s1")

        assert result == ("s2", "stage_email_sent")

    async def test_returns_none_when_send_fails(self):
        steps = [
            _step("s1", 0, PipelineStepType.CHECKBOX),
            _step("s2", 1, PipelineStepType.AUTOMATED_EMAIL),
        ]
        svc = _service()
        svc._send_stage_email = AsyncMock(return_value=False)

        assert await svc._advance_current_step(_prospect(steps), "s1") is None

    async def test_final_email_stage_is_left_for_a_coordinator(self):
        steps = [
            _step("s1", 0, PipelineStepType.CHECKBOX),
            _step("s2", 1, PipelineStepType.AUTOMATED_EMAIL, is_final_step=True),
        ]
        svc = _service()
        svc._send_stage_email = AsyncMock(return_value=True)

        assert await svc._advance_current_step(_prospect(steps), "s1") is None
        svc._send_stage_email.assert_awaited_once()

    async def test_non_email_stage_returns_none_and_sends_nothing(self):
        steps = [
            _step("s1", 0, PipelineStepType.CHECKBOX),
            _step("s2", 1, PipelineStepType.CHECKBOX),
        ]
        svc = _service()
        svc._send_stage_email = AsyncMock(return_value=True)

        assert await svc._advance_current_step(_prospect(steps), "s1") is None
        svc._send_stage_email.assert_not_awaited()


@pytest.mark.unit
class TestCompleteSentEmailStage:
    async def test_completes_as_an_automated_system_action(self):
        svc = MembershipPipelineService(SimpleNamespace())
        svc.complete_step = AsyncMock(return_value="completed")

        result = await svc._complete_on_arrival_step(
            "p-1", "org-1", "s2", "stage_email_sent"
        )

        assert result == "completed"
        kwargs = svc.complete_step.await_args.kwargs
        assert kwargs["step_id"] == "s2"
        assert kwargs["completed_by"] is None
        assert kwargs["automated"] is True
        assert kwargs["action_result"]["trigger"] == "stage_email_sent"
        assert kwargs["action_result"]["email_sent"] is True
        assert (
            kwargs["notes"] == "Completed automatically when the stage email was sent"
        )

    async def test_gate_refusal_leaves_the_stage_open(self):
        svc = MembershipPipelineService(SimpleNamespace())
        svc.complete_step = AsyncMock(side_effect=ValueError("gate"))
        svc.get_prospect = AsyncMock(return_value="unchanged")

        result = await svc._complete_on_arrival_step(
            "p-1", "org-1", "s2", "stage_email_sent"
        )

        assert result == "unchanged"
        svc.get_prospect.assert_awaited_once_with("p-1", "org-1")


async def _seed(db_session, stage_types):
    """A pipeline of ``stage_types`` and an applicant on its first stage.

    Ids are captured as strings as they are created: the service commits, and
    touching an expired ORM attribute afterwards would lazy-load outside the
    async context.
    """
    slug = f"email-stage-{uuid.uuid4().hex[:10]}"
    org = Organization(name="Email Stage VFD", slug=slug)
    db_session.add(org)
    await db_session.flush()
    org_id = str(org.id)

    svc = MembershipPipelineService(db_session)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Email Stage")
    pipeline_id = str(pipeline.id)
    step_ids = []
    for i, step_type in enumerate(stage_types):
        step = await svc.add_step(
            pipeline_id,
            org_id,
            {"name": f"Stage {i + 1}", "step_type": step_type, "required": False},
        )
        step_ids.append(str(step.id))

    prospect = ProspectiveMember(
        organization_id=org_id,
        pipeline_id=pipeline_id,
        current_step_id=step_ids[0],
        first_name="Email",
        last_name="Stage",
        email=f"{slug}@example.com",
        status=ProspectStatus.ACTIVE,
    )
    db_session.add(prospect)
    await db_session.flush()
    prospect_id = str(prospect.id)
    for i, step_id in enumerate(step_ids):
        db_session.add(
            ProspectStepProgress(
                prospect_id=prospect_id,
                step_id=step_id,
                status=(
                    StepProgressStatus.IN_PROGRESS
                    if i == 0
                    else StepProgressStatus.PENDING
                ),
            )
        )
    await db_session.commit()
    return svc, org_id, prospect_id, step_ids


def _status(prospect, step_id):
    progress = next(p for p in prospect.step_progress if str(p.step_id) == step_id)
    return progress.status


@pytest.mark.integration
class TestEmailStageCompletesOnSend:
    async def test_sent_email_stage_completes_and_moves_on(self, db_session):
        svc, org_id, prospect_id, step_ids = await _seed(
            db_session, ["checkbox", "automated_email", "checkbox"]
        )

        with patch.object(
            svc, "_send_stage_email", AsyncMock(return_value=True)
        ) as send:
            prospect = await svc.advance_prospect(prospect_id, org_id, None)

        send.assert_awaited_once()
        assert str(prospect.current_step_id) == step_ids[2]
        assert _status(prospect, step_ids[1]) == StepProgressStatus.COMPLETED
        assert _status(prospect, step_ids[2]) == StepProgressStatus.IN_PROGRESS

    async def test_consecutive_email_stages_each_send_and_complete(self, db_session):
        svc, org_id, prospect_id, step_ids = await _seed(
            db_session,
            ["checkbox", "automated_email", "automated_email", "checkbox"],
        )

        with patch.object(
            svc, "_send_stage_email", AsyncMock(return_value=True)
        ) as send:
            prospect = await svc.advance_prospect(prospect_id, org_id, None)

        assert send.await_count == 2
        assert str(prospect.current_step_id) == step_ids[3]
        assert _status(prospect, step_ids[1]) == StepProgressStatus.COMPLETED
        assert _status(prospect, step_ids[2]) == StepProgressStatus.COMPLETED

    async def test_failed_send_leaves_the_stage_in_progress(self, db_session):
        svc, org_id, prospect_id, step_ids = await _seed(
            db_session, ["checkbox", "automated_email", "checkbox"]
        )

        with patch.object(svc, "_send_stage_email", AsyncMock(return_value=False)):
            prospect = await svc.advance_prospect(prospect_id, org_id, None)

        assert str(prospect.current_step_id) == step_ids[1]
        assert _status(prospect, step_ids[1]) == StepProgressStatus.IN_PROGRESS
