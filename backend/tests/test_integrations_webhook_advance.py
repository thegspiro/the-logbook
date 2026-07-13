"""Integration webhooks auto-advance the matching prospect's stage.

Covers MembershipPipelineService.complete_current_step_for_integration_event —
the correlation logic a Documenso/Cal.com inbound webhook uses to advance a
prospect whose current stage is configured to use that integration.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.membership_pipeline_service import MembershipPipelineService


def _step(step_type, config):
    return SimpleNamespace(id="step-1", step_type=step_type, config=config)


def _prospect(email, current_step):
    return SimpleNamespace(id="p1", email=email, current_step=current_step)


def _svc_with_prospects(prospects):
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = prospects
    db.execute = AsyncMock(return_value=result)
    svc = MembershipPipelineService(db)
    # Isolate the correlation logic from the full completion machinery.
    svc.complete_step = AsyncMock()
    return svc


async def test_calcom_booking_advances_matching_meeting_stage():
    step = _step("meeting", {"scheduling_provider": "calcom"})
    svc = _svc_with_prospects([_prospect("applicant@x.com", step)])

    advanced = await svc.complete_current_step_for_integration_event(
        organization_id="org-1",
        emails=["applicant@x.com"],
        step_type="meeting",
        provider_key="scheduling_provider",
        provider_value="calcom",
        completed_by="integration:calcom",
    )

    assert advanced == {"prospect_id": "p1", "step_id": "step-1"}
    svc.complete_step.assert_awaited_once()


async def test_documenso_signature_advances_matching_document_stage():
    step = _step("document_upload", {"signing_provider": "documenso"})
    svc = _svc_with_prospects([_prospect("signer@x.com", step)])

    advanced = await svc.complete_current_step_for_integration_event(
        organization_id="org-1",
        emails=["signer@x.com"],
        step_type="document_upload",
        provider_key="signing_provider",
        provider_value="documenso",
        completed_by="integration:documenso",
    )

    assert advanced is not None
    svc.complete_step.assert_awaited_once()


async def test_no_email_short_circuits_without_query():
    svc = _svc_with_prospects([])

    advanced = await svc.complete_current_step_for_integration_event(
        organization_id="org-1",
        emails=[],
        step_type="meeting",
        provider_key="scheduling_provider",
        provider_value="calcom",
        completed_by="integration:calcom",
    )

    assert advanced is None
    svc.db.execute.assert_not_called()
    svc.complete_step.assert_not_awaited()


async def test_wrong_stage_type_does_not_advance():
    # Applicant matches by email, but their current stage is a form, not a
    # Cal.com meeting — the booking must not advance an unrelated stage.
    step = _step("form_submission", {})
    svc = _svc_with_prospects([_prospect("applicant@x.com", step)])

    advanced = await svc.complete_current_step_for_integration_event(
        organization_id="org-1",
        emails=["applicant@x.com"],
        step_type="meeting",
        provider_key="scheduling_provider",
        provider_value="calcom",
        completed_by="integration:calcom",
    )

    assert advanced is None
    svc.complete_step.assert_not_awaited()


async def test_meeting_without_calcom_provider_does_not_advance():
    # A manual meeting stage (no Cal.com) must ignore booking webhooks.
    step = _step("meeting", {"scheduling_provider": "manual"})
    svc = _svc_with_prospects([_prospect("applicant@x.com", step)])

    advanced = await svc.complete_current_step_for_integration_event(
        organization_id="org-1",
        emails=["applicant@x.com"],
        step_type="meeting",
        provider_key="scheduling_provider",
        provider_value="calcom",
        completed_by="integration:calcom",
    )

    assert advanced is None
    svc.complete_step.assert_not_awaited()
