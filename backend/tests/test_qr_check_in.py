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
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.event_service import EventService
from app.models.event import Event, EventRSVP, EventType, RSVPStatus
from app.models.user import User


# ---- Factory helpers to reduce duplication ----

def _make_org(org_id=None, timezone_val=None):
    """Create a mock organization with a timezone attribute."""
    org = MagicMock()
    org.id = org_id or uuid4()
    org.timezone = timezone_val
    return org


def _make_event(org_id=None, **overrides):
    """Create a test Event with sensible defaults."""
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=uuid4(),
        organization_id=org_id or uuid4(),
        title="Test Event",
        description="Test Description",
        event_type=EventType.BUSINESS_MEETING,
        location="Test Location",
        start_datetime=now + timedelta(minutes=30),
        end_datetime=now + timedelta(hours=2),
        requires_rsvp=False,
        is_mandatory=False,
        is_cancelled=False,
        created_by=uuid4(),
    )
    defaults.update(overrides)
    return Event(**defaults)


def _make_user(org_id=None, **overrides):
    """Create a test User with sensible defaults."""
    defaults = dict(
        id=uuid4(),
        organization_id=org_id or uuid4(),
        email="test@example.com",
        first_name="Test",
        last_name="User",
    )
    defaults.update(overrides)
    return User(**defaults)


def _mock_db_returning(*results):
    """Create an AsyncMock db session that returns results in sequence."""
    mock_db = AsyncMock(spec=AsyncSession)
    mocks = []
    for result in results:
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = result
        mocks.append(mock_result)

    call_count = 0

    async def mock_execute(*args, **kwargs):
        nonlocal call_count
        idx = min(call_count, len(mocks) - 1)
        call_count += 1
        return mocks[idx]

    mock_db.execute = mock_execute
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()
    return mock_db


class TestQRCheckInTimeValidation:
    """Test time window validation for QR code check-in"""

    @pytest.mark.asyncio
    async def test_qr_data_available_within_time_window(self):
        """Test that QR code data is available when within valid time window"""
        now = datetime.now(timezone.utc)
        org_id = uuid4()
        event = _make_event(
            org_id=org_id,
            title="Test Event",
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
        )
        mock_db = _mock_db_returning(event)

        service = EventService(mock_db)
        data, error = await service.get_qr_check_in_data(event.id, org_id)

        assert error is None
        assert data is not None
        assert data["is_valid"] is True
        assert data["event_id"] == str(event.id)
        assert data["event_name"] == "Test Event"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "label, start_offset, end_offset, extra_kwargs",
        [
            ("before window", timedelta(hours=2), timedelta(hours=3), {}),
            ("after scheduled end", timedelta(hours=-3), timedelta(hours=-1), {}),
            (
                "after actual_end_time",
                timedelta(hours=-2),
                timedelta(hours=2),
                {"actual_end_time": "USE_PAST"},
            ),
        ],
        ids=["before_window", "after_scheduled_end", "after_actual_end"],
    )
    async def test_qr_data_not_valid_outside_window(
        self, label, start_offset, end_offset, extra_kwargs
    ):
        """Test that QR code is_valid=False outside the time window"""
        now = datetime.now(timezone.utc)
        org_id = uuid4()
        if extra_kwargs.get("actual_end_time") == "USE_PAST":
            extra_kwargs["actual_end_time"] = now - timedelta(minutes=30)
        event = _make_event(
            org_id=org_id,
            start_datetime=now + start_offset,
            end_datetime=now + end_offset,
            **extra_kwargs,
        )
        mock_db = _mock_db_returning(event)

        service = EventService(mock_db)
        data, error = await service.get_qr_check_in_data(event.id, org_id)

        assert error is None
        assert data is not None
        assert data["is_valid"] is False

    @pytest.mark.asyncio
    async def test_qr_data_cancelled_event(self):
        """Test that cancelled events return an error"""
        now = datetime.now(timezone.utc)
        org_id = uuid4()
        event = _make_event(
            org_id=org_id,
            title="Cancelled Event",
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
            is_cancelled=True,
            cancellation_reason="Weather conditions",
        )
        mock_db = _mock_db_returning(event)

        service = EventService(mock_db)
        data, error = await service.get_qr_check_in_data(event.id, org_id)

        assert error == "Event has been cancelled"
        assert data is None

    @pytest.mark.asyncio
    async def test_qr_data_event_not_found(self):
        """Test that a missing event returns an error"""
        org_id = uuid4()
        mock_db = _mock_db_returning(None)

        service = EventService(mock_db)
        data, error = await service.get_qr_check_in_data(uuid4(), org_id)

        assert error is not None
        assert data is None


