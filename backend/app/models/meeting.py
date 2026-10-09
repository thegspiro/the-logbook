"""
Meeting Minutes Database Models

SQLAlchemy models for meeting minutes including meetings,
attendees, and action items.
"""

import enum
from datetime import date, datetime, time
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.event import Event
    from app.models.location import Location
    from app.models.user import User


class MeetingType(str, enum.Enum):
    """Type of meeting"""

    BUSINESS = "business"
    SPECIAL = "special"
    COMMITTEE = "committee"
    BOARD = "board"
    OTHER = "other"


class MeetingStatus(str, enum.Enum):
    """Status of meeting minutes"""

    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"


class ActionItemStatus(str, enum.Enum):
    """Status of an action item"""

    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class Meeting(Base):
    """
    Meeting model

    Represents a meeting with its minutes, attendees, and action items.
    """

    __tablename__ = "meetings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Meeting Information
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    meeting_type: Mapped[MeetingType] = mapped_column(
        Enum(MeetingType, values_callable=lambda x: [e.value for e in x]),
        default=MeetingType.BUSINESS,
        nullable=False,
        server_default="business",
    )
    meeting_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[Optional[time]] = mapped_column(Time)
    end_time: Mapped[Optional[time]] = mapped_column(Time)
    location: Mapped[Optional[str]] = mapped_column(String(255))

    # Cross-module links
    event_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("events.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    location_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("locations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Meeting Details
    called_by: Mapped[Optional[str]] = mapped_column(String(255))
    status: Mapped[MeetingStatus] = mapped_column(
        Enum(MeetingStatus, values_callable=lambda x: [e.value for e in x]),
        default=MeetingStatus.DRAFT,
        nullable=False,
        server_default="draft",
    )

    # Minutes Content
    agenda: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    motions: Mapped[Optional[str]] = mapped_column(Text)

    # Approval
    approved_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT")
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT")
    )

    # Relationships
    attendees: Mapped[list["MeetingAttendee"]] = relationship(
        "MeetingAttendee", back_populates="meeting", cascade="all, delete-orphan"
    )
    action_items: Mapped[list["MeetingActionItem"]] = relationship(
        "MeetingActionItem", back_populates="meeting", cascade="all, delete-orphan"
    )
    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])
    approver: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[approved_by]
    )
    event: Mapped[Optional["Event"]] = relationship("Event", foreign_keys=[event_id])
    location_obj: Mapped[Optional["Location"]] = relationship(
        "Location", foreign_keys=[location_id]
    )

    __table_args__ = (
        Index("idx_meetings_org_date", "organization_id", "meeting_date"),
        Index("idx_meetings_org_type", "organization_id", "meeting_type"),
        Index("idx_meetings_org_status", "organization_id", "status"),
    )

    def __repr__(self):
        return f"<Meeting(title={self.title}, date={self.meeting_date})>"


class MeetingAttendee(Base):
    """
    Meeting Attendee model

    Tracks who attended a meeting.
    """

    __tablename__ = "meeting_attendees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    meeting_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Attendance
    present: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)
    excused: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)

    # Waiver — excuses the member from attendance % penalty (can't vote in this meeting)
    waiver_reason: Mapped[Optional[str]] = mapped_column(Text)
    waiver_granted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT")
    )
    waiver_granted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    meeting: Mapped["Meeting"] = relationship("Meeting", back_populates="attendees")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    waiver_grantor: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[waiver_granted_by]
    )

    __table_args__ = (
        Index("idx_meeting_attendees_meeting", "meeting_id"),
        Index("idx_meeting_attendees_user", "user_id"),
        Index("idx_meeting_attendees_organization", "organization_id"),
    )

    def __repr__(self):
        return (
            f"<MeetingAttendee(meeting_id={self.meeting_id}, user_id={self.user_id})>"
        )


class MeetingActionItem(Base):
    """
    Meeting Action Item model

    Tracks action items assigned during meetings.
    """

    __tablename__ = "meeting_action_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Action Item Details
    description: Mapped[str] = mapped_column(Text, nullable=False)
    assigned_to: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT")
    )
    due_date: Mapped[Optional[date]] = mapped_column(Date)
    status: Mapped[ActionItemStatus] = mapped_column(
        Enum(ActionItemStatus, values_callable=lambda x: [e.value for e in x]),
        default=ActionItemStatus.OPEN,
        nullable=False,
        server_default="open",
    )
    priority: Mapped[Optional[int]] = mapped_column(
        Integer, default=0
    )  # 0=normal, 1=high, 2=urgent

    # Completion
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completion_notes: Mapped[Optional[str]] = mapped_column(Text)

    # Provenance. ``created_by`` is who the item is attributed to and
    # ``source`` names an automated path that created it ("mcp" for the
    # Claude connection); both are NULL for an item a person entered in the
    # app, so existing rows need no backfill.
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    meeting: Mapped["Meeting"] = relationship("Meeting", back_populates="action_items")
    assignee: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[assigned_to]
    )
    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        Index("idx_action_items_meeting", "meeting_id"),
        Index("idx_action_items_org_status", "organization_id", "status"),
        Index("idx_action_items_assigned", "assigned_to", "status"),
    )

    def __repr__(self):
        return f"<MeetingActionItem(description={self.description[:50]}, status={self.status})>"
