"""
Times printed on generated PDFs and CSV exports are the department's, not UTC.

A PDF is rendered on the server, so nothing localizes it for the reader. At
02:30 UTC on October 7 it is 10:30 PM on October 6 in New York: a check done
that evening was printed as the next day, and the "Generated" stamp read UTC.
"""

from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace

import pytest
from pypdf import PdfReader

from app.services import equipment_check_pdf
from app.utils.impact_plan_pdf import render_impact_plan_pdf

pytestmark = pytest.mark.unit

LATE_EVENING_UTC = datetime(2026, 10, 7, 2, 30, tzinfo=timezone.utc)


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return LATE_EVENING_UTC.replace(tzinfo=None)
        return LATE_EVENING_UTC.astimezone(tz)


def _org(tz="America/New_York"):
    return SimpleNamespace(id="org-1", name="Oakville FD", timezone=tz)


def _text(pdf) -> str:
    raw = pdf.getvalue() if isinstance(pdf, BytesIO) else pdf
    return "\n".join(page.extract_text() for page in PdfReader(BytesIO(raw)).pages)


@pytest.fixture
def _frozen_clock(monkeypatch):
    # Only for the "Generated" stamp: replacing the module's datetime class
    # also changes what its isinstance checks see, so row-date tests run on
    # the real clock and never produce either October date on their own.
    monkeypatch.setattr(equipment_check_pdf, "datetime", _Frozen)


class TestEquipmentCheckPdfs:
    def test_the_check_detail_time_is_local(self):
        text = _text(
            equipment_check_pdf.generate_check_detail_pdf(
                {
                    "overall_status": "pass",
                    "checked_by_name": "Dana Reyes",
                    "checked_at": LATE_EVENING_UTC.isoformat(),
                    "items": [],
                },
                organization=_org(),
            )
        )
        assert "2026-10-06 22:30 EDT" in text
        assert "2026-10-07" not in text

    @pytest.mark.usefixtures("_frozen_clock")
    def test_the_generated_stamp_is_local(self):
        text = _text(
            equipment_check_pdf.generate_failure_log_pdf(
                {"items": [], "total": 0}, organization=_org()
            )
        )
        assert "Generated: 2026-10-06 22:30 EDT" in text
        assert "UTC" not in text

    def test_the_failure_log_dates_are_local(self):
        text = _text(
            equipment_check_pdf.generate_failure_log_pdf(
                {
                    "items": [
                        {
                            "checked_at": LATE_EVENING_UTC,
                            "apparatus_name": "Engine 1",
                            "item_name": "SCBA",
                        }
                    ],
                    "total": 1,
                },
                organization=_org(),
            )
        )
        assert "2026-10-06" in text
        assert "2026-10-07" not in text

    def test_the_compliance_last_check_is_local(self):
        text = _text(
            equipment_check_pdf.generate_compliance_pdf(
                {
                    "total_checks": 1,
                    "pass_rate": 100,
                    "avg_items_per_check": 1,
                    "apparatus": [
                        {
                            "apparatus_name": "Engine 1",
                            "last_check_date": LATE_EVENING_UTC,
                        }
                    ],
                },
                organization=_org(),
            )
        )
        assert "2026-10-06" in text
        assert "2026-10-07" not in text


class TestImpactPlanPdf:
    def test_the_generated_stamp_carries_the_local_zone(self):
        from zoneinfo import ZoneInfo

        buf = render_impact_plan_pdf(
            {"members": [], "size_breakdown": []},
            {
                "org_name": "Oakville FD",
                "generated_at": LATE_EVENING_UTC.astimezone(
                    ZoneInfo("America/New_York")
                ),
                "parameters": [],
            },
        )
        text = _text(buf)
        assert "2026-10-06 22:30 EDT" in text
        assert "UTC" not in text


class TestAdminHoursExport:
    async def test_clock_times_and_date_are_local(self):
        from enum import Enum
        from unittest.mock import AsyncMock, MagicMock

        from app.services.admin_hours_service import AdminHoursService

        class _Method(Enum):
            CLOCK = "clock"

        entry = SimpleNamespace(
            duration_minutes=60,
            clock_in_at=datetime(2026, 10, 7, 1, 30, tzinfo=timezone.utc),
            clock_out_at=LATE_EVENING_UTC,
            entry_method=_Method.CLOCK,
            status=_Method.CLOCK,
            description="",
        )
        rows = MagicMock()
        rows.all.return_value = [(entry, "Admin", "Dana", "Reyes", None, None)]
        org = MagicMock()
        org.scalar_one_or_none.return_value = _org()
        db = SimpleNamespace(execute=AsyncMock(side_effect=[rows, org]))

        csv_text = await AdminHoursService(db).export_entries_csv("org-1")

        line = csv_text.splitlines()[1]
        assert "2026-10-06,2026-10-06 21:30,2026-10-06 22:30" in line


class TestEquipmentCheckCsvExport:
    async def test_check_times_are_local_with_their_offset(self, monkeypatch):
        from unittest.mock import AsyncMock, MagicMock

        from app.api.v1.endpoints import equipment_check as endpoint

        service = MagicMock()
        service.get_failure_log = AsyncMock(
            return_value={
                "items": [{"checked_at": LATE_EVENING_UTC, "apparatus_name": "E1"}]
            }
        )
        monkeypatch.setattr(endpoint, "EquipmentCheckService", lambda _db: service)
        org = MagicMock()
        org.scalar_one_or_none.return_value = _org()
        db = SimpleNamespace(execute=AsyncMock(return_value=org))

        response = await endpoint.export_csv(
            report_type="failures",
            date_from=None,
            date_to=None,
            apparatus_id=None,
            template_item_id=None,
            db=db,
            current_user=SimpleNamespace(organization_id="org-1"),
        )
        body = "".join([chunk async for chunk in response.body_iterator])

        assert "2026-10-06 22:30:00-04:00" in body
        assert "+00:00" not in body
