"""
Inventory NFC Tag Pydantic Schemas

Request/response shapes for NFC tags attached to inventory items. Snake-case
on the wire, like the rest of the inventory API.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.inventory import InventoryNfcTagStatus
from app.models.nfc_tag import NfcCredentialType
from app.schemas.base import UTCResponseBase

# The same two shapes a member ID card admits (see schemas/nfc_tag.py): a chip
# serial, arriving with or without separators depending on the reader, or a
# code this app wrote onto the tag. Normalization strips the separators.
_UID_PATTERN = r"^[0-9A-Za-z:_\-\s]{4,128}$"
_MIN_UID_CHARS = 4


def _require_enough_characters(value: str) -> str:
    """Reject an identifier that is only separators.

    The pattern admits ``"::::"``; normalized, that is an empty string, and
    every such tag would hash alike — the first one linked would answer for
    all of them.
    """
    if len("".join(c for c in value if c.isalnum())) < _MIN_UID_CHARS:
        raise ValueError("Tag identifier is too short to be an NFC tag")
    return value


class InventoryNfcTagCreate(BaseModel):
    """Link a tag to an item."""

    tag_uid: str = Field(..., pattern=_UID_PATTERN)
    credential_type: NfcCredentialType = NfcCredentialType.SERIAL
    label: Optional[str] = Field(None, max_length=100)

    @field_validator("tag_uid")
    @classmethod
    def _check_uid(cls, value: str) -> str:
        return _require_enough_characters(value)


class InventoryNfcTagUpdate(BaseModel):
    """Partial update. The identifier and the item it names are not editable:
    moving a tag to another item is unlinking it and linking it again, which
    leaves both actions in the audit log."""

    label: Optional[str] = Field(None, max_length=100)
    status: Optional[InventoryNfcTagStatus] = None


class InventoryNfcTagResponse(UTCResponseBase):
    """A tag as shown to a quartermaster. Never carries the identifier."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    item_id: str
    uid_preview: str
    credential_type: NfcCredentialType
    label: Optional[str] = None
    status: InventoryNfcTagStatus
    linked_by: Optional[str] = None
    linked_by_name: Optional[str] = None
    linked_at: datetime


class InventoryNfcTagListResponse(BaseModel):
    items: List[InventoryNfcTagResponse]
    total: int


class InventoryNfcResolveRequest(BaseModel):
    """What a phone read off a tag.

    Sent in a POST body rather than a query string: a chip serial is what a
    member ID card's credential consists of, and a tapped card must not end up
    in an access log.
    """

    code: Optional[str] = Field(
        None,
        pattern=_UID_PATTERN,
        description="The code this app wrote onto the tag, if it carries one",
    )
    serial_number: Optional[str] = Field(
        None, pattern=_UID_PATTERN, description="The chip's own serial number"
    )

    @field_validator("code", "serial_number")
    @classmethod
    def _check_identifier(cls, value: Optional[str]) -> Optional[str]:
        return None if value is None else _require_enough_characters(value)

    @model_validator(mode="after")
    def _need_one(self) -> "InventoryNfcResolveRequest":
        if not (self.code or self.serial_number):
            raise ValueError("A tag code or serial number is required")
        return self


class InventoryNfcSettingsResponse(BaseModel):
    """Whether this organization has NFC tag tracking switched on."""

    enabled: bool
