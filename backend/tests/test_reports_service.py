"""
Tests for the Reports Service

Unit tests for report generation logic.
"""

from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.services.reports_service import ReportsService


@pytest.fixture
def mock_db_session():
    """Create a mock async session for reports tests."""
    session = AsyncMock()
    return session


@pytest.fixture
def service(mock_db_session):
    """Create a ReportsService instance with a mock db."""
    return ReportsService(mock_db_session)


@pytest.fixture
def org_id():
    return uuid4()


class TestGenerateReport:
    """Tests for the report routing method."""

    async def test_unknown_report_type_returns_error(self, service, org_id):
        result = await service.generate_report(org_id, "nonexistent_type")
        assert "error" in result
        assert "Unknown report type" in result["error"]

    async def test_valid_report_type_dispatches(self, service, org_id):
        """Valid report types should call the appropriate generator."""
        # Just verify the dispatch mechanism works by checking known types
        valid_types = [
            "member_roster",
            "training_summary",
            "event_attendance",
            "training_progress",
            "annual_training",
            "department_overview",
            "admin_hours",
            "certification_expiration",
            "apparatus_status",
            "inventory_status",
            "compliance_status",
            "call_volume",
        ]
        for report_type in valid_types:
            # Patch the specific generator to avoid DB calls
            generator_name = f"_generate_{report_type}"
            mock_gen = AsyncMock(
                return_value={"report_type": report_type, "entries": []}
            )
            setattr(service, generator_name, mock_gen)

            result = await service.generate_report(org_id, report_type)
            assert result["report_type"] == report_type
            mock_gen.assert_called_once()


class TestGetAvailableReports:
    """Tests for the available reports listing."""

    async def test_returns_all_report_types(self, service):
        result = await service.get_available_reports()
        reports = result["available_reports"]

        assert isinstance(reports, list)
        assert len(reports) >= 10  # We have at least 12 report types

        # Check required fields
        for report in reports:
            assert "id" in report
            assert "title" in report
            assert "description" in report
            assert "category" in report
            assert "available" in report

    async def test_includes_new_report_types(self, service):
        result = await service.get_available_reports()
        report_ids = [r["id"] for r in result["available_reports"]]

        assert "certification_expiration" in report_ids
        assert "apparatus_status" in report_ids
        assert "inventory_status" in report_ids
        assert "compliance_status" in report_ids
        assert "call_volume" in report_ids

    async def test_new_reports_are_available(self, service):
        result = await service.get_available_reports()
        new_reports = {
            r["id"]: r
            for r in result["available_reports"]
            if r["id"]
            in [
                "certification_expiration",
                "apparatus_status",
                "inventory_status",
                "compliance_status",
                "call_volume",
            ]
        }

        for report_id, report in new_reports.items():
            assert report["available"] is True, f"{report_id} should be available"

    async def test_categories_include_operations(self, service):
        result = await service.get_available_reports()
        categories = {r["category"] for r in result["available_reports"]}
        assert "operations" in categories


class TestCertificationExpirationReport:
    """Tests for certification expiration report generation."""

    async def test_handles_empty_records(self, service, org_id):
        # Mock empty results
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        service.db.execute = AsyncMock(return_value=mock_result)

        result = await service._generate_certification_expiration(org_id)

        assert result["report_type"] == "certification_expiration"
        assert result["total_certifications"] == 0
        assert result["expired_count"] == 0
        assert result["expiring_soon_count"] == 0


class TestCallVolumeReport:
    """Tests for call volume report generation."""

    async def test_handles_no_shift_reports(self, service, org_id):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        service.db.execute = AsyncMock(return_value=mock_result)

        result = await service._generate_call_volume(org_id)

        assert result["report_type"] == "call_volume"
        assert result["summary"]["total_calls"] == 0
        assert result["summary"]["avg_calls_per_day"] == 0
        assert result["entries"] == []

    async def test_uses_provided_date_range(self, service, org_id):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        service.db.execute = AsyncMock(return_value=mock_result)

        start = date(2025, 1, 1)
        end = date(2025, 6, 30)
        result = await service._generate_call_volume(
            org_id, start_date=start, end_date=end
        )

        assert result["period_start"] == "2025-01-01"
        assert result["period_end"] == "2025-06-30"


class TestComplianceStatusReport:
    """Tests for compliance status report generation."""

    async def test_handles_no_requirements(self, service, org_id):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_unique_result = MagicMock()
        mock_unique_result.scalars.return_value.unique.return_value.all.return_value = (
            []
        )

        # First call: requirements, second: users, third: enrollments
        service.db.execute = AsyncMock(
            side_effect=[mock_result, mock_result, mock_unique_result]
        )

        result = await service._generate_compliance_status(org_id)

        assert result["report_type"] == "compliance_status"
        assert result["total_members"] == 0
        assert result["fully_compliant_count"] == 0
