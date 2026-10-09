"""
Compliance Requirements Configuration Models

Defines the compliance configuration that determines what requirements
must be met for a member to be considered "compliant", including
thresholds, role-based profiles, and report scheduling.
"""

from datetime import datetime
from enum import Enum as PyEnum
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.user import generate_uuid

if TYPE_CHECKING:
    from app.models.user import Organization


class ComplianceThresholdType(str, PyEnum):
    """How compliance percentage maps to status."""

    PERCENTAGE = "percentage"
    ALL_REQUIRED = "all_required"


class ReportFrequency(str, PyEnum):
    """Frequency for automated compliance reports."""

    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"
    NONE = "none"


class ReportStatus(str, PyEnum):
    """Status of a generated compliance report."""

    PENDING = "pending"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"


class ComplianceConfig(Base):
    """Organization-level compliance configuration.

    Defines thresholds, rules, and report scheduling for the
    compliance requirements system.
    """

    __tablename__ = "compliance_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # -- Threshold settings --
    threshold_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default=ComplianceThresholdType.PERCENTAGE.value,
        server_default="percentage",
    )
    compliant_threshold: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=100.0,
        comment="Min % of requirements met to be compliant",
        server_default="100.0",
    )
    at_risk_threshold: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=75.0,
        comment="Min % to be at-risk (below = non-compliant)",
        server_default="75.0",
    )

    # -- Grace period --
    grace_period_days: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Days after deadline before marking non-compliant",
        server_default="0",
    )

    # -- Evaluation period boundary --
    include_current_month: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
        comment=(
            "When false, compliance calculations evaluate as of the last day "
            "of the previous month so the in-progress month does not yet "
            "count against members (e.g. departments that drill end-of-month)."
        ),
    )

    # -- Report scheduling --
    auto_report_frequency: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=ReportFrequency.NONE.value,
        server_default="none",
    )
    report_email_recipients: Mapped[Optional[list[str]]] = mapped_column(
        JSON,
        nullable=True,
        comment="List of email addresses to receive reports",
    )
    report_day_of_month: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        default=1,
        comment="Day of month to generate monthly/quarterly reports",
    )

    # -- Notification settings --
    notify_non_compliant_members: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    notify_days_before_deadline: Mapped[Optional[list[int]]] = mapped_column(
        JSON,
        nullable=True,
        default=lambda: [30, 14, 7],
        comment="Days before deadline to send reminders",
    )

    # -- Metadata --
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", backref="compliance_config"
    )
    profiles: Mapped[list["ComplianceProfile"]] = relationship(
        "ComplianceProfile",
        back_populates="config",
        cascade="all, delete-orphan",
    )


class ComplianceProfile(Base):
    """Role/membership-type specific compliance profile.

    Allows different compliance rules for different member groups
    (e.g., active firefighters vs. administrative members).
    """

    __tablename__ = "compliance_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    config_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("compliance_configs.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # -- Applicability --
    membership_types: Mapped[Optional[list[str]]] = mapped_column(
        JSON,
        nullable=True,
        comment="Membership types this profile applies to",
    )
    role_ids: Mapped[Optional[list[str]]] = mapped_column(
        JSON,
        nullable=True,
        comment="Role IDs this profile applies to",
    )

    # -- Override thresholds (null = use org default) --
    compliant_threshold_override: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )
    at_risk_threshold_override: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )

    # -- Required training requirements --
    required_requirement_ids: Mapped[Optional[list[str]]] = mapped_column(
        JSON,
        nullable=True,
        comment="Training requirement IDs that MUST be met",
    )
    optional_requirement_ids: Mapped[Optional[list[str]]] = mapped_column(
        JSON,
        nullable=True,
        comment="Training requirement IDs that are tracked but optional",
    )

    # -- Admin hours requirements --
    admin_hours_requirements: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON,
        nullable=True,
        comment=(
            "List of {category_id, required_hours, frequency} objects. "
            "Defines yearly/quarterly admin hours targets per category."
        ),
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    priority: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Higher = evaluated first when member matches multiple",
        server_default="0",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    config: Mapped["ComplianceConfig"] = relationship(
        "ComplianceConfig", back_populates="profiles"
    )


class ComplianceReport(Base):
    """Stored compliance reports (auto-generated or manual).

    Reports are generated, stored as JSON snapshots, and optionally
    emailed to configured recipients.
    """

    __tablename__ = "compliance_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # -- Report metadata --
    report_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="monthly, annual, or yearly ('yearly' is an alias of 'annual')",
    )
    period_label: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="e.g., 'March 2026' or '2025'",
    )
    period_year: Mapped[int] = mapped_column(Integer, nullable=False)
    period_month: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, comment="1-12 for monthly"
    )

    # -- Status --
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=ReportStatus.PENDING.value,
        server_default="pending",
    )

    # -- Report data (JSON snapshot) --
    report_data: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="Full report snapshot",
    )
    summary: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        comment="Executive summary metrics",
    )

    # -- Distribution --
    emailed_to: Mapped[Optional[list[str]]] = mapped_column(
        JSON,
        nullable=True,
        comment="Email addresses report was sent to",
    )
    emailed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # -- Generation metadata --
    generated_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="User ID or null for auto-generated",
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    generation_duration_ms: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )

    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # Reports are listed per organization for a given reporting period.
        Index(
            "idx_compliance_reports_org_period",
            "organization_id",
            "period_year",
            "period_month",
        ),
        Index("idx_compliance_reports_status", "status"),
    )
