"""
Tests for TrainingProgramService.update_program_requirement.

The officer can toggle whether a linked requirement is *required* to complete
its phase (plus is_prerequisite / sort_order). Toggling ``is_required`` changes
which items count toward completion, so every ACTIVE/ON_HOLD enrollment in the
program is recomputed and re-checked for phase advancement. Non-required-field
edits skip that recompute. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.schemas.training_program import ProgramRequirementUpdate
from app.services.training_program_service import TrainingProgramService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()


def _program_requirement(is_required=True):
    return SimpleNamespace(
        id=str(uuid4()),
        program_id=str(uuid4()),
        is_required=is_required,
        is_prerequisite=False,
        sort_order=0,
    )


class TestUpdateProgramRequirement:
    async def test_missing_requirement_returns_error(self):
        db = RecordingSession([_one(None)])
        svc = TrainingProgramService(db)
        result, error = await svc.update_program_requirement(
            uuid4(), uuid4(), ProgramRequirementUpdate(is_required=False)
        )
        assert result is None
        assert error == "Program requirement not found"
        db.commit.assert_not_awaited()

    async def test_toggling_required_recomputes_enrollments(self):
        pr = _program_requirement(is_required=True)
        enrollment_rows = MagicMock()
        enrollment_rows.all.return_value = [(str(uuid4()),), (str(uuid4()),)]
        db = RecordingSession([_one(pr), enrollment_rows])
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()
        svc._maybe_auto_advance_phase = AsyncMock()
        svc._load_program_requirement = AsyncMock(return_value=pr)

        result, error = await svc.update_program_requirement(
            uuid4(), uuid4(), ProgramRequirementUpdate(is_required=False)
        )

        assert error is None
        assert result is pr
        assert pr.is_required is False
        db.commit.assert_awaited_once()
        # Both ACTIVE/ON_HOLD enrollments recomputed and re-checked.
        assert svc._recalculate_enrollment_progress.await_count == 2
        assert svc._maybe_auto_advance_phase.await_count == 2

    async def test_no_required_change_skips_recompute(self):
        # Only sort_order changes -> completion math is unaffected.
        pr = _program_requirement(is_required=True)
        db = RecordingSession([_one(pr)])
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()
        svc._maybe_auto_advance_phase = AsyncMock()
        svc._load_program_requirement = AsyncMock(return_value=pr)

        result, error = await svc.update_program_requirement(
            uuid4(), uuid4(), ProgramRequirementUpdate(sort_order=5)
        )

        assert error is None
        assert pr.sort_order == 5
        db.commit.assert_awaited_once()
        svc._recalculate_enrollment_progress.assert_not_awaited()
        svc._maybe_auto_advance_phase.assert_not_awaited()

    async def test_setting_required_to_same_value_skips_recompute(self):
        pr = _program_requirement(is_required=True)
        db = RecordingSession([_one(pr)])
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()
        svc._maybe_auto_advance_phase = AsyncMock()
        svc._load_program_requirement = AsyncMock(return_value=pr)

        _, error = await svc.update_program_requirement(
            uuid4(), uuid4(), ProgramRequirementUpdate(is_required=True)
        )

        assert error is None
        svc._recalculate_enrollment_progress.assert_not_awaited()
