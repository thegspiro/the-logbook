"""
Fixability (Batch 4): an officer can undo mistakes without leaving inflated
progress behind.

  * reverse_credits_for_source un-applies every pipeline credit a record or
    submission produced (it can fan out to several requirements).
  * reverse_approval voids the spawned record, un-applies its credit, and sends
    the submission back to pending review.
DB + credit primitives mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import ProgressCreditSource, SubmissionStatus, TrainingStatus
from app.services.training_program_service import TrainingProgramService
from app.services.training_submission_service import TrainingSubmissionService


@pytest.fixture(autouse=True)
def _no_review_prompts(monkeypatch):
    """The session fakes here model only what these tests exercise. The in-app
    notifications are covered in test_training_submission_notifications.py
    against a real database."""
    monkeypatch.setattr(TrainingSubmissionService, "_notify_reviewers", AsyncMock())
    monkeypatch.setattr(TrainingSubmissionService, "_notify_member", AsyncMock())


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _rows(items):
    return MagicMock(all=MagicMock(return_value=items))


class RecordingSession:
    def __init__(self, results=None):
        self._results = list(results or [])
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


class TestReverseCreditsForSource:
    async def test_revokes_every_credit_for_the_source(self):
        # One record fanned out to two requirements → two ledger rows.
        db = RecordingSession(
            [
                _rows(
                    [
                        ("rp-1", ProgressCreditSource.OFFICER_APPLY),
                        ("rp-2", ProgressCreditSource.OFFICER_APPLY),
                    ]
                )
            ]
        )
        svc = TrainingProgramService(db)
        svc.revoke_requirement_credit = AsyncMock(return_value=(MagicMock(), None))

        count = await svc.reverse_credits_for_source(
            organization_id=uuid4(),
            source_id="rec-1",
        )

        assert count == 2
        assert svc.revoke_requirement_credit.await_count == 2
        revoked_progress = {
            c.kwargs["progress_id"]
            for c in svc.revoke_requirement_credit.await_args_list
        }
        assert revoked_progress == {"rp-1", "rp-2"}

    async def test_no_credits_is_zero(self):
        db = RecordingSession([_rows([])])
        svc = TrainingProgramService(db)
        svc.revoke_requirement_credit = AsyncMock()

        count = await svc.reverse_credits_for_source(
            organization_id=uuid4(), source_id="rec-1"
        )

        assert count == 0
        svc.revoke_requirement_credit.assert_not_awaited()

    async def test_one_member_s_credit_in_any_program(self):
        """A session credits a whole roster; removing one attendee takes back
        only theirs — found by the source, in whichever program it landed."""
        statements = []

        class Capturing(RecordingSession):
            async def execute(self, statement, *args, **kwargs):
                statements.append(statement)
                return _rows([])

        svc = TrainingProgramService(Capturing())

        await svc.reverse_credits_for_source(
            organization_id="org-1", source_id="session-1", user_id="user-1"
        )

        compiled = str(statements[0].compile(compile_kwargs={"literal_binds": True}))
        assert "program_enrollments.user_id = 'user-1'" in compiled
        assert "requirement_progress_credits.source_id = 'session-1'" in compiled
        assert "training_programs.organization_id = 'org-1'" in compiled
        # Not narrowed to a program: a session re-linked during a reopen still
        # has its old credit in the old program.
        assert "training_programs.id =" not in compiled


class TestReverseApproval:
    async def test_rejects_non_approved_submission(self, monkeypatch):
        svc = TrainingSubmissionService(RecordingSession())
        submission = SimpleNamespace(
            status=SubmissionStatus.PENDING_REVIEW,
            training_record_id=None,
        )
        svc.get_submission = AsyncMock(return_value=submission)

        with pytest.raises(ValueError, match="approved submission"):
            await svc.reverse_approval(
                submission_id="s-1",
                reviewer_id=str(uuid4()),
                organization_id=str(uuid4()),
            )

    async def test_voids_record_reverses_credit_and_reopens(self, monkeypatch):
        record = SimpleNamespace(
            id="rec-1", status=TrainingStatus.COMPLETED, notes="orig"
        )
        submission = SimpleNamespace(
            id="s-1",
            status=SubmissionStatus.APPROVED,
            training_record_id="rec-1",
            reviewed_by="off-1",
            reviewed_at=object(),
            reviewer_notes=None,
        )
        db = RecordingSession([_one(record)])
        svc = TrainingSubmissionService(db)
        svc.get_submission = AsyncMock(return_value=submission)

        reverse_mock = AsyncMock(return_value=1)
        monkeypatch.setattr(
            TrainingProgramService, "reverse_credits_for_source", reverse_mock
        )

        result = await svc.reverse_approval(
            submission_id="s-1",
            reviewer_id=str(uuid4()),
            organization_id=str(uuid4()),
            reason="wrong member",
        )

        # Spawned record voided (kept for audit).
        assert record.status == TrainingStatus.CANCELLED
        assert "VOIDED" in record.notes
        # Credit reversed for BOTH the submission and the record source keys.
        assert reverse_mock.await_count == 2
        reversed_sources = {c.kwargs["source_id"] for c in reverse_mock.await_args_list}
        assert reversed_sources == {"s-1", "rec-1"}
        # Submission returns to pending review, unlinked from the voided record.
        assert result.status == SubmissionStatus.PENDING_REVIEW
        assert result.training_record_id is None
        assert result.reviewed_by is None

    async def test_reversal_without_record_only_reopens(self, monkeypatch):
        submission = SimpleNamespace(
            id="s-1",
            status=SubmissionStatus.APPROVED,
            training_record_id=None,
            reviewed_by="off-1",
            reviewed_at=object(),
            reviewer_notes=None,
        )
        svc = TrainingSubmissionService(RecordingSession())
        svc.get_submission = AsyncMock(return_value=submission)

        reverse_mock = AsyncMock(return_value=0)
        monkeypatch.setattr(
            TrainingProgramService, "reverse_credits_for_source", reverse_mock
        )

        result = await svc.reverse_approval(
            submission_id="s-1",
            reviewer_id=str(uuid4()),
            organization_id=str(uuid4()),
        )

        # Only the submission-keyed credit reversal runs; no record to void.
        reverse_mock.assert_awaited_once()
        assert reverse_mock.await_args.kwargs["source_id"] == "s-1"
        assert result.status == SubmissionStatus.PENDING_REVIEW
