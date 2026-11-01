"""
Meeting Minutes Models

Database models for meeting minutes, motions, action items, and templates.
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import JSON, Boolean, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.election import Election
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

    # A motion the outline prepared that the meeting has not acted on yet:
    # wording only, no mover, no vote. Never printed, published, posted or
    # sealed into an adopted record, because nothing happened.
    PENDING = "pending"
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


class MinutesAttachmentCategory(str, Enum):
    """What a file attached to a set of minutes is"""

    SIGNED_COPY = "signed_copy"
    REPORT = "report"
    AGENDA = "agenda"
    HANDOUT = "handout"
    CORRESPONDENCE = "correspondence"
    OTHER = "other"


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

# Parliamentary procedure puts these two behind a motion and a second, so the
# built-in outlines mark them and carry the usual wording. The wording is a
# starting point the secretary edits on the section, not a fixed script.
# The section whose motion accepts the previous meeting's minutes.
PREVIOUS_MINUTES_SECTION = "approval_of_previous"

DEFAULT_MOTION_SECTIONS = {
    PREVIOUS_MINUTES_SECTION: "Motion to approve the minutes of the previous meeting.",
    "adjournment": "Motion to adjourn the meeting.",
}

for _defaults in (
    DEFAULT_BUSINESS_SECTIONS,
    DEFAULT_SPECIAL_SECTIONS,
    DEFAULT_COMMITTEE_SECTIONS,
    DEFAULT_TRUSTEE_SECTIONS,
    DEFAULT_EXECUTIVE_SECTIONS,
    DEFAULT_ANNUAL_SECTIONS,
):
    for _section in _defaults:
        if _section["key"] in DEFAULT_MOTION_SECTIONS:
            _section["needs_motion"] = True
            _section["motion_text"] = DEFAULT_MOTION_SECTIONS[_section["key"]]


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
    # Which adopted version the library copy shows, and when it was filed, so a
    # republish can say "replaces version N, published <date>".
    published_revision_version: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
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

    # Adoption. The body adopts minutes at a later meeting, usually after
    # members have read them and suggested corrections. ``approved_at`` is when
    # the secretary recorded the adoption; these say what the body did and where:
    # the day of the vote, the minutes of the meeting that adopted these, and
    # whether they were adopted as presented or as amended.
    adopted_on: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    adopted_as_amended: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # Who moved and seconded the adoption. Names, not user ids, because a
    # department may let a guest make the motion as an honorary act.
    adoption_moved_by: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    adoption_seconded_by: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    # This set of minutes' own choice of which attendance statuses to name
    # (all / present_excused / present); NULL follows the department default.
    attendance_listing: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    adopting_minutes_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("meeting_minutes.id", ondelete="SET NULL"),
        nullable=True,
    )

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
    # Bumped by every content save; a save that names an older value is
    # refused (409), so two secretaries editing one draft cannot silently
    # overwrite each other's sections (MM5-4). A counter rather than
    # updated_at, which is stored to the second and would miss two saves in
    # the same second.
    edit_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
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
    # Loaded only where asked for (``get_minutes``), to name the meeting that
    # adopted these minutes; a list never pays for it.
    adopting_minutes: Mapped[Optional["MeetingMinutes"]] = relationship(
        "MeetingMinutes",
        remote_side="MeetingMinutes.id",
        foreign_keys=[adopting_minutes_id],
        lazy="raise",
    )
    meeting: Mapped[Optional["Meeting"]] = relationship(
        "Meeting", foreign_keys=[meeting_id]
    )
    motions: Mapped[list["Motion"]] = relationship(
        "Motion",
        back_populates="minutes",
        foreign_keys="Motion.minutes_id",
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

    # The outline section this motion belongs to, when it was made from one
    # ("Approval of Previous Minutes", "Adjournment"). Not a foreign key: a
    # section is an entry inside the minutes' JSON, not a row.
    section_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # For the motion that accepts the previous meeting's minutes: those
    # minutes, found by the server (never taken from a client), and whether
    # they were accepted as submitted or as revised. Passing the motion
    # prefills the adoption of the previous minutes from it.
    previous_minutes_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("meeting_minutes.id", ondelete="SET NULL"), nullable=True
    )
    acceptance: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # The ballot that decided this motion, when it went to a ballot rather
    # than a voice or hand vote. ``ballot_item_id`` is the item's id inside
    # that election's ``ballot_items``.
    election_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("elections.id", ondelete="SET NULL"), nullable=True
    )
    ballot_item_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

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
    votes_recused: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # What the vote needed to carry: see app/utils/motion_votes.py. NULL reads
    # as the default, a majority of the votes cast.
    threshold: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # Each member's vote, when the vote was taken by roll call:
    # [{"user_id": str | None, "name": str, "vote": yes|no|abstain|recuse}].
    # The totals above are derived from it when it is recorded.
    roll_call: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )

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
        "MeetingMinutes", back_populates="motions", foreign_keys=[minutes_id]
    )
    # Loaded with the motion so a response can name the ballot. The id is
    # checked against the caller's organization when it is written, so this
    # join cannot reach another department's election.
    election: Mapped[Optional["Election"]] = relationship(
        "Election", foreign_keys=[election_id], lazy="selectin"
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

    # Carry-forward: an item still open when its meeting is over is copied into
    # the next meeting's minutes. The copy points back at what it continues;
    # the original is stamped so it stops counting as open (and stops being
    # reminded) while keeping its place in the record of the meeting that
    # assigned it.
    carried_from_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("minutes_action_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    carried_forward_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # When the assignee was last emailed a reminder about this item. The daily
    # reminder task reads it to send each reminder once, and to space repeat
    # reminders on an overdue item.
    last_reminded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

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

    if TYPE_CHECKING:
        # Not a column. MinuteService records which fields an update applied so the
        # endpoint can audit them. Declared only for the type checker: an annotation
        # SQLAlchemy sees would have to be mapped.
        applied_fields: set[str]

    __table_args__ = (
        Index("ix_minutes_action_items_minutes_id", "minutes_id"),
        Index("ix_minutes_action_items_assignee_id", "assignee_id"),
        Index("ix_minutes_action_items_status", "status"),
        Index("ix_minutes_action_items_due_date", "due_date"),
        Index("ix_minutes_action_items_carried_from_id", "carried_from_id"),
    )


class MinutesAttachment(Base):
    """A file kept with a set of minutes: reports, handouts, the signed copy.

    The bytes live in ``FileStorageService``'s ``minutes-attachments`` area and
    are served only through the minutes endpoints, so a file attached to
    executive-session minutes is as restricted as the minutes themselves. They
    are deliberately *not* filed as shared Documents, whose folder rights
    reach every ``documents.view`` holder.
    """

    __tablename__ = "minutes_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    minutes_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default=MinutesAttachmentCategory.OTHER.value,
        server_default=MinutesAttachmentCategory.OTHER.value,
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)

    uploaded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_minutes_attachments_minutes_id", "minutes_id"),
        Index("ix_minutes_attachments_organization_id", "organization_id"),
    )


class MinutesElectionResult(Base):
    """An election's certified result, frozen into a set of minutes.

    The minutes are the permanent record; the election row is not (it can be
    rolled back, annotated, or deleted with its department's data). So the
    result the meeting heard is copied here, whole, at the moment a minutes
    manager imports it, and later changes to the election do not rewrite it.
    """

    __tablename__ = "minutes_election_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    minutes_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    election_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("elections.id", ondelete="SET NULL"), nullable=True
    )

    election_title: Mapped[str] = mapped_column(String(300), nullable=False)
    election_closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # ElectionResults.model_dump(mode="json") as it stood at capture.
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    # An election can close after the meeting's minutes were written, or even
    # adopted. The result is still filed with the meeting it belonged to; one
    # filed once the minutes were submitted is an addendum: dated, permanent,
    # and outside what the adopted version covers (like a signed copy).
    is_addendum: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    captured_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "minutes_id", "election_id", name="uq_minutes_election_results_pair"
        ),
        Index("ix_minutes_election_results_minutes_id", "minutes_id"),
        Index("ix_minutes_election_results_organization_id", "organization_id"),
    )


class MinutesRevision(Base):
    """An approved version of a set of minutes, immutable once written.

    One row per approval. Reopening a record for a correction supersedes its
    latest revision rather than deleting it, so the version the body approved
    first is still on file, with its hash, after the corrected version is
    approved as the next one.
    """

    __tablename__ = "minutes_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    minutes_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)

    # See app.utils.minutes_snapshot for what is and is not in here.
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    submitted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    superseded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    superseded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    superseded_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("minutes_id", "version", name="uq_minutes_revisions_version"),
        Index("ix_minutes_revisions_minutes_id", "minutes_id"),
        Index("ix_minutes_revisions_organization_id", "organization_id"),
    )


class MinutesSignature(Base):
    """A signature on adopted minutes: who attested to which version, and when.

    Tied to the revision it was given on, and carrying that revision's content
    hash, so the signature is evidence of one exact version. Reopening the
    minutes supersedes the revision and the signatures stay with it, on file
    against the text they were given for; the corrected version starts with
    none.
    """

    __tablename__ = "minutes_signatures"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    minutes_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False
    )
    revision_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("minutes_revisions.id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # The department's slot at the time ("recording_secretary"); the title is
    # kept so a later rename of the slot does not rewrite what was signed.
    slot_key: Mapped[str] = mapped_column(String(50), nullable=False)
    slot_title: Mapped[str] = mapped_column(String(100), nullable=False)
    signer_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    signed_name: Mapped[str] = mapped_column(String(200), nullable=False)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (
        UniqueConstraint("revision_id", "slot_key", name="uq_minutes_signatures_slot"),
        Index("ix_minutes_signatures_minutes_id", "minutes_id"),
        Index("ix_minutes_signatures_revision_id", "revision_id"),
        Index("ix_minutes_signatures_organization_id", "organization_id"),
    )


class MinutesPublicCopy(Base):
    """The copy of a set of minutes posted on the department's public page.

    A snapshot taken when the minutes were published, not a live view: editing
    or reopening the minutes later does not change what the public sees until
    the corrected version is published over it. One row per set of minutes,
    replaced in place, with a note of the version it replaced.

    ``content`` holds only what the public page may show (see
    ``app/utils/minutes_public.py``); the full record stays in the minutes.
    """

    __tablename__ = "minutes_public_copies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    minutes_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("meeting_minutes.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    meeting_type: Mapped[str] = mapped_column(String(50), nullable=False)
    meeting_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    content: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    revision_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    posted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # The version this copy replaced, if any, shown on the page as a note.
    replaced_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    replaced_posted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set when the minutes are reopened for a correction; the page says so
    # until the corrected version replaces this one.
    under_correction_since: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # A withdrawn copy is not served; the row is kept as the record that it was
    # posted and taken down.
    withdrawn_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    withdrawn_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_minutes_public_copies_organization_id", "organization_id"),
        Index("ix_minutes_public_copies_listing", "organization_id", "withdrawn_at"),
    )


class MinutesClosedSession(Base):
    """A closed (executive) session held during a meeting.

    What the public record needs about it: why the body went into closed
    session, on what authority, when, who was in the room and for how long, and
    a summary safe to publish ("no action taken"). What was said stays in the
    minutes' own executive-session section, which is as restricted as the
    minutes themselves; the entry and exit times and the roster of who stayed
    are what let a reader see the closed session was properly held.
    """

    __tablename__ = "minutes_closed_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    minutes_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # The motion that moved the body into closed session, when one was recorded.
    motion_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("meeting_motions.id", ondelete="SET NULL"), nullable=True
    )

    reason: Mapped[str] = mapped_column(String(300), nullable=False)
    legal_basis: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # [{user_id, name, joined_at, left_at}], one shape settled by the schema.
    participants: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
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
        Index("ix_minutes_closed_sessions_minutes_id", "minutes_id"),
        Index("ix_minutes_closed_sessions_organization_id", "organization_id"),
    )


class MinutesSuggestionStatus(str, Enum):
    """Where a member's suggested change stands"""

    OPEN = "open"
    ACCEPTED = "accepted"
    DECLINED = "declined"


class MinutesSuggestion(Base):
    """A change a member proposes while the minutes are circulated for review.

    Minutes are locked once submitted, so a suggestion never edits them: it is
    a proposal the secretary reads, accepts or declines. Accepting one means
    "I will make this change" — the secretary recalls the minutes to draft,
    edits, and circulates again — and an accepted suggestion is what makes the
    adoption "as amended".
    """

    __tablename__ = "minutes_suggestions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    minutes_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # The section it is about, or NULL for the minutes as a whole.
    section_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Tracked changes: the reviewer edited a copy of the section. ``base_content``
    # is the section as they saw it and ``proposed_content`` their edit, both as
    # sanitized rich text; ``changes`` is the list of discrete edits between them
    # (app/utils/redline.py), each with the secretary's decision once made. All
    # NULL for a plain comment-and-wording suggestion.
    base_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    proposed_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    changes: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    # When the accepted changes were written into the section.
    applied_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Not a column: set when suggestions are listed, so the response can say the
    # section has been edited since the reviewer saw it.
    section_changed = False

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=MinutesSuggestionStatus.OPEN.value,
        server_default=MinutesSuggestionStatus.OPEN.value,
    )
    resolution_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
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
        Index("ix_minutes_suggestions_minutes_id", "minutes_id"),
        Index("ix_minutes_suggestions_organization_id", "organization_id"),
        Index("ix_minutes_suggestions_created_by", "created_by"),
    )
