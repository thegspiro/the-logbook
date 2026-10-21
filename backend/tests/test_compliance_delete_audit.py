"""Deleting a compliance profile or a stored compliance report is audited.

A profile decides which requirements grade a group of members, and a stored
report is the department's record of compliance for a period. Removing either
used to leave no trace, so nobody could later say who changed the grading or
discarded the record.
"""

import uuid

import pytest
from sqlalchemy import select

from app.api.v1.endpoints import compliance_config as compliance_endpoints
from app.models.audit import AuditLog, SeverityLevel
from app.models.compliance_config import (
    ComplianceConfig,
    ComplianceProfile,
    ComplianceReport,
)
from app.models.user import Organization, User, UserStatus

pytestmark = pytest.mark.integration


def _uid():
    return str(uuid.uuid4())


async def _department(db):
    org = Organization(
        id=_uid(),
        name="Compliance Audit Department",
        slug=f"comp-audit-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    handle = uuid.uuid4().hex[:10]
    officer = User(
        id=_uid(),
        organization_id=org.id,
        username=f"officer-{handle}",
        email=f"{handle}@comp-audit.test",
        first_name="Casey",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(officer)
    await db.flush()
    return org, officer


async def _audit_rows(db, event_type, key, value):
    rows = (
        (await db.execute(select(AuditLog).where(AuditLog.event_type == event_type)))
        .scalars()
        .all()
    )
    return [r for r in rows if (r.event_data or {}).get(key) == value]


class TestComplianceDeletesAreAudited:
    async def test_profile_delete_writes_an_audit_row(self, db_session):
        org, officer = await _department(db_session)
        config = ComplianceConfig(id=_uid(), organization_id=org.id)
        db_session.add(config)
        await db_session.flush()
        profile = ComplianceProfile(
            id=_uid(), config_id=config.id, name="Probationary Members"
        )
        db_session.add(profile)
        await db_session.flush()
        profile_id = profile.id

        await compliance_endpoints.delete_compliance_profile(
            profile_id=profile_id, db=db_session, current_user=officer
        )

        rows = await _audit_rows(
            db_session, "compliance_profile_deleted", "profile_id", profile_id
        )
        assert len(rows) == 1
        assert rows[0].event_data["profile_name"] == "Probationary Members"
        assert rows[0].user_id == officer.id
        assert rows[0].organization_id == org.id
        assert rows[0].severity == SeverityLevel.WARNING

    async def test_report_delete_writes_an_audit_row(self, db_session):
        org, officer = await _department(db_session)
        report = ComplianceReport(
            id=_uid(),
            organization_id=org.id,
            report_type="monthly",
            period_label="March 2026",
            period_year=2026,
            period_month=3,
        )
        db_session.add(report)
        await db_session.flush()
        report_id = report.id

        await compliance_endpoints.delete_compliance_report(
            report_id=report_id, db=db_session, current_user=officer
        )

        rows = await _audit_rows(
            db_session, "compliance_report_deleted", "report_id", report_id
        )
        assert len(rows) == 1
        assert rows[0].event_data["period_label"] == "March 2026"
        assert rows[0].user_id == officer.id
        assert rows[0].organization_id == org.id
