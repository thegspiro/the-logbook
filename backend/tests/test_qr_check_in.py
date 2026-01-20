"""
Test Module for QR Code Check-In Functionality

This module tests the QR code-based self-check-in system for events,
including time window validation, RSVP creation, and duplicate handling.

To run these tests:
1. Install all dependencies: pip install -r requirements.txt
2. Set up test database configuration
3. Run: pytest tests/test_qr_check_in.py -v

Test Coverage:
- QR code data available within valid time window
- QR code data invalid before/after time window
- QR code respects actual_end_time when set
- Self-check-in creates RSVP for users without existing RSVP
- Duplicate check-in attempts are rejected
- Time window validation for self-check-in
- Cancelled events cannot be checked into
- Cross-organization access is prevented
"""

import pytest
from datetime import datetime, timedelta
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.event_service import EventService
from app.models.event import Event, EventRSVP, EventType, RSVPStatus
from app.models.user import User


class TestQRCheckInTimeValidation:
    """Test time window validation for QR code check-in"""

    @pytest.mark.asyncio
    async def test_qr_data_available_within_time_window(self):
        """Test that QR code data is available when within valid time window"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        org_id = uuid4()

        # Event starts in 30 minutes, ends in 2 hours
        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Test Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = event
        mock_db.execute = AsyncMock(return_value=mock_result)

        # Act
        service = EventService(mock_db)
        data, error = await service.get_qr_check_in_data(event_id, org_id)

        # Assert
        assert error is None
        assert data is not None
        assert data["is_valid"] is True
        assert data["event_id"] == str(event_id)
        assert data["event_name"] == "Test Event"

    @pytest.mark.asyncio
    async def test_qr_data_not_available_before_window(self):
        """Test that QR code is not valid before the time window"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        org_id = uuid4()

        # Event starts in 2 hours (more than 1 hour from now)
        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Future Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now + timedelta(hours=2),
            end_datetime=now + timedelta(hours=3),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = event
        mock_db.execute = AsyncMock(return_value=mock_result)

        # Act
        service = EventService(mock_db)
        data, error = await service.get_qr_check_in_data(event_id, org_id)

        # Assert
        assert error is None
        assert data is not None
        assert data["is_valid"] is False

    @pytest.mark.asyncio
    async def test_qr_data_not_available_after_scheduled_end(self):
        """Test that QR code is not valid after scheduled end time"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        org_id = uuid4()

        # Event ended 1 hour ago
        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Past Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now - timedelta(hours=3),
            end_datetime=now - timedelta(hours=1),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = event
        mock_db.execute = AsyncMock(return_value=mock_result)

        # Act
        service = EventService(mock_db)
        data, error = await service.get_qr_check_in_data(event_id, org_id)

        # Assert
        assert error is None
        assert data is not None
        assert data["is_valid"] is False

    @pytest.mark.asyncio
    async def test_qr_data_respects_actual_end_time(self):
        """Test that actual_end_time takes precedence over scheduled end_datetime"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        org_id = uuid4()

        # Event scheduled to end in 2 hours, but actual_end_time is 30 minutes ago
        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Early Ended Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now - timedelta(hours=2),
            end_datetime=now + timedelta(hours=2),  # Scheduled to end in future
            actual_end_time=now - timedelta(minutes=30),  # Actually ended 30 mins ago
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = event
        mock_db.execute = AsyncMock(return_value=mock_result)

        # Act
        service = EventService(mock_db)
        data, error = await service.get_qr_check_in_data(event_id, org_id)

        # Assert
        assert error is None
        assert data is not None
        assert data["is_valid"] is False  # Should not be valid since actual end time passed
        assert data["actual_end_time"] is not None

    @pytest.mark.asyncio
    async def test_qr_data_cancelled_event(self):
        """Test that cancelled events return an error"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        org_id = uuid4()

        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Cancelled Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=True,
            cancellation_reason="Weather conditions",
            created_by=uuid4(),
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = event
        mock_db.execute = AsyncMock(return_value=mock_result)

        # Act
        service = EventService(mock_db)
        data, error = await service.get_qr_check_in_data(event_id, org_id)

        # Assert
        assert error == "Event has been cancelled"
        assert data is None


class TestSelfCheckIn:
    """Test self-check-in functionality via QR code"""

    @pytest.mark.asyncio
    async def test_self_check_in_creates_rsvp(self):
        """Test that self-check-in creates RSVP if it doesn't exist"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        user_id = uuid4()
        org_id = uuid4()

        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Test Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        user = User(
            id=user_id,
            organization_id=org_id,
            email="test@example.com",
            first_name="Test",
            last_name="User",
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)

        # Mock event query
        mock_event_result = MagicMock()
        mock_event_result.scalar_one_or_none.return_value = event

        # Mock user query
        mock_user_result = MagicMock()
        mock_user_result.scalar_one_or_none.return_value = user

        # Mock RSVP query (no existing RSVP)
        mock_rsvp_result = MagicMock()
        mock_rsvp_result.scalar_one_or_none.return_value = None

        # Setup execute to return different results based on query
        call_count = 0
        async def mock_execute(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_event_result
            elif call_count == 2:
                return mock_user_result
            else:
                return mock_rsvp_result

        mock_db.execute = mock_execute
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        # Act
        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event_id, user_id, org_id)

        # Assert
        assert error is None
        assert rsvp is not None
        mock_db.add.assert_called_once()  # RSVP should be created
        mock_db.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_self_check_in_duplicate_check_in(self):
        """Test that duplicate check-in attempts return an error"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        user_id = uuid4()
        org_id = uuid4()

        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Test Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        user = User(
            id=user_id,
            organization_id=org_id,
            email="test@example.com",
            first_name="Test",
            last_name="User",
        )

        # Existing RSVP that's already checked in
        existing_rsvp = EventRSVP(
            id=uuid4(),
            event_id=event_id,
            user_id=user_id,
            status=RSVPStatus.GOING,
            guest_count=0,
            responded_at=now - timedelta(hours=1),
            checked_in=True,
            checked_in_at=now - timedelta(minutes=30),
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)

        # Mock event query
        mock_event_result = MagicMock()
        mock_event_result.scalar_one_or_none.return_value = event

        # Mock user query
        mock_user_result = MagicMock()
        mock_user_result.scalar_one_or_none.return_value = user

        # Mock RSVP query (existing checked-in RSVP)
        mock_rsvp_result = MagicMock()
        mock_rsvp_result.scalar_one_or_none.return_value = existing_rsvp

        # Setup execute to return different results based on query
        call_count = 0
        async def mock_execute(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_event_result
            elif call_count == 2:
                return mock_user_result
            else:
                return mock_rsvp_result

        mock_db.execute = mock_execute

        # Act
        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event_id, user_id, org_id)

        # Assert
        assert error == "You are already checked in to this event"
        assert rsvp is None

    @pytest.mark.asyncio
    async def test_self_check_in_before_time_window(self):
        """Test that check-in before time window returns an error"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        user_id = uuid4()
        org_id = uuid4()

        # Event starts in 2 hours (outside 1-hour window)
        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Future Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now + timedelta(hours=2),
            end_datetime=now + timedelta(hours=3),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        user = User(
            id=user_id,
            organization_id=org_id,
            email="test@example.com",
            first_name="Test",
            last_name="User",
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)

        # Mock event query
        mock_event_result = MagicMock()
        mock_event_result.scalar_one_or_none.return_value = event

        # Mock user query
        mock_user_result = MagicMock()
        mock_user_result.scalar_one_or_none.return_value = user

        # Setup execute to return different results based on query
        call_count = 0
        async def mock_execute(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_event_result
            else:
                return mock_user_result

        mock_db.execute = mock_execute

        # Act
        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event_id, user_id, org_id)

        # Assert
        assert error == "Check-in is not available yet. It opens 1 hour before the event."
        assert rsvp is None

    @pytest.mark.asyncio
    async def test_self_check_in_after_scheduled_end(self):
        """Test that check-in after scheduled end time returns an error"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        user_id = uuid4()
        org_id = uuid4()

        # Event ended 1 hour ago
        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Past Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now - timedelta(hours=3),
            end_datetime=now - timedelta(hours=1),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        user = User(
            id=user_id,
            organization_id=org_id,
            email="test@example.com",
            first_name="Test",
            last_name="User",
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)

        # Mock event query
        mock_event_result = MagicMock()
        mock_event_result.scalar_one_or_none.return_value = event

        # Mock user query
        mock_user_result = MagicMock()
        mock_user_result.scalar_one_or_none.return_value = user

        # Setup execute to return different results based on query
        call_count = 0
        async def mock_execute(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_event_result
            else:
                return mock_user_result

        mock_db.execute = mock_execute

        # Act
        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event_id, user_id, org_id)

        # Assert
        assert error == "Check-in is no longer available. The event has ended."
        assert rsvp is None

    @pytest.mark.asyncio
    async def test_self_check_in_after_actual_end_time(self):
        """Test that check-in respects actual_end_time when set"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        user_id = uuid4()
        org_id = uuid4()

        # Event scheduled to end in future, but actual_end_time is in past
        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Early Ended Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now - timedelta(hours=2),
            end_datetime=now + timedelta(hours=2),  # Scheduled to end in future
            actual_end_time=now - timedelta(minutes=30),  # Actually ended 30 mins ago
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        user = User(
            id=user_id,
            organization_id=org_id,
            email="test@example.com",
            first_name="Test",
            last_name="User",
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)

        # Mock event query
        mock_event_result = MagicMock()
        mock_event_result.scalar_one_or_none.return_value = event

        # Mock user query
        mock_user_result = MagicMock()
        mock_user_result.scalar_one_or_none.return_value = user

        # Setup execute to return different results based on query
        call_count = 0
        async def mock_execute(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_event_result
            else:
                return mock_user_result

        mock_db.execute = mock_execute

        # Act
        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event_id, user_id, org_id)

        # Assert
        assert error == "Check-in is no longer available. The event has ended."
        assert rsvp is None

    @pytest.mark.asyncio
    async def test_self_check_in_cancelled_event(self):
        """Test that check-in to cancelled event returns an error"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        user_id = uuid4()
        org_id = uuid4()

        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Cancelled Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=True,
            cancellation_reason="Weather conditions",
            created_by=uuid4(),
        )

        user = User(
            id=user_id,
            organization_id=org_id,
            email="test@example.com",
            first_name="Test",
            last_name="User",
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)

        # Mock event query
        mock_event_result = MagicMock()
        mock_event_result.scalar_one_or_none.return_value = event

        # Mock user query
        mock_user_result = MagicMock()
        mock_user_result.scalar_one_or_none.return_value = user

        # Setup execute to return different results based on query
        call_count = 0
        async def mock_execute(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_event_result
            else:
                return mock_user_result

        mock_db.execute = mock_execute

        # Act
        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event_id, user_id, org_id)

        # Assert
        assert error == "Event has been cancelled"
        assert rsvp is None

    @pytest.mark.asyncio
    async def test_self_check_in_user_not_in_organization(self):
        """Test that users from different organizations cannot check in"""
        # Arrange
        now = datetime.utcnow()
        event_id = uuid4()
        user_id = uuid4()
        org_id = uuid4()

        event = Event(
            id=event_id,
            organization_id=org_id,
            title="Test Event",
            description="Test Description",
            event_type=EventType.MEETING,
            location="Test Location",
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
            requires_rsvp=False,
            is_mandatory=False,
            is_cancelled=False,
            created_by=uuid4(),
        )

        # Mock database session
        mock_db = AsyncMock(spec=AsyncSession)

        # Mock event query
        mock_event_result = MagicMock()
        mock_event_result.scalar_one_or_none.return_value = event

        # Mock user query (user not found in organization)
        mock_user_result = MagicMock()
        mock_user_result.scalar_one_or_none.return_value = None

        # Setup execute to return different results based on query
        call_count = 0
        async def mock_execute(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_event_result
            else:
                return mock_user_result

        mock_db.execute = mock_execute

        # Act
        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event_id, user_id, org_id)

        # Assert
        assert error == "User not found in organization"
        assert rsvp is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
