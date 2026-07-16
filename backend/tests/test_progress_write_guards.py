"""
Guards on requirement-progress writes:
  * a member may NOT self-complete/verify, self-score, or self-set numeric
    progress on their own requirement (officer-only) — update_requirement_progress
  * an enrollment that is not ACTIVE is never auto-flipped to COMPLETED (no
    resurrecting a withdrawn/failed member) — _recalculate_enrollment_progress
DB mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from sqlalchemy.sql.dml import Update

from app.models.training import EnrollmentStatus, RequirementProgressStatus
from app.schemas.training_program import RequirementProgressUpdate
from app.services.training_program_service import TrainingProgramService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()


def _progress(user_id="u1"):
    return SimpleNamespace(
        id=str(uuid4()),
        enrollment_id="enr-1",
        enrollment=SimpleNamespace(user_id=user_id),
        requirement=SimpleNamespace(passing_score=70, max_attempts=None),
        status=RequirementProgressStatus.NOT_STARTED,
        progress_value=0.0,
        progress_percentage=0.0,
        progress_notes=None,
        started_at=None,
        completed_at=None,
        verified_at=None,
        verified_by=None,
        updated_at=None,
    )


class TestMemberSelfWriteGuard:
    async def _svc(self, progress):
        svc = TrainingProgramService(RecordingSession([_one(progress)]))
        svc._recalculate_enrollment_progress = AsyncMock()
        svc._maybe_auto_advance_phase = AsyncMock()
        return svc

    async def test_member_cannot_self_complete(self):
        svc = await self._svc(_progress("u1"))
        result, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(status="completed"),
            acting_user_id="u1",
            can_manage=False,
        )
        assert result is None and "officer" in error

    async def test_member_cannot_self_verify_or_waive(self):
        for status in ("verified", "waived"):
            svc = await self._svc(_progress("u1"))
            result, error = await svc.update_requirement_progress(
                progress_id=uuid4(),
                organization_id=uuid4(),
                updates=RequirementProgressUpdate(status=status),
                acting_user_id="u1",
                can_manage=False,
            )
            assert result is None and "officer" in error

    async def test_member_cannot_self_score(self):
        svc = await self._svc(_progress("u1"))
        result, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(test_score=100),
            acting_user_id="u1",
            can_manage=False,
        )
        assert result is None and "officer" in error

    async def test_member_cannot_self_set_progress_value(self):
        svc = await self._svc(_progress("u1"))
        result, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(progress_value=40),
            acting_user_id="u1",
            can_manage=False,
        )
        assert result is None and "officer" in error

    async def test_member_may_still_mark_in_progress(self):
        # A benign, non-completing status change is still allowed for members.
        progress = _progress("u1")
        svc = await self._svc(progress)
        result, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(status="in_progress"),
            acting_user_id="u1",
            can_manage=False,
        )
        assert error is None and result is progress
        assert progress.status == RequirementProgressStatus.IN_PROGRESS

    async def test_officer_may_complete(self):
        progress = _progress("someone-else")
        svc = await self._svc(progress)
        result, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(status="completed"),
            acting_user_id="officer-1",
            can_manage=True,
        )
        assert error is None and result is progress
        assert progress.status == RequirementProgressStatus.COMPLETED
        assert progress.progress_percentage == 100.0


def _update_count(db):
    return sum(1 for s in db.statements if isinstance(s, Update))


class TestRecalcNeverResurrects:
    async def _recalc(self, status, avg_percentage):
        enrollment = SimpleNamespace(
            id="enr-1", program_id="prog-1", user_id="u1", status=status
        )
        rows = [SimpleNamespace(progress_percentage=avg_percentage)]
        program = SimpleNamespace(id="prog-1", organization_id=str(uuid4()))
        user = SimpleNamespace(id="u1")
        db = RecordingSession(
            [
                _one(enrollment),  # load enrollment
                _scalars(rows),  # load required progress rows
                MagicMock(),  # UPDATE progress_percentage
                MagicMock(),  # possible UPDATE status
                _one(program),  # notification: load program (if completed)
                _one(user),  # notification: load user
            ]
        )
        svc = TrainingProgramService(db)
        svc._notify_program_completion = AsyncMock()
        svc._handle_evoc_completion = AsyncMock()
        await svc._recalculate_enrollment_progress(uuid4())
        return db, svc

    async def test_withdrawn_at_100_is_not_completed(self):
        db, svc = await self._recalc(EnrollmentStatus.WITHDRAWN, 100.0)
        # Only the progress_percentage update runs; no status→COMPLETED update.
        assert _update_count(db) == 1
        svc._notify_program_completion.assert_not_awaited()

    async def test_failed_at_100_is_not_completed(self):
        db, svc = await self._recalc(EnrollmentStatus.FAILED, 100.0)
        assert _update_count(db) == 1
        svc._notify_program_completion.assert_not_awaited()

    async def test_active_at_100_completes_and_notifies(self):
        db, svc = await self._recalc(EnrollmentStatus.ACTIVE, 100.0)
        # progress_percentage update + status→COMPLETED update.
        assert _update_count(db) == 2
        svc._notify_program_completion.assert_awaited_once()

    async def test_completed_below_100_reopens(self):
        db, svc = await self._recalc(EnrollmentStatus.COMPLETED, 40.0)
        # progress_percentage update + status→ACTIVE reopen update.
        assert _update_count(db) == 2
        svc._notify_program_completion.assert_not_awaited()
