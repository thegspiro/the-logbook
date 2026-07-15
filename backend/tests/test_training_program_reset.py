"""
Tests for recert-cycle reset:
  * reset_requirement_progress zeroes one progress row
  * reset_enrollment_progress zeroes all rows and re-anchors the enrollment
DB mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import EnrollmentStatus, RequirementProgressStatus
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
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _progress(**over):
    base = dict(
        id=str(uuid4()),
        enrollment_id=str(uuid4()),
        status=RequirementProgressStatus.COMPLETED,
        progress_value=24.0,
        progress_percentage=100.0,
        progress_notes={"latest_score": 88},
        started_at="x",
        completed_at="x",
        verified_at="x",
        verified_by="officer",
        verification_notes="ok",
    )
    base.update(over)
    return SimpleNamespace(**base)


class TestResetRequirement:
    async def test_missing_returns_error(self):
        svc = TrainingProgramService(RecordingSession([_one(None)]))
        prog, error = await svc.reset_requirement_progress(uuid4(), uuid4())
        assert prog is None and error == "Requirement progress not found"

    async def test_blanks_the_row_and_recalculates(self):
        row = _progress()
        db = RecordingSession([_one(row)])
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()

        prog, error = await svc.reset_requirement_progress(uuid4(), uuid4())

        assert error is None and prog is row
        assert row.status == RequirementProgressStatus.NOT_STARTED
        assert row.progress_value == 0.0
        assert row.progress_percentage == 0.0
        assert row.progress_notes is None
        assert row.completed_at is None and row.verified_by is None
        db.commit.assert_awaited_once()
        svc._recalculate_enrollment_progress.assert_awaited_once()


class TestResetEnrollment:
    async def test_missing_returns_error(self):
        svc = TrainingProgramService(RecordingSession([_one(None)]))
        enr, error = await svc.reset_enrollment_progress(uuid4(), uuid4())
        assert enr is None and error == "Enrollment not found"

    async def test_blanks_all_rows_and_reanchors(self):
        enrollment = SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            status=EnrollmentStatus.COMPLETED,
            progress_percentage=100.0,
            completed_at="x",
            current_phase_id="last",
        )
        r1, r2 = _progress(), _progress()
        first_phase = str(uuid4())
        db = RecordingSession(
            [_one(enrollment), _scalars([r1, r2]), _one(first_phase)]
        )
        svc = TrainingProgramService(db)

        enr, error = await svc.reset_enrollment_progress(uuid4(), uuid4())

        assert error is None and enr is enrollment
        # Both rows blanked.
        for r in (r1, r2):
            assert r.status == RequirementProgressStatus.NOT_STARTED
            assert r.progress_value == 0.0 and r.progress_notes is None
        # Enrollment restarted at the first phase.
        assert enrollment.status == EnrollmentStatus.ACTIVE
        assert enrollment.progress_percentage == 0.0
        assert enrollment.completed_at is None
        assert enrollment.current_phase_id == first_phase
        db.commit.assert_awaited_once()
