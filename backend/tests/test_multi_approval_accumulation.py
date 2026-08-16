"""Multi-approval accumulation tests (no DB).

PR #1424's review found the merged security fix deadlocked stages
requiring two or more roles: each request may carry only one
authenticated approval, but the payload replaced the stored approvals
list and validation demanded every role at once — so separately signed
approvals could never accumulate. These tests lock the accumulate →
partial-record → complete flow, the office-alias resolution
(chief ≡ fire_chief), and the signer-accessible approval path.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.membership_pipeline import (
    PipelineStepType,
    ProspectStepProgress,
    StepProgressStatus,
)
from app.services.membership_pipeline_service import MembershipPipelineService


def _signer(slug, name):
    return SimpleNamespace(
        id="signer-" + slug,
        positions=[SimpleNamespace(slug=slug, name=name)],
    )


def _step(required=("chief", "president")):
    return SimpleNamespace(
        id="step-1",
        step_type=PipelineStepType.MULTI_APPROVAL,
        config={"required_approvers": list(required)},
        notify_prospect_on_completion=False,
        is_final_step=False,
    )


def _prospect(step, step_progress=None):
    return SimpleNamespace(
        id="prospect-1",
        organization_id="org-1",
        current_step_id=str(step.id),
        pipeline=SimpleNamespace(steps=[step], auto_transfer_on_approval=False),
        step_progress=step_progress or [],
        email=None,
        interviews=[],
    )


def _service(prospect, signer):
    signer_result = MagicMock(scalar_one_or_none=MagicMock(return_value=signer))
    db = SimpleNamespace(
        execute=AsyncMock(return_value=signer_result),
        commit=AsyncMock(),
        add=MagicMock(),
    )
    service = MembershipPipelineService(db)
    service.get_prospect = AsyncMock(return_value=prospect)
    service._log_activity = AsyncMock()
    service._advance_current_step = AsyncMock()
    service._send_step_completion_notification = AsyncMock()
    service._do_transfer = AsyncMock()
    return service


class TestPartialApprovalAccumulation:
    async def test_first_of_two_roles_records_progress_without_completing(self):
        step = _step()
        prospect = _prospect(step)
        # fire_chief must satisfy the preset's "chief" role via the office
        # catalog aliases — the exact mismatch flagged in review.
        service = _service(prospect, _signer("fire_chief", "Fire Chief"))

        result = await service.complete_step(
            prospect_id="prospect-1",
            organization_id="org-1",
            step_id="step-1",
            completed_by="signer-fire_chief",
            action_result={"approvals": [{"role": "chief"}]},
        )

        assert result is prospect
        service._advance_current_step.assert_not_awaited()
        added = service.db.add.call_args[0][0]
        assert isinstance(added, ProspectStepProgress)
        assert added.status == StepProgressStatus.IN_PROGRESS
        assert added.action_result["approvals"] == [
            {"role": "chief", "approved_by": "signer-fire_chief"}
        ]
        assert added.completed_at is None
        service.db.commit.assert_awaited_once()

    async def test_second_role_completes_and_advances(self):
        step = _step()
        progress = SimpleNamespace(
            step_id="step-1",
            status=StepProgressStatus.IN_PROGRESS,
            action_result={
                "approvals": [{"role": "chief", "approved_by": "signer-fire_chief"}]
            },
            notes=None,
            completed_at=None,
            completed_by=None,
        )
        prospect = _prospect(step, step_progress=[progress])
        service = _service(prospect, _signer("president", "President"))

        await service.complete_step(
            prospect_id="prospect-1",
            organization_id="org-1",
            step_id="step-1",
            completed_by="signer-president",
            action_result={"approvals": [{"role": "president"}]},
        )

        assert progress.status == StepProgressStatus.COMPLETED
        roles = {a["role"] for a in progress.action_result["approvals"]}
        assert roles == {"chief", "president"}
        service._advance_current_step.assert_awaited_once()

    async def test_reapproval_updates_rather_than_duplicates(self):
        step = _step(required=("chief",))
        progress = SimpleNamespace(
            step_id="step-1",
            status=StepProgressStatus.IN_PROGRESS,
            action_result={
                "approvals": [{"role": "chief", "approved_by": "someone-else"}]
            },
            notes=None,
            completed_at=None,
            completed_by=None,
        )
        prospect = _prospect(step, step_progress=[progress])
        service = _service(prospect, _signer("fire_chief", "Fire Chief"))

        await service.complete_step(
            prospect_id="prospect-1",
            organization_id="org-1",
            step_id="step-1",
            completed_by="signer-fire_chief",
            action_result={"approvals": [{"role": "chief"}]},
        )

        assert progress.action_result["approvals"] == [
            {"role": "chief", "approved_by": "signer-fire_chief"}
        ]
        assert progress.status == StepProgressStatus.COMPLETED

    async def test_role_not_held_is_still_rejected(self):
        step = _step()
        prospect = _prospect(step)
        service = _service(prospect, _signer("secretary", "Secretary"))

        with pytest.raises(ValueError, match="role you currently hold"):
            await service.complete_step(
                prospect_id="prospect-1",
                organization_id="org-1",
                step_id="step-1",
                completed_by="signer-secretary",
                action_result={"approvals": [{"role": "chief"}]},
            )

    async def test_multiple_approvals_per_request_still_rejected(self):
        step = _step()
        prospect = _prospect(step)
        service = _service(prospect, _signer("fire_chief", "Fire Chief"))

        with pytest.raises(ValueError, match="own signer"):
            await service.complete_step(
                prospect_id="prospect-1",
                organization_id="org-1",
                step_id="step-1",
                completed_by="signer-fire_chief",
                action_result={"approvals": [{"role": "chief"}, {"role": "president"}]},
            )


class TestRecordStepApproval:
    async def test_rejects_non_multi_approval_steps(self):
        step = SimpleNamespace(
            id="step-1",
            step_type=PipelineStepType.CHECKLIST,
            config={},
        )
        prospect = _prospect(step)
        service = _service(prospect, _signer("fire_chief", "Fire Chief"))

        with pytest.raises(ValueError, match="multi-approval"):
            await service.record_step_approval(
                prospect_id="prospect-1",
                organization_id="org-1",
                step_id="step-1",
                signer_id="signer-fire_chief",
                role="chief",
            )

    async def test_delegates_a_single_signed_approval(self):
        step = _step(required=("chief",))
        prospect = _prospect(step)
        service = _service(prospect, _signer("fire_chief", "Fire Chief"))

        await service.record_step_approval(
            prospect_id="prospect-1",
            organization_id="org-1",
            step_id="step-1",
            signer_id="signer-fire_chief",
            role="chief",
        )

        added = service.db.add.call_args[0][0]
        assert isinstance(added, ProspectStepProgress)
        assert added.status == StepProgressStatus.COMPLETED
        assert added.action_result["approvals"] == [
            {"role": "chief", "approved_by": "signer-fire_chief"}
        ]
        service._advance_current_step.assert_awaited_once()
