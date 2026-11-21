"""A self-report's attachments, its approval and its removal paths, at once.

Real connections, each in its own transaction: a race needs two transactions
that really commit, which a rolled-back ``db_session`` cannot give. Every row
created is removed at the end.

What the locks have to prevent (CLAUDE.md pitfall #27, D11 residuals):

* a member removing a certificate while an officer approves the submission,
  where the approval copies the pre-removal list onto the training record
  and the member's reference check has already deleted the file;
* an upload that finishes after an approval, appending evidence to a
  submission that is already decided;
* a member deleting a submission an approval has just decided;
* an approval whose record insert fails after its status change committed,
  leaving an approved submission that credits nothing.

The hold is a wrapper around ``TrainingSubmissionService.get_submission``,
patched once on the class outside the concurrent section (pitfall #22): the
first caller after it is armed keeps its transaction open for a moment, and
the event says when it got there.
"""

import asyncio
import io
import os
import uuid
from datetime import date
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training_submissions
from app.core.database import database_manager
from app.models.training import (
    SubmissionStatus,
    TrainingRecord,
    TrainingSubmission,
)
from app.models.user import Organization, User
from app.services import file_storage_service
from app.services.training_submission_service import TrainingSubmissionService
from tests.audit_cleanup import discard_committed_audit_rows

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("_initialize_database")]

_HOLD_SECONDS = 0.6


def _session():
    return database_manager.session_factory()


@pytest.fixture
def upload_root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    monkeypatch.setattr(
        file_storage_service, "detect_mime_type", lambda content: "application/pdf"
    )
    # The in-app prompts are covered elsewhere; here they would only add
    # writes on other tables to clean up.
    monkeypatch.setattr(TrainingSubmissionService, "_notify_reviewers", AsyncMock())
    monkeypatch.setattr(TrainingSubmissionService, "_notify_member", AsyncMock())
    return tmp_path


def _stored_file(root, org_id: str, submission_id: str, label: str) -> dict:
    directory = os.path.join(str(root), org_id, "self-reports", submission_id)
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{uuid.uuid4().hex}.pdf")
    with open(path, "wb") as handle:
        handle.write(b"%PDF-1.4 " + label.encode())
    return {
        "file_name": f"{label}.pdf",
        "file_path": path,
        "file_type": "application/pdf",
    }


@pytest.fixture
async def dept(upload_root):
    """A department, a member, an officer, and the member's pending
    submission carrying two stored certificates."""
    org_id = str(uuid.uuid4())
    member_id = str(uuid.uuid4())
    officer_id = str(uuid.uuid4())
    submission_id = str(uuid.uuid4())
    async with _session() as db:
        db.add(Organization(id=org_id, name="Race FD", slug=f"race-{org_id[:8]}"))
        await db.flush()
        for user_id, name in ((member_id, "Member"), (officer_id, "Officer")):
            db.add(
                User(
                    id=user_id,
                    organization_id=org_id,
                    username=f"race-{user_id[:8]}",
                    email=f"race-{user_id[:8]}@example.org",
                    first_name=name,
                    last_name="Racer",
                    password_hash="x",
                )
            )
        await db.flush()
        first = _stored_file(upload_root, org_id, submission_id, "first")
        second = _stored_file(upload_root, org_id, submission_id, "second")
        db.add(
            TrainingSubmission(
                id=submission_id,
                organization_id=org_id,
                submitted_by=member_id,
                course_name="CPR",
                training_type="certification",
                completion_date=date(2026, 1, 5),
                hours_completed=4.0,
                status=SubmissionStatus.PENDING_REVIEW,
                attachments=[first, second],
            )
        )
        await db.commit()
    yield {
        "org": org_id,
        "member": member_id,
        "officer": officer_id,
        "submission": submission_id,
        "first": first,
        "second": second,
    }
    await discard_committed_audit_rows("organization_id = :o", {"o": org_id})
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for statement in (
                "DELETE FROM notification_logs WHERE organization_id = :o",
                "DELETE FROM training_submissions WHERE organization_id = :o",
                "DELETE FROM training_records WHERE organization_id = :o",
                "DELETE FROM self_report_configs WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": org_id})


@pytest.fixture
def hold(monkeypatch):
    """Arm a hold: the first get_submission afterwards keeps its transaction
    open; the event says when it got there."""

    def arm() -> asyncio.Event:
        reached = asyncio.Event()
        original = TrainingSubmissionService.get_submission

        async def held(self, *args, **kwargs):
            result = await original(self, *args, **kwargs)
            if not reached.is_set():
                reached.set()
                await asyncio.sleep(_HOLD_SECONDS)
            return result

        monkeypatch.setattr(TrainingSubmissionService, "get_submission", held)
        return reached

    return arm


async def _load_user(db, user_id: str) -> User:
    return (
        await db.execute(
            select(User).where(User.id == user_id).options(selectinload(User.positions))
        )
    ).scalar_one()


async def _approve(dept, after=None) -> str:
    if after is not None:
        await after.wait()
    async with _session() as db:
        try:
            await TrainingSubmissionService(db).review_submission(
                submission_id=dept["submission"],
                reviewer_id=dept["officer"],
                organization_id=dept["org"],
                action="approve",
            )
            return "approved"
        except ValueError as e:
            await db.rollback()
            return f"refused: {e}"


