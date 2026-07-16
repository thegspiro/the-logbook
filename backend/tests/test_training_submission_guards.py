"""
Guards on self-reported training submissions:
  * an officer may not approve their OWN submission (separation of duties)
  * a completion_date in the future is rejected at the schema layer
DB mocked where needed.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models.training import SubmissionStatus
from app.schemas.training_submission import TrainingSubmissionCreate
from app.services.training_submission_service import TrainingSubmissionService


def _submission(submitted_by):
    return SimpleNamespace(
        id=str(uuid4()),
        submitted_by=submitted_by,
        status=SubmissionStatus.PENDING_REVIEW,
        hours_completed=2.0,
        credit_hours=None,
        training_type="continuing_education",
        reviewed_by=None,
        reviewed_at=None,
        reviewer_notes=None,
    )


class _Session:
    def __init__(self):
        self.commit = AsyncMock()
        self.refresh = AsyncMock()


class TestOfficerSelfApproval:
    async def test_officer_cannot_approve_own_submission(self):
        officer = str(uuid4())
        svc = TrainingSubmissionService(_Session())
        svc.get_submission = AsyncMock(return_value=_submission(officer))

        with pytest.raises(ValueError, match="cannot approve your own"):
            await svc.review_submission(
                submission_id="s1",
                reviewer_id=officer,
                organization_id=str(uuid4()),
                action="approve",
            )

    async def test_other_officer_may_approve(self):
        submission = _submission(str(uuid4()))  # submitted by someone else
        svc = TrainingSubmissionService(_Session())
        svc.get_submission = AsyncMock(return_value=submission)
        svc._check_duplicate = AsyncMock(return_value=None)
        svc._create_record_from_submission = AsyncMock()

        result = await svc.review_submission(
            submission_id="s1",
            reviewer_id=str(uuid4()),  # a different officer
            organization_id=str(uuid4()),
            action="approve",
        )

        assert result.status == SubmissionStatus.APPROVED
        svc._create_record_from_submission.assert_awaited_once()

    async def test_officer_may_reject_own_submission(self):
        officer = str(uuid4())
        svc = TrainingSubmissionService(_Session())
        svc.get_submission = AsyncMock(return_value=_submission(officer))

        # Rejecting/revising one's own is harmless and allowed.
        result = await svc.review_submission(
            submission_id="s1",
            reviewer_id=officer,
            organization_id=str(uuid4()),
            action="reject",
            reviewer_notes="withdrawn",
        )
        assert result.status == SubmissionStatus.REJECTED


class TestCompletionDateValidation:
    def _payload(self, completion_date):
        return dict(
            course_name="CPR Refresher",
            training_type="continuing_education",
            completion_date=completion_date,
            hours_completed=2.0,
        )

    def test_future_date_rejected(self):
        with pytest.raises(ValidationError, match="future"):
            TrainingSubmissionCreate(**self._payload(date.today() + timedelta(days=5)))

    def test_today_accepted(self):
        sub = TrainingSubmissionCreate(**self._payload(date.today()))
        assert sub.completion_date == date.today()

    def test_past_accepted(self):
        past = date.today() - timedelta(days=400)
        sub = TrainingSubmissionCreate(**self._payload(past))
        assert sub.completion_date == past
