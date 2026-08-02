"""
Member Consent Records (ISO/IEC 27701)

Tracks each member's explicit choices for optional processing of their
personal data — the things a department may only do with permission, as
opposed to the operational processing membership itself requires.

Design: one row per (user, consent type) holding the CURRENT state; every
change is also written to the tamper-evident audit log (event type
``consent_updated``), which serves as the immutable consent ledger a
privacy audit asks for. Absence of a row means the member was never asked —
callers must treat that as "no consent", never as a default grant.
"""

import enum

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Index, String
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class ConsentType(str, enum.Enum):
    """Optional-processing categories a member can grant or refuse."""

    # Department may use the member's photo in publications, social media,
    # and public-facing material
    PHOTO_USE = "photo_use"
    # Member's name/rank may appear on the public portal roster
    PUBLIC_ROSTER_LISTING = "public_roster_listing"
    # Department may send SMS notifications to the member's mobile number
    # (TCPA: text messaging requires express consent in the US)
    SMS_NOTIFICATIONS = "sms_notifications"


class UserConsent(Base):
    __tablename__ = "user_consents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    consent_type = Column(
        Enum(ConsentType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    granted = Column(Boolean, nullable=False)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        Index("idx_user_consent_unique", "user_id", "consent_type", unique=True),
    )

    def __repr__(self):
        return (
            f"<UserConsent(user={self.user_id}, type={self.consent_type}, "
            f"granted={self.granted})>"
        )
