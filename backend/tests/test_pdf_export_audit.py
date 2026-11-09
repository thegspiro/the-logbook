"""Exports of member data leave an audit row behind.

Training reports (including the all-member records bundle), a member's own
training record, equipment-check reports and the inventory impact plan all
carry names, contact details or certification numbers. Each download is a
disclosure the audit trail has to show: who, which report, which parameters
— and never the report's content.
"""

import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import equipment_check as equipment_endpoints
from app.api.v1.endpoints import inventory as inventory_endpoints
from app.api.v1.endpoints import training_enhancements as training_endpoints
from app.api.v1.endpoints import training_module_config as config_endpoints
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.user import User
from app.services.training_module_config_service import TrainingModuleConfigService
from tests.minutes_support import _org, _user

pytestmark = [pytest.mark.integration]


def _client(db: AsyncSession, user: User, router: Any, prefix: str) -> AsyncClient:
    app = FastAPI()
    app.include_router(router, prefix=prefix)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def _audit_rows(db: AsyncSession, event_type: str, user: User) -> list[AuditLog]:
    result = await db.execute(
        select(AuditLog).where(
            AuditLog.event_type == event_type,
            AuditLog.user_id == str(user.id),
        )
    )
    return list(result.scalars().all())


def _assert_attachment(response: Any, filename: str) -> None:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert (
        response.headers["content-disposition"] == f'attachment; filename="{filename}"'
    )


@pytest.mark.parametrize("report_type", ["compliance", "member_records"])
async def test_training_report_pdf_export_is_audited(
    db_session: AsyncSession, report_type: str
):
    org_id = await _org(db_session, f"Audit-{uuid.uuid4().hex[:6]}")
    officer = await _user(db_session, org_id, "Officer", ["training.manage"])

    async with _client(
        db_session, officer, training_endpoints.router, "/training"
    ) as client:
        response = await client.post(
            "/training/reports/export",
            json={
                "report_type": report_type,
                "format": "pdf",
                "start_date": "2026-01-01",
                "end_date": "2026-06-30",
            },
        )

    _assert_attachment(response, f"training_report_{report_type}.pdf")
    rows = await _audit_rows(db_session, "training_report_exported", officer)
    assert len(rows) == 1
    assert rows[0].organization_id == org_id
    assert rows[0].event_data == {
        "report_type": report_type,
        "format": "pdf",
        "subject_user_id": None,
        "start_date": "2026-01-01",
        "end_date": "2026-06-30",
    }


async def test_individual_training_report_names_its_subject(db_session: AsyncSession):
    org_id = await _org(db_session, f"Audit-{uuid.uuid4().hex[:6]}")
    officer = await _user(db_session, org_id, "Officer", ["training.manage"])
    member = await _user(db_session, org_id, "Member", [])

    async with _client(
        db_session, officer, training_endpoints.router, "/training"
    ) as client:
        response = await client.post(
            "/training/reports/export",
            json={
                "report_type": "individual",
                "format": "pdf",
                "user_id": str(member.id),
            },
        )

    _assert_attachment(response, "training_report_individual.pdf")
    rows = await _audit_rows(db_session, "training_report_exported", officer)
    assert [r.event_data["subject_user_id"] for r in rows] == [str(member.id)]


async def test_training_report_csv_export_is_audited(db_session: AsyncSession):
    org_id = await _org(db_session, f"Audit-{uuid.uuid4().hex[:6]}")
    officer = await _user(db_session, org_id, "Officer", ["training.manage"])

    async with _client(
        db_session, officer, training_endpoints.router, "/training"
    ) as client:
        response = await client.post(
            "/training/reports/export",
            json={"report_type": "member_records", "format": "csv"},
        )

    assert response.status_code == 200, response.text
    rows = await _audit_rows(db_session, "training_report_exported", officer)
    assert [r.event_data["format"] for r in rows] == ["csv"]


async def test_rejected_training_export_leaves_no_audit_row(db_session: AsyncSession):
    """An export that produced no file disclosed nothing."""
    org_id = await _org(db_session, f"Audit-{uuid.uuid4().hex[:6]}")
    officer = await _user(db_session, org_id, "Officer", ["training.manage"])

    async with _client(
        db_session, officer, training_endpoints.router, "/training"
    ) as client:
        response = await client.post(
            "/training/reports/export",
            json={"report_type": "hours_summary", "format": "pdf"},
        )

    assert response.status_code == 400
    assert await _audit_rows(db_session, "training_report_exported", officer) == []


async def test_member_own_training_record_pdf_is_audited(db_session: AsyncSession):
    org_id = await _org(db_session, f"Audit-{uuid.uuid4().hex[:6]}")
    member = await _user(db_session, org_id, "Member", [])
    config = await TrainingModuleConfigService(db_session).get_config(org_id)
    config.allow_member_report_export = True
    await db_session.flush()

    async with _client(
        db_session, member, config_endpoints.router, "/training/module-config"
    ) as client:
        response = await client.get(
            "/training/module-config/my-training/export", params={"format": "pdf"}
        )

    _assert_attachment(response, "my_training_record.pdf")
    rows = await _audit_rows(db_session, "my_training_record_exported", member)
    assert [r.event_data for r in rows] == [
        {"format": "pdf", "start_date": None, "end_date": None}
    ]


async def test_equipment_check_pdf_export_is_audited(db_session: AsyncSession):
    org_id = await _org(db_session, f"Audit-{uuid.uuid4().hex[:6]}")
    viewer = await _user(db_session, org_id, "Viewer", ["inventory.check_view"])

    async with _client(
        db_session, viewer, equipment_endpoints.router, "/equipment-check"
    ) as client:
        response = await client.get(
            "/equipment-check/reports/export/pdf",
            params={"report_type": "compliance", "date_from": "2026-01-01"},
        )

    _assert_attachment(response, "equipment_check_compliance.pdf")
    rows = await _audit_rows(db_session, "equipment_check_report_exported", viewer)
    assert len(rows) == 1
    assert rows[0].event_data == {
        "report_type": "compliance",
        "format": "pdf",
        "check_id": None,
        "apparatus_id": None,
        "date_from": "2026-01-01",
        "date_to": None,
    }


async def test_inventory_impact_plan_pdf_export_is_audited(db_session: AsyncSession):
    org_id = await _org(db_session, f"Audit-{uuid.uuid4().hex[:6]}")
    manager = await _user(db_session, org_id, "Manager", ["inventory.manage"])

    async with _client(
        db_session, manager, inventory_endpoints.router, "/inventory"
    ) as client:
        response = await client.post("/inventory/impact-planner/pdf", json={})

    _assert_attachment(response, "impact-plan.pdf")
    rows = await _audit_rows(db_session, "inventory_impact_plan_exported", manager)
    assert [r.event_data for r in rows] == [{"format": "pdf"}]
