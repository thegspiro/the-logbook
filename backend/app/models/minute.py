"""
Meeting Minutes Models

Database models for meeting minutes, motions, and action items.
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
    JSON,
)
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum
import uuid

from app.core.database import Base


def generate_uuid() -> str:
    """Generate a UUID string for MySQL compatibility"""
    return str(uuid.uuid4())


class MeetingType(str, Enum):
    """Meeting type enumeration"""
    BUSINESS = "business"
    SPECIAL = "special"
    COMMITTEE = "committee"
    BOARD = "board"
    OTHER = "other"


class MinutesStatus(str, Enum):
    """Minutes approval workflow status"""
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"


class MotionStatus(str, Enum):
    """Motion vote result"""
    PASSED = "passed"
    FAILED = "failed"
    TABLED = "tabled"
    WITHDRAWN = "withdrawn"


class ActionItemStatus(str, Enum):
    """Action item progress status"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    OVERDUE = "overdue"


class ActionItemPriority(str, Enum):
    """Action item priority level"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class MeetingMinutes(Base):
    """
    Meeting Minutes model

    Records the official minutes of a meeting, including attendees,
    agenda items, motions, and action items.
    """
    __tablename__ = "meeting_minutes"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)

    # Meeting details
    title = Column(String(300), nullable=False)
    meeting_type = Column(SQLEnum(MeetingType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=MeetingType.BUSINESS)
    meeting_date = Column(DateTime, nullable=False)
    location = Column(String(300), nullable=True)
    called_by = Column(String(200), nullable=True)
    called_to_order_at = Column(DateTime, nullable=True)
    adjourned_at = Column(DateTime, nullable=True)

    # Attendees (stored as JSON array of {user_id, name, role, present})
    attendees = Column(JSON, nullable=True)
    quorum_met = Column(Boolean, nullable=True)
    quorum_count = Column(Integer, nullable=True)

    # Content sections
    agenda = Column(Text, nullable=True)
    old_business = Column(Text, nullable=True)
    new_business = Column(Text, nullable=True)
    treasurer_report = Column(Text, nullable=True)
    chief_report = Column(Text, nullable=True)
    committee_reports = Column(Text, nullable=True)
    announcements = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    # Approval workflow
    status = Column(SQLEnum(MinutesStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=MinutesStatus.DRAFT)
    submitted_at = Column(DateTime, nullable=True)
    submitted_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    rejected_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    rejection_reason = Column(Text, nullable=True)

    # Link to event (optional — minutes can be linked to a business_meeting event)
    event_id = Column(String(36), ForeignKey("events.id"), nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    motions = relationship("Motion", back_populates="minutes", cascade="all, delete-orphan", order_by="Motion.order")
    action_items = relationship("ActionItem", back_populates="minutes", cascade="all, delete-orphan", order_by="ActionItem.created_at")

    __table_args__ = (
        Index("ix_meeting_minutes_organization_id", "organization_id"),
        Index("ix_meeting_minutes_meeting_date", "meeting_date"),
        Index("ix_meeting_minutes_status", "status"),
        Index("ix_meeting_minutes_meeting_type", "meeting_type"),
    )


class Motion(Base):
    """
    Motion model

    Records a formal motion made during a meeting, including
    who moved/seconded, the vote tally, and the result.
    """
    __tablename__ = "meeting_motions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    minutes_id = Column(String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False)

    # Motion details
    order = Column(Integer, nullable=False, default=0)
    motion_text = Column(Text, nullable=False)
    moved_by = Column(String(200), nullable=True)
    seconded_by = Column(String(200), nullable=True)
    discussion_notes = Column(Text, nullable=True)

    # Vote result
    status = Column(SQLEnum(MotionStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=MotionStatus.PASSED)
    votes_for = Column(Integer, nullable=True)
    votes_against = Column(Integer, nullable=True)
    votes_abstain = Column(Integer, nullable=True)

    # Metadata
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    minutes = relationship("MeetingMinutes", back_populates="motions")

    __table_args__ = (
        Index("ix_meeting_motions_minutes_id", "minutes_id"),
    )


class ActionItem(Base):
    """
    Action Item model

    Tracks tasks assigned during a meeting with assignee, due date,
    and completion tracking.
    """
    __tablename__ = "meeting_action_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    minutes_id = Column(String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False)

    # Item details
    description = Column(Text, nullable=False)
    assignee_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    assignee_name = Column(String(200), nullable=True)
    due_date = Column(DateTime, nullable=True)
    priority = Column(SQLEnum(ActionItemPriority, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ActionItemPriority.MEDIUM)

    # Status tracking
    status = Column(SQLEnum(ActionItemStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ActionItemStatus.PENDING)
    completed_at = Column(DateTime, nullable=True)
    completion_notes = Column(Text, nullable=True)

    # Metadata
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    minutes = relationship("MeetingMinutes", back_populates="action_items")

    __table_args__ = (
        Index("ix_meeting_action_items_minutes_id", "minutes_id"),
        Index("ix_meeting_action_items_assignee_id", "assignee_id"),
        Index("ix_meeting_action_items_status", "status"),
        Index("ix_meeting_action_items_due_date", "due_date"),
    )
