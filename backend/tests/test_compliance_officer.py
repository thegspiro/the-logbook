"""
Tests for Compliance Officer Services

Tests for ISO readiness scoring, compliance attestation validation,
record completeness evaluation, and annual compliance report helpers.
"""

import pytest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.compliance_officer_service import (
    ISO_CATEGORIES,
    AnnualComplianceReportService,
    ComplianceAttestationService,
    ISOReadinessService,
    RecordCompletenessService,
)
from app.models.training import RenewalTaskStatus


# ============================================
# ISO_CATEGORIES Structure Tests
# ============================================


class TestISOCategories:
    """Test the ISO/FSRS category definitions."""

    def test_iso_categories_is_list(self):
        assert isinstance(ISO_CATEGORIES, list)

    def test_iso_categories_count(self):
        """There should be exactly 5 ISO/FSRS categories."""
        assert len(ISO_CATEGORIES) == 5

    def test_each_category_has_required_keys(self):
        required_keys = {"name", "nfpa_standard", "required_hours", "training_types"}
        for cat in ISO_CATEGORIES:
            assert required_keys.issubset(cat.keys()), (
                f"Category '{cat.get('name', 'unknown')}' missing keys: "
                f"{required_keys - cat.keys()}"
            )

    def test_each_category_has_name(self):
        names = [cat["name"] for cat in ISO_CATEGORIES]
        assert "Company Training" in names
        assert "Driver/Operator Training" in names
        assert "Officer Training" in names
        assert "Hazardous Materials" in names
        assert "New Driver Training" in names

    def test_each_category_has_nfpa_standard(self):
        standards = [cat["nfpa_standard"] for cat in ISO_CATEGORIES]
        assert "NFPA 1001" in standards
        assert "NFPA 1002" in standards
        assert "NFPA 1021" in standards
        assert "NFPA 472" in standards
        assert "NFPA 1451" in standards

    def test_required_hours_are_positive(self):
        for cat in ISO_CATEGORIES:
            assert cat["required_hours"] > 0, (
                f"Category '{cat['name']}' has non-positive required_hours"
            )

    def test_training_types_are_non_empty_lists(self):
        for cat in ISO_CATEGORIES:
            assert isinstance(cat["training_types"], list)
            assert len(cat["training_types"]) > 0, (
                f"Category '{cat['name']}' has empty training_types"
            )

    def test_training_types_are_strings(self):
        for cat in ISO_CATEGORIES:
            for t in cat["training_types"]:
                assert isinstance(t, str)
                assert t == t.lower(), (
                    f"Training type '{t}' in '{cat['name']}' is not lowercase"
                )

    def test_no_duplicate_training_types_within_category(self):
        for cat in ISO_CATEGORIES:
            types = cat["training_types"]
            assert len(types) == len(set(types)), (
                f"Category '{cat['name']}' has duplicate training_types"
            )

    def test_company_training_has_expected_types(self):
        company = next(c for c in ISO_CATEGORIES if c["name"] == "Company Training")
        assert "fire_training" in company["training_types"]
        assert "live_fire" in company["training_types"]
        assert "search_and_rescue" in company["training_types"]
        assert company["required_hours"] == 192

    def test_driver_training_category(self):
        driver = next(
            c for c in ISO_CATEGORIES if c["name"] == "Driver/Operator Training"
        )
        assert driver["required_hours"] == 12
        assert driver["nfpa_standard"] == "NFPA 1002"
        assert "driver_training" in driver["training_types"]

    def test_officer_training_category(self):
        officer = next(c for c in ISO_CATEGORIES if c["name"] == "Officer Training")
        assert officer["required_hours"] == 12
        assert officer["nfpa_standard"] == "NFPA 1021"
        assert "officer_development" in officer["training_types"]

    def test_hazmat_category(self):
        hazmat = next(c for c in ISO_CATEGORIES if c["name"] == "Hazardous Materials")
        assert hazmat["required_hours"] == 6
        assert hazmat["nfpa_standard"] == "NFPA 472"

    def test_new_driver_training_category(self):
        new_driver = next(
            c for c in ISO_CATEGORIES if c["name"] == "New Driver Training"
        )
        assert new_driver["required_hours"] == 60
        assert new_driver["nfpa_standard"] == "NFPA 1451"
        assert "new_driver" in new_driver["training_types"]


# ============================================
# ISOReadinessService._estimate_iso_class Tests
# ============================================


