"""
Tests for training-pipeline phase advancement in TrainingProgramService:

* _is_phase_complete — a phase is complete when every required requirement is
  at 100% (no required rows → trivially complete)
* advance_enrollment_phase — manual advance: moves to the next phase when the
  current one is complete, errors otherwise (unless forced), errors at the final
  phase and for non-phased programs
* _maybe_auto_advance_phase — auto-advances through consecutive complete phases
  but stops at one flagged requires_manual_advancement

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import EnrollmentStatus, ProgramStructureType
from app.services.training_program_service import TrainingProgramService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class RecordingSession:
    def __init__(self, results=None):
        self._results = list(results or [])
        self.statements = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()

    def add(self, obj):
        pass

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()

    def update_count(self):
        return sum(1 for s in self.statements if type(s).__name__ == "Update")


def _phase(pid, number, name, manual=False):
    return SimpleNamespace(
        id=pid,
        phase_number=number,
        name=name,
        requires_manual_advancement=manual,
    )


def _prog(pct):
    return SimpleNamespace(progress_percentage=pct)


class TestIsPhaseComplete:
    async def test_all_complete(self):
        db = RecordingSession([_scalars([_prog(100.0), _prog(100.0)])])
        assert await TrainingProgramService(db)._is_phase_complete(uuid4(), uuid4())

    async def test_one_incomplete(self):
        db = RecordingSession([_scalars([_prog(100.0), _prog(40.0)])])
        assert not await TrainingProgramService(db)._is_phase_complete(uuid4(), uuid4())

    async def test_no_required_rows_is_complete(self):
        db = RecordingSession([_scalars([])])
        assert await TrainingProgramService(db)._is_phase_complete(uuid4(), uuid4())


class TestNextPhase:
    def test_picks_next_by_number(self):
        p1, p2, p3 = _phase("a", 1, "1"), _phase("b", 2, "2"), _phase("c", 3, "3")
        nxt = TrainingProgramService._next_phase([p3, p1, p2], "a")
        assert nxt.id == "b"

    def test_none_current_returns_first(self):
        p1, p2 = _phase("a", 1, "1"), _phase("b", 2, "2")
        assert TrainingProgramService._next_phase([p2, p1], None).id == "a"

    def test_final_phase_returns_none(self):
        p1, p2 = _phase("a", 1, "1"), _phase("b", 2, "2")
        assert TrainingProgramService._next_phase([p1, p2], "b") is None


class TestAdvanceEnrollmentPhase:
    def _program(self, phases, structure=ProgramStructureType.PHASES):
        return SimpleNamespace(
            id=str(uuid4()),
            organization_id="org-1",
            structure_type=structure,
            phases=phases,
        )

    def _svc(self, enrollment, program):
        svc = TrainingProgramService(RecordingSession())
        svc.get_enrollment_by_id = AsyncMock(return_value=enrollment)
        svc.get_program_by_id = AsyncMock(return_value=program)
        svc._notify_phase_for_enrollment = AsyncMock()
        return svc

    def _phases(self):
        return [
            _phase(str(uuid4()), 1, "Phase 1"),
            _phase(str(uuid4()), 2, "Phase 2"),
        ]

    def _enrollment(self, current_phase_id):
        return SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            current_phase_id=current_phase_id,
            user_id="u1",
        )

    async def test_advances_when_complete(self):
        phases = self._phases()
        enrollment = self._enrollment(phases[0].id)
        svc = self._svc(enrollment, self._program(phases))
        svc._is_phase_complete = AsyncMock(return_value=True)

        result, error = await svc.advance_enrollment_phase(uuid4(), uuid4())

        assert error is None
        assert result.current_phase_id == phases[1].id
        assert svc.db.update_count() == 1

    async def test_blocked_when_incomplete(self):
        phases = self._phases()
        enrollment = self._enrollment(phases[0].id)
        svc = self._svc(enrollment, self._program(phases))
        svc._is_phase_complete = AsyncMock(return_value=False)

        result, error = await svc.advance_enrollment_phase(uuid4(), uuid4())

        assert result is None
        assert "not yet complete" in error
        assert svc.db.update_count() == 0

    async def test_force_skips_completeness(self):
        phases = self._phases()
        enrollment = self._enrollment(phases[0].id)
        svc = self._svc(enrollment, self._program(phases))
        svc._is_phase_complete = AsyncMock(return_value=False)

        result, error = await svc.advance_enrollment_phase(uuid4(), uuid4(), force=True)

        assert error is None
        assert result.current_phase_id == phases[1].id
        svc._is_phase_complete.assert_not_awaited()

    async def test_final_phase_errors(self):
        phases = self._phases()
        enrollment = self._enrollment(phases[1].id)
        svc = self._svc(enrollment, self._program(phases))

        result, error = await svc.advance_enrollment_phase(uuid4(), uuid4())
        assert result is None
        assert "final phase" in error

    async def test_non_phased_program_errors(self):
        enrollment = self._enrollment(None)
        program = self._program([], structure=ProgramStructureType.FLEXIBLE)
        svc = self._svc(enrollment, program)

        result, error = await svc.advance_enrollment_phase(uuid4(), uuid4())
        assert result is None
        assert "not organized into phases" in error


class TestMaybeAutoAdvancePhase:
    def _run_setup(self, enrollment, program):
        db = RecordingSession([_one(enrollment), _one(program)])
        svc = TrainingProgramService(db)
        svc._notify_phase_for_enrollment = AsyncMock()
        return svc, db

    async def test_advances_one_step_and_stops_at_final(self):
        p1, p2 = _phase(str(uuid4()), 1, "Phase 1"), _phase(str(uuid4()), 2, "Phase 2")
        program = SimpleNamespace(
            id=str(uuid4()),
            organization_id="org-1",
            structure_type=ProgramStructureType.PHASES,
            phases=[p1, p2],
        )
        enrollment = SimpleNamespace(
            id=str(uuid4()),
            program_id=program.id,
            current_phase_id=p1.id,
            user_id="u1",
            status=EnrollmentStatus.ACTIVE,
        )
        svc, db = self._run_setup(enrollment, program)
        svc._is_phase_complete = AsyncMock(return_value=True)

        await svc._maybe_auto_advance_phase(uuid4())

        # p1 (complete, non-manual) -> p2, then p2 is final -> stop.
        assert enrollment.current_phase_id == p2.id
        assert db.update_count() == 1

    async def test_stops_when_current_phase_requires_manual(self):
        p1 = _phase(str(uuid4()), 1, "Phase 1", manual=True)
        p2 = _phase(str(uuid4()), 2, "Phase 2")
        program = SimpleNamespace(
            id=str(uuid4()),
            organization_id="org-1",
            structure_type=ProgramStructureType.PHASES,
            phases=[p1, p2],
        )
        enrollment = SimpleNamespace(
            id=str(uuid4()),
            program_id=program.id,
            current_phase_id=p1.id,
            user_id="u1",
            status=EnrollmentStatus.ACTIVE,
        )
        svc, db = self._run_setup(enrollment, program)
        svc._is_phase_complete = AsyncMock(return_value=True)

        await svc._maybe_auto_advance_phase(uuid4())

        assert enrollment.current_phase_id == p1.id
        assert db.update_count() == 0

    async def test_noop_without_current_phase(self):
        enrollment = SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            current_phase_id=None,
            user_id="u1",
            status=EnrollmentStatus.ACTIVE,
        )
        db = RecordingSession([_one(enrollment)])
        svc = TrainingProgramService(db)
        svc._notify_phase_for_enrollment = AsyncMock()

        await svc._maybe_auto_advance_phase(uuid4())
        assert db.update_count() == 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
