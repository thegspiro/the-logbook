"""
Meeting Minutes Models

Database models for meeting minutes, motions, action items, and templates.
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import JSON, Boolean, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.event import Event
    from app.models.meeting import Meeting


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
    {
        "order": 0,
        "key": "call_to_order",
        "title": "Call to Order",
        "default_content": "",
        "required": True,
    },
    {
        "order": 1,
        "key": "roll_call",
        "title": "Roll Call / Attendance",
        "default_content": "",
        "required": True,
    },
    {
        "order": 2,
        "key": "approval_of_previous",
        "title": "Approval of Previous Minutes",
        "default_content": "",
        "required": False,
    },
    {
        "order": 3,
        "key": "treasurer_report",
        "title": "Treasurer's Report",
        "default_content": "",
        "required": False,
    },
    {
        "order": 4,
        "key": "chief_report",
        "title": "Chief's Report",
        "default_content": "",
        "required": False,
    },
    {
        "order": 5,
        "key": "committee_reports",
        "title": "Committee Reports",
        "default_content": "",
        "required": False,
    },
    {
        "order": 6,
        "key": "old_business",
        "title": "Old Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 7,
        "key": "new_business",
        "title": "New Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 8,
        "key": "announcements",
        "title": "Announcements",
        "default_content": "",
        "required": False,
    },
    {
        "order": 9,
        "key": "public_comment",
        "title": "Public Comment",
        "default_content": "",
        "required": False,
    },
    {
        "order": 10,
        "key": "adjournment",
        "title": "Adjournment",
        "default_content": "",
        "required": True,
    },
]

DEFAULT_SPECIAL_SECTIONS = [
    {
        "order": 0,
        "key": "call_to_order",
        "title": "Call to Order",
        "default_content": "",
        "required": True,
    },
    {
        "order": 1,
        "key": "roll_call",
        "title": "Roll Call / Attendance",
        "default_content": "",
        "required": True,
    },
    {
        "order": 2,
        "key": "purpose",
        "title": "Purpose of Special Meeting",
        "default_content": "",
        "required": True,
    },
    {
        "order": 3,
        "key": "discussion",
        "title": "Discussion",
        "default_content": "",
        "required": False,
    },
    {
        "order": 4,
        "key": "adjournment",
        "title": "Adjournment",
        "default_content": "",
        "required": True,
    },
]

DEFAULT_COMMITTEE_SECTIONS = [
    {
        "order": 0,
        "key": "call_to_order",
        "title": "Call to Order",
        "default_content": "",
        "required": True,
    },
    {
        "order": 1,
        "key": "roll_call",
        "title": "Roll Call / Attendance",
        "default_content": "",
        "required": True,
    },
    {
        "order": 2,
        "key": "old_business",
        "title": "Old Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 3,
        "key": "new_business",
        "title": "New Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 4,
        "key": "recommendations",
        "title": "Recommendations to Full Body",
        "default_content": "",
        "required": False,
    },
    {
        "order": 5,
        "key": "adjournment",
        "title": "Adjournment",
        "default_content": "",
        "required": True,
    },
]

DEFAULT_TRUSTEE_SECTIONS = [
    {
        "order": 0,
        "key": "call_to_order",
        "title": "Call to Order",
        "default_content": "",
        "required": True,
    },
    {
        "order": 1,
        "key": "roll_call",
        "title": "Roll Call / Attendance",
        "default_content": "",
        "required": True,
    },
    {
        "order": 2,
        "key": "approval_of_previous",
        "title": "Approval of Previous Minutes",
        "default_content": "",
        "required": False,
    },
    {
        "order": 3,
        "key": "treasurer_report",
        "title": "Treasurer's Report",
        "default_content": "",
        "required": True,
    },
    {
        "order": 4,
        "key": "financial_review",
        "title": "Financial Review & Budget",
        "default_content": "",
        "required": False,
    },
    {
        "order": 5,
        "key": "trust_fund_report",
        "title": "Trust Fund Report",
        "default_content": "",
        "required": False,
    },
    {
        "order": 6,
        "key": "audit_report",
        "title": "Audit Report",
        "default_content": "",
        "required": False,
    },
    {
        "order": 7,
        "key": "old_business",
        "title": "Old Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 8,
        "key": "new_business",
        "title": "New Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 9,
        "key": "legal_matters",
        "title": "Legal Matters",
        "default_content": "",
        "required": False,
    },
    {
        "order": 10,
        "key": "adjournment",
        "title": "Adjournment",
        "default_content": "",
        "required": True,
    },
]

DEFAULT_EXECUTIVE_SECTIONS = [
    {
        "order": 0,
        "key": "call_to_order",
        "title": "Call to Order",
        "default_content": "",
        "required": True,
    },
    {
        "order": 1,
        "key": "roll_call",
        "title": "Roll Call / Attendance",
        "default_content": "",
        "required": True,
    },
    {
        "order": 2,
        "key": "approval_of_previous",
        "title": "Approval of Previous Minutes",
        "default_content": "",
        "required": False,
    },
    {
        "order": 3,
        "key": "officers_reports",
        "title": "Officers' Reports",
        "default_content": "",
        "required": False,
    },
    {
        "order": 4,
        "key": "chief_report",
        "title": "Chief's Report",
        "default_content": "",
        "required": False,
    },
    {
        "order": 5,
        "key": "strategic_planning",
        "title": "Strategic Planning & Goals",
        "default_content": "",
        "required": False,
    },
    {
        "order": 6,
        "key": "personnel_matters",
        "title": "Personnel Matters",
        "default_content": "",
        "required": False,
    },
    {
        "order": 7,
        "key": "old_business",
        "title": "Old Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 8,
        "key": "new_business",
        "title": "New Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 9,
        "key": "executive_session",
        "title": "Executive Session",
        "default_content": "",
        "required": False,
    },
    {
        "order": 10,
        "key": "adjournment",
        "title": "Adjournment",
        "default_content": "",
        "required": True,
    },
]

DEFAULT_ANNUAL_SECTIONS = [
    {
        "order": 0,
        "key": "call_to_order",
        "title": "Call to Order",
        "default_content": "",
        "required": True,
    },
    {
        "order": 1,
        "key": "roll_call",
        "title": "Roll Call / Attendance",
        "default_content": "",
        "required": True,
    },
    {
        "order": 2,
        "key": "approval_of_previous",
        "title": "Approval of Previous Annual Minutes",
        "default_content": "",
        "required": False,
    },
    {
        "order": 3,
        "key": "annual_report",
        "title": "Annual Report",
        "default_content": "",
        "required": True,
    },
    {
        "order": 4,
        "key": "treasurer_report",
        "title": "Treasurer's Annual Report",
        "default_content": "",
        "required": True,
    },
    {
        "order": 5,
        "key": "chief_report",
        "title": "Chief's Annual Report",
        "default_content": "",
        "required": False,
    },
    {
        "order": 6,
        "key": "committee_reports",
        "title": "Committee Reports",
        "default_content": "",
        "required": False,
    },
    {
        "order": 7,
        "key": "election_results",
        "title": "Election Results",
        "default_content": "",
        "required": False,
    },
    {
        "order": 8,
        "key": "awards_recognition",
        "title": "Awards & Recognition",
        "default_content": "",
        "required": False,
    },
    {
        "order": 9,
        "key": "old_business",
        "title": "Old Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 10,
        "key": "new_business",
        "title": "New Business",
        "default_content": "",
        "required": False,
    },
    {
        "order": 11,
        "key": "adjournment",
        "title": "Adjournment",
        "default_content": "",
        "required": True,
    },
]


class MinutesTemplate(Base):
    """
    Meeting Minutes Template

    Defines a reusable template with predefined sections, ordering,
    and document header/footer configuration for uniform output.
    """

    __tablename__ = "minutes_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    meeting_type: Mapped[MinutesMeetingType] = mapped_column(
        SQLEnum(MinutesMeetingType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=MinutesMeetingType.BUSINESS,
        server_default="business",
    )
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    # Sections definition: JSON array of {order, key, title, default_content, required}
    sections: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)

    # Document header config: {org_name, logo_url, subtitle, show_date, show_type}
    header_config: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Document footer config: {left_text, center_text, right_text, show_page_numbers, confidentiality_notice}
    footer_config: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Meeting details
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    meeting_type: Mapped[MinutesMeetingType] = mapped_column(
        SQLEnum(MinutesMeetingType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=MinutesMeetingType.BUSINESS,
        server_default="business",
    )
    meeting_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    location: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    called_by: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    called_to_order_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    adjourned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Attendees (stored as JSON array of {user_id, name, role, present})
    attendees: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )
    quorum_met: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    quorum_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Quorum configuration for this meeting
    # quorum_type: "count" (absolute headcount) or "percentage" (of active members)
    # quorum_threshold: the required value (e.g. 10 members or 50.0 percent)
    # These default from org settings but can be overridden per-meeting.
    quorum_type: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # "count" or "percentage"
    quorum_threshold: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Dynamic content sections: JSON array of {order, key, title, content}
    # When present, this is the authoritative source for content.
    # Legacy fields below are retained for backward compatibility.
    sections: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )

    # Template used to create these minutes
    template_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("minutes_templates.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Document header/footer overrides (inherits from template if null)
    header_config: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    footer_config: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Published document reference
    published_document_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True
    )

    # Legacy content sections (kept for backward compat with existing data)
    agenda: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    old_business: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    new_business: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    treasurer_report: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    chief_report: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    committee_reports: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    announcements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Approval workflow
    status: Mapped[MinutesStatus] = mapped_column(
        SQLEnum(MinutesStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=MinutesStatus.DRAFT,
        server_default="draft",
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    submitted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    approved_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    rejected_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rejected_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Link to event (optional — minutes can be linked to a business_meeting event)
    event_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )

    # Link to meeting record (optional — pre-fills date, attendees, agenda from Meeting)
    meeting_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True
    )

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    template: Mapped[Optional["MinutesTemplate"]] = relationship(
        "MinutesTemplate", foreign_keys=[template_id]
    )
    event: Mapped[Optional["Event"]] = relationship("Event", foreign_keys=[event_id])
    meeting: Mapped[Optional["Meeting"]] = relationship(
        "Meeting", foreign_keys=[meeting_id]
    )
    motions: Mapped[list["Motion"]] = relationship(
        "Motion",
        back_populates="minutes",
        cascade="all, delete-orphan",
        order_by="Motion.order",
    )
    action_items: Mapped[list["ActionItem"]] = relationship(
        "ActionItem",
        back_populates="minutes",
        cascade="all, delete-orphan",
        order_by="ActionItem.created_at",
    )

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
                result.append(
                    {"order": i, "key": key, "title": title, "content": value}
                )
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    minutes_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False
    )

    # Motion details
    order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    motion_text: Mapped[str] = mapped_column(Text, nullable=False)
    moved_by: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    seconded_by: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    discussion_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Vote result
    status: Mapped[MotionStatus] = mapped_column(
        SQLEnum(MotionStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=MotionStatus.PASSED,
        server_default="passed",
    )
    votes_for: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    votes_against: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    votes_abstain: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    minutes: Mapped["MeetingMinutes"] = relationship(
        "MeetingMinutes", back_populates="motions"
    )

    __table_args__ = (Index("ix_meeting_motions_minutes_id", "minutes_id"),)


class ActionItem(Base):
    """
    Action Item model

    Tracks tasks assigned during a meeting with assignee, due date,
    and completion tracking.
    """

    __tablename__ = "minutes_action_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    minutes_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False
    )

    # Item details
    description: Mapped[str] = mapped_column(Text, nullable=False)
    assignee_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    assignee_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    due_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    priority: Mapped[ActionItemPriority] = mapped_column(
        SQLEnum(ActionItemPriority, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ActionItemPriority.MEDIUM,
        server_default="medium",
    )

    # Status tracking
    status: Mapped[MinutesActionItemStatus] = mapped_column(
        SQLEnum(
            MinutesActionItemStatus, values_callable=lambda x: [e.value for e in x]
        ),
        nullable=False,
        default=MinutesActionItemStatus.PENDING,
        server_default="pending",
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completion_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    minutes: Mapped["MeetingMinutes"] = relationship(
        "MeetingMinutes", back_populates="action_items"
    )

    __table_args__ = (
        Index("ix_minutes_action_items_minutes_id", "minutes_id"),
        Index("ix_minutes_action_items_assignee_id", "assignee_id"),
        Index("ix_minutes_action_items_status", "status"),
        Index("ix_minutes_action_items_due_date", "due_date"),
    )
