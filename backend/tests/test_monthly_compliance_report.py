"""
A monthly compliance report covers its month (CS-9).

It used to be the annual report relabelled: a March report showed the whole
year's hours, and graded members on records completed after March. Now its
activity figures cover the month, and standing is the one the compliance
screen would have shown on the month's last day, counting only records
completed by then.
"""

import uuid
from datetime import date

import pytest

from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.compliance_officer_service import AnnualComplianceReportService

pytestmark = [pytest.mark.integration]

# A past year, so no month of it is still in progress.
YEAR = 2025


async def _seed(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Monthly Report Department",
        slug=f"monthly-report-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    handle = uuid.uuid4().hex[:10]
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@monthly-report.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        membership_type="active",
    )
    db_session.add(member)
    await db_session.flush()
    db_session.add(
        TrainingRequirement(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Annual Continuing Education",
            requirement_type=RequirementType.HOURS,
            required_hours=10.0,
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            year=YEAR,
            active=True,
            applies_to_all=True,
        )
    )
    for completed, hours in ((date(YEAR, 2, 10), 6.0), (date(YEAR, 4, 10), 6.0)):
        db_session.add(
            TrainingRecord(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                user_id=member.id,
                course_name="Continuing Education",
                training_type=TrainingType.CONTINUING_EDUCATION,
                status=TrainingStatus.COMPLETED,
                completion_date=completed,
                hours_completed=hours,
            )
        )
    await db_session.flush()
    return org


def _only_member(report):
    (member,) = report["member_compliance"]
    return member


async def test_a_month_with_no_training_reports_none(db_session):
    org = await _seed(db_session)

    report = await AnnualComplianceReportService(db_session).generate_monthly_report(
        org.id, YEAR, 3
    )

    assert report["executive_summary"]["total_training_hours"] == 0
    assert report["period_start"] == f"{YEAR}-03-01"
    assert report["period_end"] == f"{YEAR}-03-31"
    assert report["as_of"] == f"{YEAR}-03-31"
    # Six of ten hours by the end of March; April's six do not count yet.
    assert _only_member(report)["requirements_met"] == 0


async def test_standing_at_the_end_of_a_later_month_counts_the_year_so_far(
    db_session,
):
    org = await _seed(db_session)

    report = await AnnualComplianceReportService(db_session).generate_monthly_report(
        org.id, YEAR, 4
    )

    assert report["executive_summary"]["total_training_hours"] == 6.0
    assert _only_member(report)["requirements_met"] == 1
    assert report["report_type"] == "monthly_compliance"
    assert report["month"] == 4


async def test_the_annual_report_still_covers_the_year(db_session):
    org = await _seed(db_session)

    report = await AnnualComplianceReportService(db_session).generate_annual_report(
        org.id, YEAR
    )

    assert report["executive_summary"]["total_training_hours"] == 12.0
    assert report["report_type"] == "annual_compliance"
