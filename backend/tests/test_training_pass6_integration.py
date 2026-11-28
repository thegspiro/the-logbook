"""Training (app-review B18 pass 6).

- A requirement period whose day the month does not have (June 31), or an
  unset end day in a leap year, no longer crashes grading for the whole
  department; the day is held to the month's length.
- A certificate is in force through its expiration day on the member's
  stats card, as the compliance grader reads it.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
)
from app.models.user import Organization, User, UserStatus
from app.services.training_compliance import (
    _get_custom_annual_window,
    compute_org_compliance_tally,
)
from app.services.training_service import TrainingService
from app.utils.org_timezone import resolve_org_today


async def _org(db):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Pass6 Training",
        slug=f"tr6-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={},
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org):
    tag = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{tag}",
        email=f"{tag}@tr6.test",
        first_name="T",
        last_name="M",
        password_hash="x",
        status=UserStatus.ACTIVE,
        membership_type="active",
    )
    db.add(user)
    await db.flush()
    await db.execute(
        select(User).options(selectinload(User.positions)).where(User.id == user.id)
    )
    return user


async def _hours_requirement(db, org, **period):
    requirement = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        active=True,
        applies_to_all=True,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        name="Seasonal hours",
        requirement_type=RequirementType.HOURS,
        required_hours=10,
        frequency=RequirementFrequency.ANNUAL,
        **period,
    )
    db.add(requirement)
    await db.flush()
    return requirement


@pytest.mark.unit
class TestPeriodDays:
    def test_a_day_the_month_lacks_is_held_to_its_last(self):
        requirement = type(
            "Req",
            (),
            {
                "period_start_month": 3,
                "period_start_day": 1,
                "period_end_month": 6,
                "period_end_day": 31,
                "year": None,
            },
        )()

        window = _get_custom_annual_window(requirement, date(2026, 11, 26))

        assert window == (date(2026, 3, 1), date(2026, 6, 30))

    def test_an_unset_end_day_is_the_month_end_of_the_window_year(self):
        requirement = type(
            "Req",
            (),
            {
                "period_start_month": 11,
                "period_start_day": 1,
                "period_end_month": 2,
                "period_end_day": None,
                "year": None,
            },
        )()

        # Summer 2027: the window that ended in February 2027 is extended
        # through the gap; next February (2028) has a 29th.
        assert _get_custom_annual_window(requirement, date(2028, 1, 15)) == (
            date(2027, 11, 1),
            date(2028, 2, 29),
        )
        assert _get_custom_annual_window(requirement, date(2028, 6, 1)) == (
            date(2027, 11, 1),
            date(2028, 10, 31),
        )


@pytest.mark.integration
class TestDepartmentGrading:
    async def test_june_31_does_not_take_the_department_down(self, db_session):
        org = await _org(db_session)
        await _member(db_session, org)
        await _hours_requirement(
            db_session,
            org,
            period_start_month=3,
            period_start_day=1,
            period_end_month=6,
            period_end_day=31,
        )

        tally = await compute_org_compliance_tally(
            db_session, org.id, today=date(2026, 11, 26)
        )

        assert tally.graded == 1

    async def test_a_leap_year_winter_window_does_not_either(self, db_session):
        org = await _org(db_session)
        await _member(db_session, org)
        await _hours_requirement(
            db_session,
            org,
            period_start_month=11,
            period_start_day=1,
            period_end_month=2,
            period_end_day=None,
        )

        tally = await compute_org_compliance_tally(
            db_session, org.id, today=date(2028, 6, 1)
        )

        assert tally.graded == 1


@pytest.mark.integration
class TestCertificateOnItsExpiryDay:
    async def test_is_active_not_expired(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        today = await resolve_org_today(db_session, org.id)
        db_session.add(
            TrainingRecord(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                user_id=member.id,
                course_name="CPR",
                training_type="certification",
                status=TrainingStatus.COMPLETED,
                completion_date=date(2024, 1, 1),
                expiration_date=today,
                hours_completed=4,
                certification_number="CPR-1",
            )
        )
        await db_session.flush()

        stats = await TrainingService(db_session).get_user_training_stats(
            member.id, org.id
        )

        assert stats.expired == 0
        assert stats.active_certifications == 1
        assert stats.expiring_soon == 1
