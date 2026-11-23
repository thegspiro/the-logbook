"""
The annual report's record-completeness block names what it counts.

``record_completeness.records_with_certification`` was filled from the
``course_name`` field check, so it counted records that name a course, not
records carrying a certification (CS-9). No screen reads it; API and JSON
consumers saw the wrong label. The key is now ``records_with_course_name``.
Certification numbers are not counted: nothing asked for that figure.
"""

import uuid
from datetime import date

import pytest

from app.models.training import TrainingRecord, TrainingStatus, TrainingType
from app.models.user import Organization, User, UserStatus
from app.services.compliance_officer_service import AnnualComplianceReportService

pytestmark = [pytest.mark.integration]

YEAR = 2025


def _uid() -> str:
    return str(uuid.uuid4())


async def test_the_course_name_count_is_named_for_course_names(db_session):
    org = Organization(
        id=_uid(),
        name="Completeness Department",
        slug=f"completeness-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    handle = uuid.uuid4().hex[:10]
    member = User(
        id=_uid(),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@completeness.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(member)
    await db_session.flush()
    # Two records name a course; only one carries a certification number.
    for certification_number in ("EMT-1234", None):
        db_session.add(
            TrainingRecord(
                id=_uid(),
                organization_id=org.id,
                user_id=member.id,
                course_name="Company Drill",
                training_type=TrainingType.CONTINUING_EDUCATION,
                status=TrainingStatus.COMPLETED,
                completion_date=date(YEAR, 3, 1),
                hours_completed=2.0,
                certification_number=certification_number,
            )
        )
    await db_session.flush()

    report = await AnnualComplianceReportService(db_session).generate_annual_report(
        org.id, year=YEAR
    )
    block = report["record_completeness"]

    assert block["total_records"] == 2
    assert block["records_with_course_name"] == 2
    assert "records_with_certification" not in block
