"""
Tests for self-service enrollment withdrawal:
  * a member may withdraw their own enrollment
  * an officer (can_manage) may withdraw anyone's
  * another member without manage is denied
  * missing enrollment errors; already-withdrawn is idempotent
DB mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import EnrollmentStatus
from app.services.training_program_service import TrainingProgramService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _enrollment(user_id, **over):
    base = dict(
        id=str(uuid4()),
        user_id=str(user_id),
        program_id=str(uuid4()),
        status=EnrollmentStatus.ACTIVE,
        withdrawn_at=None,
        withdrawal_reason=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


class TestWithdrawEnrollment:
    async def test_member_withdraws_own(self):
        user = uuid4()
        enr = _enrollment(user)
        db = RecordingSession([_one(enr)])
        svc = TrainingProgramService(db)

        result, error = await svc.withdraw_enrollment(
            enrollment_id=uuid4(),
            organization_id=uuid4(),
            acting_user_id=user,
            can_manage=False,
            reason="Stepped down to EMT",
        )

        assert error is None and result is enr
        assert enr.status == EnrollmentStatus.WITHDRAWN
        assert enr.withdrawn_at is not None
        assert enr.withdrawal_reason == "Stepped down to EMT"
        db.commit.assert_awaited_once()

    async def test_officer_withdraws_other(self):
        enr = _enrollment(uuid4())  # some other member
        db = RecordingSession([_one(enr)])
        svc = TrainingProgramService(db)

        result, error = await svc.withdraw_enrollment(
            enrollment_id=uuid4(),
            organization_id=uuid4(),
            acting_user_id=uuid4(),  # not the enrolled member
            can_manage=True,
        )

        assert error is None and result is enr
        assert enr.status == EnrollmentStatus.WITHDRAWN

    async def test_other_member_denied(self):
        enr = _enrollment(uuid4())
        db = RecordingSession([_one(enr)])
        svc = TrainingProgramService(db)

        result, error = await svc.withdraw_enrollment(
            enrollment_id=uuid4(),
            organization_id=uuid4(),
            acting_user_id=uuid4(),  # different member, no manage
            can_manage=False,
        )

        assert result is None
        assert error == "Not authorized to withdraw this enrollment"
        assert enr.status == EnrollmentStatus.ACTIVE
        db.commit.assert_not_awaited()

    async def test_missing_enrollment_errors(self):
        db = RecordingSession([_one(None)])
        svc = TrainingProgramService(db)

        result, error = await svc.withdraw_enrollment(
            enrollment_id=uuid4(),
            organization_id=uuid4(),
            acting_user_id=uuid4(),
            can_manage=True,
        )

        assert result is None and error == "Enrollment not found"

    async def test_already_withdrawn_is_idempotent(self):
        user = uuid4()
        enr = _enrollment(user, status=EnrollmentStatus.WITHDRAWN)
        db = RecordingSession([_one(enr)])
        svc = TrainingProgramService(db)

        result, error = await svc.withdraw_enrollment(
            enrollment_id=uuid4(),
            organization_id=uuid4(),
            acting_user_id=user,
            can_manage=False,
        )

        assert error is None and result is enr
        # No second write when already withdrawn.
        db.commit.assert_not_awaited()
