"""
Property-based tests for Pydantic schemas using Hypothesis.

These tests generate random valid/invalid inputs to exercise schema
validators and catch edge cases that example-based tests miss.
"""

from datetime import datetime, timedelta, timezone

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st
from pydantic import ValidationError

from app.schemas.event import (
    EventCancel,
    EventCreate,
    RecurringEventCreate,
    RequestPipelineTask,
    RSVPBase,
)
from app.schemas.user import EmergencyContact, AddressInfo


# ============================================================
# Strategies for generating valid data
# ============================================================

valid_title = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P", "Z")),
    min_size=1,
    max_size=200,
).filter(lambda s: s.strip())

valid_event_types = st.sampled_from([
    "business_meeting", "public_education", "training",
    "social", "fundraiser", "ceremony", "other",
])

valid_rsvp_statuses = st.sampled_from(["going", "not_going", "maybe"])

future_datetime = st.builds(
    lambda minutes: datetime.now(tz=timezone.utc) + timedelta(minutes=minutes),
    st.integers(min_value=60, max_value=525600),  # 1 hour to 1 year
)


# ============================================================
# EventCreate schema tests
# ============================================================


class TestEventCreateProperty:
    """Property-based tests for EventCreate schema validation."""

    @given(
        title=valid_title,
        event_type=valid_event_types,
        offset_minutes=st.integers(min_value=60, max_value=525600),
        duration_minutes=st.integers(min_value=1, max_value=1440),
    )
    @settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
    def test_valid_event_create_always_succeeds(
        self, title, event_type, offset_minutes, duration_minutes
    ):
        """Any event with valid title, type, and end > start should be accepted."""
        start = datetime.now(tz=timezone.utc) + timedelta(minutes=offset_minutes)
        end = start + timedelta(minutes=duration_minutes)

        event = EventCreate(
            title=title,
            event_type=event_type,
            start_datetime=start,
            end_datetime=end,
        )
        assert event.title == title
        assert event.event_type == event_type
        assert event.end_datetime > event.start_datetime

    @given(
        title=valid_title,
        event_type=valid_event_types,
        offset_minutes=st.integers(min_value=60, max_value=525600),
    )
    @settings(max_examples=30, suppress_health_check=[HealthCheck.too_slow])
    def test_end_before_start_always_fails(self, title, event_type, offset_minutes):
        """An event where end <= start should always be rejected."""
        start = datetime.now(tz=timezone.utc) + timedelta(minutes=offset_minutes)
        end = start - timedelta(minutes=1)

        with pytest.raises(ValidationError, match="end_datetime must be after"):
            EventCreate(
                title=title,
                event_type=event_type,
                start_datetime=start,
                end_datetime=end,
            )

    @given(
        title=valid_title,
        event_type=valid_event_types,
        offset_minutes=st.integers(min_value=60, max_value=525600),
        duration_minutes=st.integers(min_value=1, max_value=1440),
    )
    @settings(max_examples=30, suppress_health_check=[HealthCheck.too_slow])
    def test_rsvp_required_without_deadline_fails(
        self, title, event_type, offset_minutes, duration_minutes
    ):
        """When requires_rsvp=True, rsvp_deadline must be provided."""
        start = datetime.now(tz=timezone.utc) + timedelta(minutes=offset_minutes)
        end = start + timedelta(minutes=duration_minutes)

        with pytest.raises(ValidationError, match="rsvp_deadline is required"):
            EventCreate(
                title=title,
                event_type=event_type,
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=True,
                rsvp_deadline=None,
            )


# ============================================================
# EventCancel schema tests
# ============================================================


class TestEventCancelProperty:
    """Property-based tests for EventCancel schema."""

    @given(
        reason=st.text(min_size=10, max_size=500).filter(lambda s: s.strip()),
        send_notifs=st.booleans(),
    )
    @settings(max_examples=30)
    def test_valid_cancellation_reasons(self, reason, send_notifs):
        """Any reason between 10-500 chars should be accepted."""
        cancel = EventCancel(
            cancellation_reason=reason,
            send_notifications=send_notifs,
        )
        assert cancel.cancellation_reason == reason

    @given(reason=st.text(min_size=0, max_size=9))
    @settings(max_examples=20)
    def test_short_cancellation_reason_fails(self, reason):
        """Reasons shorter than 10 chars should be rejected."""
        with pytest.raises(ValidationError):
            EventCancel(cancellation_reason=reason)


# ============================================================
# RSVPBase schema tests
# ============================================================


