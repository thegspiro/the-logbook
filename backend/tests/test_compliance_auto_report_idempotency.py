"""A second run of the compliance auto-report task must not duplicate a report.

The task is daily and can also be triggered by hand, retried or run by a second
worker. Each run used to store and email another copy of the same period's
report; the check below is what makes the second run a no-op.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import func, select

from app.models.compliance_config import ComplianceConfig, ComplianceReport
from app.models.user import Organization, User, UserStatus
from app.services import scheduled_tasks as st
from app.services.compliance_config_service import ComplianceReportService

pytestmark = pytest.mark.integration


async def _org_with_config(db_session) -> str:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Auto Report Department",
        slug=f"auto-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    db_session.add(
        ComplianceConfig(
            organization_id=org.id,
            auto_report_frequency="monthly",
            report_day_of_month=15,
        )
    )
    await db_session.commit()
    return str(org.id)


async def _report(db_session, org_id, **overrides) -> ComplianceReport:
    values = dict(
        organization_id=org_id,
        report_type="monthly",
        period_label="February 2026",
        period_year=2026,
        period_month=2,
        status="completed",
        generated_by=None,
    )
    values.update(overrides)
    report = ComplianceReport(**values)
    db_session.add(report)
    await db_session.commit()
    return report


async def _count(db_session, org_id) -> int:
    return (
        await db_session.execute(
            select(func.count())
            .select_from(ComplianceReport)
            .where(ComplianceReport.organization_id == org_id)
        )
    ).scalar_one()


@pytest.fixture
def generated(monkeypatch):
    """Replaces generation with a recorder that stores a completed report."""
    calls: list[dict] = []

    async def fake_today(_db, _org_id):
        return date(2026, 3, 15)

    async def generate(self, *, organization_id, report_type, year, month=None, **_):
        calls.append({"org": organization_id, "type": report_type, "year": year})
        self.db.add(
            ComplianceReport(
                organization_id=organization_id,
                report_type=report_type,
                period_label=str(year),
                period_year=year,
                period_month=month,
                status="completed",
            )
        )
        await self.db.flush()

    monkeypatch.setattr("app.utils.org_timezone.resolve_org_today", fake_today)
    monkeypatch.setattr(ComplianceReportService, "generate_report", generate)
    return calls


async def test_a_second_run_the_same_day_adds_nothing(db_session, generated):
    org_id = await _org_with_config(db_session)

    first = await st.run_compliance_auto_reports(db_session)
    second = await st.run_compliance_auto_reports(db_session)

    ours = [c for c in generated if c["org"] == org_id]
    assert len(ours) == 1
    assert await _count(db_session, org_id) == 1
    assert first["total_generated"] >= 1
    assert not [d for d in second["details"] if d.get("org_id") == org_id]


async def test_a_manual_report_for_the_period_does_not_suppress_the_scheduled_one(
    db_session, generated
):
    org_id = await _org_with_config(db_session)
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"u-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@autoreport.org",
        first_name="Mina",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.commit()
    await _report(db_session, org_id, generated_by=user.id)

    await st.run_compliance_auto_reports(db_session)

    assert len([c for c in generated if c["org"] == org_id]) == 1


class TestAutoReportExists:
    async def test_a_completed_scheduled_report_counts(self, db_session):
        org_id = await _org_with_config(db_session)
        await _report(db_session, org_id)
        service = ComplianceReportService(db_session)

        assert await service.auto_report_exists(org_id, "monthly", 2026, 2)
        assert not await service.auto_report_exists(org_id, "monthly", 2026, 3)
        assert not await service.auto_report_exists(org_id, "monthly", 2025, 2)
        assert not await service.auto_report_exists(org_id, "yearly", 2026)

    async def test_a_failed_attempt_does_not_count(self, db_session):
        org_id = await _org_with_config(db_session)
        await _report(db_session, org_id, status="failed")

        assert not await ComplianceReportService(db_session).auto_report_exists(
            org_id, "monthly", 2026, 2
        )

    async def test_another_organizations_report_does_not_count(self, db_session):
        mine = await _org_with_config(db_session)
        theirs = await _org_with_config(db_session)
        await _report(db_session, theirs)

        assert not await ComplianceReportService(db_session).auto_report_exists(
            mine, "monthly", 2026, 2
        )
