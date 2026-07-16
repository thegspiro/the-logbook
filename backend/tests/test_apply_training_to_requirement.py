"""
Tests for TrainingProgramService.apply_training_to_requirement — an officer
crediting a completed training (e.g. a make-up session, or approved self-reported
training) toward one specific pipeline requirement. DB mocked.

Numeric requirements accrue; status-based requirements are marked complete; and
the flag is bypassed (it's an explicit sign-off, not the automatic import feed).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import EnrollmentStatus, RequirementType
from app.services.training_program_service import TrainingProgramService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _first(obj):
    return MagicMock(first=MagicMock(return_value=obj))


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _enrollment():
    return SimpleNamespace(id="enr-1", status=EnrollmentStatus.ACTIVE)


def _prog(value):
    return SimpleNamespace(id=str(uuid4()), progress_value=value)


# allows_external_credit intentionally False to prove the officer path ignores it.
def _req(rtype):
    return SimpleNamespace(
        id=str(uuid4()), requirement_type=rtype, allows_external_credit=False
    )


class TestApplyTrainingToRequirement:
    async def test_hours_requirement_accrues(self):
        prog, req = _prog(2.0), _req(RequirementType.HOURS)
        db = RecordingSession([_one(_enrollment()), _first((prog, req))])
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock(return_value=(MagicMock(), None))

        applied, error = await svc.apply_training_to_requirement(
            user_id="u1",
            organization_id=uuid4(),
            program_id="prog-1",
            requirement_id=req.id,
            hours=4.0,
            verified_by=uuid4(),
        )

        assert applied is True and error is None
        call = svc.update_requirement_progress.await_args
        assert call.kwargs["updates"].progress_value == 6.0

    async def test_course_requirement_increments(self):
        prog, req = _prog(1.0), _req(RequirementType.COURSES)
        db = RecordingSession([_one(_enrollment()), _first((prog, req))])
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock(return_value=(MagicMock(), None))

        applied, error = await svc.apply_training_to_requirement(
            user_id="u1",
            organization_id=uuid4(),
            program_id="prog-1",
            requirement_id=req.id,
            hours=0.0,
        )

        assert applied is True
        assert (
            svc.update_requirement_progress.await_args.kwargs["updates"].progress_value
            == 2.0
        )

    async def test_status_requirement_marked_complete(self):
        prog, req = _prog(0.0), _req(RequirementType.SKILLS_EVALUATION)
        db = RecordingSession([_one(_enrollment()), _first((prog, req))])
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock(return_value=(MagicMock(), None))

        applied, error = await svc.apply_training_to_requirement(
            user_id="u1",
            organization_id=uuid4(),
            program_id="prog-1",
            requirement_id=req.id,
            hours=3.0,
        )

        assert applied is True
        updates = svc.update_requirement_progress.await_args.kwargs["updates"]
        assert updates.status == "completed"
        assert updates.progress_value is None

    async def test_not_enrolled_returns_error(self):
        db = RecordingSession([_one(None)])
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock()

        applied, error = await svc.apply_training_to_requirement(
            user_id="u1",
            organization_id=uuid4(),
            program_id="prog-1",
            requirement_id="req-1",
            hours=4.0,
        )

        assert applied is False
        assert error == "Member is not actively enrolled in this program"
        svc.update_requirement_progress.assert_not_awaited()

    async def test_requirement_not_in_enrollment_returns_error(self):
        db = RecordingSession([_one(_enrollment()), _first(None)])
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock()

        applied, error = await svc.apply_training_to_requirement(
            user_id="u1",
            organization_id=uuid4(),
            program_id="prog-1",
            requirement_id="req-x",
            hours=4.0,
        )

        assert applied is False
        assert error == "That requirement is not part of this member's enrollment"
        svc.update_requirement_progress.assert_not_awaited()
