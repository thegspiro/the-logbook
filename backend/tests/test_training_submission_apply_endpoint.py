"""Regression tests for applying an approved submission to a requirement."""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import training_submissions
from app.schemas.training_submission import SubmissionReviewRequest


async def test_failed_apply_does_not_emit_success_audit(monkeypatch):
    """A target can disappear between validation and the actual apply."""
    submission_id = str(uuid4())
    organization_id = uuid4()
    submitter_id = uuid4()
    reviewer_id = uuid4()
    program_id = uuid4()
    requirement_id = uuid4()
    submission = SimpleNamespace(
        submitted_by=submitter_id,
        hours_completed=2.0,
        completion_date=date.today(),
    )

    submission_service = SimpleNamespace(
        get_submission=AsyncMock(return_value=submission),
        review_submission=AsyncMock(return_value=submission),
    )
    program_service = SimpleNamespace(
        validate_apply_target=AsyncMock(return_value=(True, None)),
        apply_training_to_requirement=AsyncMock(
            return_value=(False, "Enrollment is no longer active")
        ),
    )
    audit = AsyncMock()

    monkeypatch.setattr(
        training_submissions, "TrainingSubmissionService", lambda db: submission_service
    )
    monkeypatch.setattr(training_submissions, "log_audit_event", audit)
    monkeypatch.setattr(
        "app.services.training_program_service.TrainingProgramService",
        lambda db: program_service,
    )

    review = SubmissionReviewRequest(
        action="approve",
        apply_to_program_id=program_id,
        apply_to_requirement_id=requirement_id,
    )
    current_user = SimpleNamespace(
        id=reviewer_id, organization_id=organization_id, username="reviewer"
    )

    with pytest.raises(HTTPException) as exc_info:
        await training_submissions.review_submission(
            submission_id=submission_id,
            review=review,
            db=object(),
            current_user=current_user,
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Enrollment is no longer active"
    program_service.apply_training_to_requirement.assert_awaited_once()
    audit.assert_not_awaited()
