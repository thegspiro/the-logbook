"""
NFC Tag Models

Physical NFC credentials — the tag embedded in a member's ID card — bound to a
user so that tapping the card against a reader identifies the member.

This is the inverse of the tags described in ``frontend/src/constants/nfc.ts``:
those are *destination* tags stuck to a door or an apparatus that send a
member's phone to a check-in page. A tag here is an *identity* credential that
a station reads to decide who just arrived.
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.user import User


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


class NfcCheckInTarget(str, Enum):
    """What a station is checking members into."""

    SHIFT = "shift"
    EVENT = "event"
    ADMIN_HOURS = "admin_hours"


class NfcCheckInStatus(str, Enum):
    """Outcome of a tap, as the station screen must render it.

    Declared on the model rather than the schema because every tap is now
    stored with its outcome (``NfcCardTap.outcome``); ``app.schemas.nfc_tag``
    imports it from here so existing imports keep working.
    """

    CHECKED_IN = "checked_in"
    CHECKED_OUT = "checked_out"
    ALREADY_CHECKED_IN = "already_checked_in"
    ALREADY_CHECKED_OUT = "already_checked_out"
    UNKNOWN_CARD = "unknown_card"
    CARD_INACTIVE = "card_inactive"
    MEMBER_INACTIVE = "member_inactive"
    REFUSED = "refused"


class NfcTapSource(str, Enum):
    """Which kind of reader a tap came through.

    A station is staffed — somebody holding ``members.check_in`` chose the
    target. A kiosk is a room's public screen with nobody signed in, where the
    room decides the target; the two are worth telling apart when a refusal
    needs explaining.
    """

    STATION = "station"
    KIOSK = "kiosk"


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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # SHA-256 of the peppered, normalized UID. See services/nfc_tag_service.py.
    uid_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Last few characters of the UID, for on-screen identification only.
    uid_preview: Mapped[str] = mapped_column(String(8), nullable=False)

    credential_type: Mapped[NfcCredentialType] = mapped_column(
        SQLEnum(NfcCredentialType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NfcCredentialType.SERIAL,
        server_default=NfcCredentialType.SERIAL.value,
    )

    # Free-text so a department can write what is actually printed on the card
    # ("Blue ID card", "Locker fob #12") rather than pick from a list we guessed.
    label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    status: Mapped[NfcTagStatus] = mapped_column(
        SQLEnum(NfcTagStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NfcTagStatus.ACTIVE,
        server_default=NfcTagStatus.ACTIVE.value,
        index=True,
    )

    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Stamped on every successful identification, so a card nobody has tapped
    # in a year can be found and retired.
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # True only while the card is SUSPENDED because its holder left (see
    # app/services/nfc_card_status_sync.py). It is what lets a returning
    # member's card come back on its own without also undoing a suspension an
    # officer chose — the two are otherwise the same status. Any officer change
    # of status clears it, handing the card back to human control.
    auto_suspended: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    issued_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        # Per organization, not global: two departments running this platform
        # are separate tenants, and a card issued in one must not be
        # discoverable by registering it in the other.
        UniqueConstraint("organization_id", "uid_hash", name="uq_nfc_tag_org_uid"),
        Index("idx_nfc_tag_org_user", "organization_id", "user_id"),
    )

    def __repr__(self):
        return f"<NfcTag(user_id={self.user_id}, preview=…{self.uid_preview})>"


class NfcCardTap(Base):
    """One tap of a card at a station or a room kiosk, whatever its outcome.

    Refusals are recorded as well as check-ins, because a refusal is the event
    an officer is usually asked about ("my card didn't work at the meeting").
    The audit log keeps its own entries for taps that moved attendance; this
    table exists so the ID-card screen can filter by card, member and outcome
    without parsing audit JSON, and it is purged after the organization's
    retention period (``nfc_id_cards.tap_retention_months``).

    ``tag_id`` and ``user_id`` are SET NULL rather than CASCADE: deleting a
    mis-registered card must not erase the record that a tap happened, and the
    tap is evidence about the reader as much as about the member.
    """

    __tablename__ = "nfc_card_taps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    tag_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("nfc_tags.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Set only for a card no registration matched. The same peppered hash
    # nfc_tags stores, so repeated tries with one stranger's card group
    # together without the serial itself ever being kept.
    unknown_uid_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    source: Mapped[NfcTapSource] = mapped_column(
        SQLEnum(NfcTapSource, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    location_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    operator_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Polymorphic (a shift, an event or an admin-hours category), so not a
    # foreign key. target_name is a snapshot: the log should still say which
    # meeting it was after the event is renamed or deleted.
    target_type: Mapped[Optional[NfcCheckInTarget]] = mapped_column(
        SQLEnum(NfcCheckInTarget, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    target_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    target_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    outcome: Mapped[NfcCheckInStatus] = mapped_column(
        SQLEnum(NfcCheckInStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    tapped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("idx_nfc_card_tap_org_time", "organization_id", "tapped_at"),
        Index("idx_nfc_card_tap_org_tag", "organization_id", "tag_id"),
        Index("idx_nfc_card_tap_org_user", "organization_id", "user_id"),
        Index("idx_nfc_card_tap_org_location", "organization_id", "location_id"),
    )

    def __repr__(self):
        return f"<NfcCardTap(outcome={self.outcome}, tapped_at={self.tapped_at})>"
