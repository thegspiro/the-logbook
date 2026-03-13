"""
Event Models

Database models for event management, including events and RSVPs.
"""

from enum import Enum

from sqlalchemy import JSON, Boolean, Column, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class EventType(str, Enum):
    """Event type enumeration"""

    BUSINESS_MEETING = "business_meeting"
    PUBLIC_EDUCATION = "public_education"
    TRAINING = "training"
    SOCIAL = "social"
    FUNDRAISER = "fundraiser"
    CEREMONY = "ceremony"
    OTHER = "other"


class RSVPStatus(str, Enum):
    """RSVP status enumeration"""

    GOING = "going"
    NOT_GOING = "not_going"
    MAYBE = "maybe"
    WAITLISTED = "waitlisted"


class CheckInWindowType(str, Enum):
    """Check-in window type enumeration"""

    FLEXIBLE = "flexible"  # Anytime before event ends
    STRICT = "strict"  # Only between actual_start_time and actual_end_time
    WINDOW = "window"  # Configurable window (X minutes before/after)


class RecurrencePattern(str, Enum):
    """Recurrence pattern for recurring events"""

    DAILY = "daily"
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"
    MONTHLY_WEEKDAY = "monthly_weekday"  # e.g., 2nd Monday of every month
    ANNUALLY = "annually"  # Same date every year
    ANNUALLY_WEEKDAY = "annually_weekday"  # e.g., 4th Monday of July every year
    CUSTOM = "custom"  # Uses recurrence_custom_days


