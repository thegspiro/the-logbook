"""
Tests for the compliance configuration & report services
(app/services/compliance_config_service.py).

Covers the report generation lifecycle (period labelling, COMPLETED status
+ summary assembly from the annual report, and FAILED status on error),
plus the config/profile/report CRUD guards (missing config, missing
profile/report, and the completed-only email guard). The heavy annual
report dependency and email are mocked. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.compliance_config import ReportStatus
from app.services.compliance_config_service import (
    ComplianceConfigService,
    ComplianceReportService,
)


def _first(obj):
    r = MagicMock()
    r.scalars.return_value.first.return_value = obj
    return r


def _all(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


# ---------------------------------------------------------------------------
# ComplianceReportService.generate_report
# ---------------------------------------------------------------------------


@pytest.fixture
def stub_annual(monkeypatch):
    """Stub the annual report generator; return a settable result/raiser."""
    holder = SimpleNamespace(result=None, exc=None)

    async def _gen(org_id, year):
        if holder.exc:
            raise holder.exc
        return holder.result

    monkeypatch.setattr(
        "app.services.compliance_config_service.AnnualComplianceReportService",
        lambda db: SimpleNamespace(generate_annual_report=_gen),
    )
    return holder


class TestGenerateReport:
    async def test_completed_with_summary(self, stub_annual):
        stub_annual.result = {
            "executive_summary": {
                "overall_compliance_pct": 88.5,
                "fully_compliant_members": 8,
                "total_members": 10,
                "at_risk_members": 1,
                "non_compliant_members": 1,
                "total_training_hours": 240,
            }
        }
        db = _db([])  # generate_report itself doesn't query (annual is stubbed)
        report = await ComplianceReportService(db).generate_report(
            "org-1", "annual", 2026, generated_by="u1"
        )
        assert report.status == ReportStatus.COMPLETED.value
        assert report.period_label == "2026"
        assert report.summary["overall_compliance_pct"] == 88.5
        assert report.summary["total_members"] == 10
        assert report.generation_duration_ms is not None

    async def test_monthly_period_label(self, stub_annual):
        stub_annual.result = {"executive_summary": {}}
        db = _db([])
        report = await ComplianceReportService(db).generate_report(
            "org-1", "monthly", 2026, month=3
        )
        assert report.period_label == "March 2026"
        assert report.period_month == 3
        assert report.report_data["report_period"]["type"] == "monthly"

    async def test_failure_marks_failed_and_reraises(self, stub_annual):
        stub_annual.exc = RuntimeError("boom")
        db = _db([])
        with pytest.raises(RuntimeError, match="boom"):
            await ComplianceReportService(db).generate_report("org-1", "annual", 2026)
        # The report object was added; inspect the captured instance.
        report = db.add.call_args.args[0]
        assert report.status == ReportStatus.FAILED.value
        assert report.error_message == "boom"


# ---------------------------------------------------------------------------
# Config / profile CRUD guards
# ---------------------------------------------------------------------------


class TestConfigService:
    async def test_create_profile_requires_config(self):
        db = _db([_first(None)])  # get_config -> None
        with pytest.raises(ValueError, match="must be set up"):
            await ComplianceConfigService(db).create_profile("org-1", {})

    async def test_update_profile_not_found(self):
        db = _db([_first(None)])
        with pytest.raises(ValueError, match="Profile not found"):
            await ComplianceConfigService(db).update_profile("p1", "org-1", {})

    async def test_update_profile_applies_non_null_fields(self):
        profile = SimpleNamespace(id="p1", name="Old", description="keep")
        db = _db([_first(profile)])
        out = await ComplianceConfigService(db).update_profile(
            "p1", "org-1", {"name": "New", "description": None}
        )
        assert out.name == "New"
        assert out.description == "keep"  # None is ignored

    async def test_delete_profile_not_found(self):
        db = _db([_first(None)])
        with pytest.raises(ValueError, match="Profile not found"):
            await ComplianceConfigService(db).delete_profile("p1", "org-1")

    async def test_get_available_requirements_maps_fields(self):
        req = SimpleNamespace(
            id="r1",
            name="EMT",
            requirement_type="certification",
            source="state",
            frequency="annual",
        )
        db = _db([_all([req])])
        out = await ComplianceConfigService(db).get_available_requirements("org-1")
        assert out == [
            {
                "id": "r1",
                "name": "EMT",
                "requirement_type": "certification",
                "source": "state",
                "frequency": "annual",
            }
        ]


# ---------------------------------------------------------------------------
# Report CRUD + re-email
# ---------------------------------------------------------------------------


class TestReportCrud:
    async def test_list_reports_returns_total_and_items(self):
        r1, r2 = SimpleNamespace(id="a"), SimpleNamespace(id="b")
        db = _db([_scalar(2), _all([r1, r2])])
        out = await ComplianceReportService(db).list_reports("org-1")
        assert out["total"] == 2
        assert out["reports"] == [r1, r2]

    async def test_delete_report_not_found(self):
        db = _db([_first(None)])
        with pytest.raises(ValueError, match="Report not found"):
            await ComplianceReportService(db).delete_report("rep-1", "org-1")

    async def test_email_existing_requires_completed(self):
        report = SimpleNamespace(id="rep-1", status=ReportStatus.GENERATING.value)
        db = _db([_first(report)])
        with pytest.raises(ValueError, match="not completed"):
            await ComplianceReportService(db).email_existing_report(
                "rep-1", "org-1", ["x@y.org"]
            )

    async def test_email_existing_missing_report(self):
        db = _db([_first(None)])
        with pytest.raises(ValueError, match="Report not found"):
            await ComplianceReportService(db).email_existing_report(
                "rep-1", "org-1", ["x@y.org"]
            )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
