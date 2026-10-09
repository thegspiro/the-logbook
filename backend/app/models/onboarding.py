"""
Onboarding System Models

Tracks onboarding progress and stores initial setup information.
"""

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.user import generate_uuid


class OnboardingStatus(Base):
    """
    System-wide onboarding status

    Tracks whether the system has completed initial setup.
    Only one row should exist in this table.
    """

    __tablename__ = "onboarding_status"

    # "Only one row should exist" was true as an intention and undefended as a
    # constraint, and `start_onboarding` is a read-then-write: two concurrent
    # first-run requests both read "none exists" and both insert. The second row
    # then made `needs_onboarding`'s `scalar_one_or_none()` raise
    # MultipleResultsFound, so GET /onboarding/status returned 500 forever and
    # setup could not proceed -- at the one moment no account exists to sign in
    # with and fix it. See ONBOARD-7 in docs/KNOWN_LIMITATIONS.md.
    #
    # `singleton` is always 1. The unique index on it is what turns that second
    # INSERT into an IntegrityError the service can recover from, instead of a
    # duplicate nothing notices until a reader falls over.
    __table_args__ = (
        UniqueConstraint("singleton", name="uq_onboarding_status_singleton"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)

    singleton: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )

    # Onboarding completion status
    is_completed: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Onboarding steps tracking
    steps_completed: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, default=dict
    )
    current_step: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    # System information collected during onboarding
    organization_name: Mapped[Optional[str]] = mapped_column(String(255))
    organization_type: Mapped[Optional[str]] = mapped_column(String(50))
    admin_email: Mapped[Optional[str]] = mapped_column(String(255))
    admin_username: Mapped[Optional[str]] = mapped_column(String(100))

    # Security verification
    security_keys_verified: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False
    )
    database_verified: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    email_configured: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)

    # Configuration choices
    enabled_modules: Mapped[Optional[list[str]]] = mapped_column(JSON, default=list)
    timezone: Mapped[Optional[str]] = mapped_column(
        String(50), default="America/New_York"
    )

    # Metadata
    setup_started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    setup_ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    setup_user_agent: Mapped[Optional[str]] = mapped_column(Text)

    # Notes from setup process
    setup_notes: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self):
        status = "Completed" if self.is_completed else "In Progress"
        return f"<OnboardingStatus(status={status}, step={self.current_step})>"


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

    Sessions expire after 30 minutes of inactivity (see SESSION_EXPIRY_HOURS
    in api/v1/onboarding.py); each validated call slides the expiry forward.
    """

    __tablename__ = "onboarding_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    session_id: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )

    # Session data (JSON with encrypted sensitive fields)
    data: Mapped[dict[str, Any]] = mapped_column(
        MutableDict.as_mutable(JSON), default=dict, nullable=False
    )

    # Client information for security tracking
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Session expiration
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self):
        return f"<OnboardingSession(id={self.id}, session_id={self.session_id[:8]}...)>"