class TestRSVPBaseProperty:
    """Property-based tests for RSVP schema."""

    @given(
        status=valid_rsvp_statuses,
        guest_count=st.integers(min_value=0, max_value=10),
    )
    @settings(max_examples=30)
    def test_valid_rsvp_always_succeeds(self, status, guest_count):
        """Valid status + guest count in range should always be accepted."""
        rsvp = RSVPBase(status=status, guest_count=guest_count)
        assert rsvp.status == status
        assert 0 <= rsvp.guest_count <= 10

    @given(guest_count=st.integers(min_value=11, max_value=1000))
    @settings(max_examples=20)
    def test_excessive_guests_fails(self, guest_count):
        """Guest count > 10 should be rejected."""
        with pytest.raises(ValidationError):
            RSVPBase(status="going", guest_count=guest_count)


# ============================================================
# RequestPipelineTask schema tests
# ============================================================


class TestRequestPipelineTaskProperty:
    """Property-based tests for pipeline task schema."""

    @given(
        task_id=st.text(min_size=1, max_size=100).filter(lambda s: s.strip()),
        label=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    )
    @settings(max_examples=30)
    def test_valid_task_always_succeeds(self, task_id, label):
        """Any non-empty id + label within length limits should work."""
        task = RequestPipelineTask(id=task_id, label=label)
        assert task.id == task_id
        assert task.label == label

    @given(
        task_id=st.text(min_size=101, max_size=200),
    )
    @settings(max_examples=10)
    def test_oversized_id_fails(self, task_id):
        """Task ID > 100 chars should be rejected."""
        with pytest.raises(ValidationError):
            RequestPipelineTask(id=task_id, label="Valid label")


# ============================================================
# RecurringEventCreate schema tests
# ============================================================


class TestRecurringEventProperty:
    """Property-based tests for recurring event schema."""

    @given(
        pattern=st.sampled_from(["daily", "weekly", "biweekly", "monthly"]),
        title=valid_title,
    )
    @settings(max_examples=20, suppress_health_check=[HealthCheck.too_slow])
    def test_non_custom_patterns_dont_require_days(self, pattern, title):
        """Standard recurrence patterns should work without custom_days."""
        start = datetime.now(tz=timezone.utc) + timedelta(hours=1)
        end = start + timedelta(hours=2)
        recurrence_end = start + timedelta(days=90)

        event = RecurringEventCreate(
            title=title,
            event_type="training",
            start_datetime=start,
            end_datetime=end,
            recurrence_pattern=pattern,
            recurrence_end_date=recurrence_end,
        )
        assert event.recurrence_pattern == pattern

    @given(title=valid_title)
    @settings(max_examples=10, suppress_health_check=[HealthCheck.too_slow])
    def test_custom_pattern_without_days_fails(self, title):
        """Custom recurrence pattern must specify days."""
        start = datetime.now(tz=timezone.utc) + timedelta(hours=1)
        end = start + timedelta(hours=2)
        recurrence_end = start + timedelta(days=90)

        with pytest.raises(ValidationError, match="recurrence_custom_days is required"):
            RecurringEventCreate(
                title=title,
                event_type="training",
                start_datetime=start,
                end_datetime=end,
                recurrence_pattern="custom",
                recurrence_end_date=recurrence_end,
                recurrence_custom_days=None,
            )


# ============================================================
# User-related schema tests
# ============================================================


class TestEmergencyContactProperty:
    """Property-based tests for EmergencyContact schema."""

    @given(
        name=st.text(min_size=1, max_size=100).filter(lambda s: s.strip()),
        relationship=st.text(min_size=1, max_size=50).filter(lambda s: s.strip()),
        phone=st.from_regex(r"\+?1?\d{10,15}", fullmatch=True),
        is_primary=st.booleans(),
    )
    @settings(max_examples=30)
    def test_valid_emergency_contact(self, name, relationship, phone, is_primary):
        """Valid emergency contacts should always be accepted."""
        contact = EmergencyContact(
            name=name,
            relationship=relationship,
            phone=phone,
            is_primary=is_primary,
        )
        assert contact.name == name
        assert contact.phone == phone


class TestAddressInfoProperty:
    """Property-based tests for AddressInfo schema."""

    @given(
        city=st.one_of(st.none(), st.text(max_size=100)),
        state=st.one_of(st.none(), st.text(max_size=50)),
        zip_code=st.one_of(st.none(), st.from_regex(r"\d{5}(-\d{4})?", fullmatch=True)),
    )
    @settings(max_examples=30)
    def test_all_optional_fields_accepted(self, city, state, zip_code):
        """AddressInfo with any combination of optional fields should work."""
        addr = AddressInfo(city=city, state=state, zip_code=zip_code)
        assert addr.country == "USA"  # Default

    @given(city=st.text(min_size=101, max_size=200))
    @settings(max_examples=10)
    def test_oversized_city_fails(self, city):
        """City > 100 chars should be rejected."""
        with pytest.raises(ValidationError):
            AddressInfo(city=city)
