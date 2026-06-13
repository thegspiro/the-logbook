"""
Tests for training enrollment progress rollup
(app/services/training_program_service.py :: _recalculate_enrollment_progress).

The overall enrollment percentage is the average of its *required* items'
progress, and the enrollment auto-completes (with a notification) once that
average reaches 100%. Uses a recording fake session so the issued UPDATE
statements can be counted. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import EnrollmentStatus
from app.services.training_program_service import (
    RequirementProgressUpdate,
    TrainingProgramService,
)


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class RecordingSession:
    """Minimal async session that returns queued results and records the
    SQL statement objects passed to execute (so UPDATEs can be counted)."""

    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()

    def update_count(self):
        return sum(1 for s in self.statements if type(s).__name__ == "Update")


def _enrollment(status=EnrollmentStatus.ACTIVE):
    return SimpleNamespace(id="enr-1", program_id="prog-1", status=status, user_id="u1")


def _prog(pct):
    return SimpleNamespace(progress_percentage=pct)


class TestRecalculateEnrollmentProgress:
    async def test_missing_enrollment_is_noop(self):
        db = RecordingSession([_one(None)])
        await TrainingProgramService(db)._recalculate_enrollment_progress("enr-1")
        assert db.update_count() == 0
        db.commit.assert_not_awaited()

    async def test_no_required_progress_is_noop(self):
        db = RecordingSession([_one(_enrollment()), _scalars([])])
        await TrainingProgramService(db)._recalculate_enrollment_progress("enr-1")
        assert db.update_count() == 0

    async def test_partial_progress_updates_without_completing(self):
        # Average of 40 and 60 = 50 -> one UPDATE (percentage), no completion.
        db = RecordingSession(
            [_one(_enrollment()), _scalars([_prog(40.0), _prog(60.0)])]
        )
        await TrainingProgramService(db)._recalculate_enrollment_progress("enr-1")
        assert db.update_count() == 1
        db.commit.assert_awaited()

    async def test_completion_marks_and_notifies_when_newly_complete(self, monkeypatch):
        # Average 100 from a not-yet-completed enrollment -> two UPDATEs
        # (percentage + status) and a completion notification.
        program = SimpleNamespace(id="prog-1", name="FF1", organization_id=str(uuid4()))
        svc = TrainingProgramService(
            RecordingSession(
                [
                    _one(_enrollment(status=EnrollmentStatus.ACTIVE)),
                    _scalars([_prog(100.0), _prog(100.0)]),
                    MagicMock(),  # update percentage
                    MagicMock(),  # update status=completed
                    _one(program),  # program fetch
                    _one(SimpleNamespace(id="u1")),  # user fetch
                ]
            )
        )
        notify = AsyncMock()
        monkeypatch.setattr(svc, "_notify_program_completion", notify)
        monkeypatch.setattr(svc, "_handle_evoc_completion", AsyncMock())
        await svc._recalculate_enrollment_progress("enr-1")
        assert svc.db.update_count() == 2
        notify.assert_awaited_once()

    async def test_already_completed_does_not_renotify(self, monkeypatch):
        # Average 100 but enrollment was already COMPLETED -> no notification.
        svc = TrainingProgramService(
            RecordingSession(
                [
                    _one(_enrollment(status=EnrollmentStatus.COMPLETED)),
                    _scalars([_prog(100.0)]),
                    MagicMock(),
                    MagicMock(),
                ]
            )
        )
        notify = AsyncMock()
        monkeypatch.setattr(svc, "_notify_program_completion", notify)
        await svc._recalculate_enrollment_progress("enr-1")
        notify.assert_not_awaited()


class TestUpdateRequirementProgressAuth:
    """A member may only update their own progress; officers (can_manage) or
    system callers (no acting_user_id) may update anyone's."""

    def _progress(self, owner="owner"):
        return SimpleNamespace(
            id="p1",
            enrollment_id="enr-1",
            enrollment=SimpleNamespace(user_id=owner),
            updated_at=None,
        )

    def _db_with(self, progress):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=progress))
        )
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        return db

    async def test_member_cannot_update_others_progress(self):
        svc = TrainingProgramService(self._db_with(self._progress(owner="owner")))
        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(),
            acting_user_id="attacker",
            can_manage=False,
        )
        assert out is None
        assert "not authorized" in err

    async def test_member_can_update_own_progress(self, monkeypatch):
        svc = TrainingProgramService(self._db_with(self._progress(owner="me")))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(),
            acting_user_id="me",
            can_manage=False,
        )
        assert err is None
        assert out is not None

    async def test_manager_can_update_any_progress(self, monkeypatch):
        svc = TrainingProgramService(self._db_with(self._progress(owner="owner")))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
        _, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(),
            acting_user_id="officer",
            can_manage=True,
        )
        assert err is None

    async def test_system_call_without_acting_user_allowed(self, monkeypatch):
        svc = TrainingProgramService(self._db_with(self._progress(owner="owner")))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
        _, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(),
        )
        assert err is None


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
