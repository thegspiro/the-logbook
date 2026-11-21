"""Attachment entries carry a stable id, and the routes can name an entry by it.

An index moves when an earlier entry goes, so a removal by index repeated
after a lost 204 removed the next entry and its file (pitfall #36). By id, a
repeat finds nothing and changes nothing; by index, ``expected_id`` turns the
same mistake into a 409.
"""

import io
import os
import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, UploadFile

from app.api.v1.endpoints import training_enhancements, training_submissions
from app.models.training import (
    SubmissionStatus,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
)
from app.models.user import Organization, User
from app.schemas.training import TrainingRecordResponse
from app.schemas.training_submission import sanitize_attachments
from app.services import file_storage_service
from app.services.training_submission_service import TrainingSubmissionService
from app.utils.training_attachments import (
    EntryMoved,
    find_entry,
    parse_entry_ref,
    resolve_entry,
    with_entry_ids,
)

UUID_SHAPE = 36


class TestHelpers:
    pytestmark = pytest.mark.unit

    def test_stamps_only_the_dicts_without_an_id(self):
        kept = {"id": "keep-me", "file_name": "a.pdf"}
        original = [kept, {"file_name": "b.pdf"}, "legacy"]
        stamped = with_entry_ids(original)
        assert stamped[0] == kept
        assert len(stamped[1]["id"]) == UUID_SHAPE
        assert "-" in stamped[1]["id"]
        assert stamped[2] == "legacy"
        # A copy: the source list and its dicts are untouched.
        assert "id" not in original[1]
        assert stamped[0] is not kept

    def test_digits_are_an_index_and_anything_else_an_id(self):
        assert parse_entry_ref("3").index == 3
        ref = parse_entry_ref(str(uuid.uuid4()))
        assert ref.index is None
        assert ref.entry_id

    def test_resolve(self):
        entries = [{"id": "a"}, {"id": "b"}]
        assert resolve_entry(entries, "b") == (1, {"id": "b"})
        assert resolve_entry(entries, "gone") is None
        assert resolve_entry(entries, "5") is None
        assert resolve_entry(entries, "1", expected_id="b") == (1, {"id": "b"})
        with pytest.raises(EntryMoved):
            resolve_entry(entries, "0", expected_id="b")
        assert find_entry(None, "a") is None

    def test_the_responses_carry_the_id(self):
        assert sanitize_attachments([{"id": "a", "file_name": "x.pdf"}])[0]["id"] == "a"
        assert sanitize_attachments(["legacy.pdf"])[0]["id"] is None
        assert (
            training_enhancements._sanitize_attachments(
                SimpleNamespace(
                    attachments=[{"id": "a", "file_name": "x.pdf"}],
                    voided_at=None,
                    organization_id="org-1",
                    user_id="user-1",
                ),
                SimpleNamespace(id="user-1", rank=None, positions=[]),
            )[0]["id"]
            == "a"
        )
        assert TrainingRecordResponse.number_the_attachments(
            [{"id": "a", "file_name": "x.pdf"}]
        ) == [{"id": "a", "file_name": "x.pdf", "index": 0}]


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    monkeypatch.setattr(
        file_storage_service, "detect_mime_type", lambda content: "application/pdf"
    )
    monkeypatch.setattr(TrainingSubmissionService, "_notify_reviewers", AsyncMock())
    monkeypatch.setattr(TrainingSubmissionService, "_notify_member", AsyncMock())
    return tmp_path


