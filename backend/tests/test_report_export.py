"""The Reports page downloads its PDF and CSV from the server.

The report is re-run under the same gates as Generate and Run, written as a
PDF on the report kit or a formula-safe CSV with the page's own columns, and
every download leaves an audit row naming the report and its parameters, not
its content. A refused download leaves none.
"""

import csv
import io
import re
import uuid
from datetime import date
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.prospect_privacy import get_hidden_prospect_ids
from app.api.v1.endpoints import reports as reports_endpoints
from app.core.database import get_db
from app.models.analytics import SavedReport
from app.models.audit import AuditLog
from app.models.user import User
from app.services.report_tables import export_spec
from app.utils.org_timezone import resolve_org_today
from app.utils.report_number import REPORT_NUMBER_PATTERN
from tests.minutes_support import _org, _user

pytestmark = [pytest.mark.integration]


def _client(db: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(reports_endpoints.router, prefix="/reports")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_hidden_prospect_ids] = lambda: set()
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def _audit_rows(db: AsyncSession, user: User) -> list[AuditLog]:
    result = await db.execute(
        select(AuditLog).where(
            AuditLog.event_type == "report_exported",
            AuditLog.user_id == str(user.id),
        )
    )
    return list(result.scalars().all())


async def _department(db: AsyncSession) -> str:
    return await _org(db, f"Rpt-{uuid.uuid4().hex[:6]}")


async def _export(db: AsyncSession, user: User, body: dict[str, Any]):
    async with _client(db, user) as client:
        return await client.post("/reports/export", json=body)


