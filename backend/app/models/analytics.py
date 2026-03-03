"""
Analytics Database Models

SQLAlchemy models for analytics event tracking and saved report configurations.
"""

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class AnalyticsEvent(Base):
    """Stores analytics events (QR scans, check-ins, etc.)"""

    __tablename__ = "analytics_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), nullable=False, index=True)
    event_type = Column(
        String(50), nullable=False
    )  # qr_scan, check_in_success, check_in_failure, etc.
    event_id = Column(String(36), nullable=True)  # reference to the event being tracked
    user_id = Column(String(36), nullable=True)
    device_type = Column(String(20), nullable=True)
    event_metadata = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_analytics_org_event", "organization_id", "event_id"),
        Index("ix_analytics_created", "created_at"),
    )


class SavedReport(Base):
    """
    Saved report configuration

    Allows users to save report configurations and optionally schedule
    them for periodic generation with email delivery.
    """

    __tablename__ = "saved_reports"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Configuration
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    report_type = Column(String(50), nullable=False)
    filters = Column(JSON, default=dict)

    # Scheduling
    is_scheduled = Column(Boolean, default=False, nullable=False)
    schedule_frequency = Column(
        String(20), nullable=True
    )  # daily, weekly, monthly, quarterly
    schedule_day = Column(
        Integer, nullable=True
    )  # day-of-week (1-7) or day-of-month (1-31)
    next_run_date = Column(Date, nullable=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)

    # Delivery
    email_recipients = Column(JSON, default=list)  # list of email addresses

    # Ownership
    created_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active = Column(Boolean, default=True, nullable=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_saved_reports_org", "organization_id"),
        Index("ix_saved_reports_scheduled", "is_scheduled", "next_run_date"),
    )
