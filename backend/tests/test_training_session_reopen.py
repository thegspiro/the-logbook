"""Reopening a finalized training session.

Finalizing a session was one-way: ``is_finalized`` refused a second finalize
and nothing ever cleared it, so a member left off the roster could never be
added and a wrong duration could never be fixed. That is the mirror image of
the event side's failure, which locked nothing at all — same feature, two
opposite bugs.

These tests cover the way back, and the one thing reopening must not leave
behind: an approval token already emailed to the training officers against
attendee data that is about to change.

DB is mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.models.training import ApprovalStatus
from app.services.training_session_service import TrainingSessionService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _all(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _session(finalized=True):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="session-1",
        organization_id="org-1",
        is_finalized=finalized,
        finalized_at=now - timedelta(hours=1) if finalized else None,
        finalized_by="chief-1" if finalized else None,
        updated_at=now - timedelta(hours=1),
    )


def _approval(status=ApprovalStatus.PENDING):
    return SimpleNamespace(
        id="approval-1",
        status=status,
        token_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )


def _db(*results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


class TestReopenTrainingSession:
    async def test_reopen_clears_the_finalized_state(self):
        session = _session()
        db = _db(_one(session), _all([]))

        result, err = await TrainingSessionService(db).reopen_training_session(
            "session-1", "org-1"
        )

        assert err is None
        assert result is session
        assert session.is_finalized is False
        assert session.finalized_at is None
        assert session.finalized_by is None
        db.commit.assert_awaited_once()

    async def test_pending_approval_token_is_expired(self):
        """It was emailed against attendee data the reopen is about to change,
        and re-finalizing issues a fresh one."""
        approval = _approval()
        before = approval.token_expires_at
        db = _db(_one(_session()), _all([approval]))

        await TrainingSessionService(db).reopen_training_session("session-1", "org-1")

        assert approval.token_expires_at < before
        assert approval.token_expires_at <= datetime.now(timezone.utc)
        # Not marked rejected: no officer rejected anything.
        assert approval.status == ApprovalStatus.PENDING

    async def test_only_pending_approvals_are_queried(self):
        """An approved one keeps its record — re-finalizing updates the
        training records in place rather than duplicating them."""
        db = _db(_one(_session()), _all([]))

        await TrainingSessionService(db).reopen_training_session("session-1", "org-1")

        approval_stmt = db.execute.await_args_list[1].args[0]
        compiled = str(
            approval_stmt.compile(compile_kwargs={"literal_binds": True})
        ).lower()
        assert "status" in compiled
        assert "pending" in compiled

    async def test_reopening_an_open_session_is_refused(self):
        db = _db(_one(_session(finalized=False)))

        result, err = await TrainingSessionService(db).reopen_training_session(
            "session-1", "org-1"
        )

        assert result is None
        assert err == "Training session is not finalized"
        db.commit.assert_not_awaited()

    async def test_missing_session_reports_not_found(self):
        db = _db(_one(None))

        result, err = await TrainingSessionService(db).reopen_training_session(
            "session-1", "org-1"
        )

        assert result is None
        assert err == "Training session not found"
