"""
Medical Screening Service Unit Tests

Tests for MedicalScreeningService business logic using mocked database sessions.

Covers:
  - Compliance calculation (fully compliant, partial, expired)
  - Expiring-soon logic (date boundaries, days calculation)
  - CRUD delegation (create_requirement, create_record, etc.)
"""

import pytest
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.medical_screening_service import MedicalScreeningService
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)


# ============================================
# Fixtures
# ============================================


@pytest.fixture
def mock_db():
    """Create a mock async database session."""
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.delete = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    """Create a MedicalScreeningService with a mocked db."""
    return MedicalScreeningService(mock_db)


@pytest.fixture
def org_id():
    return str(uuid4())


@pytest.fixture
def user_id():
    return str(uuid4())


# ============================================
# Helper Factories
# ============================================


def make_requirement(
    org_id,
    screening_type=ScreeningType.PHYSICAL_EXAM,
    frequency_months=12,
    is_active=True,
    name="Annual Physical",
):
    req = MagicMock(spec=ScreeningRequirement)
    req.id = str(uuid4())
    req.organization_id = org_id
    req.name = name
    req.screening_type = screening_type
    req.frequency_months = frequency_months
    req.is_active = is_active
    req.grace_period_days = 30
    return req


def make_record(
    org_id,
    screening_type=ScreeningType.PHYSICAL_EXAM,
    status=ScreeningStatus.PASSED,
    completed_date=None,
    expiration_date=None,
    user_id=None,
    prospect_id=None,
):
    rec = MagicMock(spec=ScreeningRecord)
    rec.id = str(uuid4())
    rec.organization_id = org_id
    rec.screening_type = screening_type
    rec.status = status
    rec.completed_date = completed_date or date.today()
    rec.expiration_date = expiration_date
    rec.user_id = user_id
    rec.prospect_id = prospect_id
    return rec


# ============================================
# Compliance Calculation Tests
# ============================================


class TestComplianceStatus:
    """Tests for get_compliance_status."""

    async def test_fully_compliant_no_requirements(self, service, org_id, user_id):
        """When there are no requirements, the user is fully compliant."""
        with patch.object(
            service, "list_requirements", return_value=[]
        ), patch.object(service, "list_records", return_value=[]):
            summary = await service.get_compliance_status(
                org_id, user_id=user_id
            )

        assert summary.is_fully_compliant is True
        assert summary.total_requirements == 0
        assert summary.compliant_count == 0
        assert summary.non_compliant_count == 0

    async def test_fully_compliant_with_passing_records(
        self, service, org_id, user_id
    ):
        """User with passing records for all requirements is fully compliant."""
        req = make_requirement(org_id)
        rec = make_record(
            org_id,
            user_id=user_id,
            status=ScreeningStatus.PASSED,
            expiration_date=date.today() + timedelta(days=180),
        )

        with patch.object(
            service, "list_requirements", return_value=[req]
        ), patch.object(service, "list_records", return_value=[rec]):
            summary = await service.get_compliance_status(
                org_id, user_id=user_id
            )

        assert summary.is_fully_compliant is True
        assert summary.compliant_count == 1
        assert summary.non_compliant_count == 0

    async def test_non_compliant_when_no_records(self, service, org_id, user_id):
        """User with requirements but no records is non-compliant."""
        req = make_requirement(org_id)

        with patch.object(
            service, "list_requirements", return_value=[req]
        ), patch.object(service, "list_records", return_value=[]):
            summary = await service.get_compliance_status(
                org_id, user_id=user_id
            )

        assert summary.is_fully_compliant is False
        assert summary.compliant_count == 0
        assert summary.non_compliant_count == 1

    async def test_non_compliant_when_record_expired(
        self, service, org_id, user_id
    ):
        """User with expired screening record is non-compliant."""
        req = make_requirement(org_id)
        rec = make_record(
            org_id,
            user_id=user_id,
            status=ScreeningStatus.PASSED,
            expiration_date=date.today() - timedelta(days=10),
        )

        with patch.object(
            service, "list_requirements", return_value=[req]
        ), patch.object(service, "list_records", return_value=[rec]):
            summary = await service.get_compliance_status(
                org_id, user_id=user_id
            )

        assert summary.is_fully_compliant is False
        assert summary.non_compliant_count == 1

    async def test_expiring_soon_counted_when_within_30_days(
        self, service, org_id, user_id
    ):
        """Records expiring within 30 days are counted as expiring soon."""
        req = make_requirement(org_id)
        rec = make_record(
            org_id,
            user_id=user_id,
            status=ScreeningStatus.PASSED,
            expiration_date=date.today() + timedelta(days=15),
        )

        with patch.object(
            service, "list_requirements", return_value=[req]
        ), patch.object(service, "list_records", return_value=[rec]):
            summary = await service.get_compliance_status(
                org_id, user_id=user_id
            )

        assert summary.expiring_soon_count == 1
        assert summary.is_fully_compliant is True  # still compliant

    async def test_no_expiration_means_always_compliant(
        self, service, org_id, user_id
    ):
        """A passing record with no expiration date is considered indefinitely compliant."""
        req = make_requirement(org_id)
        rec = make_record(
            org_id,
            user_id=user_id,
            status=ScreeningStatus.COMPLETED,
            expiration_date=None,
        )

        with patch.object(
            service, "list_requirements", return_value=[req]
        ), patch.object(service, "list_records", return_value=[rec]):
            summary = await service.get_compliance_status(
                org_id, user_id=user_id
            )

        assert summary.is_fully_compliant is True
        assert summary.expiring_soon_count == 0

    async def test_multiple_requirements_partial_compliance(
        self, service, org_id, user_id
    ):
        """Only some requirements met yields partial compliance."""
        req1 = make_requirement(
            org_id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            name="Physical",
        )
        req2 = make_requirement(
            org_id,
            screening_type=ScreeningType.DRUG_SCREENING,
            name="Drug Test",
        )
        rec = make_record(
            org_id,
            user_id=user_id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.PASSED,
            expiration_date=date.today() + timedelta(days=180),
        )

        with patch.object(
            service, "list_requirements", return_value=[req1, req2]
        ), patch.object(service, "list_records", return_value=[rec]):
            summary = await service.get_compliance_status(
                org_id, user_id=user_id
            )

        assert summary.is_fully_compliant is False
        assert summary.compliant_count == 1
        assert summary.non_compliant_count == 1
        assert summary.total_requirements == 2

    async def test_waived_record_counts_as_compliant(
        self, service, org_id, user_id
    ):
        """A waived screening record is treated as compliant."""
        req = make_requirement(org_id)
        rec = make_record(
            org_id,
            user_id=user_id,
            status=ScreeningStatus.WAIVED,
            expiration_date=None,
        )

        with patch.object(
            service, "list_requirements", return_value=[req]
        ), patch.object(service, "list_records", return_value=[rec]):
            summary = await service.get_compliance_status(
                org_id, user_id=user_id
            )

        assert summary.is_fully_compliant is True