class TestSelfCheckIn:
    """Test self-check-in functionality via QR code"""

    @pytest.mark.asyncio
    async def test_self_check_in_creates_rsvp(self):
        """Test that self-check-in creates RSVP if it doesn't exist"""
        now = datetime.now(timezone.utc)
        org_id = uuid4()
        event = _make_event(
            org_id=org_id,
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
        )
        user = _make_user(org_id=org_id)
        org = _make_org(org_id=org_id)
        mock_db = _mock_db_returning(event, user, org, None)

        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event.id, user.id, org_id)

        assert error is None
        assert rsvp is not None
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()
        # Verify the RSVP was created with correct check-in data
        added_obj = mock_db.add.call_args[0][0]
        assert added_obj.event_id == event.id
        assert added_obj.user_id == user.id
        assert added_obj.checked_in is True
        assert added_obj.status == RSVPStatus.GOING

    @pytest.mark.asyncio
    async def test_self_check_in_duplicate_check_in(self):
        """Test that duplicate check-in attempts return an error"""
        now = datetime.now(timezone.utc)
        org_id = uuid4()
        event = _make_event(
            org_id=org_id,
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
        )
        user = _make_user(org_id=org_id)
        existing_rsvp = EventRSVP(
            id=uuid4(),
            event_id=event.id,
            user_id=user.id,
            status=RSVPStatus.GOING,
            guest_count=0,
            responded_at=now - timedelta(hours=1),
            checked_in=True,
            checked_in_at=now - timedelta(minutes=30),
        )
        org = _make_org(org_id=org_id)
        mock_db = _mock_db_returning(event, user, org, existing_rsvp)

        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event.id, user.id, org_id)

        assert error == "ALREADY_CHECKED_IN"
        assert rsvp is not None

    @pytest.mark.asyncio
    async def test_self_check_in_before_time_window(self):
        """Test that check-in before time window returns an error"""
        now = datetime.now(timezone.utc)
        org_id = uuid4()
        event = _make_event(
            org_id=org_id,
            title="Future Event",
            start_datetime=now + timedelta(hours=2),
            end_datetime=now + timedelta(hours=3),
        )
        user = _make_user(org_id=org_id)
        org = _make_org(org_id=org_id)
        mock_db = _mock_db_returning(event, user, org)

        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event.id, user.id, org_id)

        assert "Check-in is not available yet" in error
        assert rsvp is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "start_offset, end_offset, extra_kwargs",
        [
            (timedelta(hours=-3), timedelta(hours=-1), {}),
            (timedelta(hours=-2), timedelta(hours=2), {"actual_end_time": "USE_PAST"}),
        ],
        ids=["after_scheduled_end", "after_actual_end_time"],
    )
    async def test_self_check_in_after_event_ended(
        self, start_offset, end_offset, extra_kwargs
    ):
        """Test that check-in is rejected when the event has ended"""
        now = datetime.now(timezone.utc)
        org_id = uuid4()
        if extra_kwargs.get("actual_end_time") == "USE_PAST":
            extra_kwargs["actual_end_time"] = now - timedelta(minutes=30)
        event = _make_event(
            org_id=org_id,
            start_datetime=now + start_offset,
            end_datetime=now + end_offset,
            **extra_kwargs,
        )
        user = _make_user(org_id=org_id)
        org = _make_org(org_id=org_id)
        mock_db = _mock_db_returning(event, user, org)

        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event.id, user.id, org_id)

        assert error == "Check-in is no longer available. The event has ended."
        assert rsvp is None

    @pytest.mark.asyncio
    async def test_self_check_in_cancelled_event(self):
        """Test that check-in to cancelled event returns an error"""
        now = datetime.now(timezone.utc)
        org_id = uuid4()
        event = _make_event(
            org_id=org_id,
            title="Cancelled Event",
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
            is_cancelled=True,
            cancellation_reason="Weather conditions",
        )
        user = _make_user(org_id=org_id)
        mock_db = _mock_db_returning(event)

        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event.id, user.id, org_id)

        assert error == "Event has been cancelled"
        assert rsvp is None

    @pytest.mark.asyncio
    async def test_self_check_in_user_not_in_organization(self):
        """Test that users from different organizations cannot check in"""
        now = datetime.now(timezone.utc)
        org_id = uuid4()
        event = _make_event(
            org_id=org_id,
            start_datetime=now + timedelta(minutes=30),
            end_datetime=now + timedelta(hours=2),
        )
        mock_db = _mock_db_returning(event, None)

        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(event.id, uuid4(), org_id)

        assert error == "User not found in organization"
        assert rsvp is None

    @pytest.mark.asyncio
    async def test_self_check_in_event_not_found(self):
        """Test that checking in to a nonexistent event returns an error"""
        org_id = uuid4()
        mock_db = _mock_db_returning(None)

        service = EventService(mock_db)
        rsvp, error = await service.self_check_in(uuid4(), uuid4(), org_id)

        assert error is not None
        assert rsvp is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
