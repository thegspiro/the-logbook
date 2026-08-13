"""
Error Log Database Models

SQLAlchemy models for persistent error tracking.
"""

from datetime import datetime, timezone

from sqlalchemy import JSON, Column, DateTime, Index, String, Text
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class ErrorLog(Base):
    """Stores application error logs for monitoring"""

    __tablename__ = "error_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), nullable=False)
    error_type = Column(String(50), nullable=False)
    error_message = Column(Text, nullable=False)
    user_message = Column(Text, nullable=True)
    troubleshooting_steps = Column(JSON, default=list)
    context = Column(JSON, default=dict)
    user_id = Column(String(36), nullable=True)
    event_id = Column(String(36), nullable=True)
    # App-side default writes UTC regardless of the MySQL session time zone;
    # server_default stays as a fallback for rows inserted outside the ORM.
    # (MySQL's NOW() follows the container's TZ setting, so relying on it
    # alone would store local time on deployments that override TZ.)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )

    __table_args__ = (
        Index("ix_error_logs_org_type", "organization_id", "error_type"),
        Index("ix_error_logs_created", "created_at"),
    )
