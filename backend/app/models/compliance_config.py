"""
Compliance Requirements Configuration Models

Defines the compliance configuration that determines what requirements
must be met for a member to be considered "compliant", including
thresholds, role-based profiles, and report scheduling.
"""

from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.user import generate_uuid


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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # -- Threshold settings --
    threshold_type = Column(
        String(30),
        nullable=False,
        default=ComplianceThresholdType.PERCENTAGE.value,
    )
    compliant_threshold = Column(
        Float,
        nullable=False,
        default=100.0,
        comment="Min % of requirements met to be compliant",
    )
    at_risk_threshold = Column(
        Float,
        nullable=False,
        default=75.0,
        comment="Min % to be at-risk (below = non-compliant)",
    )

    # -- Grace period --
    grace_period_days = Column(
        Integer,
        nullable=False,
        default=0,
        comment="Days after deadline before marking non-compliant",
    )

    # -- Report scheduling --
    auto_report_frequency = Column(
        String(20),
        nullable=False,
        default=ReportFrequency.NONE.value,
    )
    report_email_recipients = Column(
        JSON,
        nullable=True,
        comment="List of email addresses to receive reports",
    )
    report_day_of_month = Column(
        Integer,
        nullable=True,
        default=1,
        comment="Day of month to generate monthly/quarterly reports",
    )

    # -- Notification settings --
    notify_non_compliant_members = Column(
        Boolean,
        nullable=False,
        default=False,
    )
    notify_days_before_deadline = Column(
        JSON,
        nullable=True,
        default=lambda: [30, 14, 7],
        comment="Days before deadline to send reminders",
    )

    # -- Metadata --
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    organization = relationship("Organization", backref="compliance_config")
    profiles = relationship(
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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    config_id = Column(
        String(36),
        ForeignKey("compliance_configs.id", ondelete="CASCADE"),
        nullable=False,
    )

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)

    # -- Applicability --
    membership_types = Column(
        JSON,
        nullable=True,
        comment="Membership types this profile applies to",
    )
    role_ids = Column(
        JSON,
        nullable=True,
        comment="Role IDs this profile applies to",
    )

    # -- Override thresholds (null = use org default) --
    compliant_threshold_override = Column(Float, nullable=True)
    at_risk_threshold_override = Column(Float, nullable=True)

    # -- Required training requirements --
    required_requirement_ids = Column(
        JSON,
        nullable=True,
        comment="Training requirement IDs that MUST be met",
    )
    optional_requirement_ids = Column(
        JSON,
        nullable=True,
        comment="Training requirement IDs that are tracked but optional",
    )

    # -- Admin hours requirements --
    admin_hours_requirements = Column(
        JSON,
        nullable=True,
        comment=(
            "List of {category_id, required_hours, frequency} objects. "
            "Defines yearly/quarterly admin hours targets per category."
        ),
    )

    is_active = Column(Boolean, nullable=False, default=True)
    priority = Column(
        Integer,
        nullable=False,
        default=0,
        comment="Higher = evaluated first when member matches multiple",
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    config = relationship("ComplianceConfig", back_populates="profiles")


class ComplianceReport(Base):
    """Stored compliance reports (auto-generated or manual).

    Reports are generated, stored as JSON snapshots, and optionally
    emailed to configured recipients.
    """

    __tablename__ = "compliance_reports"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # -- Report metadata --
    report_type = Column(
        String(20),
        nullable=False,
        comment="monthly or yearly",
    )
    period_label = Column(
        String(50),
        nullable=False,
        comment="e.g., 'March 2026' or '2025'",
    )
    period_year = Column(Integer, nullable=False)
    period_month = Column(Integer, nullable=True, comment="1-12 for monthly")

    # -- Status --
    status = Column(
        String(20),
        nullable=False,
        default=ReportStatus.PENDING.value,
    )

    # -- Report data (JSON snapshot) --
    report_data = Column(
        JSON,
        nullable=True,
        comment="Full report snapshot",
    )
    summary = Column(
        JSON,
        nullable=True,
        comment="Executive summary metrics",
    )

    # -- Distribution --
    emailed_to = Column(
        JSON,
        nullable=True,
        comment="Email addresses report was sent to",
    )
    emailed_at = Column(DateTime(timezone=True), nullable=True)

    # -- Generation metadata --
    generated_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="User ID or null for auto-generated",
    )
    generated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    generation_duration_ms = Column(Integer, nullable=True)

    error_message = Column(Text, nullable=True)