class TestEstimateISOClass:
    """Test the _estimate_iso_class static method."""

    def test_class_1_at_95(self):
        assert ISOReadinessService._estimate_iso_class(95.0) == 1

    def test_class_1_at_100(self):
        assert ISOReadinessService._estimate_iso_class(100.0) == 1

    def test_class_1_at_99(self):
        assert ISOReadinessService._estimate_iso_class(99.9) == 1

    def test_class_2_at_90(self):
        assert ISOReadinessService._estimate_iso_class(90.0) == 2

    def test_class_2_at_94(self):
        assert ISOReadinessService._estimate_iso_class(94.9) == 2

    def test_class_3_at_80(self):
        assert ISOReadinessService._estimate_iso_class(80.0) == 3

    def test_class_3_at_89(self):
        assert ISOReadinessService._estimate_iso_class(89.9) == 3

    def test_class_4_at_70(self):
        assert ISOReadinessService._estimate_iso_class(70.0) == 4

    def test_class_5_at_60(self):
        assert ISOReadinessService._estimate_iso_class(60.0) == 5

    def test_class_6_at_50(self):
        assert ISOReadinessService._estimate_iso_class(50.0) == 6

    def test_class_7_at_40(self):
        assert ISOReadinessService._estimate_iso_class(40.0) == 7

    def test_class_8_at_30(self):
        assert ISOReadinessService._estimate_iso_class(30.0) == 8

    def test_class_9_at_20(self):
        assert ISOReadinessService._estimate_iso_class(20.0) == 9

    def test_class_10_below_20(self):
        assert ISOReadinessService._estimate_iso_class(19.9) == 10

    def test_class_10_at_zero(self):
        assert ISOReadinessService._estimate_iso_class(0.0) == 10

    def test_class_10_at_negative(self):
        assert ISOReadinessService._estimate_iso_class(-5.0) == 10

    def test_boundary_values(self):
        """Test all boundary values to ensure correct classification."""
        boundaries = [
            (95, 1),
            (90, 2),
            (80, 3),
            (70, 4),
            (60, 5),
            (50, 6),
            (40, 7),
            (30, 8),
            (20, 9),
            (19.9, 10),
        ]
        for pct, expected_class in boundaries:
            result = ISOReadinessService._estimate_iso_class(pct)
            assert result == expected_class, (
                f"Expected class {expected_class} for {pct}%, got {result}"
            )

    def test_just_below_boundaries(self):
        """Test values just below each boundary threshold."""
        below_boundaries = [
            (94.9, 2),
            (89.9, 3),
            (79.9, 4),
            (69.9, 5),
            (59.9, 6),
            (49.9, 7),
            (39.9, 8),
            (29.9, 9),
            (19.9, 10),
        ]
        for pct, expected_class in below_boundaries:
            result = ISOReadinessService._estimate_iso_class(pct)
            assert result == expected_class, (
                f"Expected class {expected_class} for {pct}%, got {result}"
            )

    def test_class_monotonic(self):
        """Higher readiness should give equal or better (lower) class."""
        prev_class = 10
        for pct in range(0, 101, 5):
            cls = ISOReadinessService._estimate_iso_class(pct)
            assert cls <= prev_class, (
                f"Class {cls} at {pct}% should be <= {prev_class}"
            )
            prev_class = cls


# ============================================
# ISOReadinessService.get_iso_readiness Tests
# ============================================


class TestGetISOReadiness:
    """Test the get_iso_readiness async method with mocked db."""

    async def test_no_members_returns_empty(self):
        mock_db = AsyncMock()
        mock_members_result = MagicMock()
        mock_members_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_members_result

        service = ISOReadinessService(mock_db)
        result = await service.get_iso_readiness("org-1", year=2025)

        assert result["year"] == 2025
        assert result["categories"] == []
        assert result["overall_readiness_pct"] == 0.0
        assert result["iso_class_estimate"] == 10

    async def test_default_year_is_current(self):
        mock_db = AsyncMock()
        mock_members_result = MagicMock()
        mock_members_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_members_result

        service = ISOReadinessService(mock_db)
        result = await service.get_iso_readiness("org-1")

        assert result["year"] == date.today().year


# ============================================
# ComplianceAttestationService Tests
# ============================================


