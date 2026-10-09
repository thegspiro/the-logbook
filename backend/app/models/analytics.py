"""
Analytics Database Models

SQLAlchemy models for analytics event tracking and saved report configurations.
"""

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class AnalyticsEvent(Base):
    """Stores analytics events (QR scans, check-ins, etc.)"""

    __tablename__ = "analytics_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(String(36), nullable=False)
    event_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # qr_scan, check_in_success, check_in_failure, etc.
    event_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True
    )  # reference to the event being tracked
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    device_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    event_metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(
        "metadata", JSON, default=dict
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Configuration
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    report_type: Mapped[str] = mapped_column(String(50), nullable=False)
    filters: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)

    # Scheduling. NOTE (2026-08-27): stored and API-writable, but nothing
    # reads it — no TASK_RUNNERS entry (scheduled_tasks.py) or other job
    # advances next_run_date or sends email_recipients. A caller can set
    # is_scheduled=True and see it listed as scheduled with no report ever
    # generated (CLAUDE.md Pitfall #19 shape). SavedReportResponse.enforced
    # reports this so the UI can label it instead of badging it Active; a
    # scheduler is needed before this can report True. See
    # docs/KNOWN_LIMITATIONS.md.
    is_scheduled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    schedule_frequency: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # daily, weekly, monthly, quarterly
    schedule_day: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # day-of-week (1-7) or day-of-month (1-31)
    next_run_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Delivery
    email_recipients: Mapped[Optional[list[str]]] = mapped_column(
        JSON, default=list
    )  # list of email addresses

    # Ownership
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_saved_reports_org", "organization_id"),
        Index("ix_saved_reports_scheduled", "is_scheduled", "next_run_date"),
    )