async def _member(db):
    org = Organization(name="Entry FD", slug=f"entry-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    suffix = uuid.uuid4().hex[:8]
    member = User(
        organization_id=org.id,
        username=f"entry-{suffix}",
        email=f"entry-{suffix}@example.org",
        first_name="Entry",
        last_name="Member",
        password_hash="x",
    )
    db.add(member)
    await db.flush()
    return org, member


def _entry(root, org_id, label):
    directory = os.path.join(str(root), str(org_id), "self-reports", "s")
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{uuid.uuid4().hex}.pdf")
    with open(path, "wb") as handle:
        handle.write(b"%PDF-1.4 " + label.encode())
    return {
        "id": str(uuid.uuid4()),
        "file_name": f"{label}.pdf",
        "file_path": path,
        "file_type": "application/pdf",
    }


async def _pending(db, org, member, entries):
    submission = TrainingSubmission(
        organization_id=org.id,
        submitted_by=member.id,
        course_name="CPR",
        training_type="certification",
        completion_date=date(2026, 1, 5),
        hours_completed=2.0,
        status=SubmissionStatus.PENDING_REVIEW,
        attachments=entries,
    )
    db.add(submission)
    await db.flush()
    return submission


@pytest.mark.integration
class TestRemovalByEntry:
    async def test_removing_the_same_entry_twice_removes_one_file(
        self, db_session, root
    ):
        org, member = await _member(db_session)
        first = _entry(root, org.id, "first")
        second = _entry(root, org.id, "second")
        submission = await _pending(db_session, org, member, [first, second])

        for _ in range(2):
            await training_submissions.delete_submission_attachment(
                str(submission.id),
                first["id"],
                expected_id=None,
                db=db_session,
                current_user=member,
            )

        await db_session.refresh(submission)
        assert [e["id"] for e in submission.attachments] == [second["id"]]
        assert not os.path.exists(first["file_path"])
        assert os.path.exists(second["file_path"])

    async def test_a_legacy_index_with_a_stale_expected_id_answers_409(
        self, db_session, root
    ):
        org, member = await _member(db_session)
        first = _entry(root, org.id, "first")
        second = _entry(root, org.id, "second")
        submission = await _pending(db_session, org, member, [first, second])

        await training_submissions.delete_submission_attachment(
            str(submission.id),
            "0",
            expected_id=first["id"],
            db=db_session,
            current_user=member,
        )
        # The retry after a lost 204: slot 0 now holds the second entry.
        with pytest.raises(HTTPException) as exc:
            await training_submissions.delete_submission_attachment(
                str(submission.id),
                "0",
                expected_id=first["id"],
                db=db_session,
                current_user=member,
            )

        assert exc.value.status_code == 409
        await db_session.refresh(submission)
        assert [e["id"] for e in submission.attachments] == [second["id"]]
        assert os.path.exists(second["file_path"])

    async def test_an_absent_id_after_a_decision_is_still_a_no_op(
        self, db_session, root
    ):
        """A retry that arrives after an approval answers like any other
        repeat, not with a 400 about decisions."""
        org, member = await _member(db_session)
        first = _entry(root, org.id, "first")
        submission = await _pending(db_session, org, member, [first])
        submission.status = SubmissionStatus.APPROVED
        await db_session.flush()

        await training_submissions.delete_submission_attachment(
            str(submission.id),
            str(uuid.uuid4()),
            expected_id=None,
            db=db_session,
            current_user=member,
        )

        await db_session.refresh(submission)
        assert submission.attachments == [first]


@pytest.mark.integration
class TestWritersStampIds:
    async def test_every_writer_stamps_an_id_and_the_approval_keeps_it(
        self, db_session, root
    ):
        org, member = await _member(db_session)
        submission = await _pending(db_session, org, member, [])

        await training_submissions.upload_submission_attachment(
            str(submission.id),
            file=UploadFile(io.BytesIO(b"%PDF-1.4 a"), filename="a.pdf"),
            db=db_session,
            current_user=member,
        )
        await db_session.refresh(submission)
        uploaded = submission.attachments[0]
        assert len(uploaded["id"]) == UUID_SHAPE

        created = await training_submissions.create_submission_with_attachment(
            payload=(
                '{"course_name": "EMT", "training_type": "continuing_education",'
                ' "completion_date": "2026-01-05", "hours_completed": 1.0}'
            ),
            file=UploadFile(io.BytesIO(b"%PDF-1.4 b"), filename="b.pdf"),
            db=db_session,
            current_user=member,
        )
        assert len(created.attachments[0]["id"]) == UUID_SHAPE

        officer = User(
            organization_id=org.id,
            username=f"officer-{uuid.uuid4().hex[:8]}",
            email=f"officer-{uuid.uuid4().hex[:8]}@example.org",
            first_name="Officer",
            last_name="Reviewer",
            password_hash="x",
        )
        db_session.add(officer)
        await db_session.flush()
        await TrainingSubmissionService(db_session).review_submission(
            submission_id=str(submission.id),
            reviewer_id=str(officer.id),
            organization_id=org.id,
            action="approve",
        )
        record = await db_session.get(TrainingRecord, submission.training_record_id)
        assert record.attachments[0]["id"] == uploaded["id"]
        assert record.attachments is not submission.attachments

        await training_enhancements.upload_record_attachment(
            str(record.id),
            file=UploadFile(io.BytesIO(b"%PDF-1.4 c"), filename="c.pdf"),
            db=db_session,
            current_user=member,
        )
        await db_session.refresh(record)
        assert len(record.attachments[1]["id"]) == UUID_SHAPE
        assert record.status == TrainingStatus.COMPLETED


@pytest.mark.integration
class TestDownloadByEntry:
    async def test_both_download_routes_take_an_id_or_an_index(
        self, db_session, root, monkeypatch
    ):
        async def served(ref, **kwargs):
            return SimpleNamespace(path=ref)

        monkeypatch.setattr(file_storage_service, "file_response", served)
        org, member = await _member(db_session)
        first = _entry(root, org.id, "first")
        second = _entry(root, org.id, "second")
        submission = await _pending(db_session, org, member, [first, second])
        record = TrainingRecord(
            organization_id=org.id,
            user_id=member.id,
            course_name="CPR",
            training_type="certification",
            completion_date=date(2026, 1, 5),
            hours_completed=2.0,
            status=TrainingStatus.COMPLETED,
            attachments=[first, second],
        )
        db_session.add(record)
        await db_session.flush()

        by_id = await training_submissions.download_submission_attachment(
            str(submission.id), second["id"], db=db_session, current_user=member
        )
        by_index = await training_submissions.download_submission_attachment(
            str(submission.id), "1", db=db_session, current_user=member
        )
        record_by_id = await training_enhancements.download_record_attachment(
            str(record.id), second["id"], db=db_session, current_user=member
        )
        for response in (by_id, by_index, record_by_id):
            assert response.path == second["file_path"]

        with pytest.raises(HTTPException) as exc:
            await training_submissions.download_submission_attachment(
                str(submission.id),
                str(uuid.uuid4()),
                db=db_session,
                current_user=member,
            )
        assert exc.value.status_code == 404
