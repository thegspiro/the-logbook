"""
Inventory NFC Tag Pydantic Schemas

Request/response shapes for NFC tags attached to inventory items, storage
areas and equipment-check compartments, put-away, and the staff tap log. Snake-case on the wire, like the rest
of the inventory API.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.inventory import (
    InventoryAuditFrequency,
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
    check_compartment_id: Optional[str] = None
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


class InventoryNfcResolveCheckRequest(InventoryNfcResolveRequest):
    """A tap made during an equipment check of one template."""

    template_id: str = Field(..., min_length=1, max_length=36)


class InventoryNfcResolveCheckResponse(BaseModel):
    """What a tap during a check named.

    ``compartment``: jump the form to ``compartment_id``. ``item``: the
    checklist entries in ``template_item_ids`` are the ones linked to the
    tapped inventory item, in checklist order.
    """

    kind: Literal["compartment", "item"]
    tag_id: str
    compartment_id: Optional[str] = None
    compartment_name: Optional[str] = None
    item_name: Optional[str] = None
    template_item_ids: List[str] = Field(default_factory=list)


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


# ---------------------------------------------------------------------------
# Audit schedule
# ---------------------------------------------------------------------------


class InventoryAuditScheduleUpdate(BaseModel):
    """Put a storage area on an audit schedule, or take it off with ``null``.

    The key is required so an empty body cannot silently clear a schedule.
    """

    audit_frequency: Optional[InventoryAuditFrequency] = Field(...)


class InventoryAuditScheduleRow(UTCResponseBase):
    storage_area_id: str
    storage_area_name: str
    location_name: Optional[str] = None
    audit_frequency: Optional[InventoryAuditFrequency] = None
    last_audited_at: Optional[datetime] = None
    # Null while the area has never been audited: it is due now.
    next_due_at: Optional[datetime] = None
    overdue: bool
    days_overdue: Optional[int] = None


class InventoryAuditScheduleListResponse(BaseModel):
    items: List[InventoryAuditScheduleRow]
    total: int


# ---------------------------------------------------------------------------
# Taps made offline, applied later
# ---------------------------------------------------------------------------

# One offline session's worth of taps: the same bound as an audit, for the
# same reason.
MAX_REPLAY_TAPS = MAX_AUDIT_TAPS

_CLIENT_ID_PATTERN = r"^[A-Za-z0-9_\-]{8,64}$"


class InventoryNfcReplayTap(BaseModel):
    """One step taken without signal, in the order it was taken.

    Either what was read off a tag (the code written on it, or its serial), or
    a storage area picked from the list: exactly one of the two. The phone
    stores the raw read and nothing it knows about the tag, so what the tap
    means is decided here, when it arrives.
    """

    code: Optional[str] = Field(None, pattern=_UID_PATTERN)
    serial_number: Optional[str] = Field(None, pattern=_UID_PATTERN)
    storage_area_id: Optional[str] = Field(None, min_length=1, max_length=36)

    @field_validator("code", "serial_number")
    @classmethod
    def _check_identifier(cls, value: Optional[str]) -> Optional[str]:
        return None if value is None else _require_enough_characters(value)

    @model_validator(mode="after")
    def _one_kind(self) -> "InventoryNfcReplayTap":
        read = bool(self.code or self.serial_number)
        if read == bool(self.storage_area_id):
            raise ValueError("A step is either a tag read or a picked storage area")
        return self


class InventoryNfcPutAwayReplayRequest(BaseModel):
    """Put-away taps made offline, with where the screen stood beforehand."""

    open_storage_area_id: Optional[str] = Field(
        None, min_length=1, max_length=36, description="The shelf open when signal went"
    )
    held_item_id: Optional[str] = Field(
        None, min_length=1, max_length=36, description="An item waiting for its shelf"
    )
    held_item_tag_id: Optional[str] = Field(None, max_length=36)
    taps: List[InventoryNfcReplayTap] = Field(
        ..., min_length=1, max_length=MAX_REPLAY_TAPS
    )


class InventoryNfcPutAwayReplayStep(BaseModel):
    """What one offline tap turned out to be, and what it did."""

    index: int
    outcome: Literal[
        "moved", "already_there", "shelf_opened", "held", "refused", "unread"
    ]
    item_id: Optional[str] = None
    item_name: Optional[str] = None
    storage_area_name: Optional[str] = None
    message: Optional[str] = None


class InventoryNfcPutAwayReplayResponse(BaseModel):
    results: List[InventoryNfcPutAwayReplayStep]
    moved_count: int
    refused_count: int
    unread_count: int
    # An item tapped last, still waiting for a shelf when the taps ran out.
    held_item_name: Optional[str] = None


class InventoryNfcAuditReplayRequest(BaseModel):
    """A shelf audit finished offline.

    ``tapped`` holds the items identified before signal went; ``taps`` the raw
    reads made after. The shelf is ``storage_area_id`` when it was chosen with
    signal, otherwise the first shelf among ``taps``.
    """

    client_submission_id: str = Field(..., pattern=_CLIENT_ID_PATTERN)
    storage_area_id: Optional[str] = Field(None, min_length=1, max_length=36)
    tapped: List[InventoryNfcAuditTap] = Field(
        default_factory=list, max_length=MAX_AUDIT_TAPS
    )
    taps: List[InventoryNfcReplayTap] = Field(
        default_factory=list, max_length=MAX_REPLAY_TAPS
    )

    @model_validator(mode="after")
    def _bounded(self) -> "InventoryNfcAuditReplayRequest":
        if len(self.tapped) + len(self.taps) > MAX_AUDIT_TAPS:
            raise ValueError(f"An audit holds up to {MAX_AUDIT_TAPS} taps")
        return self


class InventoryNfcAuditReplayResponse(BaseModel):
    """The saved audit, or why none could be saved.

    ``unread_count`` taps named nothing usable (an unlinked or lost tag, an
    inactive item); ``other_shelf_count`` were another shelf's tag, which an
    audit of one shelf ignores.
    """

    audit: Optional[InventoryNfcAuditDetail] = None
    not_saved_reason: Optional[str] = None
    unread_count: int = 0
    other_shelf_count: int = 0
