"""
NFC Tag Pydantic Schemas

Request/response shapes for member ID card (NFC) credentials and for the
check-in station that reads them.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models.nfc_tag import (
    NfcCheckInStatus,
    NfcCheckInTarget,
    NfcCredentialType,
    NfcTagStatus,
    NfcTapSource,
)
from app.models.user import UserStatus
from app.schemas.base import UTCResponseBase

_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)

# A credential is one of two things, and the pattern has to admit both: the
# chip's own serial (hex, 4/7/10 bytes for the ISO 14443 families used in ID
# cards, arriving with or without colons depending on the reader), or a code an
# officer wrote onto a blank tag, which is alphanumeric by construction.
# Normalization strips the separators; this only has to reject what plainly is
# neither.
_UID_PATTERN = r"^[0-9A-Za-z:_\-\s]{4,128}$"


class NfcCheckInDirection(str, Enum):
    """Which way a tap moves the member.

    ``AUTO`` is the default and the one an unattended station should use: a
    member taps once on arrival and once on the way out without anybody
    touching the screen in between.
    """

    AUTO = "auto"
    IN = "in"
    OUT = "out"


class NfcTagCreate(BaseModel):
    """Register a card against a member.

    Always an officer acting on a member's behalf — there is no self-service
    path. A credential that opens attendance is issued the way a key is, by
    somebody who is accountable for handing it over.
    """

    user_id: str = Field(..., min_length=1, max_length=36)
    tag_uid: str = Field(..., pattern=_UID_PATTERN)
    label: Optional[str] = Field(None, max_length=100)
    credential_type: NfcCredentialType = NfcCredentialType.SERIAL

    @field_validator("tag_uid")
    @classmethod
    def _reject_empty_uid(cls, value: str) -> str:
        """Reject a credential that is only separators.

        The pattern above admits ``"::::"``; normalization would reduce it to
        an empty string and every such card would then hash to the same value,
        so the first one registered would answer for all of them.
        """
        stripped = "".join(c for c in value if c.isalnum())
        if len(stripped) < 4:
            raise ValueError("Tag serial number is too short to be a card")
        return value


class NfcTagUpdate(BaseModel):
    """Partial update. Only the label and lifecycle state are editable.

    The UID is not: re-pointing an existing record at a different card would
    silently transfer the issued-on date and usage history of one credential to
    another. Registering the new card and revoking the old one keeps both
    histories intact.
    """

    label: Optional[str] = Field(None, max_length=100)
    status: Optional[NfcTagStatus] = None
    revoked_reason: Optional[str] = None


class NfcTagResponse(UTCResponseBase):
    """A card as shown to an officer. Never carries the UID."""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    user_id: str
    uid_preview: str
    credential_type: NfcCredentialType
    label: Optional[str] = None
    status: NfcTagStatus
    issued_at: datetime
    last_used_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    revoked_reason: Optional[str] = None
    issued_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # True while the card is suspended because its holder left; it comes back
    # by itself if they return. An officer's own suspension reads False.
    auto_suspended: bool = False

    # Enriched for list views so the card table can name people without the
    # client fetching the directory.
    member_name: Optional[str] = None
    issued_by_name: Optional[str] = None


class NfcTagListResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    items: List[NfcTagResponse]
    total: int


class NfcTagBulkStatusRequest(BaseModel):
    """One status applied to many cards — retiring a batch, or a leaver's set.

    The cap matches ``MAX_BULK_CARDS`` in ``nfc_card_admin_service``.
    """

    tag_ids: List[str] = Field(..., min_length=1, max_length=200)
    status: NfcTagStatus
    revoked_reason: Optional[str] = Field(None, max_length=500)

    @field_validator("tag_ids")
    @classmethod
    def _ids_are_ids(cls, value: List[str]) -> List[str]:
        if any(not item or len(item) > 36 for item in value):
            raise ValueError("Each card id must be 1 to 36 characters")
        return value


class NfcTagBulkFailure(BaseModel):
    model_config = _RESPONSE_CONFIG

    id: str
    detail: str


class NfcTagBulkStatusResponse(UTCResponseBase):
    """Which cards changed and which were refused, and why."""

    model_config = _RESPONSE_CONFIG

    updated: List[NfcTagResponse]
    failed: List[NfcTagBulkFailure]


class NfcCoverageMember(BaseModel):
    """A current member with no working card."""

    model_config = _RESPONSE_CONFIG

    user_id: str
    member_name: Optional[str] = None
    membership_number: Optional[str] = None
    member_status: Optional[UserStatus] = None


class NfcCoverageCard(NfcTagResponse):
    """A card on a coverage list, with its holder's membership status."""

    member_status: Optional[UserStatus] = None


