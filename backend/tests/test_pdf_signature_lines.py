"""Signature lines, added to a report at download when asked for.

Owner decision of 2026-11-21: a report that goes up the chain for review is
signed on paper, so the downloads offer a tick-box that ends the report with
Prepared by / Reviewed by / Approved by lines, each with a date. They are off
unless asked for: most downloads are working copies nobody signs.
"""

import io
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import equipment_check as equipment_endpoints
from app.api.v1.endpoints import reports as reports_endpoints
from app.api.v1.endpoints import training_enhancements as training_endpoints
from app.core.database import get_db
from app.models.user import User
from app.services.report_export import render_report_pdf
from app.services.report_tables import build_export_table
from tests import test_pdf_print_safety as safety
from tests.minutes_support import _org, _user

SIGNATURE_LABELS = ("Prepared by", "Reviewed by", "Approved by")


def _pages(pdf: bytes) -> list[str]:
    return [page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages]


def _signed(pdf: bytes) -> bool:
    return "Reviewed by" in " ".join(_pages(pdf))


def _render(**kw: Any) -> bytes:
    return render_report_pdf(
        build_export_table("member_roster", safety._ROSTER),
        org_name="Test Fire Department",
        logo=None,
        generated_at="2026-11-21 10:00 EST",
        generated_by="Jordan Ames, Fire Chief",
        parameters=[],
        **kw,
    )


@pytest.mark.unit
class TestTheKit:
    def test_no_signature_lines_unless_asked(self):
        assert not _signed(_render())

    def test_the_lines_close_the_report_on_its_last_page(self):
        pages = _pages(_render(signature_lines=True))
        last = pages[-1]
        for label in SIGNATURE_LABELS:
            assert label in last
        assert last.count("Date") >= 3
        assert not any("Reviewed by" in page for page in pages[:-1])

    def test_the_preparer_is_named_under_their_line(self):
        last = _pages(_render(signature_lines=True))[-1]
        tail = last[last.index("Reviewed by") - 200 :]
        assert "Jordan Ames, Fire Chief" in tail

    def test_the_block_stays_inside_the_print_safe_area(self):
        pdf = _render(signature_lines=True)
        for page, w, h, x0, y0, x1, y1, text in safety._runs(pdf):
            assert x0 >= safety.SAFE_EDGE - 0.5, (page, text)
            assert x1 <= w - safety.SAFE_EDGE + 0.5, (page, text)
            assert y0 >= safety.SAFE_EDGE - 0.5, (page, text)
            assert y1 <= h - safety.SAFE_EDGE + 0.5, (page, text)


def _client(db: AsyncSession, user: User, router: Any, prefix: str) -> AsyncClient:
    app = FastAPI()
    app.include_router(router, prefix=prefix)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


@pytest.mark.integration
class TestTheDownloads:
    @pytest.mark.parametrize("asked", [True, False])
    async def test_reports_page(self, db_session: AsyncSession, asked: bool):
        org_id = await _org(db_session, f"Sig-{uuid.uuid4().hex[:6]}")
        officer = await _user(db_session, org_id, "Officer", ["reports.view"])
        body: dict[str, Any] = {"format": "pdf", "report_type": "event_attendance"}
        if asked:
            body["signature_lines"] = True
        async with _client(
            db_session, officer, reports_endpoints.router, "/reports"
        ) as client:
            response = await client.post("/reports/export", json=body)
        assert response.status_code == 200, response.text
        assert _signed(response.content) is asked

    @pytest.mark.parametrize("asked", [True, False])
    async def test_training_report(self, db_session: AsyncSession, asked: bool):
        org_id = await _org(db_session, f"Sig-{uuid.uuid4().hex[:6]}")
        officer = await _user(db_session, org_id, "Officer", ["training.manage"])
        body: dict[str, Any] = {"report_type": "compliance", "format": "pdf"}
        if asked:
            body["signature_lines"] = True
        async with _client(
            db_session, officer, training_endpoints.router, "/training"
        ) as client:
            response = await client.post("/training/reports/export", json=body)
        assert response.status_code == 200, response.text
        assert _signed(response.content) is asked

    @pytest.mark.parametrize("asked", [True, False])
    async def test_equipment_check_report(self, db_session: AsyncSession, asked: bool):
        org_id = await _org(db_session, f"Sig-{uuid.uuid4().hex[:6]}")
        viewer = await _user(db_session, org_id, "Viewer", ["inventory.check_view"])
        params = {"report_type": "compliance"}
        if asked:
            params["signature_lines"] = "true"
        async with _client(
            db_session, viewer, equipment_endpoints.router, "/equipment-check"
        ) as client:
            response = await client.get(
                "/equipment-check/reports/export/pdf", params=params
            )
        assert response.status_code == 200, response.text
        assert _signed(response.content) is asked
