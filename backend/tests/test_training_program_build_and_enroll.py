"""
Tests for training-pipeline fixes in TrainingProgramService:

* build_program — atomic create of program + phases + requirements + milestones
* bulk_enroll_members — members failing a prerequisite/concurrency gate must be
  skipped, not enrolled anyway (the skip check used to compare a UUID against
  name-based error strings and never matched)
* update_requirement_progress — marking a non-numeric requirement complete must
  move progress_percentage to 100 so the enrollment rollup advances
* _recalculate_enrollment_progress — a completed enrollment whose progress
  falls back below 100% must reopen

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import (
    EnrollmentStatus,
    ProgramMilestone,
    ProgramPhase,
    ProgramRequirement,
    RequirementProgressStatus,
    TrainingProgram,
    TrainingRequirement,
)
from app.schemas.training_program import (
    ProgramBuildMilestoneInput,
    ProgramBuildPhaseInput,
    ProgramBuildRequest,
    ProgramBuildRequirementInput,
    RequirementProgressUpdate,
    TrainingProgramCreate,
)
from app.services.training_program_service import TrainingProgramService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class RecordingSession:
    """Async session that returns queued results and records added objects."""

    def __init__(self, results=None):
        self._results = list(results or [])
        self.statements = []
        self.added = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()
        self.rollback = AsyncMock()

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()

    def update_count(self):
        return sum(1 for s in self.statements if type(s).__name__ == "Update")


class TestBuildProgram:
    """build_program persists the whole structure under one transaction."""

    async def test_builds_program_phases_requirements_milestones(self):
        db = RecordingSession()
        svc = TrainingProgramService(db)

        payload = ProgramBuildRequest(
            program=TrainingProgramCreate(
                name="Recruit", code="RECRUIT", structure_type="phases"
            ),
            phases=[
                ProgramBuildPhaseInput(
                    phase_number=1,
                    name="Phase 1",
                    requires_manual_advancement=True,
                    requirements=[
                        ProgramBuildRequirementInput(
                            name="Hose Ops",
                            requirement_type="hours",
                            required_hours=40,
                            is_required=True,
                            sort_order=1,
                        )
                    ],
                    milestones=[
                        ProgramBuildMilestoneInput(
                            name="Halfway", completion_percentage_threshold=50
                        )
                    ],
                )
            ],
        )

        program, error = await svc.build_program(payload, uuid4(), uuid4())

        assert error is None
        assert isinstance(program, TrainingProgram)
        # code and manual-advancement flag are persisted, not dropped.
        assert program.code == "RECRUIT"
        added = db.added
        assert any(isinstance(o, ProgramPhase) and o.requires_manual_advancement for o in added)
        assert any(isinstance(o, TrainingRequirement) for o in added)
        assert any(isinstance(o, ProgramRequirement) for o in added)
        assert any(isinstance(o, ProgramMilestone) for o in added)
        # Exactly one commit — the whole build is one transaction.
        assert db.commit.await_count == 1

    async def test_invalid_structure_type_returns_error_without_commit(self):
        db = RecordingSession()
        svc = TrainingProgramService(db)
        payload = ProgramBuildRequest(
            program=TrainingProgramCreate(name="X", structure_type="not-a-type"),
            phases=[],
        )
        program, error = await svc.build_program(payload, uuid4(), uuid4())
        assert program is None
        assert "Invalid structure type" in error
        db.commit.assert_not_awaited()


class TestBulkEnrollGate:
    """Members failing a prerequisite gate must not be enrolled."""

    async def test_prerequisite_failure_blocks_enrollment(self):
        program = SimpleNamespace(
            id=str(uuid4()),
            organization_id="org-1",
            prerequisite_program_ids=[str(uuid4())],
            allows_concurrent_enrollment=True,
            phases=[],
        )
        u1, u2 = uuid4(), uuid4()

        db = RecordingSession(
            [
                # batch user-name fetch
                _scalars(
                    [
                        SimpleNamespace(id=str(u1), first_name="Al", last_name="A"),
                        SimpleNamespace(id=str(u2), first_name="Bo", last_name="B"),
                    ]
                ),
                # completed-prerequisite fetch — nobody has completed it
                MagicMock(all=MagicMock(return_value=[])),
            ]
        )
        svc = TrainingProgramService(db)
        svc.get_program_by_id = AsyncMock(return_value=program)
        svc.enroll_member = AsyncMock()

        enrollments, errors = await svc.bulk_enroll_members(
            program_id=uuid4(),
            user_ids=[u1, u2],
            organization_id=uuid4(),
        )

        # Nobody satisfied the prerequisite, so nobody is enrolled.
        svc.enroll_member.assert_not_awaited()
        assert enrollments == []
        assert len(errors) == 2

    async def test_eligible_member_is_enrolled(self):
        program = SimpleNamespace(
            id=str(uuid4()),
            organization_id="org-1",
            prerequisite_program_ids=None,
            allows_concurrent_enrollment=True,
            phases=[],
        )
        u1 = uuid4()
        db = RecordingSession(
            [_scalars([SimpleNamespace(id=str(u1), first_name="Al", last_name="A")])]
        )
        svc = TrainingProgramService(db)
        svc.get_program_by_id = AsyncMock(return_value=program)
        svc.enroll_member = AsyncMock(return_value=(SimpleNamespace(user_id=u1), None))

        enrollments, errors = await svc.bulk_enroll_members(
            program_id=uuid4(),
            user_ids=[u1],
            organization_id=uuid4(),
        )

        svc.enroll_member.assert_awaited_once()
        assert len(enrollments) == 1
        assert errors == []


class TestNonNumericCompletion:
    """Marking a non-numeric requirement complete advances progress to 100%."""

    def _db_with(self, progress):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=progress))
        )
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        return db

    async def test_status_completed_sets_percentage_100(self, monkeypatch):
        progress = SimpleNamespace(
            id="p1",
            enrollment_id="enr-1",
            enrollment=SimpleNamespace(user_id="me"),
            status=RequirementProgressStatus.NOT_STARTED,
            progress_percentage=0.0,
            started_at=None,
            completed_at=None,
            verified_by=None,
            verified_at=None,
            updated_at=None,
        )
        svc = TrainingProgramService(self._db_with(progress))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())

        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(status="completed"),
        )

        assert err is None
        assert out.progress_percentage == 100.0
        assert out.completed_at is not None


class TestCompletionRevert:
    """A completed enrollment reopens when progress falls back below 100%."""

    async def test_revert_completed_to_active(self):
        enrollment = SimpleNamespace(
            id="enr-1",
            program_id="prog-1",
            status=EnrollmentStatus.COMPLETED,
            user_id="u1",
        )
        db = RecordingSession(
            [
                _one(enrollment),  # enrollment fetch
                _scalars([SimpleNamespace(progress_percentage=40.0)]),  # required rows
            ]
        )
        await TrainingProgramService(db)._recalculate_enrollment_progress("enr-1")
        # One UPDATE for the new percentage, one to revert status to ACTIVE.
        assert db.update_count() == 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
