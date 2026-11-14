"""The resend key on a training submission, at the API boundary."""

import pytest
from pydantic import ValidationError

from app.schemas.training_submission import TrainingSubmissionCreate

pytestmark = pytest.mark.unit

BASE = {
    "course_name": "Ladder drill",
    "training_type": "skills_practice",
    "completion_date": "2026-10-30",
    "hours_completed": 2,
}


def test_a_uuid_key_reaches_the_service_arguments():
    # The endpoint passes model_dump(exclude_unset=True) to create_submission,
    # which takes the key by name.
    key = "3f6c2a1e-9b8d-4c7a-8e5f-0a1b2c3d4e5f"
    dumped = TrainingSubmissionCreate(**BASE, client_request_id=key).model_dump(
        exclude_unset=True
    )
    assert dumped["client_request_id"] == key


def test_the_key_is_optional():
    dumped = TrainingSubmissionCreate(**BASE).model_dump(exclude_unset=True)
    assert "client_request_id" not in dumped


@pytest.mark.parametrize(
    "key", ["short", "x" * 65, "has spaces in it", "semi;colon-0001", "slash/0000001"]
)
def test_a_malformed_key_is_refused(key):
    with pytest.raises(ValidationError):
        TrainingSubmissionCreate(**BASE, client_request_id=key)
