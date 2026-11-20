"""Request bodies cannot write the ``attachments`` column of a training record
or a training submission.

The stored shape is a server-written dict carrying ``file_path``, which a
client never sees and so cannot produce. A body that sent ``attachments``
replaced that list with bare strings: every entry's file was orphaned (no
reference collector can see a string), and on a submission a fake name
satisfied the department's required-evidence setting. The upload routes and
the approval copy are now the only writers.
"""

import json
import uuid
from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import select

from app.api.v1.endpoints import training, training_submissions
from app.models.training import TrainingRecord, TrainingStatus
from app.models.user import Organization, User, UserStatus
from app.schemas.training import (
    TrainingRecordCreate,
    TrainingRecordResponse,
    TrainingRecordUpdate,
)
from app.schemas.training_submission import (
    TrainingSubmissionCreate,
    TrainingSubmissionUpdate,
)

_VALUES = (["renamed.pdf"], [], None)


def _locs(error: ValidationError) -> list[tuple]:
    return [tuple(e["loc"]) for e in error.errors()]


def _record_create(**overrides):
    body = {
        "user_id": str(uuid.uuid4()),
        "course_name": "CPR",
        "training_type": "certification",
        "hours_completed": 4,
    }
    body.update(overrides)
    return body


def _submission_create(**overrides):
    body = {
        "course_name": "CPR",
        "training_type": "certification",
        "completion_date": str(date.today()),
        "hours_completed": 4,
    }
    body.update(overrides)
    return body


@pytest.mark.unit
class TestTheFourBodiesRefuseAttachments:
    @pytest.mark.parametrize("value", _VALUES)
    def test_a_record_update(self, value):
        with pytest.raises(ValidationError) as caught:
            TrainingRecordUpdate.model_validate({"attachments": value})
        assert _locs(caught.value) == [("attachments",)]

    @pytest.mark.parametrize("value", _VALUES)
    def test_a_record_create(self, value):
        with pytest.raises(ValidationError) as caught:
            TrainingRecordCreate.model_validate(_record_create(attachments=value))
        assert _locs(caught.value) == [("attachments",)]

    @pytest.mark.parametrize("value", _VALUES)
    def test_a_submission_update(self, value):
        with pytest.raises(ValidationError) as caught:
            TrainingSubmissionUpdate.model_validate({"attachments": value})
        assert _locs(caught.value) == [("attachments",)]

    @pytest.mark.parametrize("value", _VALUES)
    def test_a_submission_create(self, value):
        """The case that mattered most: a fake name passed the department's
        required-evidence check."""
        with pytest.raises(ValidationError) as caught:
            TrainingSubmissionCreate.model_validate(
                _submission_create(attachments=value)
            )
        assert _locs(caught.value) == [("attachments",)]

    def test_the_message_points_at_the_upload_route(self):
        with pytest.raises(ValidationError) as caught:
            TrainingRecordUpdate.model_validate({"attachments": []})
        assert "/training/records/{id}/attachments" in str(caught.value)

    def test_a_body_without_the_key_is_unaffected(self):
        assert TrainingRecordUpdate.model_validate({"notes": "x"}).notes == "x"
        assert TrainingRecordCreate.model_validate(_record_create()).attachments is None
        assert (
            TrainingSubmissionCreate.model_validate(_submission_create()).attachments
            is None
        )
        assert TrainingSubmissionUpdate.model_validate({}).attachments is None

    def test_a_response_still_carries_the_stored_attachments(self):
        """The refusal sits on the request schemas only: the response, which
        shares TrainingRecordBase, must still serialize what is stored."""
        now = datetime.now(UTC)
        response = TrainingRecordResponse.model_validate(
            {
                **_record_create(),
                "id": str(uuid.uuid4()),
                "organization_id": str(uuid.uuid4()),
                "created_at": now,
                "updated_at": now,
                "attachments": [{"file_name": "a.pdf", "file_path": "/x"}, "b.pdf"],
            }
        )
        assert [a.file_name for a in response.attachments] == ["a.pdf", "b.pdf"]


@pytest.mark.unit
class TestCreateWithAttachmentRefusesTheKeyInItsPayload:
    async def test_the_file_is_never_stored(self, monkeypatch):
        """The key used to be dropped silently and the file stored."""
        store = AsyncMock()
        monkeypatch.setattr(training_submissions, "_store_attachment_file", store)

        with pytest.raises(RequestValidationError) as caught:
            await training_submissions.create_submission_with_attachment(
                payload=json.dumps(_submission_create(attachments=["fake.pdf"])),
                file=SimpleNamespace(
                    read=AsyncMock(return_value=b"%PDF-1.4"), filename="cert.pdf"
                ),
                db=None,
                current_user=SimpleNamespace(id="user-1", organization_id="org-1"),
            )

        assert [tuple(e["loc"]) for e in caught.value.errors()] == [("attachments",)]
        store.assert_not_awaited()


@pytest.mark.integration
class TestStoredEntriesSurviveAnEdit:
    """Regression guard: an edit that does not mention attachments leaves the
    stored entries exactly as they were."""

    async def test_an_officer_edit_keeps_the_stored_entry(self, db_session):
        org = Organization(name="Attach FD", slug=f"att-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        suffix = uuid.uuid4().hex[:8]
        member = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"m-{suffix}",
            email=f"m-{suffix}@example.org",
            first_name="Pat",
            last_name="Member",
            status=UserStatus.ACTIVE,
        )
        db_session.add(member)
        await db_session.flush()
        entry = {
            "file_name": "card.pdf",
            "file_path": f"/uploads/{org.id}/training-records/r/card.pdf",
            "file_type": "application/pdf",
            "file_size": 8,
            "uploaded_at": "2026-01-01T00:00:00+00:00",
            "uploaded_by": str(member.id),
        }
        record = TrainingRecord(
            organization_id=org.id,
            user_id=member.id,
            course_name="CPR",
            training_type="certification",
            completion_date=date(2024, 1, 1),
            hours_completed=4.0,
            status=TrainingStatus.COMPLETED,
            attachments=[dict(entry)],
        )
        db_session.add(record)
        await db_session.flush()

        await training.update_record(
            uuid.UUID(str(record.id)),
            TrainingRecordUpdate(notes="x"),
            BackgroundTasks(),
            reason=None,
            db=db_session,
            current_user=member,
        )

        fresh = (
            await db_session.execute(
                select(TrainingRecord)
                .where(TrainingRecord.id == record.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert fresh.notes == "x"
        assert fresh.attachments == [entry]
