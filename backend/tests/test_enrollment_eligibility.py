"""
Tests for TrainingProgramService.get_enrollment_eligibility.

Decides, per member, whether they can be enrolled in a program right now and why
not — mirroring the hard gates in bulk_enroll_members (already enrolled, missing
prerequisite, concurrent-enrollment block). DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.services.training_program_service import TrainingProgramService


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

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _user(first="A", last="Member", number=None):
    return SimpleNamespace(
        id=str(uuid4()),
        first_name=first,
        last_name=last,
        membership_number=number,
    )


def _program(concurrent=True, prereqs=None):
    return SimpleNamespace(
        id=str(uuid4()),
        allows_concurrent_enrollment=concurrent,
        prerequisite_program_ids=prereqs,
    )


def _svc(results, program):
    db = RecordingSession(results)
    svc = TrainingProgramService(db)
    svc.get_program_by_id = AsyncMock(return_value=program)
    return svc


def _by_id(results):
    return {r["user_id"]: r for r in results}


class TestEnrollmentEligibility:
    async def test_missing_program_returns_none(self):
        svc = TrainingProgramService(RecordingSession([]))
        svc.get_program_by_id = AsyncMock(return_value=None)
        assert await svc.get_enrollment_eligibility(uuid4(), uuid4()) is None

    async def test_marks_already_enrolled(self):
        u1, u2 = _user("Al"), _user("Bo")
        program = _program(concurrent=True, prereqs=None)
        # queries: select(User), enrolled-in-this
        svc = _svc([_scalars([u1, u2]), _rows([(u1.id,)])], program)

        results = await svc.get_enrollment_eligibility(uuid4(), uuid4())

        by_id = _by_id(results)
        assert by_id[u1.id]["status"] == "enrolled"
        assert by_id[u1.id]["eligible"] is False
        assert by_id[u2.id]["status"] == "eligible"
        assert by_id[u2.id]["eligible"] is True
        # Eligible members sort first.
        assert results[0]["user_id"] == u2.id

    async def test_marks_missing_prerequisite_with_names(self):
        u1, u2 = _user("Al"), _user("Bo")
        program = _program(concurrent=True, prereqs=["prog-a"])
        # queries: users, enrolled(none), prereq names, completed pairs (u1 only)
        svc = _svc(
            [
                _scalars([u1, u2]),
                _rows([]),
                _rows([("prog-a", "Recruit School")]),
                _rows([(u1.id, "prog-a")]),
            ],
            program,
        )

        results = await svc.get_enrollment_eligibility(uuid4(), uuid4())

        by_id = _by_id(results)
        assert by_id[u1.id]["status"] == "eligible"
        assert by_id[u2.id]["status"] == "prerequisite"
        assert "Recruit School" in by_id[u2.id]["reason"]

    async def test_marks_concurrent_block(self):
        u1, u2 = _user("Al"), _user("Bo")
        program = _program(concurrent=False, prereqs=None)
        # queries: users, enrolled(none), active-anywhere (u1)
        svc = _svc([_scalars([u1, u2]), _rows([]), _rows([(u1.id,)])], program)

        results = await svc.get_enrollment_eligibility(uuid4(), uuid4())

        by_id = _by_id(results)
        assert by_id[u1.id]["status"] == "concurrent"
        assert by_id[u1.id]["eligible"] is False
        assert by_id[u2.id]["status"] == "eligible"

    async def test_enrolled_takes_precedence_over_concurrent(self):
        # A member active in THIS program is also "active somewhere"; the
        # primary, most useful reason is that they're already in this program.
        u1 = _user("Al")
        program = _program(concurrent=False, prereqs=None)
        svc = _svc(
            [_scalars([u1]), _rows([(u1.id,)]), _rows([(u1.id,)])],
            program,
        )

        results = await svc.get_enrollment_eligibility(uuid4(), uuid4())

        assert results[0]["status"] == "enrolled"