class TestComplianceAttestationValidation:
    """Test validation logic in create_attestation."""

    async def test_invalid_period_type_raises(self):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        with pytest.raises(ValueError, match="period_type must be"):
            await service.create_attestation(
                organization_id="org-1",
                attestation_data={
                    "period_type": "monthly",
                    "period_year": 2025,
                    "compliance_percentage": 85.0,
                },
                attested_by="user-1",
            )

    async def test_missing_period_type_raises(self):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        with pytest.raises(ValueError, match="period_type must be"):
            await service.create_attestation(
                organization_id="org-1",
                attestation_data={
                    "period_year": 2025,
                    "compliance_percentage": 85.0,
                },
                attested_by="user-1",
            )

    async def test_missing_period_year_raises(self):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        with pytest.raises(ValueError, match="period_year is required"):
            await service.create_attestation(
                organization_id="org-1",
                attestation_data={
                    "period_type": "annual",
                    "compliance_percentage": 85.0,
                },
                attested_by="user-1",
            )

    async def test_quarterly_without_quarter_raises(self):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        with pytest.raises(
            ValueError, match="period_quarter must be 1, 2, 3, or 4"
        ):
            await service.create_attestation(
                organization_id="org-1",
                attestation_data={
                    "period_type": "quarterly",
                    "period_year": 2025,
                    "compliance_percentage": 85.0,
                },
                attested_by="user-1",
            )

    async def test_quarterly_with_invalid_quarter_raises(self):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        with pytest.raises(
            ValueError, match="period_quarter must be 1, 2, 3, or 4"
        ):
            await service.create_attestation(
                organization_id="org-1",
                attestation_data={
                    "period_type": "quarterly",
                    "period_year": 2025,
                    "period_quarter": 5,
                    "compliance_percentage": 85.0,
                },
                attested_by="user-1",
            )

    async def test_quarterly_with_zero_quarter_raises(self):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        with pytest.raises(
            ValueError, match="period_quarter must be 1, 2, 3, or 4"
        ):
            await service.create_attestation(
                organization_id="org-1",
                attestation_data={
                    "period_type": "quarterly",
                    "period_year": 2025,
                    "period_quarter": 0,
                    "compliance_percentage": 85.0,
                },
                attested_by="user-1",
            )

    async def test_missing_compliance_percentage_raises(self):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        with pytest.raises(ValueError, match="compliance_percentage is required"):
            await service.create_attestation(
                organization_id="org-1",
                attestation_data={
                    "period_type": "annual",
                    "period_year": 2025,
                },
                attested_by="user-1",
            )

    @patch(
        "app.services.compliance_officer_service.log_audit_event",
        new_callable=AsyncMock,
    )
    @patch(
        "app.services.compliance_officer_service.generate_uuid",
        return_value="test-uuid",
    )
    async def test_valid_annual_attestation_succeeds(self, mock_uuid, mock_audit):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        result = await service.create_attestation(
            organization_id="org-1",
            attestation_data={
                "period_type": "annual",
                "period_year": 2025,
                "compliance_percentage": 92.5,
                "notes": "All requirements met",
                "areas_reviewed": ["training", "certifications"],
            },
            attested_by="user-1",
        )

        assert result["attestation_id"] == "test-uuid"
        assert result["period_type"] == "annual"
        assert result["period_year"] == 2025
        assert result["compliance_percentage"] == 92.5
        assert result["notes"] == "All requirements met"
        assert result["areas_reviewed"] == ["training", "certifications"]
        assert result["attested_by"] == "user-1"
        assert "created_at" in result
        mock_audit.assert_called_once()

    @patch(
        "app.services.compliance_officer_service.log_audit_event",
        new_callable=AsyncMock,
    )
    @patch(
        "app.services.compliance_officer_service.generate_uuid",
        return_value="test-uuid-2",
    )
    async def test_valid_quarterly_attestation_succeeds(self, mock_uuid, mock_audit):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        result = await service.create_attestation(
            organization_id="org-1",
            attestation_data={
                "period_type": "quarterly",
                "period_year": 2025,
                "period_quarter": 3,
                "compliance_percentage": 88.0,
            },
            attested_by="user-2",
        )

        assert result["attestation_id"] == "test-uuid-2"
        assert result["period_type"] == "quarterly"
        assert result["period_quarter"] == 3
        assert result["compliance_percentage"] == 88.0

    @patch(
        "app.services.compliance_officer_service.log_audit_event",
        new_callable=AsyncMock,
    )
    @patch(
        "app.services.compliance_officer_service.generate_uuid",
        return_value="test-uuid-3",
    )
    async def test_attestation_defaults_for_optional_fields(
        self, mock_uuid, mock_audit
    ):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        result = await service.create_attestation(
            organization_id="org-1",
            attestation_data={
                "period_type": "annual",
                "period_year": 2025,
                "compliance_percentage": 75.0,
            },
            attested_by="user-1",
        )

        assert result["notes"] == ""
        assert result["areas_reviewed"] == []
        assert result["exceptions"] == []

    @patch(
        "app.services.compliance_officer_service.log_audit_event",
        new_callable=AsyncMock,
    )
    @patch(
        "app.services.compliance_officer_service.generate_uuid",
        return_value="test-uuid-4",
    )
    async def test_attestation_with_exceptions(self, mock_uuid, mock_audit):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        exceptions = [
            {
                "requirement_name": "Hazmat Refresher",
                "reason": "Instructor unavailable",
                "mitigation": "Scheduled for Q1 2026",
            }
        ]

        result = await service.create_attestation(
            organization_id="org-1",
            attestation_data={
                "period_type": "annual",
                "period_year": 2025,
                "compliance_percentage": 80.0,
                "exceptions": exceptions,
            },
            attested_by="user-1",
        )

        assert result["exceptions"] == exceptions

    @patch(
        "app.services.compliance_officer_service.log_audit_event",
        new_callable=AsyncMock,
    )
    @patch(
        "app.services.compliance_officer_service.generate_uuid",
        return_value="test-uuid-5",
    )
    async def test_audit_event_called_with_correct_params(
        self, mock_uuid, mock_audit
    ):
        mock_db = AsyncMock()
        service = ComplianceAttestationService(mock_db)

        await service.create_attestation(
            organization_id="org-1",
            attestation_data={
                "period_type": "annual",
                "period_year": 2025,
                "compliance_percentage": 90.0,
            },
            attested_by="user-1",
        )

        mock_audit.assert_called_once()
        call_kwargs = mock_audit.call_args[1]
        assert call_kwargs["db"] is mock_db
        assert call_kwargs["event_type"] == "compliance_attestation"
        assert call_kwargs["event_category"] == "compliance"
        assert call_kwargs["severity"] == "info"
        assert call_kwargs["user_id"] == "user-1"
        assert call_kwargs["event_data"]["organization_id"] == "org-1"

    async def test_valid_quarters_accepted(self):
        """All four quarters (1-4) should be accepted for quarterly attestations."""
        for quarter in (1, 2, 3, 4):
            mock_db = AsyncMock()
            service = ComplianceAttestationService(mock_db)

            with patch(
                "app.services.compliance_officer_service.log_audit_event",
                new_callable=AsyncMock,
            ), patch(
                "app.services.compliance_officer_service.generate_uuid",
                return_value=f"uuid-q{quarter}",
            ):
                result = await service.create_attestation(
                    organization_id="org-1",
                    attestation_data={
                        "period_type": "quarterly",
                        "period_year": 2025,
                        "period_quarter": quarter,
                        "compliance_percentage": 90.0,
                    },
                    attested_by="user-1",
                )
                assert result["period_quarter"] == quarter


