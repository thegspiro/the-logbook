"""
Meeting Minutes Models

Database models for meeting minutes, motions, action items, and templates.
"""

from sqlalchemy import (
    Column,
    String,
    Text,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Enum as SQLEnum,
    Index,
    JSON,
)
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum
from app.core.utils import generate_uuid

from app.core.database import Base


class MinutesMeetingType(str, Enum):
    """Meeting type enumeration"""
    BUSINESS = "business"
    SPECIAL = "special"
    COMMITTEE = "committee"
    BOARD = "board"
    TRUSTEE = "trustee"
    EXECUTIVE = "executive"
    ANNUAL = "annual"
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


class MinutesActionItemStatus(str, Enum):
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


# ── Default template sections for a standard business meeting ──

DEFAULT_BUSINESS_SECTIONS = [
    {"order": 0, "key": "call_to_order", "title": "Call to Order", "default_content": "", "required": True},
    {"order": 1, "key": "roll_call", "title": "Roll Call / Attendance", "default_content": "", "required": True},
    {"order": 2, "key": "approval_of_previous", "title": "Approval of Previous Minutes", "default_content": "", "required": False},
    {"order": 3, "key": "treasurer_report", "title": "Treasurer's Report", "default_content": "", "required": False},
    {"order": 4, "key": "chief_report", "title": "Chief's Report", "default_content": "", "required": False},
    {"order": 5, "key": "committee_reports", "title": "Committee Reports", "default_content": "", "required": False},
    {"order": 6, "key": "old_business", "title": "Old Business", "default_content": "", "required": False},
    {"order": 7, "key": "new_business", "title": "New Business", "default_content": "", "required": False},
    {"order": 8, "key": "announcements", "title": "Announcements", "default_content": "", "required": False},
    {"order": 9, "key": "public_comment", "title": "Public Comment", "default_content": "", "required": False},
    {"order": 10, "key": "adjournment", "title": "Adjournment", "default_content": "", "required": True},
]

DEFAULT_SPECIAL_SECTIONS = [
    {"order": 0, "key": "call_to_order", "title": "Call to Order", "default_content": "", "required": True},
    {"order": 1, "key": "roll_call", "title": "Roll Call / Attendance", "default_content": "", "required": True},
    {"order": 2, "key": "purpose", "title": "Purpose of Special Meeting", "default_content": "", "required": True},
    {"order": 3, "key": "discussion", "title": "Discussion", "default_content": "", "required": False},
    {"order": 4, "key": "adjournment", "title": "Adjournment", "default_content": "", "required": True},
]

DEFAULT_COMMITTEE_SECTIONS = [
    {"order": 0, "key": "call_to_order", "title": "Call to Order", "default_content": "", "required": True},
    {"order": 1, "key": "roll_call", "title": "Roll Call / Attendance", "default_content": "", "required": True},
    {"order": 2, "key": "old_business", "title": "Old Business", "default_content": "", "required": False},
    {"order": 3, "key": "new_business", "title": "New Business", "default_content": "", "required": False},
    {"order": 4, "key": "recommendations", "title": "Recommendations to Full Body", "default_content": "", "required": False},
    {"order": 5, "key": "adjournment", "title": "Adjournment", "default_content": "", "required": True},
]

DEFAULT_TRUSTEE_SECTIONS = [
    {"order": 0, "key": "call_to_order", "title": "Call to Order", "default_content": "", "required": True},
    {"order": 1, "key": "roll_call", "title": "Roll Call / Attendance", "default_content": "", "required": True},
    {"order": 2, "key": "approval_of_previous", "title": "Approval of Previous Minutes", "default_content": "", "required": False},
    {"order": 3, "key": "treasurer_report", "title": "Treasurer's Report", "default_content": "", "required": True},
    {"order": 4, "key": "financial_review", "title": "Financial Review & Budget", "default_content": "", "required": False},
    {"order": 5, "key": "trust_fund_report", "title": "Trust Fund Report", "default_content": "", "required": False},
    {"order": 6, "key": "audit_report", "title": "Audit Report", "default_content": "", "required": False},
    {"order": 7, "key": "old_business", "title": "Old Business", "default_content": "", "required": False},
    {"order": 8, "key": "new_business", "title": "New Business", "default_content": "", "required": False},
    {"order": 9, "key": "legal_matters", "title": "Legal Matters", "default_content": "", "required": False},
    {"order": 10, "key": "adjournment", "title": "Adjournment", "default_content": "", "required": True},
]

