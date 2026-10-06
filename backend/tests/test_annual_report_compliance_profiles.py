"""
The annual compliance report grades members through their compliance profile.

``generate_annual_report`` used to grade every member against every
applicable requirement at the default 100% / 75% thresholds, while the
compliance matrix and ``compute_org_compliance_pct`` (the dashboard figure)
resolved each member's profile through ``ComplianceGrading.for_member``. A
department using profiles read one percentage on the dashboard and another in
the report it files for the year (CMP4-3). The report now resolves members the
same way, so the three agree.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training as training_endpoints
from app.models.compliance_config import ComplianceConfig, ComplianceProfile
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
from app.services.training_compliance import compute_org_compliance_pct
from app.utils.org_timezone import resolve_org_today

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _member(db, org, name: str, membership_type: str) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=_uid(),
        organization_id=org.id,
        username=f"{name.lower()}-{handle}",
        email=f"{handle}@profile-report.test",
        first_name=name,
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        membership_type=membership_type,
    )
    db.add(user)
    await db.flush()
    await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == user.id)
        .execution_options(populate_existing=True)
    )
    return user


async def _hours_req(db, org, name: str, hours: float) -> TrainingRequirement:
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        name=name,
        requirement_type=RequirementType.HOURS,
        required_hours=hours,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        active=True,
        applies_to_all=True,
    )
    db.add(req)
    await db.flush()
    return req


async def _profile_department(db):
    """Two requirements; a recruit profile requires only the first.

    Every member logs eight hours, which meets "Basic Hours" and not
    "Full Hours". Graded against both, everybody is at 50%; graded through
    their profile, a recruit is at 100%, and a reserve member's 50% clears
    the reserve profile's lowered bar.
    """
    org = Organization(
        id=_uid(),
        name="Profile Report Department",
        slug=f"profile-report-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    today = await resolve_org_today(db, org.id)

    basic = await _hours_req(db, org, "Basic Hours", 8.0)
    full = await _hours_req(db, org, "Full Hours", 200.0)

    recruit = await _member(db, org, "Recruit", "probationary")
    reserve = await _member(db, org, "Reserve", "reserve")
    regular = await _member(db, org, "Regular", "active")

    config = ComplianceConfig(
        id=_uid(),
        organization_id=org.id,
        threshold_type="percentage",
        compliant_threshold=100.0,
        at_risk_threshold=40.0,
        include_current_month=True,
    )
    db.add(config)
    await db.flush()
    db.add_all(
        [
            ComplianceProfile(
                id=_uid(),
                config_id=config.id,
                name="Recruits",
                membership_types=["probationary"],
                required_requirement_ids=[basic.id],
                is_active=True,
                priority=10,
            ),
            ComplianceProfile(
                id=_uid(),
                config_id=config.id,
                name="Reserves",
                membership_types=["reserve"],
                compliant_threshold_override=50.0,
                is_active=True,
                priority=5,
            ),
        ]
    )
    db.add_all(
        [
            TrainingRecord(
                id=_uid(),
                organization_id=org.id,
                user_id=member.id,
                course_name="Company Drill",
                training_type=TrainingType.CONTINUING_EDUCATION,
                status=TrainingStatus.COMPLETED,
                completion_date=today,
                hours_completed=8.0,
            )
            for member in (recruit, reserve, regular)
        ]
    )
    await db.flush()
    return org, today, basic, full, recruit, reserve, regular


class TestAnnualReportAppliesComplianceProfiles:
    async def test_profile_narrows_requirements_and_overrides_thresholds(
        self, db_session
    ):
        org, today, _, _, recruit, reserve, regular = await _profile_department(
            db_session
        )

        report = await AnnualComplianceReportService(db_session).generate_annual_report(
            org.id, year=today.year
        )
        rows = {row["user_id"]: row for row in report["member_compliance"]}

        # The recruit profile requires only Basic Hours, which they met.
        assert rows[recruit.id]["requirements_total"] == 1
        assert rows[recruit.id]["requirements_met"] == 1
        assert rows[recruit.id]["status"] == "compliant"
        # The reserve profile keeps both requirements but lowers the bar to
        # 50%, which their 1 of 2 clears.
        assert rows[reserve.id]["requirements_total"] == 2
        assert rows[reserve.id]["compliance_pct"] == 50.0
        assert rows[reserve.id]["status"] == "compliant"
        # No profile: the org-wide 100% bar, at risk above 40%.
        assert rows[regular.id]["requirements_total"] == 2
        assert rows[regular.id]["status"] == "at_risk"

        summary = report["executive_summary"]
        assert summary["fully_compliant_members"] == 2
        assert summary["at_risk_members"] == 1
        assert summary["overall_compliance_pct"] == 66.7

    async def test_requirement_analysis_counts_only_members_it_grades(self, db_session):
        org, today, basic, full, *_ = await _profile_department(db_session)

        report = await AnnualComplianceReportService(db_session).generate_annual_report(
            org.id, year=today.year
        )
        analysis = {
            row["requirement_id"]: row for row in report["requirement_analysis"]
        }

        assert analysis[basic.id]["members_total"] == 3
        assert analysis[basic.id]["members_compliant"] == 3
        # The recruit profile does not require Full Hours, so it is not held
        # against the recruit here either.
        assert analysis[full.id]["members_total"] == 2
        assert analysis[full.id]["members_compliant"] == 0

    async def test_report_matrix_and_dashboard_percentage_agree(self, db_session):
        org, today, *_ = await _profile_department(db_session)
        caller = User(id=_uid(), organization_id=org.id)

        report = await AnnualComplianceReportService(db_session).generate_annual_report(
            org.id, year=today.year
        )
        matrix = await training_endpoints.get_compliance_matrix(
            db=db_session, current_user=caller
        )
        pct = await compute_org_compliance_pct(db_session, org.id, today)

        assert report["executive_summary"]["overall_compliance_pct"] == pct
        by_member = {row["user_id"]: row for row in report["member_compliance"]}
        for row in matrix["members"]:
            reported = by_member[str(row["user_id"])]
            assert reported["status"] == row["standing"]
            assert reported["compliance_pct"] == row["completion_pct"]
            assert reported["requirements_met"] == row["requirements_met"]
            assert reported["requirements_total"] == row["requirements_total"]