# ============================================
# RecordCompletenessService Tests
# ============================================


class TestRecordCompletenessFieldChecks:
    """Test the field check logic used in evaluate_record_completeness."""

    def _make_record(
        self,
        course_name=None,
        training_type=None,
        completion_date=None,
        hours_completed=None,
        instructor=None,
        location=None,
        location_id=None,
    ):
        """Create a mock training record with configurable fields."""
        record = MagicMock()
        record.course_name = course_name
        record.training_type = training_type
        record.completion_date = completion_date
        record.hours_completed = hours_completed
        record.instructor = instructor
        record.location = location
        record.location_id = location_id
        return record

    def test_course_name_check_truthy(self):
        record = self._make_record(course_name="Fire Safety 101")
        assert bool(record.course_name) is True

    def test_course_name_check_empty_string(self):
        record = self._make_record(course_name="")
        assert bool(record.course_name) is False

    def test_course_name_check_none(self):
        record = self._make_record(course_name=None)
        assert bool(record.course_name) is False

    def test_training_type_check_present(self):
        record = self._make_record(training_type="fire_training")
        assert record.training_type is not None

    def test_training_type_check_none(self):
        record = self._make_record(training_type=None)
        assert record.training_type is None

    def test_completion_date_check_present(self):
        record = self._make_record(completion_date=date(2025, 6, 15))
        assert record.completion_date is not None

    def test_completion_date_check_none(self):
        record = self._make_record(completion_date=None)
        assert record.completion_date is None

    def test_hours_completed_positive(self):
        record = self._make_record(hours_completed=4.0)
        assert record.hours_completed is not None and record.hours_completed > 0

    def test_hours_completed_zero(self):
        record = self._make_record(hours_completed=0)
        assert not (record.hours_completed is not None and record.hours_completed > 0)

    def test_hours_completed_none(self):
        record = self._make_record(hours_completed=None)
        assert not (record.hours_completed is not None and record.hours_completed > 0)

    def test_hours_completed_negative(self):
        record = self._make_record(hours_completed=-1)
        assert not (record.hours_completed is not None and record.hours_completed > 0)

    def test_instructor_check_truthy(self):
        record = self._make_record(instructor="Chief Smith")
        assert bool(record.instructor) is True

    def test_instructor_check_empty(self):
        record = self._make_record(instructor="")
        assert bool(record.instructor) is False

    def test_location_via_free_text(self):
        record = self._make_record(location="Station 1", location_id=None)
        assert bool(record.location) or bool(record.location_id)

    def test_location_via_fk(self):
        record = self._make_record(location=None, location_id="loc-123")
        assert bool(record.location) or bool(record.location_id)

    def test_location_both_missing(self):
        record = self._make_record(location=None, location_id=None)
        assert not (bool(record.location) or bool(record.location_id))

    def test_location_both_empty_strings(self):
        record = self._make_record(location="", location_id="")
        assert not (bool(record.location) or bool(record.location_id))


