"""
Admin Hours Models

Database models for tracking administrative hours logged by members.
Supports QR code clock-in/clock-out, manual entry with optional approval workflows,
and automatic crediting from event attendance via configurable mappings.
"""

from enum import Enum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class AdminHoursEntryMethod(str, Enum):
    """How the hours entry was created"""

    QR_SCAN = "qr_scan"
    MANUAL = "manual"
    EVENT_ATTENDANCE = "event_attendance"


class AdminHoursEntryStatus(str, Enum):
    """Status of an admin hours entry"""

    ACTIVE = "active"  # Clock-in started, not yet clocked out
    PENDING = "pending"  # Submitted, awaiting approval
    APPROVED = "approved"
    REJECTED = "rejected"


class AdminHoursCategory(Base):
    """
    Admin Hours Category

    Defines the types of administrative work members can log hours for.
    Each category can generate a QR code for easy clock-in/clock-out.
    """

    __tablename__ = "admin_hours_categories"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Category details
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=True)  # Hex color for UI, e.g. "#3B82F6"

    # Approval settings
    require_approval = Column(Boolean, nullable=False, default=True)
    auto_approve_under_hours = Column(
        Float, nullable=True
    )  # Auto-approve if under X hours (null = always require approval)

    # Safety limits
    max_hours_per_session = Column(
        Float, nullable=True, default=12.0
    )  # Auto clock-out after X hours (null = no limit)

    # Status
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)

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
    entries = relationship(
        "AdminHoursEntry", back_populates="category", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_admin_hours_categories_org_id", "organization_id"),
        Index("ix_admin_hours_categories_active", "organization_id", "is_active"),
    )


class AdminHoursEntry(Base):
    """
    Admin Hours Entry

    Records a single session of administrative work by a member.
    Can be created via QR code scan (clock-in/clock-out) or manual entry.
    """

    __tablename__ = "admin_hours_entries"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category_id = Column(
        String(36),
        ForeignKey("admin_hours_categories.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Time tracking
    clock_in_at = Column(DateTime(timezone=True), nullable=False)
    clock_out_at = Column(DateTime(timezone=True), nullable=True)  # null = still active
    duration_minutes = Column(Integer, nullable=True)  # Calculated on clock-out

    # Details
    description = Column(Text, nullable=True)
    entry_method = Column(
        SQLEnum(
            AdminHoursEntryMethod,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=AdminHoursEntryMethod.MANUAL,
    )

    # Event attendance source (set when entry_method = EVENT_ATTENDANCE)
    source_event_id = Column(
        String(36),
        ForeignKey("events.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_rsvp_id = Column(
        String(36),
        ForeignKey("event_rsvps.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Approval workflow
    status = Column(
        SQLEnum(
            AdminHoursEntryStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=AdminHoursEntryStatus.ACTIVE,
    )
    approved_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)

    # Metadata
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
    category = relationship("AdminHoursCategory", back_populates="entries")
    user = relationship("User", foreign_keys=[user_id])
    approver = relationship("User", foreign_keys=[approved_by])
    source_event = relationship("Event", foreign_keys=[source_event_id])

    __table_args__ = (
        Index("ix_admin_hours_entries_org_id", "organization_id"),
        Index("ix_admin_hours_entries_user_id", "user_id"),
        Index("ix_admin_hours_entries_category_id", "category_id"),
        Index("ix_admin_hours_entries_status", "organization_id", "status"),
        Index(
            "ix_admin_hours_entries_user_active",
            "user_id",
            "status",
        ),
        Index("ix_admin_hours_entries_source_rsvp", "source_rsvp_id", "category_id"),
    )


class EventHourMapping(Base):
    """Maps event types/custom categories to admin hours categories.

    Allows organizations to configure how event attendance hours are
    automatically credited to admin hours categories, with optional
    percentage splits (e.g., 70% Training, 30% Professional Development).
    """

    __tablename__ = "event_hour_mappings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Source: exactly one of these must be set
    event_type = Column(String(50), nullable=True)
    custom_category = Column(String(100), nullable=True)

    # Target admin hours category + percentage of hours to credit
    admin_hours_category_id = Column(
        String(36),
        ForeignKey("admin_hours_categories.id", ondelete="CASCADE"),
        nullable=False,
    )
    percentage = Column(Integer, nullable=False, default=100)

    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
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
    admin_hours_category = relationship("AdminHoursCategory")

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
        Index("ix_event_hour_mappings_org_id", "organization_id"),
        Index(
            "ix_event_hour_mappings_org_event_type",
            "organization_id",
            "event_type",
        ),
    )
