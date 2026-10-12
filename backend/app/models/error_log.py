"""
Error Log Database Models

SQLAlchemy models for persistent error tracking.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class ErrorLog(Base):
    """Stores application error logs for monitoring"""

    __tablename__ = "error_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(String(36), nullable=False)
    error_type: Mapped[str] = mapped_column(String(50), nullable=False)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    user_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    troubleshooting_steps: Mapped[Optional[list[str]]] = mapped_column(
        JSON, default=list
    )
    context: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    event_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    # App-side default writes UTC regardless of the MySQL session time zone;
    # server_default stays as a fallback for rows inserted outside the ORM.
    # (MySQL's NOW() follows the container's TZ setting, so relying on it
    # alone would store local time on deployments that override TZ.)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )

    __table_args__ = (
        Index("ix_error_logs_org_type", "organization_id", "error_type"),
        Index("ix_error_logs_created", "created_at"),
    )
