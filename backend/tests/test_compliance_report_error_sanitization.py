"""`ComplianceReport.error_message` must never carry raw exception text.

`ComplianceReportService.generate_report`'s outer `except Exception as e:`
handler wrote `report.error_message = str(e)` directly -- the unfiltered
exception message, with no sanitization at all (the same column had both the
right and the wrong pattern in this one file: `_record_failed_report` already
used `safe_error_detail()` for a scheduled run that never got a row to begin
with, while `generate_report`'s own handler -- for the far more common path,
a manual or scheduled generation that gets partway through -- did not).

`ComplianceReportSummary`/`ComplianceReportDetail` serialize `error_message`
straight back to the client on `GET /compliance/reports` and
`GET /compliance/reports/{report_id}` (gated behind `training.manage` /
`reports.view`). CLAUDE.md's `safe_error_detail()` pattern -- and this
project's standing rule, exercised by SEC13-1/SEC14-1/SEC16-1 against the same
shape on other error columns -- is that an already-authenticated,
already-permitted caller still must not receive raw driver/SQL/path text.

A duplicate-key `IntegrityError`, a transient driver error, or any other
exception raised while building or storing a report's data would otherwise
persist its full driver/SQL/path text onto the row and hand it back on the
next list or detail call.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.models.compliance_config import ComplianceReport
from app.models.user import Organization
from app.services.compliance_config_service import ComplianceReportService

pytestmark = pytest.mark.integration


async def _org(db_session) -> str:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Compliance Report Error FD",
        slug=f"compliance-err-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.commit()
    return str(org.id)


class TestComplianceReportGenerationFailureDoesNotPersistRawExceptionText:
    async def test_a_generation_failure_s_error_message_is_sanitized(self, db_session):
        org_id = await _org(db_session)
        service = ComplianceReportService(db_session)

        raw = (
            '(pymysql.err.OperationalError) (1054, "Unknown column '
            "'compliance_reports.bogus' in 'field list'\") [SQL: SELECT "
            "compliance_reports.bogus FROM compliance_reports] File "
            '"/app/services/training_compliance.py", line 88, in '
            "generate_monthly_report"
        )

        with patch(
            "app.services.compliance_config_service.AnnualComplianceReportService."
            "generate_monthly_report",
            new=AsyncMock(side_effect=RuntimeError(raw)),
        ):
            with pytest.raises(RuntimeError):
                await service.generate_report(
                    organization_id=org_id,
                    report_type="monthly",
                    year=2026,
                    month=3,
                )

        result = await db_session.execute(
            ComplianceReport.__table__.select().where(
                ComplianceReport.organization_id == org_id
            )
        )
        report = result.fetchone()
        assert report is not None, "no ComplianceReport row was stored"
        assert report.status == "failed"

        msg = report.error_message or ""
        assert msg, "error_message was left empty rather than sanitized"
        for leak in (
            "pymysql",
            "OperationalError",
            "SELECT compliance_reports",
            "training_compliance.py",
        ):
            assert leak not in msg, (
                f"raw exception text ({leak!r}) reached "
                "ComplianceReport.error_message, which GET /compliance/reports "
                "and GET /compliance/reports/{report_id} serialize straight "
                "back to the client"
            )
