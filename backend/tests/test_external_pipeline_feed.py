"""
Tests for crediting external/synced course completions (e.g. Vector Solutions
imports) into pipeline progress via
TrainingProgramService.credit_category_progress.

HOURS requirements accrue the record's hours; COURSES requirements accrue one
completion; other requirement types are left for explicit sign-off. The credit
fans out across every active enrollment that requires the category. DB mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import ProgressCreditSource, RequirementType
from app.services.training_program_service import TrainingProgramService


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _rows(items):
    return MagicMock(all=MagicMock(return_value=items))


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _prog(value):
    return SimpleNamespace(id=str(uuid4()), progress_value=value)


def _req(rtype, allows_external_credit=True):
    return SimpleNamespace(
        id=str(uuid4()),
        requirement_type=rtype,
        allows_external_credit=allows_external_credit,
    )


class TestCreditCategoryProgress:
    async def test_advances_hours_and_courses_skips_other_types(self):
        enrollment = SimpleNamespace(id="enr-1")
        p_hours, r_hours = _prog(2.0), _req(RequirementType.HOURS)
        p_course, r_course = _prog(1.0), _req(RequirementType.COURSES)
        p_skill, r_skill = _prog(0.0), _req(RequirementType.SKILLS_EVALUATION)
        db = RecordingSession(
            [
                _scalars([enrollment]),
                _rows([(p_hours, r_hours), (p_course, r_course), (p_skill, r_skill)]),
            ]
        )
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock(return_value=(MagicMock(), None))

        advanced = await svc.credit_category_progress(
            user_id="u1",
            organization_id=uuid4(),
            category_id="cat-1",
            hours=4.0,
        )

        assert advanced == 2  # hours + course; the skills requirement is skipped
        by_id = {
            c.kwargs["progress_id"]: c.kwargs["updates"].progress_value
            for c in svc.update_requirement_progress.await_args_list
        }
        assert by_id[p_hours.id] == 6.0  # 2 existing + 4 credited hours
        assert by_id[p_course.id] == 2.0  # 1 existing + 1 course completion

    async def test_fans_out_across_multiple_active_enrollments(self):
        e1, e2 = SimpleNamespace(id="enr-1"), SimpleNamespace(id="enr-2")
        p1, r1 = _prog(0.0), _req(RequirementType.HOURS)
        p2, r2 = _prog(0.0), _req(RequirementType.HOURS)
        db = RecordingSession(
            [
                _scalars([e1, e2]),
                _rows([(p1, r1)]),  # enr-1
                _rows([(p2, r2)]),  # enr-2
            ]
        )
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock(return_value=(MagicMock(), None))

        advanced = await svc.credit_category_progress(
            user_id="u1", organization_id=uuid4(), category_id="cat-1", hours=3.0
        )

        assert advanced == 2  # same completion credited to both programs

    async def test_requirement_without_external_credit_is_skipped(self):
        # An in-house-only requirement (allows_external_credit=False) matching the
        # category must NOT be advanced by an imported course.
        enrollment = SimpleNamespace(id="enr-1")
        p_open, r_open = _prog(0.0), _req(RequirementType.HOURS)
        p_inhouse, r_inhouse = _prog(0.0), _req(
            RequirementType.HOURS, allows_external_credit=False
        )
        db = RecordingSession(
            [
                _scalars([enrollment]),
                _rows([(p_open, r_open), (p_inhouse, r_inhouse)]),
            ]
        )
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock(return_value=(MagicMock(), None))

        advanced = await svc.credit_category_progress(
            user_id="u1", organization_id=uuid4(), category_id="cat-1", hours=4.0
        )

        assert advanced == 1  # only the opted-in requirement
        assert svc.update_requirement_progress.await_args.kwargs["progress_id"] == (
            p_open.id
        )

    async def test_no_active_enrollment_is_noop(self):
        db = RecordingSession([_scalars([])])
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock()

        advanced = await svc.credit_category_progress(
            user_id="u1", organization_id=uuid4(), category_id="cat-1", hours=4.0
        )

        assert advanced == 0
        svc.update_requirement_progress.assert_not_awaited()

    async def test_cert_only_record_still_credits_a_course_requirement(self):
        # A 0-hour completion (a certification) still advances a COURSES
        # requirement by one, but not an HOURS requirement.
        enrollment = SimpleNamespace(id="enr-1")
        p_hours, r_hours = _prog(5.0), _req(RequirementType.HOURS)
        p_course, r_course = _prog(0.0), _req(RequirementType.COURSES)
        db = RecordingSession(
            [
                _scalars([enrollment]),
                _rows([(p_hours, r_hours), (p_course, r_course)]),
            ]
        )
        svc = TrainingProgramService(db)
        svc.update_requirement_progress = AsyncMock(return_value=(MagicMock(), None))

        advanced = await svc.credit_category_progress(
            user_id="u1", organization_id=uuid4(), category_id="cat-1", hours=0.0
        )

        assert advanced == 1  # only the course requirement
        call = svc.update_requirement_progress.await_args
        assert call.kwargs["progress_id"] == p_course.id
        assert call.kwargs["updates"].progress_value == 1.0

    async def test_noop_when_nothing_to_credit(self):
        svc = TrainingProgramService(RecordingSession([]))
        svc.update_requirement_progress = AsyncMock()

        advanced = await svc.credit_category_progress(
            user_id="u1",
            organization_id=uuid4(),
            category_id="cat-1",
            hours=0.0,
            is_course_completion=False,
        )

        assert advanced == 0
        svc.update_requirement_progress.assert_not_awaited()

    async def test_with_source_id_routes_through_credit_ledger(self):
        # When the imported record's id is threaded through, the accrual goes via
        # the idempotency ledger keyed on that record — so a re-sync of the same
        # record cannot double-credit.
        enrollment = SimpleNamespace(id="enr-1")
        p_hours, r_hours = _prog(2.0), _req(RequirementType.HOURS)
        db = RecordingSession([_scalars([enrollment]), _rows([(p_hours, r_hours)])])
        svc = TrainingProgramService(db)
        svc.apply_requirement_credit = AsyncMock(return_value=(MagicMock(), None))

        advanced = await svc.credit_category_progress(
            user_id="u1",
            organization_id=uuid4(),
            category_id="cat-1",
            hours=4.0,
            source_id="rec-42",
        )

        assert advanced == 1
        svc.apply_requirement_credit.assert_awaited_once()
        kwargs = svc.apply_requirement_credit.await_args.kwargs
        assert kwargs["source_type"] == ProgressCreditSource.EXTERNAL_IMPORT
        assert kwargs["source_id"] == "rec-42"
        assert kwargs["units"] == 4.0
