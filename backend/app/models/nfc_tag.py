"""
NFC Tag Models

Physical NFC credentials — the tag embedded in a member's ID card — bound to a
user so that tapping the card against a reader identifies the member.

This is the inverse of the tags described in ``frontend/src/constants/nfc.ts``:
those are *destination* tags stuck to a door or an apparatus that send a
member's phone to a check-in page. A tag here is an *identity* credential that
a station reads to decide who just arrived.
"""

from enum import Enum

from sqlalchemy import Column, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class NfcCredentialType(str, Enum):
    """How the card was bound to the member.

    Worth recording because it decides what a replacement looks like. A
    ``SERIAL`` card is a factory-programmed ID card whose only identifier is
    the chip's own serial — nothing was written to it, and it cannot be
    reissued to somebody else. A ``WRITTEN`` card is a blank tag an officer
    wrote a generated code onto, which can be rewritten and reused.
    """

    SERIAL = "serial"
    WRITTEN = "written"


class NfcTagStatus(str, Enum):
    """Lifecycle state of an issued card."""

    ACTIVE = "active"
    # Temporarily refused — a member on suspension, a card left at the station.
    SUSPENDED = "suspended"
    # Terminal. A lost card is never reactivated: whoever found it can still
    # tap it, so the record is kept only so the audit trail can name the card
    # that stopped working and when.
    LOST = "lost"
    REVOKED = "revoked"


class NfcTag(Base):
    """
    An NFC credential (ID card) issued to a member.

    SECURITY — the UID is stored **hashed**, never in clear text. A card UID is
    the whole of the secret: anything holding one can be cloned onto a
    writable tag, so a leaked database dump would otherwise be a stack of
    working ID cards. Lookups are by hash of the normalized UID, which is why
    ``uid_hash`` carries the unique constraint and there is no column holding
    the UID itself. ``uid_preview`` keeps the last four characters so an
    officer can tell two cards apart on screen and match one against the number
    printed on the card.
    """

    __tablename__ = "nfc_tags"

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

    # SHA-256 of the peppered, normalized UID. See services/nfc_tag_service.py.
    uid_hash = Column(String(64), nullable=False)
    # Last few characters of the UID, for on-screen identification only.
    uid_preview = Column(String(8), nullable=False)

    credential_type = Column(
        SQLEnum(NfcCredentialType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NfcCredentialType.SERIAL,
        server_default=NfcCredentialType.SERIAL.value,
    )

    # Free-text so a department can write what is actually printed on the card
    # ("Blue ID card", "Locker fob #12") rather than pick from a list we guessed.
    label = Column(String(100), nullable=True)

    status = Column(
        SQLEnum(NfcTagStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NfcTagStatus.ACTIVE,
        server_default=NfcTagStatus.ACTIVE.value,
        index=True,
    )

    issued_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Stamped on every successful identification, so a card nobody has tapped
    # in a year can be found and retired.
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoked_reason = Column(Text, nullable=True)

    issued_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        # Per organization, not global: two departments running this platform
        # are separate tenants, and a card issued in one must not be
        # discoverable by registering it in the other.
        UniqueConstraint("organization_id", "uid_hash", name="uq_nfc_tag_org_uid"),
        Index("idx_nfc_tag_org_user", "organization_id", "user_id"),
    )

    def __repr__(self):
        return f"<NfcTag(user_id={self.user_id}, preview=…{self.uid_preview})>"
