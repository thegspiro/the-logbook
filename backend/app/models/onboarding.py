"""
Onboarding System Models

Tracks onboarding progress and stores initial setup information.
"""

from sqlalchemy import Column, String, Boolean, DateTime, Text, JSON, Integer
from sqlalchemy.sql import func
from sqlalchemy.ext.mutable import MutableDict
from datetime import datetime

from app.core.database import Base
from app.models.user import generate_uuid


class OnboardingStatus(Base):
    """
    System-wide onboarding status

    Tracks whether the system has completed initial setup.
    Only one row should exist in this table.
    """

    __tablename__ = "onboarding_status"

    id = Column(String(36), primary_key=True, default=generate_uuid)

    # Onboarding completion status
    is_completed = Column(Boolean, default=False, nullable=False)
    completed_at = Column(DateTime(timezone=True))

    # Onboarding steps tracking
    steps_completed = Column(JSON, default={})
    current_step = Column(Integer, default=0)

    # System information collected during onboarding
    organization_name = Column(String(255))
    organization_type = Column(String(50))
    admin_email = Column(String(255))
    admin_username = Column(String(100))

    # Security verification
    security_keys_verified = Column(Boolean, default=False)
    database_verified = Column(Boolean, default=False)
    email_configured = Column(Boolean, default=False)

    # Configuration choices
    enabled_modules = Column(JSON, default=[])
    timezone = Column(String(50), default="America/New_York")

    # Metadata
    setup_started_at = Column(DateTime(timezone=True), server_default=func.now())
    setup_ip_address = Column(String(45))
    setup_user_agent = Column(Text)

    # Notes from setup process
    setup_notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        status = "Completed" if self.is_completed else "In Progress"
        return f"<OnboardingStatus(status={status}, step={self.current_step})>"


class OnboardingChecklistItem(Base):
    """
    Individual checklist items for post-onboarding setup

    These are recommendations/tasks for after initial onboarding
    """

    __tablename__ = "onboarding_checklist"

    id = Column(String(36), primary_key=True, default=generate_uuid)

    # Item details
    title = Column(String(255), nullable=False)
    description = Column(Text)
    category = Column(String(50))  # security, configuration, deployment, etc.
    priority = Column(String(20))  # critical, high, medium, low

    # Status
    is_completed = Column(Boolean, default=False)
    completed_at = Column(DateTime(timezone=True))
    completed_by = Column(String(36))  # User ID

    # Help information
    documentation_link = Column(Text)
    estimated_time_minutes = Column(Integer)

    # Ordering
    sort_order = Column(Integer, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<OnboardingChecklistItem(title={self.title}, priority={self.priority})>"


class OnboardingSessionModel(Base):
    """
    Server-side onboarding session storage

    SECURITY: Stores sensitive onboarding data encrypted server-side
    instead of in browser sessionStorage. This prevents passwords,
    API keys, and secrets from being exposed in the browser.

    Session data includes:
    - Department configuration
    - Email/authentication settings (encrypted)
    - File storage configuration (encrypted)
    - Admin user credentials (encrypted)
    - IT team information

    Sessions expire after 2 hours of inactivity.
    """
    __tablename__ = "onboarding_sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(64), unique=True, nullable=False, index=True)

    # Session data (JSON with encrypted sensitive fields)
    data = Column(MutableDict.as_mutable(JSON), default={}, nullable=False)

    # Client information for security tracking
    ip_address = Column(String(45), nullable=False)
    user_agent = Column(Text, nullable=True)

    # Session expiration
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<OnboardingSession(id={self.id}, session_id={self.session_id[:8]}...)>"
