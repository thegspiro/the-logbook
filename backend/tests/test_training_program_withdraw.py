"""
Tests for self-service enrollment withdrawal:
  * a member may withdraw their own enrollment
  * an officer (can_manage) may withdraw anyone's
  * another member without manage is denied
  * missing enrollment errors; already-withdrawn is idempotent
DB mocked, except the response-shape class at the bottom, which needs real
relationship loading and is marked ``integration``.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text

from app.models.training import EnrollmentStatus, ProgramEnrollment, TrainingProgram
from app.schemas.training_program import ProgramEnrollmentResponse
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

        assert error is None
        assert result is enr
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

        assert error is None
        assert result is enr
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

    @pytest.mark.parametrize(
        "enrollment_status",
        [
            EnrollmentStatus.COMPLETED,
            EnrollmentStatus.EXPIRED,
            EnrollmentStatus.FAILED,
        ],
    )
    async def test_member_cannot_withdraw_finalized_enrollment(self, enrollment_status):
        user = uuid4()
        enr = _enrollment(user, status=enrollment_status)
        db = RecordingSession([_one(enr)])
        svc = TrainingProgramService(db)

        result, error = await svc.withdraw_enrollment(
            enrollment_id=uuid4(),
            organization_id=uuid4(),
            acting_user_id=user,
            can_manage=False,
        )

        assert result is None
        assert error == "Not authorized to withdraw a finalized enrollment"
        assert enr.status == enrollment_status
        db.commit.assert_not_awaited()

    async def test_officer_can_withdraw_finalized_enrollment(self):
        enr = _enrollment(uuid4(), status=EnrollmentStatus.COMPLETED)
        db = RecordingSession([_one(enr)])
        svc = TrainingProgramService(db)

        result, error = await svc.withdraw_enrollment(
            enrollment_id=uuid4(),
            organization_id=uuid4(),
            acting_user_id=uuid4(),
            can_manage=True,
        )

        assert error is None
        assert result is enr
        assert enr.status == EnrollmentStatus.WITHDRAWN
        db.commit.assert_awaited_once()

    async def test_missing_enrollment_errors(self):
        db = RecordingSession([_one(None)])
        svc = TrainingProgramService(db)

        result, error = await svc.withdraw_enrollment(
            enrollment_id=uuid4(),
            organization_id=uuid4(),
            acting_user_id=uuid4(),
            can_manage=True,
        )

        assert result is None
        assert error == "Enrollment not found"

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

        assert error is None
        assert result is enr
        # No second write when already withdrawn.
        db.commit.assert_not_awaited()


@pytest.mark.integration
class TestWithdrawnEnrollmentSerializes:
    """The withdrawal response has to survive FastAPI's response validation.

    ``ProgramEnrollmentResponse`` carries the nested programme, so Pydantic
    reads ``enrollment.program`` after the endpoint's last await. The withdraw
    query does not eager-load it, so an unloaded relationship there is a lazy
    load outside greenlet_spawn: the member's withdrawal commits and they still
    get a 500 (MissingGreenlet) telling them it failed.
    """

    @staticmethod
    async def _fixture_rows(db_session):
        """One organization, member, programme and active enrollment."""
        org_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "name": "Withdraw Dept", "slug": f"wd-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Dana', 'Reyes', :em, 'x', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"dreyes-{user_id[:8]}",
                "em": f"dreyes-{user_id[:8]}@test.com",
            },
        )

        # Built through the ORM so the model's column defaults apply — the
        # response schema types several of them as non-optional.
        program = TrainingProgram(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            name="Probationary Firefighter Pipeline",
            active=True,
        )
        enrollment = ProgramEnrollment(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            user_id=user_id,
            program_id=program.id,
            enrolled_at=datetime.now(timezone.utc),
            progress_percentage=0.0,
            status=EnrollmentStatus.ACTIVE,
        )
        db_session.add_all([program, enrollment])
        await db_session.flush()
        ids = (UUID(org_id), UUID(user_id), UUID(enrollment.id), program.name)

        # A many-to-one lazy load is answered from the identity map without any
        # SQL, which would mask exactly the failure under test. Evict the setup
        # objects so the service starts from the same blank session a request
        # does.
        db_session.expunge_all()
        return ids

    async def test_withdrawal_returns_a_response_carrying_the_programme(
        self, db_session
    ):
        org_id, user_id, enrollment_id, program_name = await self._fixture_rows(
            db_session
        )
        service = TrainingProgramService(db_session)

        enrollment, error = await service.withdraw_enrollment(
            enrollment_id=enrollment_id,
            organization_id=org_id,
            acting_user_id=user_id,
            can_manage=False,
            reason="Stepped down to EMT",
        )

        assert error is None
        assert enrollment.status == EnrollmentStatus.WITHDRAWN
        assert "program" not in sa_inspect(enrollment).unloaded

        body = ProgramEnrollmentResponse.model_validate(enrollment)
        assert body.program is not None
        assert body.program.name == program_name

    async def test_repeat_withdrawal_also_carries_the_programme(self, db_session):
        """The already-withdrawn early return serializes through the same model."""
        org_id, user_id, enrollment_id, program_name = await self._fixture_rows(
            db_session
        )
        service = TrainingProgramService(db_session)

        await service.withdraw_enrollment(
            enrollment_id=enrollment_id,
            organization_id=org_id,
            acting_user_id=user_id,
            can_manage=False,
        )
        db_session.expunge_all()
        enrollment, error = await service.withdraw_enrollment(
            enrollment_id=enrollment_id,
            organization_id=org_id,
            acting_user_id=user_id,
            can_manage=False,
        )

        assert error is None
        assert "program" not in sa_inspect(enrollment).unloaded
        assert (
            ProgramEnrollmentResponse.model_validate(enrollment).program.name
            == program_name
        )
