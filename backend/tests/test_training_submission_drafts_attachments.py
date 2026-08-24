"""Draft submissions and certificate attachments on self-reported training.

Covers the two behaviours the redesigned submit form depends on:
  * a draft is parked outside the review workflow until the member submits it,
    and routing (review vs auto-approve) is decided at that moment
  * an attachment is written by the submitter only, is served back without the
    server file path, and cannot be used to read a file outside its directory
"""

import json
import os
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import training_submissions
from app.models.training import SubmissionStatus
from app.schemas.training_submission import (
    TrainingSubmissionCreate,
    TrainingSubmissionResponse,
    sanitize_attachments,
)
from app.services.training_submission_service import TrainingSubmissionService


class _Session:
    def __init__(self):
        self.added = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    def add(self, obj):
        self.added.append(obj)


def _config(**overrides):
    base = dict(
        require_approval=True,
        auto_approve_under_hours=None,
        max_hours_per_submission=16,
        allowed_training_types=None,
        field_config={},
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _submission(**overrides):
    base = dict(
        id=str(uuid4()),
        submitted_by=str(uuid4()),
        organization_id=str(uuid4()),
        status=SubmissionStatus.DRAFT,
        training_type="continuing_education",
        hours_completed=1.0,
        certification_number=None,
        issuing_agency=None,
        expiration_date=None,
        category_id=None,
        attachments=None,
        course_name="Pump Ops",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestDrafts:
    async def test_save_as_draft_skips_the_review_queue(self):
        svc = TrainingSubmissionService(_Session())
        svc.get_config = AsyncMock(return_value=_config(require_approval=False))
        svc._check_duplicate = AsyncMock(return_value=None)
        svc._create_record_from_submission = AsyncMock()

        submission = await svc.create_submission(
            organization_id=str(uuid4()),
            submitted_by=str(uuid4()),
            course_name="Pump Ops",
            training_type="continuing_education",
            completion_date=date.today(),
            hours_completed=2.0,
            save_as_draft=True,
        )

        # require_approval=False would otherwise auto-approve this outright.
        assert submission.status == SubmissionStatus.DRAFT
        svc._create_record_from_submission.assert_not_awaited()

    async def test_submitting_a_draft_routes_it_for_review(self):
        owner = str(uuid4())
        draft = _submission(submitted_by=owner)
        svc = TrainingSubmissionService(_Session())
        svc.get_submission = AsyncMock(return_value=draft)
        svc.get_config = AsyncMock(return_value=_config())
        svc._record_if_auto_approved = AsyncMock()

        result = await svc.submit_draft(draft.id, owner, draft.organization_id)

        assert result.status == SubmissionStatus.PENDING_REVIEW

    async def test_draft_routing_uses_the_settings_in_force_at_submit_time(self):
        """A draft can sit for weeks; the department's rules may have changed."""
        owner = str(uuid4())
        draft = _submission(submitted_by=owner)
        svc = TrainingSubmissionService(_Session())
        svc.get_submission = AsyncMock(return_value=draft)
        svc.get_config = AsyncMock(return_value=_config(require_approval=False))
        svc._record_if_auto_approved = AsyncMock()

        result = await svc.submit_draft(draft.id, owner, draft.organization_id)

        assert result.status == SubmissionStatus.APPROVED
        svc._record_if_auto_approved.assert_awaited_once()

    async def test_a_certification_draft_still_needs_an_officer(self):
        """Separation of duties survives the draft path."""
        owner = str(uuid4())
        draft = _submission(submitted_by=owner, training_type="certification")
        svc = TrainingSubmissionService(_Session())
        svc.get_submission = AsyncMock(return_value=draft)
        svc.get_config = AsyncMock(
            return_value=_config(require_approval=False, auto_approve_under_hours=40)
        )
        svc._record_if_auto_approved = AsyncMock()

        result = await svc.submit_draft(draft.id, owner, draft.organization_id)

        assert result.status == SubmissionStatus.PENDING_REVIEW

    async def test_only_the_owner_may_submit_a_draft(self):
        draft = _submission()
        svc = TrainingSubmissionService(_Session())
        svc.get_submission = AsyncMock(return_value=draft)

        with pytest.raises(PermissionError):
            await svc.submit_draft(draft.id, str(uuid4()), draft.organization_id)

    async def test_only_a_draft_can_be_submitted(self):
        owner = str(uuid4())
        submission = _submission(
            submitted_by=owner, status=SubmissionStatus.PENDING_REVIEW
        )
        svc = TrainingSubmissionService(_Session())
        svc.get_submission = AsyncMock(return_value=submission)

        with pytest.raises(ValueError, match="Only a draft"):
            await svc.submit_draft(submission.id, owner, submission.organization_id)

    def test_create_schema_defaults_to_not_a_draft(self):
        payload = TrainingSubmissionCreate(
            course_name="Pump Ops",
            training_type="continuing_education",
            completion_date=date.today(),
            hours_completed=2.0,
        )
        assert payload.save_as_draft is False

    async def test_officer_listing_hides_other_members_drafts(self, monkeypatch):
        captured = {}

        async def _get_submissions(**kwargs):
            captured.update(kwargs)
            return []

        monkeypatch.setattr(
            training_submissions,
            "TrainingSubmissionService",
            lambda db: SimpleNamespace(get_submissions=_get_submissions),
        )

        await training_submissions.get_all_submissions(
            status=None,
            user_id=None,
            limit=50,
            offset=0,
            db=None,
            current_user=SimpleNamespace(organization_id=str(uuid4())),
        )
        assert captured["exclude_statuses"] == ["draft"]

        await training_submissions.get_all_submissions(
            status="draft",
            user_id=None,
            limit=50,
            offset=0,
            db=None,
            current_user=SimpleNamespace(organization_id=str(uuid4())),
        )
        # An explicit filter is an officer asking for exactly that status.
        assert captured["exclude_statuses"] is None


class TestAttachments:
    def test_sanitize_drops_the_server_path(self):
        rows = sanitize_attachments(
            [
                {
                    "file_name": "cert.pdf",
                    "file_path": "/app/uploads/x/abc.pdf",
                    "file_type": "application/pdf",
                    "file_size": 12,
                    "uploaded_at": "2026-03-12T00:00:00+00:00",
                    "uploaded_by": "user-1",
                },
                "legacy-string-entry",
            ]
        )
        assert rows[0] == {
            "index": 0,
            "file_name": "cert.pdf",
            "file_type": "application/pdf",
            "file_size": 12,
            "uploaded_at": "2026-03-12T00:00:00+00:00",
        }
        assert rows[1] == {"index": 1, "file_name": "legacy-string-entry"}

    def test_response_model_never_serializes_a_file_path(self):
        response = TrainingSubmissionResponse.model_validate(
            SimpleNamespace(
                id=uuid4(),
                organization_id=uuid4(),
                submitted_by=uuid4(),
                submitter_name=None,
                course_name="Pump Ops",
                course_code=None,
                training_type="continuing_education",
                description=None,
                completion_date=date.today(),
                hours_completed=2.0,
                credit_hours=None,
                instructor=None,
                location=None,
                certification_number=None,
                issuing_agency=None,
                expiration_date=None,
                category_id=None,
                attachments=[
                    {"file_name": "cert.pdf", "file_path": "/app/uploads/x/abc.pdf"}
                ],
                status="pending_review",
                reviewed_by=None,
                reviewed_at=None,
                reviewer_notes=None,
                training_record_id=None,
                submitted_at=date.today(),
                updated_at=date.today(),
            )
        )
        assert "file_path" not in response.model_dump_json()

    async def test_non_owner_without_permission_is_refused(self, monkeypatch):
        submission = _submission()
        monkeypatch.setattr(
            training_submissions,
            "TrainingSubmissionService",
            lambda db: SimpleNamespace(
                get_submission=AsyncMock(return_value=submission)
            ),
        )
        with (
            patch.object(training_submissions, "_has_permission", return_value=False),
            patch.object(
                training_submissions, "_collect_user_permissions", return_value=set()
            ),
        ):
            with pytest.raises(HTTPException) as exc:
                await training_submissions._load_submission_for_attachment(
                    None,
                    submission.id,
                    SimpleNamespace(
                        id=str(uuid4()),
                        organization_id=submission.organization_id,
                        permissions=[],
                        role=None,
                    ),
                )
        assert exc.value.status_code == 403

    async def test_download_refuses_a_path_outside_the_attachment_directory(
        self, monkeypatch
    ):
        """The column is client-writable through the create/update schemas."""
        submission = _submission(attachments=[{"file_path": "/etc/passwd"}])
        monkeypatch.setattr(
            training_submissions,
            "_load_submission_for_attachment",
            AsyncMock(return_value=submission),
        )

        with pytest.raises(HTTPException) as exc:
            await training_submissions.download_submission_attachment(
                submission.id,
                0,
                db=None,
                current_user=SimpleNamespace(id=submission.submitted_by),
            )
        assert exc.value.status_code == 404

    async def test_upload_rejects_a_disallowed_file_type(self, monkeypatch, tmp_path):
        submission = _submission(submitted_by="user-1")
        monkeypatch.setattr(
            training_submissions,
            "_load_submission_for_attachment",
            AsyncMock(return_value=submission),
        )
        monkeypatch.setattr(
            training_submissions, "SUBMISSION_ATTACHMENT_DIR", str(tmp_path)
        )
        monkeypatch.setattr(
            training_submissions, "detect_mime_type", lambda content: "text/plain"
        )

        upload = SimpleNamespace(
            read=AsyncMock(return_value=b"plain text"), filename="notes.txt"
        )
        with pytest.raises(HTTPException) as exc:
            await training_submissions.upload_submission_attachment(
                submission.id,
                file=upload,
                db=None,
                current_user=SimpleNamespace(id="user-1", organization_id="org-1"),
            )
        assert exc.value.status_code == 400
        assert not os.listdir(tmp_path)

    async def test_upload_stores_a_pdf_and_returns_sanitized_metadata(
        self, monkeypatch, tmp_path
    ):
        submission = _submission(submitted_by="user-1")
        monkeypatch.setattr(
            training_submissions,
            "_load_submission_for_attachment",
            AsyncMock(return_value=submission),
        )
        monkeypatch.setattr(
            training_submissions, "SUBMISSION_ATTACHMENT_DIR", str(tmp_path)
        )
        monkeypatch.setattr(
            training_submissions, "detect_mime_type", lambda content: "application/pdf"
        )
        # flag_modified needs a real mapped instance; the JSON reassignment
        # above it is the part under test.
        monkeypatch.setattr(
            training_submissions, "flag_modified", lambda instance, key: None
        )
        db = _Session()

        upload = SimpleNamespace(
            read=AsyncMock(return_value=b"%PDF-1.4"), filename="cert.pdf"
        )
        result = await training_submissions.upload_submission_attachment(
            submission.id,
            file=upload,
            db=db,
            current_user=SimpleNamespace(id="user-1", organization_id="org-1"),
        )

        assert result["attachments"] == [
            {
                "index": 0,
                "file_name": "cert.pdf",
                "file_type": "application/pdf",
                "file_size": len(b"%PDF-1.4"),
                "uploaded_at": submission.attachments[0]["uploaded_at"],
            }
        ]
        # Stored under a server-generated name with a magic-derived extension.
        stored = os.listdir(os.path.join(str(tmp_path), "org-1"))
        assert len(stored) == 1
        assert stored[0].endswith(".pdf")

    async def test_upload_is_refused_once_a_decision_has_been_made(
        self, monkeypatch, tmp_path
    ):
        submission = _submission(
            submitted_by="user-1", status=SubmissionStatus.APPROVED
        )
        monkeypatch.setattr(
            training_submissions,
            "_load_submission_for_attachment",
            AsyncMock(return_value=submission),
        )
        monkeypatch.setattr(
            training_submissions, "SUBMISSION_ATTACHMENT_DIR", str(tmp_path)
        )

        with pytest.raises(HTTPException) as exc:
            await training_submissions.upload_submission_attachment(
                submission.id,
                file=SimpleNamespace(
                    read=AsyncMock(return_value=b"%PDF"), filename="c.pdf"
                ),
                db=None,
                current_user=SimpleNamespace(id="user-1", organization_id="org-1"),
            )
        assert exc.value.status_code == 400


class TestDraftHandoffRevalidates:
    """A draft can sit for weeks; the department's rules may tighten."""

    async def _submit(self, config, **submission_overrides):
        owner = str(uuid4())
        draft = _submission(submitted_by=owner, **submission_overrides)
        svc = TrainingSubmissionService(_Session())
        svc.get_submission = AsyncMock(return_value=draft)
        svc.get_config = AsyncMock(return_value=config)
        svc._record_if_auto_approved = AsyncMock()
        return await svc.submit_draft(draft.id, owner, draft.organization_id)

    async def test_hours_over_a_lowered_maximum_are_rejected(self):
        with pytest.raises(ValueError, match="exceed maximum"):
            await self._submit(_config(max_hours_per_submission=1), hours_completed=4.0)

    async def test_a_type_no_longer_allowed_is_rejected(self):
        with pytest.raises(ValueError, match="not allowed"):
            await self._submit(_config(allowed_training_types=["certification"]))

    async def test_required_supporting_documents_are_enforced(self):
        config = _config(
            field_config={"attachments": {"visible": True, "required": True}}
        )
        with pytest.raises(ValueError, match="supporting documents"):
            await self._submit(config, attachments=None)

        result = await self._submit(config, attachments=[{"file_name": "cert.pdf"}])
        assert result.status == SubmissionStatus.PENDING_REVIEW

    async def test_the_handoff_timestamps_the_submission(self):
        """The queue orders by submitted_at, so a promoted draft is filed now."""
        result = await self._submit(_config())
        assert result.submitted_at is not None

    async def test_an_auto_approved_draft_commits_once(self):
        """The status change and its record share a transaction.

        Two commits would leave a failed record insert behind an approved
        submission no retry can reach — it is no longer a draft.
        """
        owner = str(uuid4())
        draft = _submission(submitted_by=owner)
        session = _Session()
        svc = TrainingSubmissionService(session)
        svc.get_submission = AsyncMock(return_value=draft)
        svc.get_config = AsyncMock(return_value=_config(require_approval=False))
        svc._check_duplicate = AsyncMock(return_value=None)
        svc._create_record_from_submission = AsyncMock()

        result = await svc.submit_draft(draft.id, owner, draft.organization_id)

        assert result.status == SubmissionStatus.APPROVED
        # The record helper owns the commit on this path.
        session.commit.assert_not_awaited()
        svc._create_record_from_submission.assert_awaited_once()


class TestAttachmentRoot:
    def test_submission_evidence_lives_under_the_record_download_root(self):
        """Approval copies these paths onto the TrainingRecord verbatim.

        The record download route confines paths to TRAINING_ATTACHMENT_DIR, so
        a sibling directory would 404 every approved certificate from the
        member's own training history.
        """
        from app.api.v1.endpoints.training_enhancements import TRAINING_ATTACHMENT_DIR

        assert training_submissions.SUBMISSION_ATTACHMENT_DIR.startswith(
            TRAINING_ATTACHMENT_DIR + os.sep
        )

    def test_a_path_outside_the_root_is_never_returned(self):
        assert training_submissions._confined_path({"file_path": "/etc/passwd"}) is None
        assert training_submissions._confined_path("legacy-string") is None
        assert (
            training_submissions._confined_attachment_paths(
                [{"file_path": "/etc/passwd"}, None]
            )
            == []
        )


class TestDeletingASubmission:
    async def test_stored_evidence_is_removed_with_the_row(self, monkeypatch, tmp_path):
        """A withdrawn certificate must not outlive its submission on disk."""
        monkeypatch.setattr(
            training_submissions, "SUBMISSION_ATTACHMENT_DIR", str(tmp_path)
        )
        stored = tmp_path / "cert.pdf"
        stored.write_bytes(b"%PDF")
        submission = _submission(attachments=[{"file_path": str(stored)}])

        service = SimpleNamespace(
            get_submission=AsyncMock(return_value=submission),
            delete_submission=AsyncMock(return_value=True),
        )
        monkeypatch.setattr(
            training_submissions, "TrainingSubmissionService", lambda db: service
        )

        await training_submissions.delete_submission(
            submission.id,
            db=None,
            current_user=SimpleNamespace(
                id=submission.submitted_by, organization_id=submission.organization_id
            ),
        )

        assert not stored.exists()


class TestCreateWithAttachment:
    """One request for the submission and its evidence.

    Uploading afterwards cannot work for a submission the department
    auto-approves: it is frozen the moment it exists and its record has
    already been copied from it.
    """

    def _payload(self, **overrides):
        body = {
            "course_name": "EMT Recertification",
            "training_type": "continuing_education",
            "completion_date": str(date.today()),
            "start_time": "09:00:00",
            "hours_completed": 4.0,
        }
        body.update(overrides)
        return json.dumps(body)

    async def test_the_attachment_is_on_the_row_that_routing_sees(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setattr(
            training_submissions, "SUBMISSION_ATTACHMENT_DIR", str(tmp_path)
        )
        monkeypatch.setattr(
            training_submissions, "detect_mime_type", lambda content: "application/pdf"
        )
        captured = {}

        async def _create(**kwargs):
            captured.update(kwargs)
            return _submission(status=SubmissionStatus.APPROVED)

        monkeypatch.setattr(
            training_submissions,
            "TrainingSubmissionService",
            lambda db: SimpleNamespace(create_submission=_create),
        )

        await training_submissions.create_submission_with_attachment(
            payload=self._payload(),
            file=SimpleNamespace(
                read=AsyncMock(return_value=b"%PDF-1.4"), filename="cert.pdf"
            ),
            db=None,
            current_user=SimpleNamespace(id="user-1", organization_id="org-1"),
        )

        assert captured["attachments"][0]["file_name"] == "cert.pdf"
        assert captured["attachments"][0]["file_type"] == "application/pdf"
        # The start time the member reported travels with it.
        assert str(captured["start_time"]) == "09:00:00"

    async def test_a_rejected_file_never_reaches_the_service(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setattr(
            training_submissions, "SUBMISSION_ATTACHMENT_DIR", str(tmp_path)
        )
        monkeypatch.setattr(
            training_submissions, "detect_mime_type", lambda content: "text/plain"
        )
        create = AsyncMock()
        monkeypatch.setattr(
            training_submissions,
            "TrainingSubmissionService",
            lambda db: SimpleNamespace(create_submission=create),
        )

        with pytest.raises(HTTPException) as exc:
            await training_submissions.create_submission_with_attachment(
                payload=self._payload(),
                file=SimpleNamespace(
                    read=AsyncMock(return_value=b"plain"), filename="notes.txt"
                ),
                db=None,
                current_user=SimpleNamespace(id="user-1", organization_id="org-1"),
            )

        assert exc.value.status_code == 400
        create.assert_not_awaited()
        assert not os.listdir(tmp_path)

    async def test_a_failed_create_does_not_strand_the_file(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setattr(
            training_submissions, "SUBMISSION_ATTACHMENT_DIR", str(tmp_path)
        )
        monkeypatch.setattr(
            training_submissions, "detect_mime_type", lambda content: "application/pdf"
        )

        async def _boom(**kwargs):
            raise ValueError("Hours exceed maximum of 4 per submission")

        monkeypatch.setattr(
            training_submissions,
            "TrainingSubmissionService",
            lambda db: SimpleNamespace(create_submission=_boom),
        )

        with pytest.raises(HTTPException):
            await training_submissions.create_submission_with_attachment(
                payload=self._payload(hours_completed=40.0),
                file=SimpleNamespace(
                    read=AsyncMock(return_value=b"%PDF-1.4"), filename="cert.pdf"
                ),
                db=None,
                current_user=SimpleNamespace(id="user-1", organization_id="org-1"),
            )

        # The row never landed, so the bytes on disk belong to nothing.
        assert os.listdir(os.path.join(str(tmp_path), "org-1")) == []

    async def test_a_malformed_payload_is_a_422_not_a_500(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            training_submissions, "SUBMISSION_ATTACHMENT_DIR", str(tmp_path)
        )
        with pytest.raises(HTTPException) as exc:
            await training_submissions.create_submission_with_attachment(
                payload='{"course_name": "No hours"}',
                file=SimpleNamespace(
                    read=AsyncMock(return_value=b"%PDF"), filename="c.pdf"
                ),
                db=None,
                current_user=SimpleNamespace(id="user-1", organization_id="org-1"),
            )
        assert exc.value.status_code == 422


class TestStartTime:
    def test_the_reported_start_time_reaches_the_record(self):
        """`_create_record_from_submission` copies it, so the officer sees when
        the class ran rather than a date alone."""
        import inspect

        source = inspect.getsource(
            TrainingSubmissionService._create_record_from_submission
        )
        assert "start_time=submission.start_time" in source