DEFAULT_EXECUTIVE_SECTIONS = [
    {"order": 0, "key": "call_to_order", "title": "Call to Order", "default_content": "", "required": True},
    {"order": 1, "key": "roll_call", "title": "Roll Call / Attendance", "default_content": "", "required": True},
    {"order": 2, "key": "approval_of_previous", "title": "Approval of Previous Minutes", "default_content": "", "required": False},
    {"order": 3, "key": "officers_reports", "title": "Officers' Reports", "default_content": "", "required": False},
    {"order": 4, "key": "chief_report", "title": "Chief's Report", "default_content": "", "required": False},
    {"order": 5, "key": "strategic_planning", "title": "Strategic Planning & Goals", "default_content": "", "required": False},
    {"order": 6, "key": "personnel_matters", "title": "Personnel Matters", "default_content": "", "required": False},
    {"order": 7, "key": "old_business", "title": "Old Business", "default_content": "", "required": False},
    {"order": 8, "key": "new_business", "title": "New Business", "default_content": "", "required": False},
    {"order": 9, "key": "executive_session", "title": "Executive Session", "default_content": "", "required": False},
    {"order": 10, "key": "adjournment", "title": "Adjournment", "default_content": "", "required": True},
]

DEFAULT_ANNUAL_SECTIONS = [
    {"order": 0, "key": "call_to_order", "title": "Call to Order", "default_content": "", "required": True},
    {"order": 1, "key": "roll_call", "title": "Roll Call / Attendance", "default_content": "", "required": True},
    {"order": 2, "key": "approval_of_previous", "title": "Approval of Previous Annual Minutes", "default_content": "", "required": False},
    {"order": 3, "key": "annual_report", "title": "Annual Report", "default_content": "", "required": True},
    {"order": 4, "key": "treasurer_report", "title": "Treasurer's Annual Report", "default_content": "", "required": True},
    {"order": 5, "key": "chief_report", "title": "Chief's Annual Report", "default_content": "", "required": False},
    {"order": 6, "key": "committee_reports", "title": "Committee Reports", "default_content": "", "required": False},
    {"order": 7, "key": "election_results", "title": "Election Results", "default_content": "", "required": False},
    {"order": 8, "key": "awards_recognition", "title": "Awards & Recognition", "default_content": "", "required": False},
    {"order": 9, "key": "old_business", "title": "Old Business", "default_content": "", "required": False},
    {"order": 10, "key": "new_business", "title": "New Business", "default_content": "", "required": False},
    {"order": 11, "key": "adjournment", "title": "Adjournment", "default_content": "", "required": True},
]