class NfcCardCounts(BaseModel):
    model_config = _RESPONSE_CONFIG

    active: int = 0
    suspended: int = 0
    lost: int = 0
    revoked: int = 0


class NfcCoverageResponse(UTCResponseBase):
    """The three lists on the Coverage tab.

    Each list is capped; its ``*_total`` is the real count, so a screen can
    say "showing 1,000 of 1,240" rather than imply the list is complete.
    """

    model_config = _RESPONSE_CONFIG

    unused_days: int
    current_member_count: int
    card_counts: NfcCardCounts
    members_without_card: List[NfcCoverageMember]
    members_without_card_total: int
    unused_cards: List[NfcCoverageCard]
    unused_cards_total: int
    former_member_cards: List[NfcCoverageCard]
    former_member_cards_total: int


class NfcCardTapResponse(UTCResponseBase):
    """One tap on the log. Never carries a card serial.

    ``unknown_card_key`` is the first characters of an unregistered card's
    peppered hash: enough to see that the same stranger's card was tried five
    times, useless for recovering the serial.
    """

    model_config = _RESPONSE_CONFIG

    id: str
    tapped_at: datetime
    outcome: NfcCheckInStatus
    source: NfcTapSource
    tag_id: Optional[str] = None
    card_uid_preview: Optional[str] = None
    card_label: Optional[str] = None
    unknown_card_key: Optional[str] = None
    user_id: Optional[str] = None
    member_name: Optional[str] = None
    location_id: Optional[str] = None
    location_name: Optional[str] = None
    operator_id: Optional[str] = None
    operator_name: Optional[str] = None
    target_type: Optional[NfcCheckInTarget] = None
    target_id: Optional[str] = None
    target_name: Optional[str] = None


class NfcCardTapListResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    items: List[NfcCardTapResponse]
    total: int
    limit: int
    offset: int


class NfcIdCardSettingsResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    tap_retention_months: int


class NfcIdCardSettingsUpdate(BaseModel):
    """Bounds match ``MIN/MAX_TAP_RETENTION_MONTHS`` in the admin service."""

    tap_retention_months: int = Field(..., ge=3, le=84)


class NfcCheckInRequest(BaseModel):
    """A tap at a station.

    Two identifiers because a tap can produce two, and which one is the
    credential depends on how the card was issued. A phone reading a blank tag
    an officer wrote a code onto gets both the written code (``tag_payload``)
    and the chip's serial; a factory-programmed ID card, or a USB reader that
    only reports a serial, gives just ``tag_uid``. The written code is tried
    first — it is the deliberate binding — and the serial is the fallback.
    """

    tag_uid: str = Field(..., pattern=_UID_PATTERN)
    tag_payload: Optional[str] = Field(None, max_length=512)
    target_type: NfcCheckInTarget
    target_id: str = Field(..., min_length=1, max_length=36)
    direction: NfcCheckInDirection = NfcCheckInDirection.AUTO


class NfcCheckInResponse(UTCResponseBase):
    """Result of a tap.

    Returned with HTTP 200 for every *domain* outcome, including an
    unrecognised card. A station is a screen that must render whatever just
    happened — "already checked in" and "card not recognised" are things to
    show the person standing there, not transport errors — and a kiosk that
    stops on an exception is a kiosk somebody has to walk over and restart.
    Genuine caller errors (no permission, a target that does not exist) still
    raise 4xx.
    """

    model_config = _RESPONSE_CONFIG

    status: NfcCheckInStatus
    message: str
    target_name: Optional[str] = None
    user_id: Optional[str] = None
    member_name: Optional[str] = None
    membership_number: Optional[str] = None
    occurred_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None


class KioskBadgeTapRequest(BaseModel):
    """A card tap at a room's public kiosk.

    No target and no direction: the room's display code decides the event and
    the tap toggles in/out, because nobody is standing at the kiosk to choose.
    """

    tag_uid: str = Field(..., pattern=_UID_PATTERN)
    tag_payload: Optional[str] = Field(None, max_length=512)


class KioskBadgeTapResponse(UTCResponseBase):
    """Result of a kiosk tap, cut down for a screen anyone can read.

    Deliberately narrower than ``NfcCheckInResponse``: no member id, full name
    or membership number. A first name and last initial is enough for a member
    to confirm their own tap and too little to read anyone else's record off a
    copied card.
    """

    model_config = _RESPONSE_CONFIG

    status: NfcCheckInStatus
    message: str
    target_name: Optional[str] = None
    member_display_name: Optional[str] = None
    occurred_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
