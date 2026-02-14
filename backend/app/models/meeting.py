"""
Meeting Minutes Database Models

SQLAlchemy models for meeting minutes including meetings,
attendees, and action items.
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Date,
    Integer,
    Text,
    Enum,
    ForeignKey,
    Index,
    Time,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.core.utils import generate_uuid

from app.core.database import Base


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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Meeting Information
    title = Column(String(255), nullable=False)
    meeting_type = Column(Enum(MeetingType, values_callable=lambda x: [e.value for e in x]), default=MeetingType.BUSINESS, nullable=False)
    meeting_date = Column(Date, nullable=False, index=True)
    start_time = Column(Time)
    end_time = Column(Time)
    location = Column(String(255))

    # Meeting Details
    called_by = Column(String(255))
    status = Column(Enum(MeetingStatus, values_callable=lambda x: [e.value for e in x]), default=MeetingStatus.DRAFT, nullable=False)

    # Minutes Content
    agenda = Column(Text)
    notes = Column(Text)
    motions = Column(Text)

    # Approval
    approved_by = Column(String(36), ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    attendees = relationship("MeetingAttendee", back_populates="meeting", cascade="all, delete-orphan")
    action_items = relationship("MeetingActionItem", back_populates="meeting", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[created_by])
    approver = relationship("User", foreign_keys=[approved_by])

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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    meeting_id = Column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Attendance
    present = Column(Boolean, default=True)
    excused = Column(Boolean, default=False)

    # Waiver — excuses the member from attendance % penalty (can't vote in this meeting)
    waiver_reason = Column(Text)
    waiver_granted_by = Column(String(36), ForeignKey("users.id"))
    waiver_granted_at = Column(DateTime(timezone=True))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    meeting = relationship("Meeting", back_populates="attendees")
    user = relationship("User")

    __table_args__ = (
        Index("idx_meeting_attendees_meeting", "meeting_id"),
        Index("idx_meeting_attendees_user", "user_id"),
    )

    def __repr__(self):
        return f"<MeetingAttendee(meeting_id={self.meeting_id}, user_id={self.user_id})>"


class MeetingActionItem(Base):
    """
    Meeting Action Item model

    Tracks action items assigned during meetings.
    """

    __tablename__ = "meeting_action_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    meeting_id = Column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Action Item Details
    description = Column(Text, nullable=False)
    assigned_to = Column(String(36), ForeignKey("users.id"))
    due_date = Column(Date)
    status = Column(Enum(ActionItemStatus, values_callable=lambda x: [e.value for e in x]), default=ActionItemStatus.OPEN, nullable=False)
    priority = Column(Integer, default=0)  # 0=normal, 1=high, 2=urgent

    # Completion
    completed_at = Column(DateTime(timezone=True))
    completion_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    meeting = relationship("Meeting", back_populates="action_items")
    assignee = relationship("User", foreign_keys=[assigned_to])

    __table_args__ = (
        Index("idx_action_items_meeting", "meeting_id"),
        Index("idx_action_items_org_status", "organization_id", "status"),
        Index("idx_action_items_assigned", "assigned_to", "status"),
    )

    def __repr__(self):
        return f"<MeetingActionItem(description={self.description[:50]}, status={self.status})>"