async def _remove_first(dept, after=None) -> str:
    if after is not None:
        await after.wait()
    async with _session() as db:
        member = await _load_user(db, dept["member"])
        try:
            await training_submissions.delete_submission_attachment(
                submission_id=dept["submission"],
                entry="0",
                expected_id=None,
                db=db,
                current_user=member,
            )
            return "removed"
        except HTTPException as e:
            await db.rollback()
            return f"refused: {e.status_code}"


async def _records(org_id: str) -> list[TrainingRecord]:
    async with _session() as db:
        return list(
            (
                await db.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == org_id
                    )
                )
            )
            .scalars()
            .all()
        )


async def _submission(submission_id: str) -> TrainingSubmission | None:
    async with _session() as db:
        return await db.get(TrainingSubmission, submission_id)


async def test_a_removal_during_an_approval_keeps_the_records_file(dept, hold):
    """The approval reads first and holds. Unlocked, the member's removal
    commits and deletes the file, and the approval then copies the stale list
    onto the record, which names a file that is gone."""
    reached = hold()
    approval, removal = await asyncio.gather(
        _approve(dept), _remove_first(dept, after=reached)
    )

    assert approval == "approved"
    assert removal == "refused: 400"
    records = await _records(dept["org"])
    assert len(records) == 1
    for entry in records[0].attachments:
        assert os.path.exists(entry["file_path"]), entry["file_name"]
    assert os.path.exists(dept["first"]["file_path"])


async def test_an_approval_during_a_removal_does_not_copy_the_removed_entry(dept, hold):
    """The member's removal reads first and holds. Unlocked, the approval
    copies the list from before the removal onto the record, and the member
    then rewrites an approved submission's attachments."""
    reached = hold()
    removal, approval = await asyncio.gather(
        _remove_first(dept), _approve(dept, after=reached)
    )

    assert removal == "removed"
    assert approval == "approved"
    records = await _records(dept["org"])
    assert len(records) == 1
    assert [e["file_name"] for e in records[0].attachments] == ["second.pdf"]
    submission = await _submission(dept["submission"])
    assert [e["file_name"] for e in submission.attachments] == ["second.pdf"]
    assert not os.path.exists(dept["first"]["file_path"])


async def test_deleting_a_submission_during_its_approval_is_refused(dept, hold):
    """Unlocked, the member's delete reads PENDING_REVIEW from a snapshot taken
    before the approval committed and removes a submission an officer has
    just approved."""

    async def delete_submission(after) -> str:
        await after.wait()
        async with _session() as db:
            member = await _load_user(db, dept["member"])
            try:
                await training_submissions.delete_submission(
                    submission_id=dept["submission"], db=db, current_user=member
                )
                return "deleted"
            except HTTPException as e:
                await db.rollback()
                return f"refused: {e.status_code}"

    reached = hold()
    approval, deletion = await asyncio.gather(
        _approve(dept), delete_submission(after=reached)
    )

    assert approval == "approved"
    assert deletion == "refused: 400"
    submission = await _submission(dept["submission"])
    assert submission is not None
    assert submission.status == SubmissionStatus.APPROVED
    assert os.path.exists(dept["first"]["file_path"])


async def test_an_upload_finishing_after_an_approval_is_refused(dept, monkeypatch):
    """The upload passes its status check, then spends its time storing and
    scanning the file. An approval lands meanwhile. Unlocked, the upload then
    appends to the approved submission."""
    stored_paths: list[str] = []
    reached = asyncio.Event()
    release = asyncio.Event()
    original = training_submissions._store_attachment_file

    async def slow_store(*args, **kwargs):
        stored = await original(*args, **kwargs)
        stored_paths.append(stored["file_path"])
        reached.set()
        await release.wait()
        return stored

    monkeypatch.setattr(training_submissions, "_store_attachment_file", slow_store)

    async def upload() -> str:
        async with _session() as db:
            member = await _load_user(db, dept["member"])
            try:
                await training_submissions.upload_submission_attachment(
                    submission_id=dept["submission"],
                    file=UploadFile(io.BytesIO(b"%PDF-1.4 late"), filename="late.pdf"),
                    db=db,
                    current_user=member,
                )
                return "uploaded"
            except HTTPException as e:
                await db.rollback()
                return f"refused: {e.status_code}"

    async def approve_then_release() -> str:
        result = await _approve(dept, after=reached)
        release.set()
        return result

    uploaded, approval = await asyncio.gather(upload(), approve_then_release())

    assert approval == "approved"
    assert uploaded == "refused: 400"
    submission = await _submission(dept["submission"])
    assert [e["file_name"] for e in submission.attachments] == [
        "first.pdf",
        "second.pdf",
    ]
    assert stored_paths and not os.path.exists(stored_paths[0])


async def test_a_failed_record_insert_leaves_the_submission_undecided(
    dept, monkeypatch
):
    """The approval's status change and the record it creates are one
    transaction. Committed separately, a failure creating the record left an
    approved submission that credits nothing and that no retry can reach,
    because it is no longer pending."""

    async def failing_record(self, submission):
        raise RuntimeError("record insert failed")

    monkeypatch.setattr(
        TrainingSubmissionService, "_create_record_from_submission", failing_record
    )

    async with _session() as db:
        with pytest.raises(RuntimeError):
            await TrainingSubmissionService(db).review_submission(
                submission_id=dept["submission"],
                reviewer_id=dept["officer"],
                organization_id=dept["org"],
                action="approve",
            )
        await db.rollback()

    submission = await _submission(dept["submission"])
    assert submission.status == SubmissionStatus.PENDING_REVIEW
    assert submission.reviewed_at is None
