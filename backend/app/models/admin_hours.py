"""
Admin Hours Models

Database models for tracking administrative hours logged by members.
Supports QR code clock-in/clock-out, manual entry with optional approval workflows,
and automatic crediting from event attendance via configurable mappings.
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.event import Event
    from app.models.user import User


class AdminHoursEntryMethod(str, Enum):
    """How the hours entry was created"""

    QR_SCAN = "qr_scan"
    # An officer-operated ID card station, distinct from a member scanning the
    # category's QR code with their own phone. Kept apart because an export or
    # an audit that cannot tell the two apart is claiming something untrue
    # about who was standing there.
    NFC_STATION = "nfc_station"
    MANUAL = "manual"
    EVENT_ATTENDANCE = "event_attendance"


class AdminHoursEntryStatus(str, Enum):
    """Status of an admin hours entry"""

    ACTIVE = "active"  # Clock-in started, not yet clocked out
    PENDING = "pending"  # Submitted, awaiting approval
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"  # Retracted by the member; counts toward nothing


class AdminHoursCategory(Base):
    """
    Admin Hours Category

    Defines the types of administrative work members can log hours for.
    Each category can generate a QR code for easy clock-in/clock-out.
    """

    __tablename__ = "admin_hours_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Category details
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    color: Mapped[Optional[str]] = mapped_column(
        String(7), nullable=True
    )  # Hex color for UI, e.g. "#3B82F6"

    # Approval settings
    require_approval: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    auto_approve_under_hours: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )  # Auto-approve if under X hours (null = always require approval)

    # Safety limits
    max_hours_per_session: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True, default=12.0
    )  # Auto clock-out after X hours (null = no limit)

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
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
    entries: Mapped[list["AdminHoursEntry"]] = relationship(
        "AdminHoursEntry", back_populates="category", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_admin_hours_categories_active", "organization_id", "is_active"),
    )


class AdminHoursEntry(Base):
    """
    Admin Hours Entry

    Records a single session of administrative work by a member.
    Can be created via QR code scan (clock-in/clock-out) or manual entry.
    """

    __tablename__ = "admin_hours_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("admin_hours_categories.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Time tracking
    clock_in_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    clock_out_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # null = still active
    duration_minutes: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Calculated on clock-out

    # Details
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    entry_method: Mapped[AdminHoursEntryMethod] = mapped_column(
        SQLEnum(
            AdminHoursEntryMethod,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=AdminHoursEntryMethod.MANUAL,
    )

    # Event attendance source (set when entry_method = EVENT_ATTENDANCE)
    source_event_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("events.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_rsvp_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("event_rsvps.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Approval workflow
    status: Mapped[AdminHoursEntryStatus] = mapped_column(
        SQLEnum(
            AdminHoursEntryStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=AdminHoursEntryStatus.ACTIVE,
        server_default="active",
    )
    approved_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

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
    category: Mapped["AdminHoursCategory"] = relationship(
        "AdminHoursCategory", back_populates="entries"
    )
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    approver: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[approved_by]
    )
    source_event: Mapped[Optional["Event"]] = relationship(
        "Event", foreign_keys=[source_event_id]
    )

    __table_args__ = (
        Index("ix_admin_hours_entries_category_id", "category_id"),
        Index("ix_admin_hours_entries_status", "organization_id", "status"),
        Index(
            "ix_admin_hours_entries_user_active",
            "user_id",
            "status",
        ),
        Index("ix_admin_hours_entries_source_rsvp", "source_rsvp_id", "category_id"),
    )


# Event types whose attendance is never credited to admin hours, whatever
# mapping a department has configured. A Training event's attendance is
# credited to the members' training records when its attendance is finalized;
# crediting admin hours as well counted the same hours twice wherever the two
# are added together (the dashboard's My Hours, the annual compliance report's
# total contributed). This is the authority: the crediting path, the event
# card's estimate and the mapping settings all read it, and the settings
# screen hides these types (frontend HourTrackingSection keeps a copy in step).
EVENT_TYPES_WITHOUT_ADMIN_HOURS = frozenset({"training"})

EVENT_TYPE_WITHOUT_ADMIN_HOURS_REASON = (
    "Training events are credited to members' training records instead of "
    "admin hours"
)


class EventHourMapping(Base):
    """Maps event types/custom categories to admin hours categories.

    Allows organizations to configure how event attendance hours are
    automatically credited to admin hours categories, with optional
    percentage splits (e.g., 70% Training, 30% Professional Development).
    """

    __tablename__ = "event_hour_mappings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Source: exactly one of these must be set
    event_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    custom_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Target admin hours category + percentage of hours to credit
    admin_hours_category_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("admin_hours_categories.id", ondelete="CASCADE"),
        nullable=False,
    )
    percentage: Mapped[int] = mapped_column(
        Integer, nullable=False, default=100, server_default="100"
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
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
    admin_hours_category: Mapped["AdminHoursCategory"] = relationship(
        "AdminHoursCategory"
    )

    __table_args__ = (
        CheckConstraint(
            "percentage >= 1 AND percentage <= 100",
            name="ck_event_hour_mappings_percentage_range",
        ),
        CheckConstraint(
            "(event_type IS NOT NULL AND custom_category IS NULL) OR "
            "(event_type IS NULL AND custom_category IS NOT NULL)",
            name="ck_event_hour_mappings_one_source",
        ),
        UniqueConstraint(
            "organization_id",
            "event_type",
            "custom_category",
            "admin_hours_category_id",
            name="uq_event_hour_mappings_source_target",
        ),
    )
