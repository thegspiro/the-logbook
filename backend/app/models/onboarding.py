"""
Onboarding System Models

Tracks onboarding progress and stores initial setup information.
"""

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.ext.mutable import MutableDict
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

    id = Column(String(36), primary_key=True, default=generate_uuid)

    singleton = Column(Integer, nullable=False, default=1, server_default="1")

    # Onboarding completion status
    is_completed = Column(Boolean, default=False, nullable=False, server_default="0")
    completed_at = Column(DateTime(timezone=True))

    # Onboarding steps tracking
    steps_completed = Column(JSON, default=dict)
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
    enabled_modules = Column(JSON, default=list)
    timezone = Column(String(50), default="America/New_York")

    # Metadata
    setup_started_at = Column(DateTime(timezone=True), server_default=func.now())
    setup_ip_address = Column(String(45))
    setup_user_agent = Column(Text)

    # Notes from setup process
    setup_notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(64), unique=True, nullable=False, index=True)

    # Session data (JSON with encrypted sensitive fields)
    data = Column(MutableDict.as_mutable(JSON), default=dict, nullable=False)

    # Client information for security tracking
    ip_address = Column(String(45), nullable=False)
    user_agent = Column(Text, nullable=True)

    # Session expiration
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self):
        return f"<OnboardingSession(id={self.id}, session_id={self.session_id[:8]}...)>"