class Event(Base):
    """
    Event model for managing department events

    Supports various event types including meetings, training,
    public education, and social events.
    """

    __tablename__ = "events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Event details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    event_type = Column(
        SQLEnum(EventType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=EventType.OTHER,
    )
    custom_category = Column(
        String(100), nullable=True
    )  # Organization-defined custom category (from custom_event_categories settings)

    # Location (new system with location_id FK, or legacy free-text location for "Other")
    location_id = Column(
        String(36), ForeignKey("locations.id"), nullable=True
    )  # FK to Location table
    location = Column(
        String(300), nullable=True
    )  # Free-text location for "Other Location" or legacy events
    location_details = Column(
        Text, nullable=True
    )  # Additional directions, room numbers, etc.

    # Timing
    start_datetime = Column(DateTime(timezone=True), nullable=False)
    end_datetime = Column(DateTime(timezone=True), nullable=False)
    actual_start_time = Column(
        DateTime(timezone=True), nullable=True
    )  # Recorded by secretary when event actually starts
    actual_end_time = Column(
        DateTime(timezone=True), nullable=True
    )  # Recorded by secretary when event actually ends

    # RSVP settings
    requires_rsvp = Column(Boolean, nullable=False, default=False)
    rsvp_deadline = Column(DateTime(timezone=True), nullable=True)
    max_attendees = Column(Integer, nullable=True)  # Null means unlimited
    allowed_rsvp_statuses = Column(
        JSON, nullable=True
    )  # List of allowed RSVP statuses, defaults to ["going", "not_going"]

    # Attendance settings
    is_mandatory = Column(Boolean, nullable=False, default=False)

    # Additional settings
    allow_guests = Column(Boolean, nullable=False, default=False)
    send_reminders = Column(Boolean, nullable=False, default=True)
    reminder_schedule = Column(
        JSON, nullable=False, default=lambda: [24]
    )  # List of hours before event to send reminders

    # Check-in window settings
    check_in_window_type = Column(
        SQLEnum(CheckInWindowType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=CheckInWindowType.FLEXIBLE,
    )
    check_in_minutes_before = Column(
        Integer, nullable=True, default=30
    )  # Minutes before start to allow check-in
    check_in_minutes_after = Column(
        Integer, nullable=True, default=15
    )  # For WINDOW type: minutes after start
    require_checkout = Column(
        Boolean, nullable=False, default=False
    )  # Require manual check-out

    # Recurrence
    is_recurring = Column(Boolean, nullable=False, default=False)
    recurrence_pattern = Column(
        SQLEnum(RecurrencePattern, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    recurrence_end_date = Column(
        DateTime(timezone=True), nullable=True
    )  # When the recurring series ends
    recurrence_custom_days = Column(
        JSON, nullable=True
    )  # For CUSTOM: list of weekday numbers (0=Mon, 6=Sun)
    recurrence_weekday = Column(
        Integer, nullable=True
    )  # For monthly/annual weekday: target weekday (0=Mon, 6=Sun)
    recurrence_week_ordinal = Column(
        Integer, nullable=True
    )  # For monthly/annual weekday: which occurrence (1-5, -1=last)
    recurrence_month = Column(
        Integer, nullable=True
    )  # For annually_weekday: target month (1-12)
    recurrence_exceptions = Column(
        JSON, nullable=True
    )  # List of ISO date strings to skip in a recurring series
    recurrence_parent_id = Column(
        String(36), ForeignKey("events.id"), nullable=True
    )  # Links instances to their parent
    template_id = Column(
        String(36), ForeignKey("event_templates.id"), nullable=True
    )  # Created from a template

    # Custom fields
    custom_fields = Column(
        JSON, nullable=True
    )  # Flexible storage for event-specific data
    attachments = Column(JSON, nullable=True)  # List of attachment URLs/metadata

    # Status
    is_draft = Column(Boolean, default=False, server_default="0")
    is_cancelled = Column(Boolean, nullable=False, default=False)
    cancellation_reason = Column(Text, nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    updated_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    rsvps = relationship(
        "EventRSVP", back_populates="event", cascade="all, delete-orphan"
    )
    location_obj = relationship(
        "Location", foreign_keys=[location_id], back_populates="events"
    )
    recurrence_children = relationship(
        "Event", foreign_keys=[recurrence_parent_id], back_populates="recurrence_parent"
    )
    recurrence_parent = relationship(
        "Event",
        foreign_keys=[recurrence_parent_id],
        remote_side=[id],
        back_populates="recurrence_children",
    )
    template = relationship("EventTemplate", foreign_keys=[template_id])

    __table_args__ = (
        Index("ix_events_organization_id", "organization_id"),
        Index("ix_events_start_datetime", "start_datetime"),
        Index("ix_events_event_type", "event_type"),
        Index("ix_events_custom_category", "custom_category"),
        Index("ix_events_location_id", "location_id"),
        Index("ix_events_recurrence_parent_id", "recurrence_parent_id"),
    )


class EventRSVP(Base):
    """
    Event RSVP model for tracking attendance

    Tracks member responses to event invitations.
    """

    __tablename__ = "event_rsvps"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # RSVP details
    status = Column(
        SQLEnum(RSVPStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=RSVPStatus.GOING,
    )
    guest_count = Column(
        Integer, nullable=False, default=0
    )  # Number of additional guests
    notes = Column(Text, nullable=True)  # Special requests, dietary restrictions, etc.
    dietary_restrictions = Column(String(500), nullable=True)
    accessibility_needs = Column(String(500), nullable=True)

    # Tracking
    responded_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Actual attendance (filled in after event)
    checked_in = Column(Boolean, nullable=False, default=False)
    checked_in_at = Column(DateTime(timezone=True), nullable=True)
    checked_out_at = Column(DateTime(timezone=True), nullable=True)
    attendance_duration_minutes = Column(
        Integer, nullable=True
    )  # Calculated duration in minutes

    # Attendance overrides (for managers/training officers)
    override_check_in_at = Column(
        DateTime(timezone=True), nullable=True
    )  # Manual override of check-in time
    override_check_out_at = Column(
        DateTime(timezone=True), nullable=True
    )  # Manual override of check-out time
    override_duration_minutes = Column(
        Integer, nullable=True
    )  # Manual override of duration
    overridden_by = Column(
        String(36), ForeignKey("users.id"), nullable=True
    )  # Who made the override
    overridden_at = Column(
        DateTime(timezone=True), nullable=True
    )  # When the override was made

    # Relationships
    event = relationship("Event", back_populates="rsvps")
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("ix_event_rsvps_event_id", "event_id"),
        Index("ix_event_rsvps_user_id", "user_id"),
        Index("ix_event_rsvps_organization_id", "organization_id"),
        # Unique constraint: one RSVP per user per event
        Index("ix_event_rsvps_event_user", "event_id", "user_id", unique=True),
    )


class EventTemplate(Base):
    """
    Event Template model for reusable event configurations

    Allows departments to create templates for events they run regularly
    (e.g., weekly meetings, annual holiday events, recurring trainings).
    Templates store the event structure without specific dates.
    """

    __tablename__ = "event_templates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Template identification
    name = Column(
        String(200), nullable=False
    )  # Template name (e.g., "Weekly Business Meeting")
    description = Column(Text, nullable=True)

    # Event defaults (copied when creating an event from this template)
    event_type = Column(
        SQLEnum(EventType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=EventType.OTHER,
    )
    default_title = Column(
        String(200), nullable=True
    )  # Default title for events created from template
    default_description = Column(Text, nullable=True)
    default_location_id = Column(String(36), ForeignKey("locations.id"), nullable=True)
    default_location = Column(String(300), nullable=True)
    default_location_details = Column(Text, nullable=True)
    default_duration_minutes = Column(Integer, nullable=True)  # Default event duration

    # RSVP defaults
    requires_rsvp = Column(Boolean, nullable=False, default=False)
    max_attendees = Column(Integer, nullable=True)
    is_mandatory = Column(Boolean, nullable=False, default=False)
    allow_guests = Column(Boolean, nullable=False, default=False)

    # Check-in defaults
    check_in_window_type = Column(
        SQLEnum(CheckInWindowType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    check_in_minutes_before = Column(Integer, nullable=True, default=30)
    check_in_minutes_after = Column(Integer, nullable=True, default=15)
    require_checkout = Column(Boolean, nullable=False, default=False)

    # Notification defaults
    send_reminders = Column(Boolean, nullable=False, default=True)
    reminder_schedule = Column(JSON, nullable=False, default=lambda: [24])

    # Custom fields template (structure for custom data fields)
    custom_fields_template = Column(JSON, nullable=True)

    # Metadata
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    updated_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (Index("ix_event_templates_organization_id", "organization_id"),)


class EventExternalAttendee(Base):
    """
    External (non-member) attendee at an event.

    Used primarily for public outreach events (public education, fundraisers,
    ceremonies) where community members attend but are not system users.
    Can be auto-created from public form submissions via Forms → Events integration.
    """

    __tablename__ = "event_external_attendees"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )

    # Attendee info
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    organization_name = Column(String(255), nullable=True)

    # Check-in tracking
    checked_in = Column(Boolean, nullable=False, default=False)
    checked_in_at = Column(DateTime(timezone=True), nullable=True)

    # Source tracking (e.g., "form_submission" with form submission ID)
    source = Column(String(50), nullable=True)
    source_id = Column(String(36), nullable=True)
    notes = Column(Text, nullable=True)

    # Metadata
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=func.now())
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    event = relationship("Event", foreign_keys=[event_id])

    __table_args__ = (
        Index("ix_ext_attendees_event_id", "event_id"),
        Index("ix_ext_attendees_org_id", "organization_id"),
        Index("ix_ext_attendees_email", "email"),
    )


class RSVPHistory(Base):
    """
    RSVP History model for tracking RSVP status changes.

    Records each status change for audit and activity tracking purposes.
    """

    __tablename__ = "rsvp_history"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    rsvp_id = Column(
        String(36), ForeignKey("event_rsvps.id", ondelete="CASCADE"), nullable=False
    )
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    old_status = Column(String(20), nullable=True)  # Null for initial RSVP
    new_status = Column(String(20), nullable=False)
    changed_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    changed_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )  # Null means self-change

    # Relationships
    rsvp = relationship("EventRSVP", foreign_keys=[rsvp_id])
    event = relationship("Event", foreign_keys=[event_id])
    user = relationship("User", foreign_keys=[user_id])
    changer = relationship("User", foreign_keys=[changed_by])

    __table_args__ = (
        Index("ix_rsvp_history_event_id", "event_id"),
        Index("ix_rsvp_history_rsvp_id", "rsvp_id"),
        Index("ix_rsvp_history_user_id", "user_id"),
        Index("ix_rsvp_history_changed_at", "changed_at"),
    )
