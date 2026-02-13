"""
Error Log Database Models

SQLAlchemy models for persistent error tracking.
"""

from sqlalchemy import (
    Column,
    String,
    DateTime,
    Text,
    JSON,
    Index,
)
from sqlalchemy.sql import func

from app.core.utils import generate_uuid

from app.core.database import Base


class ErrorLog(Base):
    """Stores application error logs for monitoring"""
    __tablename__ = "error_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), nullable=False, index=True)
    error_type = Column(String(50), nullable=False)
    error_message = Column(Text, nullable=False)
    user_message = Column(Text, nullable=True)
    troubleshooting_steps = Column(JSON, default=[])
    context = Column(JSON, default={})
    user_id = Column(String(36), nullable=True)
    event_id = Column(String(36), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_error_logs_org_type", "organization_id", "error_type"),
        Index("ix_error_logs_created", "created_at"),
    )
