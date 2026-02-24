"""
Analytics Database Models

SQLAlchemy models for analytics event tracking.
"""

from sqlalchemy import JSON, Column, DateTime, Index, String
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
