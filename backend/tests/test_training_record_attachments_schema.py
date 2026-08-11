"""
Tests for how a training record's attachments are serialised.

`POST /training/records/{id}/attachments` stores a **dict** per file
(file_name, file_path, file_type, file_size, uploaded_at, uploaded_by), but the
record response declared `attachments: Optional[List[str]]`. So the first time
anybody attached a certificate, `GET /training/records` started returning a
500 — response validation failed for the whole list, not just that record.

Two things this pins: the response accepts what the uploader actually writes,
and it does not hand the client the server's filesystem path.
"""

import pytest
from pydantic import ValidationError

from app.schemas.training import TrainingAttachment, TrainingRecordResponse

STORED = {
    "file_name": "completion-certificate.pdf",
    "file_path": "/app/uploads/training_attachments/rec-1/abc123.pdf",
    "file_type": "application/pdf",
    "file_size": 1801,
    "uploaded_at": "2026-08-10T11:29:23.789957+00:00",
    "uploaded_by": "256605cb-e6e5-4183-aae9-23bb9eecd7ea",
}


def _record(attachments):
    return TrainingRecordResponse.model_validate(
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "organization_id": "22222222-2222-2222-2222-222222222222",
            "user_id": "33333333-3333-3333-3333-333333333333",
            "title": "Pump Operations",
            "course_name": "Pump Operations",
            "training_type": "skills_practice",
            "hours_completed": 4,
            "created_at": "2026-08-10T00:00:00Z",
            "updated_at": "2026-08-10T00:00:00Z",
            "attachments": attachments,
        }
    )


def test_accepts_the_dict_the_uploader_stores():
    record = _record([STORED])

    assert record.attachments is not None
    assert record.attachments[0].file_name == "completion-certificate.pdf"
    assert record.attachments[0].file_size == 1801


def test_does_not_expose_the_server_file_path():
    record = _record([STORED])

    dumped = record.model_dump()["attachments"][0]
    assert "file_path" not in dumped
    assert "uploaded_by" not in dumped
    # And nothing that looks like one leaked into another field.
    assert not any("/app/uploads" in str(v) for v in dumped.values())


def test_stamps_each_attachment_with_its_index():
    """The download route addresses attachments by position; they have no id."""
    record = _record([STORED, {**STORED, "file_name": "transcript.pdf"}])

    assert [a.index for a in record.attachments or []] == [0, 1]


def test_carries_legacy_string_attachments_through():
    """The column's original shape was a list of file names."""
    record = _record(["old-certificate.pdf"])

    assert record.attachments is not None
    assert record.attachments[0].file_name == "old-certificate.pdf"
    assert record.attachments[0].index == 0


def test_no_attachments_is_still_valid():
    assert _record(None).attachments is None
    assert _record([]).attachments == []


def test_attachment_rejects_a_non_numeric_size():
    with pytest.raises(ValidationError):
        TrainingAttachment(file_name="x.pdf", file_size="huge")
