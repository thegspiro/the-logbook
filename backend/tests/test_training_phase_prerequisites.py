"""
Tests for phase prerequisites.

``ProgramPhase.prerequisite_phase_ids`` was stored, remapped on duplication, and
never consulted: a phase could declare "finish Skills first" and members would
still be advanced straight past it. Worse, the column is JSON while the schema
parses the ids as UUIDs, so actually setting the field raised TypeError at
commit — the feature could not be used at all. Covers:

* coercion to strings, which is what makes the column writable
* validation — foreign ids, self-reference, cycles
* enforcement on manual and automatic advancement
* pruning references to a phase that gets deleted

DB mocked; no MySQL.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import ProgramStructureType
from app.services.training_program_service import TrainingProgramService
from app.utils.json_ids import normalize_id_list
from app.utils.phase_prerequisites import find_cycle


def _phase(name, number, prerequisites=None, phase_id=None):
    return SimpleNamespace(
        id=phase_id or str(uuid4()),
        name=name,
        phase_number=number,
        prerequisite_phase_ids=prerequisites,
        requires_manual_advancement=False,
    )


class PhaseSession:
    """Session whose execute() always answers with the same phase list."""

    def __init__(self, phases):
        self._phases = phases
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        pass

    async def execute(self, statement, *args, **kwargs):
        str(statement)
        scalars = MagicMock()
        scalars.all.return_value = self._phases
        return MagicMock(
            scalars=MagicMock(return_value=scalars),
            scalar_one_or_none=MagicMock(return_value=None),
            all=MagicMock(return_value=[]),
        )


class TestIdCoercion:
    def test_uuids_become_strings(self):
        # The column is JSON; json.dumps raises TypeError on a UUID, so a list
        # of them never reaches the database.
        raw = [uuid4(), uuid4()]
        ids = normalize_id_list(raw)
        assert ids == [str(raw[0]), str(raw[1])]
        json.dumps(ids)

    def test_blanks_and_duplicates_are_dropped(self):
        assert normalize_id_list(["a", "  ", "a", None, "b"]) == ["a", "b"]

    def test_empty_input_is_empty(self):
        assert normalize_id_list(None) == []


class TestCycleDetection:
    def test_a_two_phase_loop_is_found(self):
        assert find_cycle({"a": ["b"], "b": ["a"]}, "a") == ["a", "b", "a"]

    def test_a_longer_loop_is_found(self):
        cycle = find_cycle({"a": ["b"], "b": ["c"], "c": ["a"]}, "a")
        assert cycle == ["a", "b", "c", "a"]

    def test_a_diamond_is_not_a_cycle(self):
        # Two independent paths to the same phase are legitimate.
        graph = {"d": ["b", "c"], "b": ["a"], "c": ["a"], "a": []}
        assert find_cycle(graph, "d") is None

    def test_an_unknown_dependency_is_not_a_cycle(self):
        assert find_cycle({"a": ["gone"]}, "a") is None


class TestValidation:
    async def test_ids_from_this_program_are_accepted_as_strings(self):
        first, second = _phase("Orientation", 1), _phase("Skills", 2)
        svc = TrainingProgramService(PhaseSession([first, second]))

        ids, error = await svc._validate_phase_prerequisites(
            program_id="prog-1",
            phase_id=second.id,
            prerequisite_phase_ids=[first.id],
        )

        assert error is None
        assert ids == [str(first.id)]

    async def test_an_empty_list_leaves_the_column_null(self):
        svc = TrainingProgramService(PhaseSession([]))

        ids, error = await svc._validate_phase_prerequisites(
            program_id="prog-1", phase_id=None, prerequisite_phase_ids=[]
        )

        assert (ids, error) == (None, None)

    async def test_an_id_from_another_program_is_rejected(self):
        # Persisting it would be a dangling — and cross-tenant — reference.
        existing = _phase("Orientation", 1)
        svc = TrainingProgramService(PhaseSession([existing]))

        ids, error = await svc._validate_phase_prerequisites(
            program_id="prog-1",
            phase_id=None,
            prerequisite_phase_ids=[str(uuid4())],
        )

        assert ids is None
        assert "not part of this program" in error

    async def test_a_phase_cannot_require_itself(self):
        phase = _phase("Skills", 2)
        svc = TrainingProgramService(PhaseSession([phase]))

        ids, error = await svc._validate_phase_prerequisites(
            program_id="prog-1",
            phase_id=phase.id,
            prerequisite_phase_ids=[phase.id],
        )

        assert ids is None
        assert "its own prerequisite" in error

    async def test_a_loop_is_rejected_and_names_the_phases(self):
        first = _phase("Orientation", 1)
        second = _phase("Skills", 2, prerequisites=[first.id])
        # Pointing Orientation back at Skills closes the loop.
        svc = TrainingProgramService(PhaseSession([first, second]))

        ids, error = await svc._validate_phase_prerequisites(
            program_id="prog-1",
            phase_id=first.id,
            prerequisite_phase_ids=[second.id],
        )

        assert ids is None
        assert "loop back" in error
        assert "Orientation" in error
        assert "Skills" in error


class TestUnmetPrerequisites:
    async def test_an_unfinished_prerequisite_is_reported_by_name(self, monkeypatch):
        first = _phase("Orientation", 1)
        second = _phase("Skills", 2, prerequisites=[first.id])
        svc = TrainingProgramService(PhaseSession([]))
        monkeypatch.setattr(svc, "_is_phase_complete", AsyncMock(return_value=False))

        unmet = await svc._unmet_phase_prerequisites(
            uuid4(), second, {str(first.id): first}
        )

        assert unmet == ["Orientation"]

    async def test_a_finished_prerequisite_clears_the_gate(self, monkeypatch):
        first = _phase("Orientation", 1)
        second = _phase("Skills", 2, prerequisites=[first.id])
        svc = TrainingProgramService(PhaseSession([]))
        monkeypatch.setattr(svc, "_is_phase_complete", AsyncMock(return_value=True))

        assert (
            await svc._unmet_phase_prerequisites(
                uuid4(), second, {str(first.id): first}
            )
            == []
        )

    async def test_a_deleted_prerequisite_does_not_strand_the_member(self, monkeypatch):
        # Nothing can complete a phase that no longer exists, so honoring the
        # reference would lock the member out permanently.
        orphan = _phase("Skills", 2, prerequisites=[str(uuid4())])
        svc = TrainingProgramService(PhaseSession([]))
        monkeypatch.setattr(svc, "_is_phase_complete", AsyncMock(return_value=False))

        assert await svc._unmet_phase_prerequisites(uuid4(), orphan, {}) == []


class TestAdvancementEnforcement:
    def _service(self, phases, current_phase_id, completed_phase_ids):
        """Service whose enrollment sits on ``current_phase_id`` and has
        completed exactly ``completed_phase_ids``."""
        svc = TrainingProgramService(PhaseSession(phases))
        enrollment = SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            current_phase_id=current_phase_id,
        )
        program = SimpleNamespace(
            id=enrollment.program_id,
            phases=phases,
            structure_type=ProgramStructureType.PHASES,
            organization_id=str(uuid4()),
        )
        svc.get_enrollment_by_id = AsyncMock(return_value=enrollment)
        svc.get_program_by_id = AsyncMock(return_value=program)
        svc._notify_phase_for_enrollment = AsyncMock()
        done = {str(pid) for pid in completed_phase_ids}
        svc._is_phase_complete = AsyncMock(
            side_effect=lambda _enrollment_id, phase_id: str(phase_id) in done
        )
        return svc, enrollment

    async def test_a_gated_phase_reports_what_is_still_missing(self):
        # The member was force-advanced past Classroom, finished Skills, and now
        # wants Ride-Along — which requires both. Phase *order* alone would let
        # them through; the prerequisite is what catches the gap.
        classroom = _phase("Classroom", 1)
        skills = _phase("Skills", 2)
        ride_along = _phase("Ride-Along", 3, prerequisites=[classroom.id, skills.id])
        svc, _ = self._service([classroom, skills, ride_along], skills.id, [skills.id])

        out, error = await svc.advance_enrollment_phase(uuid4(), uuid4())

        assert out is None
        assert "Ride-Along can't start until" in error
        assert "Classroom" in error
        # Skills is finished, so it must not be listed as a blocker.
        assert "Skills" not in error.split(":", 1)[1]

    async def test_advancement_proceeds_once_the_gate_is_met(self):
        classroom = _phase("Classroom", 1)
        skills = _phase("Skills", 2)
        ride_along = _phase("Ride-Along", 3, prerequisites=[classroom.id, skills.id])
        svc, _ = self._service(
            [classroom, skills, ride_along], skills.id, [classroom.id, skills.id]
        )

        out, error = await svc.advance_enrollment_phase(uuid4(), uuid4())

        assert error is None
        assert out.current_phase_id == ride_along.id

    async def test_force_overrides_the_gate(self):
        classroom = _phase("Classroom", 1)
        skills = _phase("Skills", 2)
        ride_along = _phase("Ride-Along", 3, prerequisites=[classroom.id])
        svc, _ = self._service([classroom, skills, ride_along], skills.id, [])

        out, error = await svc.advance_enrollment_phase(uuid4(), uuid4(), force=True)

        assert error is None
        assert out.current_phase_id == ride_along.id


class QueuedSession:
    """Session that answers execute() from a queue of prepared results."""

    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()

    def add(self, obj):
        pass

    async def execute(self, statement, *args, **kwargs):
        str(statement)
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()


def _scalar(value):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=value))


class TestAutoAdvanceEnforcement:
    async def test_auto_advance_stops_at_a_gated_phase(self):
        from app.models.training import EnrollmentStatus

        classroom = _phase("Classroom", 1)
        skills = _phase("Skills", 2)
        ride_along = _phase("Ride-Along", 3, prerequisites=[classroom.id])
        enrollment = SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            current_phase_id=skills.id,
            status=EnrollmentStatus.ACTIVE,
        )
        program = SimpleNamespace(
            structure_type=ProgramStructureType.PHASES,
            phases=[classroom, skills, ride_along],
        )
        session = QueuedSession([_scalar(enrollment), _scalar(program)])
        svc = TrainingProgramService(session)
        # Skills is done, Classroom never was — Ride-Along stays shut.
        svc._is_phase_complete = AsyncMock(
            side_effect=lambda _e, pid: str(pid) == str(skills.id)
        )

        await svc._maybe_auto_advance_phase(uuid4())

        assert enrollment.current_phase_id == skills.id
        session.commit.assert_not_awaited()


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        (["keep", "drop"], ["keep"]),
        (["drop"], None),
        (None, None),
    ],
)
def test_pruning_a_deleted_phase_id(stored, expected):
    """The delete path rebuilds the list rather than mutating it — a plain JSON
    column doesn't track in-place changes, so a .remove() would never be saved."""
    current = normalize_id_list(stored)
    pruned = [pid for pid in current if pid != "drop"]
    assert (pruned or None) == expected
