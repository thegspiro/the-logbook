"""
Tests for post-creation pipeline editing on TrainingProgramService:
update program / phase / milestone, reorder phases & requirements, and the
auto-clean destructive ops (delete phase, remove requirement). DB mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import RequirementProgressStatus, RequirementType
from app.schemas.training_program import (
    ProgramMilestoneUpdate,
    ProgramPhaseUpdate,
    TrainingProgramUpdate,
)
from app.services.training_program_service import TrainingProgramService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _rows(rows):
    r = MagicMock()
    r.all.return_value = rows
    return r


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.deleted = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()

    async def delete(self, obj):
        self.deleted.append(obj)

    def stmt_types(self):
        return [type(s).__name__ for s in self.statements]


class TestUpdateProgram:
    async def test_missing_returns_error(self):
        svc = TrainingProgramService(RecordingSession([]))
        svc.get_program_by_id = AsyncMock(return_value=None)
        program, error = await svc.update_training_program(
            uuid4(), uuid4(), TrainingProgramUpdate(name="X")
        )
        assert program is None and error == "Training program not found"

    async def test_updates_fields(self):
        prog = SimpleNamespace(name="Old", description=None, structure_type=None)
        db = RecordingSession([])
        svc = TrainingProgramService(db)
        svc.get_program_by_id = AsyncMock(return_value=prog)
        program, error = await svc.update_training_program(
            uuid4(), uuid4(), TrainingProgramUpdate(name="New", description="d")
        )
        assert error is None
        assert prog.name == "New" and prog.description == "d"
        db.commit.assert_awaited_once()

    async def test_invalid_structure_type_rejected(self):
        prog = SimpleNamespace(structure_type=None)
        svc = TrainingProgramService(RecordingSession([]))
        svc.get_program_by_id = AsyncMock(return_value=prog)
        program, error = await svc.update_training_program(
            uuid4(), uuid4(), TrainingProgramUpdate(structure_type="banana")
        )
        assert program is None and "Invalid structure type" in error


class TestUpdatePhase:
    async def test_missing_returns_error(self):
        svc = TrainingProgramService(RecordingSession([]))
        svc._get_program_phase = AsyncMock(return_value=None)
        phase, error = await svc.update_program_phase(
            uuid4(), uuid4(), uuid4(), ProgramPhaseUpdate(name="X")
        )
        assert phase is None and error == "Program phase not found"

    async def test_ignores_phase_number_but_sets_others(self):
        phase = SimpleNamespace(
            name="Old", description=None, phase_number=1, requires_manual_advancement=False
        )
        db = RecordingSession([])
        svc = TrainingProgramService(db)
        svc._get_program_phase = AsyncMock(return_value=phase)
        _, error = await svc.update_program_phase(
            uuid4(), uuid4(), uuid4(),
            ProgramPhaseUpdate(name="New", phase_number=9, requires_manual_advancement=True),
        )
        assert error is None
        assert phase.name == "New"
        assert phase.requires_manual_advancement is True
        assert phase.phase_number == 1  # reorder is a separate operation


class TestReorderPhases:
    async def test_rejects_mismatched_set(self):
        p1 = SimpleNamespace(id=str(uuid4()), phase_number=1)
        db = RecordingSession([_scalars([p1])])
        svc = TrainingProgramService(db)
        phases, error = await svc.reorder_program_phases(uuid4(), uuid4(), [uuid4()])
        assert phases is None and "every phase exactly once" in error

    async def test_renumbers_in_order(self):
        p1 = SimpleNamespace(id=str(uuid4()), phase_number=1)
        p2 = SimpleNamespace(id=str(uuid4()), phase_number=2)
        db = RecordingSession([_scalars([p1, p2])])
        svc = TrainingProgramService(db)
        phases, error = await svc.reorder_program_phases(
            uuid4(), uuid4(), [p2.id, p1.id]
        )
        assert error is None
        assert p2.phase_number == 1 and p1.phase_number == 2
        db.commit.assert_awaited_once()


class TestDeletePhase:
    async def test_cleans_up_and_reanchors(self):
        phase_id = str(uuid4())
        phase = SimpleNamespace(id=phase_id)
        link_id, req_id = str(uuid4()), str(uuid4())
        e1, e2 = str(uuid4()), str(uuid4())
        remaining = SimpleNamespace(id=str(uuid4()), phase_number=2)
        db = RecordingSession(
            [
                _rows([(link_id, req_id)]),          # requirement links on phase
                _rows([(e1, phase_id), (e2, "other")]),  # enrollments
                MagicMock(),                          # delete RequirementProgress
                _scalars([remaining]),                # remaining phases
                MagicMock(),                          # update re-anchor
            ]
        )
        svc = TrainingProgramService(db)
        svc._get_program_phase = AsyncMock(return_value=phase)
        svc._recalculate_enrollment_progress = AsyncMock()
        svc._maybe_auto_advance_phase = AsyncMock()

        ok, error = await svc.delete_program_phase(phase_id, uuid4(), uuid4())

        assert ok is True and error is None
        assert phase in db.deleted
        assert "Delete" in db.stmt_types() and "Update" in db.stmt_types()
        # Both enrollments recomputed; only the parked one re-advanced.
        assert svc._recalculate_enrollment_progress.await_count == 2
        assert svc._maybe_auto_advance_phase.await_count == 1


class TestRemoveRequirement:
    async def test_deletes_progress_link_and_orphan(self):
        link = SimpleNamespace(id=str(uuid4()), requirement_id=str(uuid4()))
        e1 = str(uuid4())
        db = RecordingSession(
            [
                _one(link),           # the link
                _rows([(e1,)]),       # program enrollments
                MagicMock(),          # delete RequirementProgress
                _one(None),           # no other program references it -> orphan
                MagicMock(),          # delete TrainingRequirement
            ]
        )
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()
        svc._maybe_auto_advance_phase = AsyncMock()

        ok, error = await svc.remove_requirement_from_program(uuid4(), uuid4(), uuid4())

        assert ok is True and error is None
        assert link in db.deleted
        assert db.stmt_types().count("Delete") == 2  # progress rows + orphan req
        svc._recalculate_enrollment_progress.assert_awaited_once()


class TestReorderRequirements:
    async def test_sets_sort_order(self):
        a = SimpleNamespace(id=str(uuid4()), sort_order=0)
        b = SimpleNamespace(id=str(uuid4()), sort_order=0)
        db = RecordingSession([_scalars([a, b])])
        svc = TrainingProgramService(db)
        links, error = await svc.reorder_program_requirements(
            uuid4(), uuid4(), [b.id, a.id]
        )
        assert error is None
        assert b.sort_order == 0 and a.sort_order == 1

    async def test_rejects_foreign_id(self):
        a = SimpleNamespace(id=str(uuid4()), sort_order=0)
        db = RecordingSession([_scalars([a])])
        svc = TrainingProgramService(db)
        links, error = await svc.reorder_program_requirements(
            uuid4(), uuid4(), [uuid4()]
        )
        assert links is None and "does not belong" in error


class TestMilestones:
    async def test_update(self):
        ms = SimpleNamespace(name="Old", completion_percentage_threshold=50.0)
        db = RecordingSession([])
        svc = TrainingProgramService(db)
        svc._get_program_milestone = AsyncMock(return_value=ms)
        _, error = await svc.update_program_milestone(
            uuid4(), uuid4(), uuid4(), ProgramMilestoneUpdate(name="New")
        )
        assert error is None and ms.name == "New"

    async def test_delete_missing(self):
        svc = TrainingProgramService(RecordingSession([]))
        svc._get_program_milestone = AsyncMock(return_value=None)
        ok, error = await svc.delete_program_milestone(uuid4(), uuid4(), uuid4())
        assert ok is False and error == "Program milestone not found"


class TestRecomputeForRequirement:
    async def test_rescales_incomplete_rows_and_skips_completed(self):
        req = SimpleNamespace(
            id=str(uuid4()),
            requirement_type=RequirementType.HOURS,
            required_hours=10,
            required_shifts=None,
            required_calls=None,
            required_courses=None,
        )
        in_progress = SimpleNamespace(
            enrollment_id=str(uuid4()),
            status=RequirementProgressStatus.IN_PROGRESS,
            progress_value=5,
            progress_percentage=0.0,
        )
        done = SimpleNamespace(
            enrollment_id=str(uuid4()),
            status=RequirementProgressStatus.COMPLETED,
            progress_value=10,
            progress_percentage=100.0,
        )
        db = RecordingSession([_scalars([in_progress, done])])
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()
        svc._maybe_auto_advance_phase = AsyncMock()

        await svc._recompute_progress_for_requirement(req)

        # 5 of 10 hours -> 50%; completed row untouched.
        assert in_progress.progress_percentage == 50.0
        assert done.progress_percentage == 100.0
        svc._recalculate_enrollment_progress.assert_awaited_once()

    async def test_status_based_requirement_is_noop(self):
        req = SimpleNamespace(
            id=str(uuid4()),
            requirement_type=RequirementType.CERTIFICATION,
            required_hours=None,
            required_shifts=None,
            required_calls=None,
            required_courses=None,
        )
        db = RecordingSession([])
        svc = TrainingProgramService(db)
        await svc._recompute_progress_for_requirement(req)
        assert db.statements == []  # returned before querying