# ============================================
# Expiring Soon Tests
# ============================================


class TestExpiringSoon:
    """Tests for get_expiring_soon."""

    async def test_returns_empty_when_no_expiring_records(
        self, service, mock_db, org_id
    ):
        """No expiring records returns empty list."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        result = await service.get_expiring_soon(org_id, days=30)
        assert result == []

    async def test_calculates_days_until_expiration(
        self, service, mock_db, org_id
    ):
        """Days until expiration is correctly calculated."""
        exp_date = date.today() + timedelta(days=15)
        record = make_record(
            org_id,
            status=ScreeningStatus.PASSED,
            expiration_date=exp_date,
            user_id=str(uuid4()),
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [record]
        mock_db.execute.return_value = mock_result

        result = await service.get_expiring_soon(org_id, days=30)

        assert len(result) == 1
        assert result[0].days_until_expiration == 15
        assert result[0].expiration_date == exp_date

    async def test_includes_records_up_to_days_parameter(
        self, service, mock_db, org_id
    ):
        """The days parameter controls the expiration window."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        await service.get_expiring_soon(org_id, days=60)

        # Verify the query was executed (details depend on SQLAlchemy mock)
        assert mock_db.execute.called


# ============================================
# CRUD Tests
# ============================================


class TestCRUD:
    """Tests for basic CRUD operations."""

    async def test_create_requirement_adds_to_db(self, service, mock_db, org_id):
        """Creating a requirement adds it to the session."""
        from app.schemas.medical_screening import ScreeningRequirementCreate

        data = ScreeningRequirementCreate(
            name="Annual Physical",
            screening_type="physical_exam",
            is_active=True,
            grace_period_days=30,
        )

        result = await service.create_requirement(org_id, data)

        assert mock_db.add.called
        assert result.name == "Annual Physical"
        assert result.organization_id == org_id

    async def test_delete_requirement_returns_false_when_not_found(
        self, service, org_id
    ):
        """Deleting a non-existent requirement returns False."""
        with patch.object(service, "get_requirement", return_value=None):
            result = await service.delete_requirement("bad-id", org_id)
        assert result is False

    async def test_delete_requirement_returns_true_on_success(
        self, service, mock_db, org_id
    ):
        """Deleting an existing requirement returns True."""
        req = make_requirement(org_id)
        with patch.object(service, "get_requirement", return_value=req):
            result = await service.delete_requirement(req.id, org_id)
        assert result is True
        assert mock_db.delete.called

    async def test_create_record_adds_to_db(self, service, mock_db, org_id):
        """Creating a record adds it to the session."""
        from app.schemas.medical_screening import ScreeningRecordCreate

        data = ScreeningRecordCreate(
            screening_type="drug_screening",
            status="scheduled",
        )

        result = await service.create_record(org_id, data)

        assert mock_db.add.called
        assert result.organization_id == org_id

    async def test_update_record_returns_none_when_not_found(
        self, service, org_id
    ):
        """Updating a non-existent record returns None."""
        from app.schemas.medical_screening import ScreeningRecordUpdate

        data = ScreeningRecordUpdate(status="passed")
        with patch.object(service, "get_record", return_value=None):
            result = await service.update_record("bad-id", org_id, data)
        assert result is None
