"""
Tests for requirement prerequisites.

``ProgramRequirement.is_prerequisite`` was settable in the editor, copied on
duplication, and carried through export — and consulted nowhere. A department
could mark "Orientation" a prerequisite and every other step stayed open.
Covers:

* which requirements a gate locks, and which it leaves alone
* scope: a phase's gate governs that phase, not the whole program
* a requirement reachable through an ungated scope staying open
* refusal at sign-off, in words a recruit can act on

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import RequirementProgressStatus, RequirementType
from app.schemas.training_program import RequirementProgressUpdate
from app.services.training_program_service import TrainingProgramService


def _link(name, *, requirement_id=None, phase_id=None, is_prerequisite=False):
    return SimpleNamespace(
        id=str(uuid4()),
        requirement_id=requirement_id or str(uuid4()),
        phase_id=phase_id,
        is_prerequisite=is_prerequisite,
        is_required=True,
        requirement=SimpleNamespace(name=name),
    )


def _progress_row(requirement_id, percentage):
    return SimpleNamespace(
        requirement_id=requirement_id,
        progress_percentage=percentage,
    )


class LockSession:
    """Answers the two queries prerequisite_locks() makes, in order."""

    def __init__(self, links, progress_rows):
        self._results = [links, progress_rows]
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        str(statement)
        scalars = MagicMock()
        scalars.all.return_value = self._results.pop(0) if self._results else []
        return MagicMock(scalars=MagicMock(return_value=scalars))


class TestPrerequisiteLocks:
    async def test_no_gates_means_nothing_is_locked(self):
        links = [_link("Orientation"), _link("Ride-Alongs")]
        svc = TrainingProgramService(LockSession(links, []))

        assert await svc.prerequisite_locks(uuid4(), uuid4()) == {}

    async def test_an_unfinished_gate_locks_its_scope(self):
        gate = _link("Orientation", is_prerequisite=True)
        other = _link("Ride-Alongs")
        svc = TrainingProgramService(LockSession([gate, other], []))

        locks = await svc.prerequisite_locks(uuid4(), uuid4())

        assert locks == {other.requirement_id: ["Orientation"]}

    async def test_a_gate_never_locks_itself(self):
        # Otherwise the prerequisite could never be started either.
        gate = _link("Orientation", is_prerequisite=True)
        svc = TrainingProgramService(LockSession([gate], []))

        assert await svc.prerequisite_locks(uuid4(), uuid4()) == {}

    async def test_a_finished_gate_opens_the_scope(self):
        gate = _link("Orientation", is_prerequisite=True)
        other = _link("Ride-Alongs")
        rows = [_progress_row(gate.requirement_id, 100.0)]
        svc = TrainingProgramService(LockSession([gate, other], rows))

        assert await svc.prerequisite_locks(uuid4(), uuid4()) == {}

    async def test_a_partly_done_gate_still_locks(self):
        gate = _link("Orientation", is_prerequisite=True)
        other = _link("Ride-Alongs")
        rows = [_progress_row(gate.requirement_id, 60.0)]
        svc = TrainingProgramService(LockSession([gate, other], rows))

        assert other.requirement_id in await svc.prerequisite_locks(uuid4(), uuid4())

    async def test_a_gate_only_governs_its_own_phase(self):
        # A phase-1 gate must not lock phase-2 work the member is cleared for.
        phase_one, phase_two = str(uuid4()), str(uuid4())
        gate = _link("Orientation", phase_id=phase_one, is_prerequisite=True)
        same_phase = _link("Station Tour", phase_id=phase_one)
        other_phase = _link("Pump Ops", phase_id=phase_two)
        svc = TrainingProgramService(LockSession([gate, same_phase, other_phase], []))

        locks = await svc.prerequisite_locks(uuid4(), uuid4())

        assert locks == {same_phase.requirement_id: ["Orientation"]}

    async def test_a_phase_gate_does_not_lock_program_level_work(self):
        phase = str(uuid4())
        gate = _link("Orientation", phase_id=phase, is_prerequisite=True)
        program_level = _link("Annual Physical", phase_id=None)
        svc = TrainingProgramService(LockSession([gate, program_level], []))

        assert await svc.prerequisite_locks(uuid4(), uuid4()) == {}

    async def test_a_requirement_open_in_any_scope_stays_open(self):
        # The same requirement linked into a gated phase and an ungated one is
        # still work the member can legitimately do.
        shared_id = str(uuid4())
        phase_one, phase_two = str(uuid4()), str(uuid4())
        gate = _link("Orientation", phase_id=phase_one, is_prerequisite=True)
        gated = _link("CPR", requirement_id=shared_id, phase_id=phase_one)
        open_link = _link("CPR", requirement_id=shared_id, phase_id=phase_two)
        svc = TrainingProgramService(LockSession([gate, gated, open_link], []))

        assert await svc.prerequisite_locks(uuid4(), uuid4()) == {}

    async def test_two_unfinished_gates_are_both_named(self):
        first = _link("Orientation", is_prerequisite=True)
        second = _link("Background Check", is_prerequisite=True)
        other = _link("Ride-Alongs")
        svc = TrainingProgramService(LockSession([first, second, other], []))

        locks = await svc.prerequisite_locks(uuid4(), uuid4())

        assert locks[other.requirement_id] == ["Background Check", "Orientation"]


class TestLockedMessage:
    def test_one_blocker(self):
        message = TrainingProgramService._locked_message(["Orientation"])
        assert message == "Finish Orientation first — this step unlocks after that."

    def test_two_blockers_read_as_a_pair(self):
        message = TrainingProgramService._locked_message(["Orientation", "CPR"])
        assert "Orientation and CPR" in message

    def test_three_blockers_are_listed(self):
        message = TrainingProgramService._locked_message(["A", "B", "C"])
        assert "A, B, and C" in message


class TestSignOffIsRefused:
    def _service(self, progress, locks):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=progress))
        )
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        svc = TrainingProgramService(db)
        svc.prerequisite_locks = AsyncMock(return_value=locks)
        svc._recalculate_enrollment_progress = AsyncMock()
        svc._maybe_auto_advance_phase = AsyncMock()
        return svc

    def _progress(self, requirement_id):
        return SimpleNamespace(
            id=str(uuid4()),
            enrollment_id=str(uuid4()),
            requirement_id=requirement_id,
            enrollment=SimpleNamespace(user_id="u1", program_id=str(uuid4())),
            requirement=SimpleNamespace(
                requirement_type=RequirementType.CHECKLIST,
                checklist_items=[],
                passing_score=None,
                max_attempts=None,
            ),
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

    async def test_a_locked_requirement_is_refused_by_name(self):
        progress = self._progress("req-1")
        svc = self._service(progress, {"req-1": ["Orientation"]})

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(status="completed"),
        )

        assert out is None
        assert error == "Finish Orientation first — this step unlocks after that."
        # Nothing was half-applied on the way to the refusal.
        assert progress.status == RequirementProgressStatus.NOT_STARTED
        svc._recalculate_enrollment_progress.assert_not_awaited()

    async def test_an_unlocked_requirement_is_unaffected(self):
        progress = self._progress("req-1")
        svc = self._service(progress, {"req-other": ["Orientation"]})

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(status="completed"),
        )

        assert error is None
        assert out.status == RequirementProgressStatus.COMPLETED
