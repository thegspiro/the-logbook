"""
Tests for the recertification-cycle auto-reset:
  * _compute_next_recert_date scheduling (fixed anchor, rolling interval, off)
  * _clamp_day short-month/leap-year handling
  * auto_reset_if_due (skips future deadlines, resets past-due ones)
  * run_due_recert_resets (sweeps every past-due enrollment)
DB mocked.
"""

from datetime import date, datetime, timezone
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


def _rows(items):
    """A result whose .all() yields (enrollment, program) rows for the sweep."""
    return MagicMock(all=MagicMock(return_value=items))


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _program(**over):
    base = dict(
        recert_enabled=True,
        recert_interval_months=24,
        recert_anchor_month=3,
        recert_anchor_day=30,
    )
    base.update(over)
    return SimpleNamespace(**base)


def _progress():
    return SimpleNamespace(
        id=str(uuid4()),
        status=RequirementProgressStatus.COMPLETED,
        progress_value=24.0,
        progress_percentage=100.0,
        progress_notes={"score": 90},
        started_at="x",
        completed_at="x",
        verified_at="x",
        verified_by="officer",
        verification_notes="ok",
    )


class TestComputeNextRecertDate:
    def test_fixed_anchor_biennial_lands_on_march_30(self):
        # Enrolled mid-2026 with NREMT's March 30 / 24-month cycle → next reset
        # is the biennial anchor two cycles out (2028-03-30, not 2027).
        prog = _program()
        result = TrainingProgramService._compute_next_recert_date(
            prog, date(2026, 7, 15)
        )
        assert result == date(2028, 3, 30)

    def test_anchor_yearly_when_interval_is_twelve_months(self):
        prog = _program(recert_interval_months=12)
        result = TrainingProgramService._compute_next_recert_date(
            prog, date(2026, 7, 15)
        )
        assert result == date(2027, 3, 30)

    def test_rolling_interval_without_anchor(self):
        prog = _program(recert_anchor_month=None, recert_anchor_day=None)
        result = TrainingProgramService._compute_next_recert_date(
            prog, date(2026, 7, 15)
        )
        # 24 months forward from the base date.
        assert result == date(2028, 7, 15)

    def test_returns_none_when_disabled(self):
        prog = _program(recert_enabled=False)
        assert (
            TrainingProgramService._compute_next_recert_date(prog, date(2026, 7, 15))
            is None
        )

    def test_returns_none_when_no_interval_and_no_anchor(self):
        prog = _program(
            recert_interval_months=None,
            recert_anchor_month=None,
            recert_anchor_day=None,
        )
        assert (
            TrainingProgramService._compute_next_recert_date(prog, date(2026, 7, 15))
            is None
        )


class TestClampDay:
    def test_clamps_anchor_day_past_month_end(self):
        # Day 31 requested in a 30-day month falls back to the 30th.
        assert TrainingProgramService._clamp_day(2026, 4, 31) == date(2026, 4, 30)

    def test_leap_day_falls_back_in_non_leap_year(self):
        assert TrainingProgramService._clamp_day(2027, 2, 29) == date(2027, 2, 28)

    def test_add_months_clamps_day(self):
        # Jan 31 + 1 month has no Feb 31 → clamps to Feb 28 (2026 non-leap).
        assert TrainingProgramService._add_months(date(2026, 1, 31), 1) == date(
            2026, 2, 28
        )


