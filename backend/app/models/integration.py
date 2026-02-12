"""
Integration Database Models

SQLAlchemy models for external integration configurations.
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Text,
    JSON,
    Index,
)
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class Integration(Base):
    """Stores integration configurations per organization"""
    __tablename__ = "integrations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), nullable=False, index=True)
    integration_type = Column(String(50), nullable=False)  # google-calendar, slack, etc.
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=False)  # Calendar, Messaging, Data
    status = Column(String(20), nullable=False, default="available")  # available, connected, error, coming_soon
    config = Column(JSON, default={})
    enabled = Column(Boolean, default=False)
    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_integrations_org_type", "organization_id", "integration_type", unique=True),
    )