class MinutesTemplate(Base):
    """
    Meeting Minutes Template

    Defines a reusable template with predefined sections, ordering,
    and document header/footer configuration for uniform output.
    """
    __tablename__ = "minutes_templates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    meeting_type = Column(SQLEnum(MinutesMeetingType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=MinutesMeetingType.BUSINESS)
    is_default = Column(Boolean, nullable=False, default=False)

    # Sections definition: JSON array of {order, key, title, default_content, required}
    sections = Column(JSON, nullable=False)

    # Document header config: {org_name, logo_url, subtitle, show_date, show_type}
    header_config = Column(JSON, nullable=True)

    # Document footer config: {left_text, center_text, right_text, show_page_numbers, confidentiality_notice}
    footer_config = Column(JSON, nullable=True)

    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_minutes_templates_organization_id", "organization_id"),
        Index("ix_minutes_templates_meeting_type", "meeting_type"),
    )


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
    meeting_type = Column(SQLEnum(MinutesMeetingType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=MinutesMeetingType.BUSINESS)
    meeting_date = Column(DateTime, nullable=False)
    location = Column(String(300), nullable=True)
    called_by = Column(String(200), nullable=True)
    called_to_order_at = Column(DateTime, nullable=True)
    adjourned_at = Column(DateTime, nullable=True)

    # Attendees (stored as JSON array of {user_id, name, role, present})
    attendees = Column(JSON, nullable=True)
    quorum_met = Column(Boolean, nullable=True)
    quorum_count = Column(Integer, nullable=True)

    # Quorum configuration for this meeting
    # quorum_type: "count" (absolute headcount) or "percentage" (of active members)
    # quorum_threshold: the required value (e.g. 10 members or 50.0 percent)
    # These default from org settings but can be overridden per-meeting.
    quorum_type = Column(String(20), nullable=True)  # "count" or "percentage"
    quorum_threshold = Column(Float, nullable=True)

    # Dynamic content sections: JSON array of {order, key, title, content}
    # When present, this is the authoritative source for content.
    # Legacy fields below are retained for backward compatibility.
    sections = Column(JSON, nullable=True)

    # Template used to create these minutes
    template_id = Column(String(36), ForeignKey("minutes_templates.id", ondelete="SET NULL"), nullable=True)

    # Document header/footer overrides (inherits from template if null)
    header_config = Column(JSON, nullable=True)
    footer_config = Column(JSON, nullable=True)

    # Published document reference
    published_document_id = Column(String(36), nullable=True)

    # Legacy content sections (kept for backward compat with existing data)
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
    template = relationship("MinutesTemplate", foreign_keys=[template_id])
    event = relationship("Event", foreign_keys=[event_id])
    motions = relationship("Motion", back_populates="minutes", cascade="all, delete-orphan", order_by="Motion.order")
    action_items = relationship("ActionItem", back_populates="minutes", cascade="all, delete-orphan", order_by="ActionItem.created_at")

    def get_sections(self):
        """Return sections from the dynamic field, or build from legacy fields."""
        if self.sections:
            return self.sections

        # Build sections from legacy fields for backward compatibility
        legacy_map = [
            ("agenda", "Agenda"),
            ("old_business", "Old Business"),
            ("new_business", "New Business"),
            ("treasurer_report", "Treasurer's Report"),
            ("chief_report", "Chief's Report"),
            ("committee_reports", "Committee Reports"),
            ("announcements", "Announcements"),
            ("notes", "General Notes"),
        ]
        result = []
        for i, (key, title) in enumerate(legacy_map):
            value = getattr(self, key, None)
            if value:
                result.append({"order": i, "key": key, "title": title, "content": value})
        return result

    def get_effective_header(self):
        """Get header config: minutes override > template > None"""
        if self.header_config:
            return self.header_config
        if self.template and self.template.header_config:
            return self.template.header_config
        return None

    def get_effective_footer(self):
        """Get footer config: minutes override > template > None"""
        if self.footer_config:
            return self.footer_config
        if self.template and self.template.footer_config:
            return self.template.footer_config
        return None

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
    __tablename__ = "minutes_action_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    minutes_id = Column(String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False)

    # Item details
    description = Column(Text, nullable=False)
    assignee_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    assignee_name = Column(String(200), nullable=True)
    due_date = Column(DateTime, nullable=True)
    priority = Column(SQLEnum(ActionItemPriority, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ActionItemPriority.MEDIUM)

    # Status tracking
    status = Column(SQLEnum(MinutesActionItemStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=MinutesActionItemStatus.PENDING)
    completed_at = Column(DateTime, nullable=True)
    completion_notes = Column(Text, nullable=True)

    # Metadata
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    minutes = relationship("MeetingMinutes", back_populates="action_items")

    __table_args__ = (
        Index("ix_minutes_action_items_minutes_id", "minutes_id"),
        Index("ix_minutes_action_items_assignee_id", "assignee_id"),
        Index("ix_minutes_action_items_status", "status"),
        Index("ix_minutes_action_items_due_date", "due_date"),
    )