class TestAutoResetIfDue:
    async def test_future_deadline_is_a_noop(self):
        enrollment = SimpleNamespace(next_recert_reset_at=date(2100, 1, 1))
        svc = TrainingProgramService(RecordingSession([]))
        assert await svc.auto_reset_if_due(enrollment) is False

    async def test_no_deadline_is_a_noop(self):
        enrollment = SimpleNamespace(next_recert_reset_at=None)
        svc = TrainingProgramService(RecordingSession([]))
        assert await svc.auto_reset_if_due(enrollment) is False

    async def test_withdrawn_member_is_not_resurrected(self):
        # A member who left the program keeps their stored deadline, but a due
        # deadline must NOT flip them back to ACTIVE.
        enrollment = SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            status=EnrollmentStatus.WITHDRAWN,
            next_recert_reset_at=date(2000, 1, 1),
        )
        svc = TrainingProgramService(RecordingSession([]))

        assert await svc.auto_reset_if_due(enrollment) is False
        assert enrollment.status == EnrollmentStatus.WITHDRAWN

    async def test_past_due_resets_and_reschedules(self):
        enrollment = SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            status=EnrollmentStatus.COMPLETED,
            progress_percentage=100.0,
            completed_at="x",
            current_phase_id="last",
            next_recert_reset_at=date(2000, 1, 1),
            last_recert_reset_at=None,
        )
        row = _progress()
        first_phase = str(uuid4())
        # _get_program_for_enrollment, then blank rows, then first-phase lookup.
        db = RecordingSession([_one(_program()), _scalars([row]), _one(first_phase)])
        svc = TrainingProgramService(db)

        did_reset = await svc.auto_reset_if_due(enrollment)

        assert did_reset is True
        assert row.status == RequirementProgressStatus.NOT_STARTED
        assert enrollment.status == EnrollmentStatus.ACTIVE
        assert enrollment.progress_percentage == 0.0
        assert enrollment.current_phase_id == first_phase
        # Deadline advanced to a future date and the reset stamp recorded.
        assert enrollment.next_recert_reset_at > date.today()
        assert isinstance(enrollment.last_recert_reset_at, datetime)
        db.commit.assert_awaited_once()


class TestRunDueRecertResets:
    async def test_resets_each_due_enrollment(self):
        e1 = SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            status=EnrollmentStatus.COMPLETED,
            progress_percentage=100.0,
            completed_at="x",
            current_phase_id="last",
            next_recert_reset_at=date(2000, 1, 1),
            last_recert_reset_at=None,
        )
        e2 = SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            status=EnrollmentStatus.ACTIVE,
            progress_percentage=40.0,
            completed_at=None,
            current_phase_id="mid",
            next_recert_reset_at=date(2001, 1, 1),
            last_recert_reset_at=None,
        )
        prog = _program()
        # The sweep now selects (enrollment, program) rows in one query, then
        # per enrollment blanks its rows and looks up the first phase.
        db = RecordingSession(
            [
                _rows([(e1, prog), (e2, prog)]),  # due-enrollment sweep
                _scalars([_progress()]),
                _one("ph-1"),  # e1
                _scalars([_progress()]),
                _one("ph-1"),  # e2
            ]
        )
        svc = TrainingProgramService(db)

        count, error = await svc.run_due_recert_resets(uuid4())

        assert error is None and count == 2
        assert e1.status == EnrollmentStatus.ACTIVE
        assert e2.progress_percentage == 0.0
        db.commit.assert_awaited_once()

    async def test_withdrawn_row_is_skipped(self):
        # Even if a withdrawn enrollment slips through the WHERE clause, the loop
        # guard must not reactivate it.
        withdrawn = SimpleNamespace(
            id=str(uuid4()),
            program_id=str(uuid4()),
            status=EnrollmentStatus.WITHDRAWN,
            progress_percentage=0.0,
            completed_at=None,
            current_phase_id=None,
            next_recert_reset_at=date(2000, 1, 1),
            last_recert_reset_at=None,
        )
        db = RecordingSession([_rows([(withdrawn, _program())])])
        svc = TrainingProgramService(db)

        count, error = await svc.run_due_recert_resets(uuid4())

        assert error is None and count == 0
        assert withdrawn.status == EnrollmentStatus.WITHDRAWN
        db.commit.assert_not_awaited()

    async def test_no_due_enrollments_skips_commit(self):
        db = RecordingSession([_rows([])])
        svc = TrainingProgramService(db)

        count, error = await svc.run_due_recert_resets(uuid4())

        assert error is None and count == 0
        db.commit.assert_not_awaited()

    async def test_reset_now_matches_current_datetime(self):
        # datetime.now is used for both the "today" comparison and the stamp;
        # simply verify the computed next date beats today for a real program.
        prog = _program()
        base = datetime.now(timezone.utc).date()
        nxt = TrainingProgramService._compute_next_recert_date(prog, base)
        assert nxt is not None and nxt > base
