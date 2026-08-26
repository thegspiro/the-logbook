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
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.models.compliance_config import (
    ComplianceConfig,
    ComplianceProfile,
    ReportStatus,
)
from app.schemas.compliance_config import ComplianceReportGenerate
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

    async def test_invalid_report_type_rejected(self, stub_annual):
        db = _db([])
        with pytest.raises(ValueError, match="report_type"):
            await ComplianceReportService(db).generate_report("org-1", "weekly", 2026)

    async def test_yearly_report_type_accepted(self, stub_annual):
        stub_annual.result = {"executive_summary": {}}
        db = _db([])
        report = await ComplianceReportService(db).generate_report(
            "org-1", "yearly", 2026
        )
        assert report.status == ReportStatus.COMPLETED.value
        assert report.period_label == "2026"
        assert report.report_type == "yearly"

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

    async def test_update_profile_applies_fields_and_clears_an_explicit_null(self):
        """apply_updates: a present, non-null field is written; an explicit
        null clears it. The endpoint sends exclude_unset=True, so an omitted
        key never reaches this method at all — a null that does arrive here
        is the caller deliberately clearing the field."""
        profile = SimpleNamespace(id="p1", name="Old", description="keep")
        db = _db([_first(profile)])
        out = await ComplianceConfigService(db).update_profile(
            "p1", "org-1", {"name": "New", "description": None}
        )
        assert out.name == "New"
        assert out.description is None

    async def test_update_profile_name_cannot_be_nulled(self):
        """`name` is NOT NULL on the model — apply_updates must reject an
        explicit null with a clean ValueError (-> 400), not a flush-time
        IntegrityError (-> 500)."""
        profile = ComplianceProfile(id="p1", config_id="cfg-1", name="Old")
        db = _db([_first(profile)])
        with pytest.raises(ValueError, match="cannot be cleared"):
            await ComplianceConfigService(db).update_profile(
                "p1", "org-1", {"name": None}
            )

    async def test_update_profile_threshold_override_can_be_reset_to_default(self):
        """compliant_threshold_override is nullable (null = use org default) —
        a caller resetting a profile back to the org default must be able to
        null it out, not just overwrite it with another number."""
        profile = ComplianceProfile(
            id="p1",
            config_id="cfg-1",
            name="Officers",
            compliant_threshold_override=90.0,
        )
        db = _db([_first(profile)])
        out = await ComplianceConfigService(db).update_profile(
            "p1", "org-1", {"compliant_threshold_override": None}
        )
        assert out.compliant_threshold_override is None

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


class TestCreateOrUpdateConfig:
    async def test_update_branch_applies_fields_via_apply_updates(self):
        existing = ComplianceConfig(
            id="cfg-1", organization_id="org-1", threshold_type="percentage"
        )
        refetched = ComplianceConfig(
            id="cfg-1", organization_id="org-1", threshold_type="all_required"
        )
        db = _db([_first(existing), _first(refetched)])
        out = await ComplianceConfigService(db).create_or_update_config(
            "org-1", {"threshold_type": "all_required"}, updated_by="user-1"
        )
        assert out.threshold_type == "all_required"

    async def test_first_write_race_is_a_clean_400_not_a_500(self):
        """Two concurrent first-time saves for the same org both read config
        as None and both attempt an insert; organization_id is unique, so
        the loser's flush raises IntegrityError. That must surface as a
        clean ValueError (-> 400), not an unhandled 500."""
        db = _db([_first(None)])
        db.flush = AsyncMock(
            side_effect=IntegrityError("insert", {}, Exception("duplicate"))
        )
        db.rollback = AsyncMock()
        with pytest.raises(ValueError, match="already exists"):
            await ComplianceConfigService(db).create_or_update_config(
                "org-1", {}, updated_by="user-1"
            )
        db.rollback.assert_awaited_once()


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


# ---------------------------------------------------------------------------
# ComplianceReportGenerate.report_type
# ---------------------------------------------------------------------------


class TestReportTypeSchema:
    """The schema's allowed set must match the service's runtime check
    (compliance_config_service.py's `if report_type not in (...)`) — a
    scheduled auto-report task calls the service directly with
    report_type="yearly", bypassing this schema, so both places have to
    agree or one of the two paths silently diverges from the other."""

    @pytest.mark.parametrize("value", ["monthly", "annual", "yearly"])
    def test_known_values_are_accepted(self, value):
        req = ComplianceReportGenerate(report_type=value, year=2025)
        assert req.report_type == value

    def test_unknown_value_is_rejected_at_the_schema_layer(self):
        with pytest.raises(ValidationError):
            ComplianceReportGenerate(report_type="weekly", year=2025)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
