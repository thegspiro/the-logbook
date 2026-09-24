"""
Inventory NFC Tag Pydantic Schemas

Request/response shapes for NFC tags attached to inventory items and storage
areas, put-away, and the staff tap log. Snake-case on the wire, like the rest
of the inventory API.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.inventory import (
    InventoryNfcAuditResult,
    InventoryNfcScanAction,
    InventoryNfcTagStatus,
)
from app.models.nfc_tag import NfcCredentialType
from app.schemas.base import UTCResponseBase
from app.schemas.inventory import InventoryItemResponse

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
    """Link a tag to an item or a storage area (the target is in the path)."""

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
    # Exactly one of these is set.
    item_id: Optional[str] = None
    storage_area_id: Optional[str] = None
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


class InventoryNfcResolveAnyRequest(InventoryNfcResolveRequest):
    """A tap that may name an item or a storage area."""

    record: bool = Field(
        True,
        description=(
            "Log an item lookup in the tap log (inventory managers only). "
            "The put-away screen sends false: the move it makes is logged "
            "on its own, and a lookup row beside it would say the same thing "
            "twice."
        ),
    )


class InventoryNfcStorageAreaSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    label: Optional[str] = None
    location_id: Optional[str] = None


class InventoryNfcResolveAnyResponse(BaseModel):
    """Exactly one of ``item`` / ``storage_area`` is set, per ``kind``."""

    kind: Literal["item", "storage_area"]
    tag_id: str
    tag_uid_preview: str
    item: Optional[InventoryItemResponse] = None
    storage_area: Optional[InventoryNfcStorageAreaSummary] = None


class InventoryNfcPutAwayRequest(BaseModel):
    """Move an item onto a storage area."""

    item_id: str = Field(..., min_length=1, max_length=36)
    storage_area_id: str = Field(..., min_length=1, max_length=36)
    item_tag_id: Optional[str] = Field(
        None,
        max_length=36,
        description="The item tag that was tapped, recorded in the tap log",
    )


class InventoryNfcPutAwayResponse(BaseModel):
    item_id: str
    item_name: str
    storage_area_id: str
    storage_area_name: str
    from_storage_area_id: Optional[str] = None
    from_storage_area_name: Optional[str] = None
    # False when the item was already on that storage area; the tap is still
    # logged, because "it was seen there" is what the log is for.
    moved: bool


class InventoryNfcScanResponse(UTCResponseBase):
    """One row of an item's tap log."""

    id: str
    item_id: str
    action: InventoryNfcScanAction
    tag_uid_preview: Optional[str] = None
    storage_area_id: Optional[str] = None
    storage_area_name: Optional[str] = None
    from_storage_area_id: Optional[str] = None
    from_storage_area_name: Optional[str] = None
    scanned_by: Optional[str] = None
    scanned_by_name: Optional[str] = None
    scanned_at: datetime


class InventoryNfcScanListResponse(BaseModel):
    items: List[InventoryNfcScanResponse]
    total: int


class InventoryNfcSettingsResponse(BaseModel):
    """Whether this organization has NFC tag tracking switched on."""

    enabled: bool


# ---------------------------------------------------------------------------
# Shelf audits
# ---------------------------------------------------------------------------

# A shelf, bin or cabinet with more than this many tagged items is several
# audits' work; the cap bounds one request, not a department's inventory.
MAX_AUDIT_TAPS = 500


class InventoryNfcAuditTap(BaseModel):
    """One item tapped during the audit."""

    item_id: str = Field(..., min_length=1, max_length=36)
    tag_id: Optional[str] = Field(
        None, max_length=36, description="The item's tag that was read"
    )


class InventoryNfcAuditCreate(BaseModel):
    """Submit a finished shelf audit: the shelf, and every item tapped on it."""

    storage_area_id: str = Field(..., min_length=1, max_length=36)
    tapped: List[InventoryNfcAuditTap] = Field(
        default_factory=list, max_length=MAX_AUDIT_TAPS
    )


class InventoryNfcAuditApply(BaseModel):
    """Move these unexpected items onto the audited shelf."""

    item_ids: List[str] = Field(..., min_length=1, max_length=MAX_AUDIT_TAPS)

    @field_validator("item_ids")
    @classmethod
    def _check_ids(cls, value: List[str]) -> List[str]:
        if any(not i or len(i) > 36 for i in value):
            raise ValueError("Invalid item id")
        return value


class InventoryNfcAuditLine(BaseModel):
    id: str
    # Null once the item itself has been deleted; the name is a snapshot.
    item_id: Optional[str] = None
    item_name: str
    result: InventoryNfcAuditResult
    # Where the system had the item when the audit ran.
    recorded_storage_area_id: Optional[str] = None
    recorded_storage_area_name: Optional[str] = None
    moved: bool


class InventoryNfcAuditSummary(UTCResponseBase):
    id: str
    # Null once the shelf has been deleted; the name is a snapshot.
    storage_area_id: Optional[str] = None
    storage_area_name: str
    expected_count: int
    found_count: int
    missing_count: int
    unexpected_count: int
    audited_by: Optional[str] = None
    audited_by_name: Optional[str] = None
    audited_at: datetime
    applied_by: Optional[str] = None
    applied_by_name: Optional[str] = None
    applied_at: Optional[datetime] = None


class InventoryNfcAuditListResponse(BaseModel):
    items: List[InventoryNfcAuditSummary]
    total: int


class InventoryNfcAuditSkipped(BaseModel):
    item_id: str
    name: str
    reason: str


class InventoryNfcAuditDetail(InventoryNfcAuditSummary):
    items: List[InventoryNfcAuditLine]
    # Set only on the response to an apply.
    moved_item_ids: Optional[List[str]] = None
    skipped: Optional[List[InventoryNfcAuditSkipped]] = None


# ---------------------------------------------------------------------------
# Member ID card lookup
# ---------------------------------------------------------------------------


class InventoryNfcMemberResponse(BaseModel):
    """The member a tapped ID card belongs to. Never carries the identifier."""

    user_id: str
    member_name: str
    membership_number: Optional[str] = None


# ---------------------------------------------------------------------------
# Bulk enrollment
# ---------------------------------------------------------------------------


class InventoryNfcUntaggedItem(BaseModel):
    id: str
    name: str
    serial_number: Optional[str] = None
    asset_tag: Optional[str] = None
    category_name: Optional[str] = None
    storage_area_name: Optional[str] = None


class InventoryNfcUntaggedListResponse(BaseModel):
    items: List[InventoryNfcUntaggedItem]
    total: int
