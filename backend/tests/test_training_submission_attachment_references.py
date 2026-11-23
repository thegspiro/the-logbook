"""Removing a submission's attachment, or the whole submission, keeps a file
another row still names.

Approval copies a submission's certificate entries onto the training record it
creates, and ``reverse_approval`` voids that record without touching its
attachments. The submission is editable again afterwards, so the member can
remove the certificate, or delete the submission, while the voided record
still names the file. Both routes used to unlink it regardless.
"""

import uuid
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints import training_submissions
from app.models.pending_file_deletion import PendingFileDeletion
from app.models.training import (
    SubmissionStatus,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
)
from app.models.user import Organization, User, UserStatus
from app.services import file_storage_service, member_files
from app.services.training_submission_service import TrainingSubmissionService

pytestmark = pytest.mark.integration


@pytest.fixture
def root(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
    # No saved S3 settings: every department here keeps files on the volume.
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    return uploads


async def _org_and_member(db):
    org = Organization(name="Refs FD", slug=f"refs-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
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
    db.add(member)
    await db.flush()
    return org, member


def _certificate(root, org_id):
    directory = root / str(org_id) / "self-reports" / uuid.uuid4().hex
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{uuid.uuid4().hex}.pdf"
    path.write_bytes(b"%PDF-1.4 certificate")
    return path


def _entry(path, name="cert.pdf"):
    return {
        "file_name": name,
        "file_path": str(path),
        "file_type": "application/pdf",
        "file_size": 20,
        "uploaded_at": "2026-01-01T00:00:00+00:00",
        "uploaded_by": "someone",
    }


async def _submission(db, org, member, attachments, **overrides):
    fields = dict(
        organization_id=str(org.id),
        submitted_by=str(member.id),
        course_name="CPR",
        training_type="certification",
        completion_date=date(2024, 1, 1),
        hours_completed=4.0,
        status=SubmissionStatus.PENDING_REVIEW,
        attachments=attachments,
    )
    fields.update(overrides)
    submission = TrainingSubmission(**fields)
    db.add(submission)
    await db.flush()
    return submission


async def _voided_record(db, org, member, attachments):
    record = TrainingRecord(
        organization_id=str(org.id),
        user_id=str(member.id),
        course_name="CPR",
        training_type="certification",
        completion_date=date(2024, 1, 1),
        hours_completed=4.0,
        status=TrainingStatus.CANCELLED,
        voided_at=datetime.now(UTC),
        attachments=attachments,
    )
    db.add(record)
    await db.flush()
    return record


async def _fresh(db, model, row_id):
    return (
        await db.execute(
            select(model)
            .where(model.id == row_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


class TestRemovingOneAttachment:
    async def test_keeps_a_file_a_voided_record_names(self, db_session, root):
        org, member = await _org_and_member(db_session)
        kept = _certificate(root, org.id)
        other = _certificate(root, org.id)
        submission = await _submission(
            db_session, org, member, [_entry(kept), _entry(other, "other.pdf")]
        )
        await _voided_record(db_session, org, member, [_entry(kept)])

        await training_submissions.delete_submission_attachment(
            submission.id, "0", expected_id=None, db=db_session, current_user=member
        )

        assert kept.exists()
        assert other.exists()
        fresh = await _fresh(db_session, TrainingSubmission, submission.id)
        assert fresh.attachments == [_entry(other, "other.pdf")]

    async def test_keeps_a_file_the_same_list_names_twice(self, db_session, root):
        org, member = await _org_and_member(db_session)
        certificate = _certificate(root, org.id)
        submission = await _submission(
            db_session,
            org,
            member,
            [_entry(certificate), _entry(certificate)],
            status=SubmissionStatus.DRAFT,
        )

        await training_submissions.delete_submission_attachment(
            submission.id, "0", expected_id=None, db=db_session, current_user=member
        )

        assert certificate.exists()
        fresh = await _fresh(db_session, TrainingSubmission, submission.id)
        assert fresh.attachments == [_entry(certificate)]

    async def test_still_removes_an_unreferenced_certificate(self, db_session, root):
        org, member = await _org_and_member(db_session)
        certificate = _certificate(root, org.id)
        submission = await _submission(
            db_session,
            org,
            member,
            [_entry(certificate)],
            status=SubmissionStatus.DRAFT,
        )

        await training_submissions.delete_submission_attachment(
            submission.id, "0", expected_id=None, db=db_session, current_user=member
        )

        assert not certificate.exists()
        fresh = await _fresh(db_session, TrainingSubmission, submission.id)
        assert fresh.attachments == []

    async def test_a_failed_reference_check_keeps_the_file(
        self, db_session, root, monkeypatch
    ):
        org, member = await _org_and_member(db_session)
        certificate = _certificate(root, org.id)
        submission = await _submission(
            db_session,
            org,
            member,
            [_entry(certificate)],
            status=SubmissionStatus.DRAFT,
        )
        monkeypatch.setattr(
            member_files,
            "referenced_elsewhere",
            AsyncMock(side_effect=RuntimeError("database went away")),
        )

        await training_submissions.delete_submission_attachment(
            submission.id, "0", expected_id=None, db=db_session, current_user=member
        )

        assert certificate.exists()
        fresh = await _fresh(db_session, TrainingSubmission, submission.id)
        assert fresh.attachments == []


class TestDeletingTheSubmission:
    async def test_keeps_a_file_a_voided_record_names(self, db_session, root):
        org, member = await _org_and_member(db_session)
        kept = _certificate(root, org.id)
        alone = _certificate(root, org.id)
        submission = await _submission(
            db_session, org, member, [_entry(kept), _entry(alone, "alone.pdf")]
        )
        await _voided_record(db_session, org, member, [_entry(kept)])

        await training_submissions.delete_submission(
            submission.id, db=db_session, current_user=member
        )

        assert kept.exists()
        assert not alone.exists()
        assert await _fresh(db_session, TrainingSubmission, submission.id) is None

    async def test_a_failed_reference_check_keeps_every_file(
        self, db_session, root, monkeypatch
    ):
        org, member = await _org_and_member(db_session)
        certificate = _certificate(root, org.id)
        submission = await _submission(db_session, org, member, [_entry(certificate)])
        monkeypatch.setattr(
            member_files,
            "referenced_elsewhere",
            AsyncMock(side_effect=RuntimeError("database went away")),
        )

        await training_submissions.delete_submission(
            submission.id, db=db_session, current_user=member
        )

        assert certificate.exists()
        assert await _fresh(db_session, TrainingSubmission, submission.id) is None


async def _queued(db, org):
    return sorted(
        (
            await db.execute(
                select(
                    PendingFileDeletion.path,
                    PendingFileDeletion.area,
                    PendingFileDeletion.reason,
                ).where(PendingFileDeletion.organization_id == str(org.id))
            )
        ).all()
    )


class TestTheFilesAreQueuedWithTheDelete:
    """The certificates were removed only after the commit and after the
    officers' prompts were archived, so a failure in between left them with
    nothing recording them (owner decision 2026-11-23, batch A item 4)."""

    async def test_a_notification_failure_after_the_commit_leaves_them_queued(
        self, db_session, root, monkeypatch
    ):
        org, member = await _org_and_member(db_session)
        certificate = _certificate(root, org.id)
        submission = await _submission(db_session, org, member, [_entry(certificate)])
        monkeypatch.setattr(
            TrainingSubmissionService,
            "_archive_review_prompts",
            AsyncMock(side_effect=RuntimeError("notifications table locked")),
        )

        with pytest.raises(HTTPException):
            await training_submissions.delete_submission(
                submission.id, db=db_session, current_user=member
            )

        assert await _fresh(db_session, TrainingSubmission, submission.id) is None
        assert await _queued(db_session, org) == [
            (
                str(certificate.resolve()),
                "self-reports",
                "submission_deleted",
            )
        ]
        assert certificate.exists()

    async def test_a_completed_delete_resolves_its_rows(self, db_session, root):
        org, member = await _org_and_member(db_session)
        kept = _certificate(root, org.id)
        alone = _certificate(root, org.id)
        submission = await _submission(
            db_session, org, member, [_entry(kept), _entry(alone, "alone.pdf")]
        )
        await _voided_record(db_session, org, member, [_entry(kept)])

        await training_submissions.delete_submission(
            submission.id, db=db_session, current_user=member
        )

        assert await _queued(db_session, org) == []
        assert kept.exists()
        assert not alone.exists()