class TestRecordCompletenessEvaluate:
    """Test evaluate_record_completeness with mocked db."""

    async def test_no_records_returns_zero_completeness(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        service = RecordCompletenessService(mock_db)
        result = await service.evaluate_record_completeness("org-1")

        assert result["total_records"] == 0
        assert result["fields"] == []
        assert result["overall_completeness_pct"] == 0.0
        assert result["nfpa_1401_compliant"] is False

    async def test_fully_complete_records(self):
        mock_db = AsyncMock()
        record = MagicMock()
        record.course_name = "Fire Safety"
        record.training_type = "fire_training"
        record.completion_date = date(2025, 3, 15)
        record.hours_completed = 4.0
        record.instructor = "Chief Smith"
        record.location = "Station 1"
        record.location_id = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [record]
        mock_db.execute.return_value = mock_result

        service = RecordCompletenessService(mock_db)
        result = await service.evaluate_record_completeness(
            "org-1",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )

        assert result["total_records"] == 1
        assert result["overall_completeness_pct"] == 100.0
        assert result["nfpa_1401_compliant"] is True
        assert len(result["fields"]) == 6

        for field in result["fields"]:
            assert field["fill_rate_pct"] == 100.0
            assert field["records_with_value"] == 1

    async def test_partially_complete_records(self):
        mock_db = AsyncMock()
        # Record missing instructor and location
        record = MagicMock()
        record.course_name = "Hazmat Awareness"
        record.training_type = "hazmat"
        record.completion_date = date(2025, 5, 1)
        record.hours_completed = 2.0
        record.instructor = ""
        record.location = None
        record.location_id = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [record]
        mock_db.execute.return_value = mock_result

        service = RecordCompletenessService(mock_db)
        result = await service.evaluate_record_completeness(
            "org-1",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )

        assert result["total_records"] == 1
        # 4 out of 6 fields filled = 66.7%
        assert result["overall_completeness_pct"] == pytest.approx(66.7, abs=0.1)
        assert result["nfpa_1401_compliant"] is False

    async def test_nfpa_1401_threshold_at_90(self):
        """Verify the NFPA 1401 threshold is exactly 90%."""
        mock_db = AsyncMock()

        # Create 10 records, 9 fully complete and 1 missing instructor + location
        records = []
        for i in range(9):
            r = MagicMock()
            r.course_name = f"Course {i}"
            r.training_type = "fire_training"
            r.completion_date = date(2025, 1, i + 1)
            r.hours_completed = 4.0
            r.instructor = "Instructor"
            r.location = "Station"
            r.location_id = None
            records.append(r)

        # One record missing instructor and location (2 of 6 fields missing)
        incomplete = MagicMock()
        incomplete.course_name = "Incomplete"
        incomplete.training_type = "fire_training"
        incomplete.completion_date = date(2025, 2, 1)
        incomplete.hours_completed = 2.0
        incomplete.instructor = ""
        incomplete.location = None
        incomplete.location_id = None
        records.append(incomplete)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = records
        mock_db.execute.return_value = mock_result

        service = RecordCompletenessService(mock_db)
        result = await service.evaluate_record_completeness(
            "org-1",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )

        assert result["total_records"] == 10
        # With 9/10 for instructor and 9/10 for location: fill rates are 90%
        # Other 4 fields are 100% => avg = (100+100+100+100+90+90)/6 = 96.7
        assert result["nfpa_1401_compliant"] is True

    async def test_default_date_range(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        service = RecordCompletenessService(mock_db)
        result = await service.evaluate_record_completeness("org-1")

        today = date.today()
        assert result["period_start"] == date(today.year, 1, 1).isoformat()
        assert result["period_end"] == today.isoformat()

    async def test_field_names_in_result(self):
        mock_db = AsyncMock()
        record = MagicMock()
        record.course_name = "Test"
        record.training_type = "fire_training"
        record.completion_date = date(2025, 1, 1)
        record.hours_completed = 1.0
        record.instructor = "Inst"
        record.location = "Loc"
        record.location_id = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [record]
        mock_db.execute.return_value = mock_result

        service = RecordCompletenessService(mock_db)
        result = await service.evaluate_record_completeness(
            "org-1", start_date=date(2025, 1, 1), end_date=date(2025, 12, 31)
        )

        field_names = [f["field_name"] for f in result["fields"]]
        assert "course_name" in field_names
        assert "training_type" in field_names
        assert "completion_date" in field_names
        assert "hours_completed" in field_names
        assert "instructor" in field_names
        assert "location" in field_names

    async def test_multiple_records_mixed_completeness(self):
        """Test fill rate calculations with multiple records of varying completeness."""
        mock_db = AsyncMock()

        # Record 1: fully complete
        r1 = MagicMock()
        r1.course_name = "Course A"
        r1.training_type = "fire_training"
        r1.completion_date = date(2025, 1, 1)
        r1.hours_completed = 4.0
        r1.instructor = "Smith"
        r1.location = "Station 1"
        r1.location_id = None

        # Record 2: missing instructor only
        r2 = MagicMock()
        r2.course_name = "Course B"
        r2.training_type = "hazmat"
        r2.completion_date = date(2025, 2, 1)
        r2.hours_completed = 2.0
        r2.instructor = None
        r2.location = "Station 2"
        r2.location_id = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [r1, r2]
        mock_db.execute.return_value = mock_result

        service = RecordCompletenessService(mock_db)
        result = await service.evaluate_record_completeness(
            "org-1", start_date=date(2025, 1, 1), end_date=date(2025, 12, 31)
        )

        assert result["total_records"] == 2

        # Find the instructor field
        instructor_field = next(
            f for f in result["fields"] if f["field_name"] == "instructor"
        )
        assert instructor_field["records_with_value"] == 1
        assert instructor_field["fill_rate_pct"] == 50.0


# ============================================
# AnnualComplianceReportService Helper Tests
# ============================================


class TestRecertificationSummary:
    """Test _get_recertification_summary helper."""

    async def test_empty_results(self):
        mock_db = AsyncMock()

        mock_pathways_result = MagicMock()
        mock_pathways_result.scalar.return_value = 0

        mock_tasks_result = MagicMock()
        mock_tasks_result.__iter__ = MagicMock(return_value=iter([]))

        mock_db.execute.side_effect = [mock_pathways_result, mock_tasks_result]

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_recertification_summary("org-1")

        assert result["active_pathways"] == 0
        assert result["tasks_completed"] == 0
        assert result["tasks_pending"] == 0
        assert result["tasks_expired"] == 0

    async def test_with_data(self):
        mock_db = AsyncMock()

        mock_pathways_result = MagicMock()
        mock_pathways_result.scalar.return_value = 3

        mock_tasks_result = MagicMock()
        mock_tasks_result.__iter__ = MagicMock(
            return_value=iter(
                [
                    (RenewalTaskStatus.COMPLETED, 10),
                    (RenewalTaskStatus.PENDING, 5),
                    (RenewalTaskStatus.IN_PROGRESS, 3),
                    (RenewalTaskStatus.EXPIRED, 2),
                    (RenewalTaskStatus.LAPSED, 1),
                ]
            )
        )

        mock_db.execute.side_effect = [mock_pathways_result, mock_tasks_result]

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_recertification_summary("org-1")

        assert result["active_pathways"] == 3
        assert result["tasks_completed"] == 10
        assert result["tasks_pending"] == 8  # pending(5) + in_progress(3)
        assert result["tasks_expired"] == 3  # expired(2) + lapsed(1)

    async def test_pending_combines_pending_and_in_progress(self):
        """Verify tasks_pending sums PENDING + IN_PROGRESS statuses."""
        mock_db = AsyncMock()

        mock_pathways_result = MagicMock()
        mock_pathways_result.scalar.return_value = 1

        mock_tasks_result = MagicMock()
        mock_tasks_result.__iter__ = MagicMock(
            return_value=iter(
                [
                    (RenewalTaskStatus.PENDING, 7),
                    (RenewalTaskStatus.IN_PROGRESS, 4),
                ]
            )
        )

        mock_db.execute.side_effect = [mock_pathways_result, mock_tasks_result]

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_recertification_summary("org-1")

        assert result["tasks_pending"] == 11

    async def test_expired_combines_expired_and_lapsed(self):
        """Verify tasks_expired sums EXPIRED + LAPSED statuses."""
        mock_db = AsyncMock()

        mock_pathways_result = MagicMock()
        mock_pathways_result.scalar.return_value = 1

        mock_tasks_result = MagicMock()
        mock_tasks_result.__iter__ = MagicMock(
            return_value=iter(
                [
                    (RenewalTaskStatus.EXPIRED, 6),
                    (RenewalTaskStatus.LAPSED, 3),
                ]
            )
        )

        mock_db.execute.side_effect = [mock_pathways_result, mock_tasks_result]

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_recertification_summary("org-1")

        assert result["tasks_expired"] == 9


class TestInstructorSummary:
    """Test _get_instructor_summary helper."""

    async def test_empty_results(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        today = date(2025, 6, 15)
        result = await service._get_instructor_summary("org-1", today)

        assert result["total_qualified"] == 0
        assert result["active_instructors"] == 0
        assert result["expiring_qualifications"] == 0

    async def test_with_qualifications(self):
        mock_db = AsyncMock()
        today = date(2025, 6, 15)

        # Active, not expiring soon
        q1 = MagicMock()
        q1.active = True
        q1.expiration_date = date(2026, 1, 1)

        # Active, expiring within 90 days
        q2 = MagicMock()
        q2.active = True
        q2.expiration_date = date(2025, 8, 1)  # within 90 days of June 15

        # Inactive
        q3 = MagicMock()
        q3.active = False
        q3.expiration_date = date(2025, 7, 1)

        # Active, already expired (before today)
        q4 = MagicMock()
        q4.active = True
        q4.expiration_date = date(2025, 5, 1)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [q1, q2, q3, q4]
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_instructor_summary("org-1", today)

        assert result["total_qualified"] == 4
        assert result["active_instructors"] == 3  # q1, q2, q4
        assert result["expiring_qualifications"] == 1  # only q2

    async def test_expiring_boundary_90_days(self):
        """Test the 90-day expiring window boundary."""
        mock_db = AsyncMock()
        today = date(2025, 6, 15)

        # Expires exactly at today + 90 days (should count)
        q1 = MagicMock()
        q1.active = True
        q1.expiration_date = today + timedelta(days=90)

        # Expires at today + 91 days (should NOT count)
        q2 = MagicMock()
        q2.active = True
        q2.expiration_date = today + timedelta(days=91)

        # Expires today (should count)
        q3 = MagicMock()
        q3.active = True
        q3.expiration_date = today

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [q1, q2, q3]
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_instructor_summary("org-1", today)

        assert result["expiring_qualifications"] == 2  # q1, q3

    async def test_inactive_not_counted_as_expiring(self):
        """Inactive instructors should not count as expiring even if date is near."""
        mock_db = AsyncMock()
        today = date(2025, 6, 15)

        q1 = MagicMock()
        q1.active = False
        q1.expiration_date = today + timedelta(days=30)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [q1]
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_instructor_summary("org-1", today)

        assert result["expiring_qualifications"] == 0

    async def test_no_expiration_date_not_counted(self):
        """Instructors without an expiration_date should not be counted as expiring."""
        mock_db = AsyncMock()
        today = date(2025, 6, 15)

        q1 = MagicMock()
        q1.active = True
        q1.expiration_date = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [q1]
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_instructor_summary("org-1", today)

        assert result["active_instructors"] == 1
        assert result["expiring_qualifications"] == 0


class TestMultiAgencySummary:
    """Test _get_multi_agency_summary helper."""

    async def test_empty_results(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_multi_agency_summary(
            "org-1", date(2025, 1, 1), date(2025, 12, 31)
        )

        assert result["total_exercises"] == 0
        assert result["nims_compliant_exercises"] == 0
        assert result["total_participants"] == 0

    async def test_with_exercises(self):
        mock_db = AsyncMock()

        e1 = MagicMock()
        e1.nims_compliant = True
        e1.total_participants = 45

        e2 = MagicMock()
        e2.nims_compliant = False
        e2.total_participants = 20

        e3 = MagicMock()
        e3.nims_compliant = True
        e3.total_participants = None  # no participant count

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [e1, e2, e3]
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_multi_agency_summary(
            "org-1", date(2025, 1, 1), date(2025, 12, 31)
        )

        assert result["total_exercises"] == 3
        assert result["nims_compliant_exercises"] == 2
        assert result["total_participants"] == 65  # 45 + 20 + 0

    async def test_none_participants_treated_as_zero(self):
        """Exercises with None total_participants should contribute 0."""
        mock_db = AsyncMock()

        e1 = MagicMock()
        e1.nims_compliant = False
        e1.total_participants = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [e1]
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_multi_agency_summary(
            "org-1", date(2025, 1, 1), date(2025, 12, 31)
        )

        assert result["total_participants"] == 0


class TestEffectivenessSummary:
    """Test _get_effectiveness_summary helper."""

    async def test_empty_results(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_effectiveness_summary("org-1", 2025)

        assert result["total_evaluations"] == 0
        assert result["avg_reaction_rating"] is None
        assert result["avg_knowledge_gain"] is None

    async def test_with_evaluations(self):
        mock_db = AsyncMock()

        ev1 = MagicMock()
        ev1.overall_rating = 4.0
        ev1.knowledge_gain_percentage = 20.0

        ev2 = MagicMock()
        ev2.overall_rating = 5.0
        ev2.knowledge_gain_percentage = 30.0

        ev3 = MagicMock()
        ev3.overall_rating = None
        ev3.knowledge_gain_percentage = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [ev1, ev2, ev3]
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_effectiveness_summary("org-1", 2025)

        assert result["total_evaluations"] == 3
        assert result["avg_reaction_rating"] == 4.5  # (4+5)/2
        assert result["avg_knowledge_gain"] == 25.0  # (20+30)/2

    async def test_all_none_ratings(self):
        mock_db = AsyncMock()

        ev1 = MagicMock()
        ev1.overall_rating = None
        ev1.knowledge_gain_percentage = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [ev1]
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_effectiveness_summary("org-1", 2025)

        assert result["total_evaluations"] == 1
        assert result["avg_reaction_rating"] is None
        assert result["avg_knowledge_gain"] is None

    async def test_averages_rounded_to_2_decimals(self):
        mock_db = AsyncMock()

        ev1 = MagicMock()
        ev1.overall_rating = 3.0
        ev1.knowledge_gain_percentage = 10.0

        ev2 = MagicMock()
        ev2.overall_rating = 4.0
        ev2.knowledge_gain_percentage = 20.0

        ev3 = MagicMock()
        ev3.overall_rating = 5.0
        ev3.knowledge_gain_percentage = 30.0

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [ev1, ev2, ev3]
        mock_db.execute.return_value = mock_result

        service = AnnualComplianceReportService(mock_db)
        result = await service._get_effectiveness_summary("org-1", 2025)

        assert result["avg_reaction_rating"] == 4.0  # (3+4+5)/3
        assert result["avg_knowledge_gain"] == 20.0  # (10+20+30)/3


# ============================================
# RenewalTaskStatus Enum Tests
# ============================================


class TestRenewalTaskStatusInComplianceContext:
    """Verify RenewalTaskStatus values used by the compliance report."""

    def test_completed_value(self):
        assert RenewalTaskStatus.COMPLETED.value == "completed"

    def test_pending_value(self):
        assert RenewalTaskStatus.PENDING.value == "pending"

    def test_in_progress_value(self):
        assert RenewalTaskStatus.IN_PROGRESS.value == "in_progress"

    def test_expired_value(self):
        assert RenewalTaskStatus.EXPIRED.value == "expired"

    def test_lapsed_value(self):
        assert RenewalTaskStatus.LAPSED.value == "lapsed"

    def test_status_inherits_str(self):
        assert issubclass(RenewalTaskStatus, str)

    def test_status_count(self):
        assert len(RenewalTaskStatus) == 5
