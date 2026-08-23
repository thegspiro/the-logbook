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

from app.models.nfc_tag import NfcCredentialType, NfcTagStatus
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


class NfcCheckInTarget(str, Enum):
    """What a station is checking members into."""

    SHIFT = "shift"
    EVENT = "event"
    ADMIN_HOURS = "admin_hours"


class NfcCheckInDirection(str, Enum):
    """Which way a tap moves the member.

    ``AUTO`` is the default and the one an unattended station should use: a
    member taps once on arrival and once on the way out without anybody
    touching the screen in between.
    """

    AUTO = "auto"
    IN = "in"
    OUT = "out"


class NfcCheckInStatus(str, Enum):
    """Outcome of a tap, as the station screen must render it."""

    CHECKED_IN = "checked_in"
    CHECKED_OUT = "checked_out"
    ALREADY_CHECKED_IN = "already_checked_in"
    ALREADY_CHECKED_OUT = "already_checked_out"
    UNKNOWN_CARD = "unknown_card"
    CARD_INACTIVE = "card_inactive"
    MEMBER_INACTIVE = "member_inactive"
    REFUSED = "refused"


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

    # Enriched for list views so the card table can name people without the
    # client fetching the directory.
    member_name: Optional[str] = None
    issued_by_name: Optional[str] = None


class NfcTagListResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    items: List[NfcTagResponse]
    total: int


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