async def test_a_pdf_of_an_operational_report_is_audited(db_session: AsyncSession):
    org_id = await _department(db_session)
    officer = await _user(db_session, org_id, "Officer", ["reports.view"])

    response = await _export(
        db_session,
        officer,
        {
            "format": "pdf",
            "report_type": "event_attendance",
            "start_date": "2026-01-01",
            "end_date": "2026-06-30",
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    today = await resolve_org_today(db_session, org_id)
    assert response.headers["content-disposition"] == (
        f'attachment; filename="event_attendance_{today.isoformat()}.pdf"'
    )
    reader = PdfReader(io.BytesIO(response.content))
    text = " ".join(page.extract_text() for page in reader.pages)
    assert "EVENT ATTENDANCE" in text
    assert "Period: 2026-01-01 to 2026-06-30" in text
    assert "Page 1 of" in text
    assert "Officer Tester" in text
    rows = await _audit_rows(db_session, officer)
    assert [r.event_data for r in rows] == [
        {
            "report_type": "event_attendance",
            "format": "pdf",
            "saved_report_id": None,
            "start_date": "2026-01-01",
            "end_date": "2026-06-30",
            "filter_keys": [],
            "row_count": 0,
        }
    ]
    assert rows[0].organization_id == org_id


async def test_a_csv_of_the_roster_has_the_pages_columns_and_is_formula_safe(
    db_session: AsyncSession,
):
    org_id = await _department(db_session)
    officer = await _user(
        db_session, org_id, "Officer", ["reports.view", "members.view"]
    )
    await _user(db_session, org_id, "=HYPERLINK(1)", [])

    response = await _export(
        db_session, officer, {"format": "csv", "report_type": "member_roster"}
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    table = list(csv.reader(io.StringIO(response.content.decode("utf-8"))))
    assert table[0] == [c["header"] for c in export_spec()["member_roster"]["columns"]]
    first_names = [row[0] for row in table[1:]]
    assert "'=HYPERLINK(1)" in first_names
    assert "=HYPERLINK(1)" not in first_names
    rows = await _audit_rows(db_session, officer)
    assert [(r.event_data["format"], r.event_data["row_count"]) for r in rows] == [
        ("csv", len(table) - 1)
    ]


async def test_a_member_data_report_needs_its_source_permission(
    db_session: AsyncSession,
):
    org_id = await _department(db_session)
    viewer = await _user(db_session, org_id, "Viewer", ["reports.view"])

    response = await _export(
        db_session, viewer, {"format": "pdf", "report_type": "member_roster"}
    )

    assert response.status_code == 403
    assert await _audit_rows(db_session, viewer) == []


async def test_an_unknown_report_is_refused_without_an_audit_row(
    db_session: AsyncSession,
):
    org_id = await _department(db_session)
    officer = await _user(db_session, org_id, "Officer", ["reports.view"])

    response = await _export(
        db_session, officer, {"format": "csv", "report_type": "payroll"}
    )

    assert response.status_code == 400
    assert await _audit_rows(db_session, officer) == []


async def test_a_request_must_name_one_report(db_session: AsyncSession):
    org_id = await _department(db_session)
    officer = await _user(db_session, org_id, "Officer", ["reports.view"])

    response = await _export(
        db_session,
        officer,
        {
            "format": "pdf",
            "report_type": "event_attendance",
            "saved_report_id": str(uuid.uuid4()),
        },
    )

    assert response.status_code == 422


async def _saved(db: AsyncSession, org_id: str, **values: Any) -> SavedReport:
    report = SavedReport(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=values.pop("name", "Q1 Drills"),
        report_type=values.pop("report_type", "event_attendance"),
        filters=values.pop("filters", {}),
        **values,
    )
    db.add(report)
    await db.flush()
    return report


async def test_a_saved_report_exports_under_its_name_with_its_saved_dates(
    db_session: AsyncSession,
):
    org_id = await _department(db_session)
    officer = await _user(db_session, org_id, "Officer", ["reports.view"])
    saved = await _saved(
        db_session,
        org_id,
        name="Q1 Drills",
        filters={"start_date": "2026-01-01", "end_date": "2026-03-31"},
    )

    response = await _export(
        db_session, officer, {"format": "pdf", "saved_report_id": saved.id}
    )

    assert response.status_code == 200, response.text
    today = await resolve_org_today(db_session, org_id)
    assert response.headers["content-disposition"] == (
        f'attachment; filename="q1_drills_{today.isoformat()}.pdf"'
    )
    text = " ".join(
        page.extract_text() for page in PdfReader(io.BytesIO(response.content)).pages
    )
    assert "Report: Event Attendance" in text
    assert "Period: 2026-01-01 to 2026-03-31" in text
    rows = await _audit_rows(db_session, officer)
    assert rows[0].event_data["saved_report_id"] == saved.id
    assert rows[0].event_data["start_date"] == "2026-01-01"
    assert rows[0].event_data["filter_keys"] == ["end_date", "start_date"]


async def test_a_saved_report_with_a_relative_period_resolves_it_as_run_does(
    db_session: AsyncSession,
):
    org_id = await _department(db_session)
    officer = await _user(db_session, org_id, "Officer", ["reports.view"])
    saved = await _saved(db_session, org_id, filters={"period": "year_to_date"})

    response = await _export(
        db_session, officer, {"format": "csv", "saved_report_id": saved.id}
    )

    assert response.status_code == 200, response.text
    today = await resolve_org_today(db_session, org_id)
    rows = await _audit_rows(db_session, officer)
    assert rows[0].event_data["start_date"] == date(today.year, 1, 1).isoformat()


async def test_another_departments_saved_report_is_not_found(
    db_session: AsyncSession,
):
    org_id = await _department(db_session)
    other_org = await _department(db_session)
    officer = await _user(db_session, org_id, "Officer", ["reports.view"])
    theirs = await _saved(db_session, other_org)

    response = await _export(
        db_session, officer, {"format": "pdf", "saved_report_id": theirs.id}
    )

    assert response.status_code == 404
    assert await _audit_rows(db_session, officer) == []


async def test_a_saved_report_name_in_any_script_is_encoded_in_the_header(
    db_session: AsyncSession,
):
    org_id = await _department(db_session)
    officer = await _user(db_session, org_id, "Officer", ["reports.view"])
    saved = await _saved(db_session, org_id, name="Учения")

    response = await _export(
        db_session, officer, {"format": "csv", "saved_report_id": saved.id}
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-disposition"].startswith(
        "attachment; filename*=utf-8''"
    )


async def test_a_pdf_names_its_preparer_by_rank_and_its_number_is_audited(
    db_session: AsyncSession,
):
    """The page names who prepared the report by the department's own title
    for their rank, and the report number it prints is the one in the audit
    row, so a printed page traces back to its export (2026-11-21)."""
    from app.models.operational_rank import OperationalRank

    org_id = await _department(db_session)
    officer = await _user(db_session, org_id, "Officer", ["reports.view"])
    officer.rank = "captain"
    db_session.add(
        OperationalRank(
            organization_id=org_id, rank_code="captain", display_name="Captain"
        )
    )
    await db_session.flush()

    response = await _export(
        db_session, officer, {"format": "pdf", "report_type": "event_attendance"}
    )

    assert response.status_code == 200, response.text
    text = " ".join(
        page.extract_text() for page in PdfReader(io.BytesIO(response.content)).pages
    )
    assert "Prepared by: Officer Tester, Captain" in text
    printed = re.search(REPORT_NUMBER_PATTERN, text)
    assert printed is not None, text
    rows = await _audit_rows(db_session, officer)
    assert rows[0].event_data["report_number"] == printed.group(0)


async def test_a_csv_carries_no_report_number(db_session: AsyncSession):
    org_id = await _department(db_session)
    officer = await _user(db_session, org_id, "Officer", ["reports.view"])

    response = await _export(
        db_session, officer, {"format": "csv", "report_type": "event_attendance"}
    )

    assert response.status_code == 200, response.text
    rows = await _audit_rows(db_session, officer)
    assert rows[0].event_data["report_number"] is None
