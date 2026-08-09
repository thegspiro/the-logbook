"""
Tests for enrollment expiry.

EnrollmentStatus.EXPIRED was read (recert treats it as a renewable state) but
never written, so an enrollment past its completion deadline stayed ACTIVE
forever — the member's page said "42 days overdue" against a status that
claimed otherwise, and no officer view could filter for it. Covers:

* the overdue test itself, including the statuses it must not touch
* expiry on read, mirroring auto_reset_if_due
* reopening, which is the only way back out of EXPIRED

DB mocked; no MySQL.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import EnrollmentStatus
from app.services.training_program_service import TrainingProgramService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


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
        str(statement)
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()


def _enrollment(status=EnrollmentStatus.ACTIVE, days_from_today=-1):
    return SimpleNamespace(
        # A real UUID: the service coerces the id when it rolls progress up.
        id=str(uuid4()),
        organization_id="org-1",
        program_id="prog-1",
        user_id="u1",
        status=status,
        progress_percentage=60.0,
        target_completion_date=(
            date.today() + timedelta(days=days_from_today)
            if days_from_today is not None
            else None
        ),
        deadline_warning_sent=True,
        deadline_warning_sent_at=None,
        updated_at=None,
    )


class TestIsOverdue:
    def test_active_past_its_deadline_is_overdue(self):
        assert TrainingProgramService._is_overdue(_enrollment()) is True

    def test_deadline_today_is_not_overdue(self):
        # The member has until the end of the day they were given.
        assert (
            TrainingProgramService._is_overdue(_enrollment(days_from_today=0)) is False
        )

    def test_no_deadline_never_expires(self):
        assert (
            TrainingProgramService._is_overdue(_enrollment(days_from_today=None))
            is False
        )

    def test_a_non_active_enrollment_is_left_alone(self):
        # Expiring a withdrawn or completed member would rewrite their history.
        for status in (
            EnrollmentStatus.COMPLETED,
            EnrollmentStatus.WITHDRAWN,
            EnrollmentStatus.FAILED,
            EnrollmentStatus.ON_HOLD,
            EnrollmentStatus.EXPIRED,
        ):
            assert (
                TrainingProgramService._is_overdue(_enrollment(status=status)) is False
            )


class TestAutoExpireIfOverdue:
    async def test_overdue_enrollment_expires_and_notifies(self, monkeypatch):
        enrollment = _enrollment()
        svc = TrainingProgramService(RecordingSession())
        notify = AsyncMock()
        monkeypatch.setattr(svc, "_notify_enrollment_expired", notify)
        monkeypatch.setattr(
            svc,
            "_get_program_for_enrollment",
            AsyncMock(return_value=SimpleNamespace(id="prog-1", name="Recruit")),
        )

        assert await svc.auto_expire_if_overdue(enrollment) is True
        assert enrollment.status == EnrollmentStatus.EXPIRED
        notify.assert_awaited_once()

    async def test_a_current_enrollment_is_untouched(self):
        enrollment = _enrollment(days_from_today=30)
        svc = TrainingProgramService(RecordingSession())

        assert await svc.auto_expire_if_overdue(enrollment) is False
        assert enrollment.status == EnrollmentStatus.ACTIVE

    async def test_a_notification_failure_does_not_undo_the_expiry(self, monkeypatch):
        enrollment = _enrollment()
        svc = TrainingProgramService(RecordingSession())
        monkeypatch.setattr(
            svc,
            "_get_program_for_enrollment",
            AsyncMock(side_effect=RuntimeError("notification service down")),
        )

        assert await svc.auto_expire_if_overdue(enrollment) is True
        assert enrollment.status == EnrollmentStatus.EXPIRED


class TestReopenEnrollment:
    def _svc(self, enrollment):
        svc = TrainingProgramService(RecordingSession())
        svc.get_enrollment_by_id = AsyncMock(return_value=enrollment)
        svc._recalculate_enrollment_progress = AsyncMock()
        return svc

    async def test_reopening_restores_active_and_a_new_deadline(self):
        enrollment = _enrollment(status=EnrollmentStatus.EXPIRED)
        svc = self._svc(enrollment)
        new_deadline = date.today() + timedelta(days=60)

        out, error = await svc.reopen_enrollment(
            uuid4(), uuid4(), target_completion_date=new_deadline
        )

        assert error is None
        assert out.status == EnrollmentStatus.ACTIVE
        assert out.target_completion_date == new_deadline
        # The warning sweep must be able to speak again on the new date.
        assert out.deadline_warning_sent is False
        # A member who finished everything while expired should not have to wait
        # for the next progress edit to be marked complete.
        svc._recalculate_enrollment_progress.assert_awaited_once()

    async def test_reopening_without_a_date_keeps_the_old_one(self):
        enrollment = _enrollment(status=EnrollmentStatus.EXPIRED)
        original = enrollment.target_completion_date
        svc = self._svc(enrollment)

        out, error = await svc.reopen_enrollment(uuid4(), uuid4())

        assert error is None
        assert out.target_completion_date == original

    async def test_a_past_deadline_is_rejected(self):
        # Reopening onto a date already gone would expire again immediately.
        enrollment = _enrollment(status=EnrollmentStatus.EXPIRED)
        svc = self._svc(enrollment)

        out, error = await svc.reopen_enrollment(
            uuid4(), uuid4(), target_completion_date=date.today() - timedelta(days=1)
        )

        assert out is None
        assert "must be in the future" in error

    async def test_only_an_expired_enrollment_can_be_reopened(self):
        enrollment = _enrollment(status=EnrollmentStatus.WITHDRAWN)
        svc = self._svc(enrollment)

        out, error = await svc.reopen_enrollment(uuid4(), uuid4())

        assert out is None
        assert "expired" in error

    async def test_a_missing_enrollment_reports_not_found(self):
        svc = TrainingProgramService(RecordingSession())
        svc.get_enrollment_by_id = AsyncMock(return_value=None)

        out, error = await svc.reopen_enrollment(uuid4(), uuid4())

        assert out is None
        assert error == "Enrollment not found"


class TestRunDueExpirations:
    async def test_the_sweep_expires_every_overdue_enrollment(self, monkeypatch):
        overdue = [_enrollment(), _enrollment()]
        result = MagicMock()
        result.scalars.return_value.all.return_value = overdue
        svc = TrainingProgramService(RecordingSession([result]))
        monkeypatch.setattr(svc, "_notify_enrollment_expired", AsyncMock())
        monkeypatch.setattr(
            svc,
            "_get_program_for_enrollment",
            AsyncMock(return_value=SimpleNamespace(id="prog-1", name="Recruit")),
        )

        count, error = await svc.run_due_expirations(uuid4())

        assert error is None
        assert count == 2
        assert all(e.status == EnrollmentStatus.EXPIRED for e in overdue)
