"""
Event Models

Database models for event management, including events and RSVPs.
"""

from sqlalchemy import (
    Column,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Enum as SQLEnum,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from uuid import uuid4
from datetime import datetime
from enum import Enum

from app.core.database import Base


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


class Event(Base):
    """
    Event model for managing department events

    Supports various event types including meetings, training,
    public education, and social events.
    """
    __tablename__ = "events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)

    # Event details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    event_type = Column(SQLEnum(EventType), nullable=False, default=EventType.OTHER)

    # Location
    location = Column(String(300), nullable=True)
    location_details = Column(Text, nullable=True)  # Additional directions, room numbers, etc.

    # Timing
    start_datetime = Column(DateTime, nullable=False)
    end_datetime = Column(DateTime, nullable=False)

    # RSVP settings
    requires_rsvp = Column(Boolean, nullable=False, default=False)
    rsvp_deadline = Column(DateTime, nullable=True)
    max_attendees = Column(Integer, nullable=True)  # Null means unlimited

    # Attendance settings
    is_mandatory = Column(Boolean, nullable=False, default=False)
    eligible_roles = Column(JSONB, nullable=True)  # List of role slugs, null means all members

    # Additional settings
    allow_guests = Column(Boolean, nullable=False, default=False)
    send_reminders = Column(Boolean, nullable=False, default=True)
    reminder_hours_before = Column(Integer, nullable=False, default=24)  # Hours before event to send reminder

    # Custom fields
    custom_fields = Column(JSONB, nullable=True)  # Flexible storage for event-specific data
    attachments = Column(JSONB, nullable=True)  # List of attachment URLs/metadata

    # Status
    is_cancelled = Column(Boolean, nullable=False, default=False)
    cancellation_reason = Column(Text, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)

    # Metadata
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    rsvps = relationship("EventRSVP", back_populates="event", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_events_organization_id", "organization_id"),
        Index("ix_events_start_datetime", "start_datetime"),
        Index("ix_events_event_type", "event_type"),
    )


class EventRSVP(Base):
    """
    Event RSVP model for tracking attendance

    Tracks member responses to event invitations.
    """
    __tablename__ = "event_rsvps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # RSVP details
    status = Column(SQLEnum(RSVPStatus), nullable=False, default=RSVPStatus.GOING)
    guest_count = Column(Integer, nullable=False, default=0)  # Number of additional guests
    notes = Column(Text, nullable=True)  # Special requests, dietary restrictions, etc.

    # Tracking
    responded_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Actual attendance (filled in after event)
    checked_in = Column(Boolean, nullable=False, default=False)
    checked_in_at = Column(DateTime, nullable=True)

    # Relationships
    event = relationship("Event", back_populates="rsvps")

    __table_args__ = (
        Index("ix_event_rsvps_event_id", "event_id"),
        Index("ix_event_rsvps_user_id", "user_id"),
        # Unique constraint: one RSVP per user per event
        Index("ix_event_rsvps_event_user", "event_id", "user_id", unique=True),
    )
