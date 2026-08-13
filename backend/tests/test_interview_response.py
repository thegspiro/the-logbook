"""Regression tests for interview API response serialization."""

from datetime import datetime, timezone
from uuid import uuid4

from app.schemas.membership_pipeline import InterviewResponse


def test_interview_response_allows_deleted_interviewer():
    """Historical interviews remain serializable after an interviewer is deleted."""
    response = InterviewResponse(
        id=uuid4(),
        prospect_id=uuid4(),
        interviewer_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    assert response.interviewer_id is None
