"""
Event Request Pipeline Models

Database models for the public outreach event request pipeline.
Community members can request events (fire safety demos, station tours, etc.)
via a public form. Requests flow through a review pipeline before becoming
scheduled events.

The pipeline is intentionally fluid — departments can configure their own
checklist tasks and work them in any order. Date selection is flexible:
requesters express preferences rather than committing to exact dates.
"""

import enum
import secrets

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


def generate_status_token() -> str:
    """Generate a secure token for public status checking."""
    return secrets.token_urlsafe(32)


class EventRequestStatus(str, enum.Enum):
    """
    Broad status of an event request.

    Kept intentionally simple — the real workflow detail lives in
    configurable pipeline tasks (task_completions JSON).
    """

    SUBMITTED = "submitted"
    IN_PROGRESS = "in_progress"
    SCHEDULED = "scheduled"
    POSTPONED = "postponed"
    COMPLETED = "completed"
    DECLINED = "declined"
    CANCELLED = "cancelled"


class EventRequest(Base):
    """
    Public outreach event request.

    Created when a community member submits a request for the department
    to host or participate in a public event. Flows through a review
    pipeline before optionally being converted into an actual Event.
    """

    __tablename__ = "event_requests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Requester contact info
    contact_name = Column(String(255), nullable=False)
    contact_email = Column(String(255), nullable=False)
    contact_phone = Column(String(50), nullable=True)
    organization_name = Column(String(255), nullable=True)

    # Event details (outreach_type is a plain string — types are configurable per department)
    outreach_type = Column(
        String(100),
        nullable=False,
        default="other",
    )
    description = Column(Text, nullable=False)

    # Flexible date preferences — requesters express preferences, not commitments.
    # date_flexibility: "specific_dates" (they have exact dates), "general_timeframe"
    # (e.g., "a Saturday in March"), or "flexible" (department picks).
    date_flexibility = Column(String(30), nullable=False, default="flexible")
    preferred_date_start = Column(DateTime(timezone=True), nullable=True)
    preferred_date_end = Column(DateTime(timezone=True), nullable=True)
    # Free-text for fuzzy preferences like "Saturday morning next month"
    preferred_timeframe = Column(String(500), nullable=True)
    # General time-of-day preference
    preferred_time_of_day = Column(
        String(20), nullable=True, default="flexible"
    )  # "morning", "afternoon", "evening", "flexible"

    audience_size = Column(Integer, nullable=True)
    age_group = Column(String(100), nullable=True)
    venue_preference = Column(
        String(20), nullable=False, default="their_location"
    )  # "their_location", "our_station", "either"
    venue_address = Column(Text, nullable=True)
    special_requests = Column(Text, nullable=True)

    # Pipeline tracking — broad status plus flexible per-task completions
    status = Column(
        Enum(EventRequestStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=EventRequestStatus.SUBMITTED,
        index=True,
    )
    assigned_to = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewer_notes = Column(Text, nullable=True)
    decline_reason = Column(Text, nullable=True)

    # Confirmed event date (set by coordinator when scheduling)
    event_date = Column(DateTime(timezone=True), nullable=True)
    event_end_date = Column(DateTime(timezone=True), nullable=True)
    event_location_id = Column(
        String(36), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )

    # Configurable pipeline task completions (JSON)
    # Schema: { "task_id": { "completed": true, "completed_by": "user-uuid",
    #           "completed_at": "iso-datetime", "notes": "..." } }
    task_completions = Column(JSON, nullable=True, default=dict)

    # Link to created Event (when SCHEDULED)
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )

    # Public status tracking
    status_token = Column(
        String(64), unique=True, index=True, default=generate_status_token
    )

    # Source tracking (from form submission)
    form_submission_id = Column(
        String(36),
        ForeignKey("form_submissions.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Metadata
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    event = relationship("Event", foreign_keys=[event_id])
    assignee = relationship("User", foreign_keys=[assigned_to])
    activity_log = relationship(
        "EventRequestActivity",
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="EventRequestActivity.created_at.desc()",
    )

    __table_args__ = (
        Index("idx_event_request_org_status", "organization_id", "status"),
        Index("idx_event_request_org_type", "organization_id", "outreach_type"),
    )

    def __repr__(self):
        return f"<EventRequest(contact={self.contact_name}, type={self.outreach_type}, status={self.status})>"


class EventRequestActivity(Base):
    """
    Audit trail for event request pipeline actions.

    Records every status change, task completion, note, and action taken on a request.
    """

    __tablename__ = "event_request_activity"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    request_id = Column(
        String(36),
        ForeignKey("event_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    action = Column(String(100), nullable=False)
    old_status = Column(String(50), nullable=True)
    new_status = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)
    details = Column(JSON, nullable=True)

    performed_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    request = relationship("EventRequest", back_populates="activity_log")
    performer = relationship("User", foreign_keys=[performed_by])

    __table_args__ = (
        Index("idx_event_req_activity_request", "request_id"),
    )

    def __repr__(self):
        return f"<EventRequestActivity(request={self.request_id}, action={self.action})>"


class EventRequestEmailTemplate(Base):
    """
    Reusable email templates for the event request pipeline.

    Departments can store common messages (e.g., directions to the station,
    volunteer signup instructions) and attach them to email triggers or
    send them manually.
    """

    __tablename__ = "event_request_email_templates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(200), nullable=False)
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=False)
    body_text = Column(Text, nullable=True)

    # When to auto-send: trigger key (e.g., "on_scheduled", "days_before_event")
    # NULL means manual-only
    trigger = Column(String(100), nullable=True)
    # For "days_before_event" trigger: how many days before
    trigger_days_before = Column(Integer, nullable=True)

    is_active = Column(Integer, nullable=False, default=1)
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_email_tpl_org", "organization_id"),
    )
