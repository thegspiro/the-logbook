"""
Equipment Check Pydantic Schemas

Request and response schemas for equipment check template management
and shift equipment check submissions.
"""

from datetime import date, datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.schemas.base import UTCResponseBase

# ============================================
# Check Template Item Schemas
# ============================================

# The kinds of check the form knows how to render. `check_type` is a plain
# string column rather than an enum, so nothing stopped an unsupported value
# being stored — and the check form prints the type under each item name, so an
# unrecognised one reached the crew as a raw token ("presence" under every item,
# because that is what the value said). Validated on the way in instead.
# Keep in step with CHECK_TYPES in frontend/src/pages/scheduling/
# equipmentCheckPresets.ts, which is what the template builder offers.
CHECK_TYPES = frozenset(
    {
        "pass_fail",
        "present",
        "functional",
        "quantity",
        "level",
        "date_lot",
        "reading",
        "text",
        "header",
    }
)


def _validate_check_type(value: Optional[str]) -> Optional[str]:
    """Reject a check type the form has no renderer for."""
    if value is None:
        return value
    if value not in CHECK_TYPES:
        raise ValueError(
            f"Unsupported check type '{value}'. "
            f"Expected one of: {', '.join(sorted(CHECK_TYPES))}"
        )
    return value


class CheckTemplateItemCreate(BaseModel):
    """Schema for creating a check template item."""

    name: str = Field(..., max_length=200)
    description: Optional[str] = None
    sort_order: int = 0
    check_type: str = Field(default="pass_fail", max_length=30)
    is_required: bool = False
    required_quantity: Optional[int] = None
    expected_quantity: Optional[int] = None
    critical_minimum_quantity: Optional[int] = None
    min_level: Optional[float] = None
    level_unit: Optional[str] = Field(None, max_length=50)
    serial_number: Optional[str] = Field(None, max_length=100)
    lot_number: Optional[str] = Field(None, max_length=100)
    image_url: Optional[str] = Field(None, max_length=500)
    equipment_id: Optional[str] = None
    inventory_item_id: Optional[str] = None
    has_expiration: bool = False
    expiration_date: Optional[date] = None
    expiration_warning_days: int = 30

    @field_validator("check_type")
    @classmethod
    def check_type_is_supported(cls, value: str) -> str:
        return _validate_check_type(value) or value


class CheckTemplateItemUpdate(BaseModel):
    """Schema for updating a check template item."""

    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    compartment_id: Optional[str] = None
    sort_order: Optional[int] = None
    check_type: Optional[str] = Field(None, max_length=30)
    is_required: Optional[bool] = None
    required_quantity: Optional[int] = None
    expected_quantity: Optional[int] = None
    critical_minimum_quantity: Optional[int] = None
    min_level: Optional[float] = None
    level_unit: Optional[str] = Field(None, max_length=50)
    serial_number: Optional[str] = Field(None, max_length=100)
    lot_number: Optional[str] = Field(None, max_length=100)
    image_url: Optional[str] = Field(None, max_length=500)
    equipment_id: Optional[str] = None
    inventory_item_id: Optional[str] = None
    has_expiration: Optional[bool] = None
    expiration_date: Optional[date] = None
    expiration_warning_days: Optional[int] = None

    @field_validator("check_type")
    @classmethod
    def check_type_is_supported(cls, value: Optional[str]) -> Optional[str]:
        return _validate_check_type(value)


class CheckTemplateItemResponse(UTCResponseBase):
    """Response schema for a check template item."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    compartment_id: str
    name: str
    description: Optional[str] = None
    sort_order: int
    check_type: str
    is_required: bool
    required_quantity: Optional[int] = None
    expected_quantity: Optional[int] = None
    critical_minimum_quantity: Optional[int] = None
    min_level: Optional[float] = None
    level_unit: Optional[str] = None
    serial_number: Optional[str] = None
    lot_number: Optional[str] = None
    image_url: Optional[str] = None
    equipment_id: Optional[str] = None
    inventory_item_id: Optional[str] = None
    quantity_on_truck: Optional[int] = None
    # Projected from the linked catalog item: "2/4" alone does not say whether
    # a crew is looking for two boxes or two gloves.
    unit_of_measure: Optional[str] = None
    # The lots physically aboard, soonest first. A crew checking a drug bag is
    # reading dates off boxes; without these the form can only show one date
    # for a position that may hold three, and there is no way to tell whether
    # what is in the bag is what the record says.
    lots_aboard: List["DeployedLot"] = []
    has_expiration: bool
    expiration_date: Optional[date] = None
    expiration_warning_days: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ============================================
# Check Template Compartment Schemas
# ============================================


class CheckTemplateCompartmentCreate(BaseModel):
    """Schema for creating a compartment."""

    name: str = Field(..., max_length=200)
    description: Optional[str] = None
    sort_order: int = 0
    image_url: Optional[str] = Field(None, max_length=500)
    is_header: bool = False
    container_type: str = Field("compartment", max_length=50)
    parent_compartment_id: Optional[str] = None
    items: Optional[List[CheckTemplateItemCreate]] = None


class CheckTemplateCompartmentUpdate(BaseModel):
    """Schema for updating a compartment."""

    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    sort_order: Optional[int] = None
    image_url: Optional[str] = Field(None, max_length=500)
    is_header: Optional[bool] = None
    container_type: Optional[str] = Field(None, max_length=50)
    parent_compartment_id: Optional[str] = None


class CheckTemplateCompartmentResponse(UTCResponseBase):
    """Response schema for a compartment with nested items."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    template_id: str
    name: str
    description: Optional[str] = None
    sort_order: int
    image_url: Optional[str] = None
    is_header: bool = False
    container_type: str = "compartment"
    parent_compartment_id: Optional[str] = None
    items: List[CheckTemplateItemResponse] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_validator("is_header", mode="before")
    @classmethod
    def coerce_is_header(cls, v: object) -> bool:
        """Rows created before the is_header column was added store NULL."""
        if v is None:
            return False
        return bool(v)

    @field_validator("container_type", mode="before")
    @classmethod
    def coerce_container_type(cls, v: object) -> str:
        """Rows created before the container_type column store NULL."""
        if v is None:
            return "compartment"
        return str(v)


# ============================================
# Equipment Check Template Schemas
# ============================================


class EquipmentCheckTemplateCreate(BaseModel):
    """Schema for creating an equipment check template."""

    name: str = Field(..., max_length=200)
    description: Optional[str] = None
    apparatus_id: Optional[str] = None
    apparatus_type: Optional[str] = Field(None, max_length=50)
    check_timing: str = Field(..., max_length=30)
    template_type: str = Field(default="equipment", max_length=30)
    assigned_positions: Optional[List[str]] = None
    is_active: bool = True
    sort_order: int = 0
    compartments: Optional[List[CheckTemplateCompartmentCreate]] = None


class EquipmentCheckTemplateUpdate(BaseModel):
    """Schema for updating an equipment check template."""

    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    apparatus_id: Optional[str] = None
    apparatus_type: Optional[str] = Field(None, max_length=50)
    check_timing: Optional[str] = Field(None, max_length=30)
    template_type: Optional[str] = Field(None, max_length=30)
    assigned_positions: Optional[List[str]] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class EquipmentCheckTemplateResponse(UTCResponseBase):
    """Response schema for an equipment check template with compartments."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    organization_id: str
    apparatus_id: Optional[str] = None
    apparatus_type: Optional[str] = None
    name: str
    description: Optional[str] = None
    check_timing: str
    template_type: str = "equipment"
    assigned_positions: Optional[List[str]] = None
    is_active: bool
    sort_order: int
    compartments: List[CheckTemplateCompartmentResponse] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None


# ============================================
# Shift Equipment Check Submission Schemas
# ============================================


class CheckItemResultSubmit(BaseModel):
    """A single item result in a check submission."""

    template_item_id: str
    compartment_name: str = Field(..., max_length=200)
    item_name: str = Field(..., max_length=200)
    check_type: Optional[str] = Field(None, max_length=30)
    # "not_applicable" is a real answer, not a fault: a tool legitimately off
    # the truck used to have to be filed as a failure, and the compliance
    # reports counted it as one. It counts as answered in
    # _compute_check_status and never toward the failure count.
    status: str = Field(..., pattern=r"^(pass|fail|not_checked|not_applicable)$")
    quantity_found: Optional[int] = None
    required_quantity: Optional[int] = None
    critical_minimum_quantity: Optional[int] = None
    level_reading: Optional[float] = None
    level_unit: Optional[str] = Field(None, max_length=50)
    serial_number: Optional[str] = Field(None, max_length=100)
    lot_number: Optional[str] = Field(None, max_length=100)
    serial_found: Optional[str] = Field(None, max_length=100)
    lot_found: Optional[str] = Field(None, max_length=100)
    # Expiration read off a unit replaced during this check. Written back onto
    # the template item alongside lot_found so the truck's record reflects the
    # unit actually on it.
    expiration_found: Optional[date] = None
    photo_urls: Optional[List[str]] = None
    # Advisory only: the server recomputes expiry from the template item (or
    # expiration_found) so a client cannot pass an expired item by asserting it
    # is fine. Kept for checks submitted without a template item to resolve.
    is_expired: bool = False
    expiration_date: Optional[date] = None
    notes: Optional[str] = None


class ShiftEquipmentCheckCreate(BaseModel):
    """Schema for submitting an equipment check tied to a shift."""

    template_id: str
    check_timing: str = Field(..., max_length=30)
    items: List[CheckItemResultSubmit] = Field(..., min_length=1)
    notes: Optional[str] = None
    signature_data: Optional[str] = None


class StandaloneEquipmentCheckCreate(BaseModel):
    """Schema for standalone equipment check (no shift)."""

    template_id: str
    apparatus_id: Optional[str] = None
    check_timing: str = Field(default="start_of_shift", max_length=30)
    items: List[CheckItemResultSubmit] = Field(..., min_length=1)
    notes: Optional[str] = None
    signature_data: Optional[str] = None


class EquipmentCheckCompleteItems(BaseModel):
    """Schema for completing remaining items on an incomplete check."""

    items: List[CheckItemResultSubmit] = Field(..., min_length=1)
    notes: Optional[str] = None
    signature_data: Optional[str] = None


class ShiftEquipmentCheckItemResponse(UTCResponseBase):
    """Response schema for a single check item result."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    check_id: str
    template_item_id: Optional[str] = None
    compartment_name: str
    item_name: str
    check_type: Optional[str] = None
    status: str
    quantity_found: Optional[int] = None
    required_quantity: Optional[int] = None
    critical_minimum_quantity: Optional[int] = None
    level_reading: Optional[float] = None
    level_unit: Optional[str] = None
    serial_number: Optional[str] = None
    lot_number: Optional[str] = None
    serial_found: Optional[str] = None
    lot_found: Optional[str] = None
    expiration_found: Optional[date] = None
    updated_serial: bool = False
    photo_urls: Optional[List[str]] = None
    is_expired: bool
    expiration_date: Optional[date] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None


class ShiftEquipmentCheckResponse(UTCResponseBase):
    """Response schema for a completed equipment check."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    organization_id: str
    shift_id: Optional[str] = None
    template_id: Optional[str] = None
    check_context: str = "shift_based"
    apparatus_id: Optional[str] = None
    checked_by: Optional[str] = None
    checked_by_name: Optional[str] = None
    checked_at: Optional[datetime] = None
    check_timing: str
    overall_status: str
    total_items: int
    completed_items: int
    failed_items: int
    notes: Optional[str] = None
    items: List[ShiftEquipmentCheckItemResponse] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ShiftCheckSummary(UTCResponseBase):
    """Summary of check status for a shift — used in shift detail view."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    template_id: str
    template_name: str
    check_timing: str
    assigned_positions: Optional[List[str]] = None
    is_completed: bool = False
    overall_status: Optional[str] = None
    checked_by_name: Optional[str] = None
    checked_at: Optional[datetime] = None
    total_items: int = 0
    completed_items: int = 0
    failed_items: int = 0


class CheckItemHistory(UTCResponseBase):
    """History entry for a single item across multiple shifts."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    check_id: str
    shift_id: str
    shift_date: Optional[date] = None
    status: str
    quantity_found: Optional[int] = None
    level_reading: Optional[float] = None
    serial_number: Optional[str] = None
    lot_number: Optional[str] = None
    is_expired: bool = False
    notes: Optional[str] = None
    checked_by_name: Optional[str] = None
    checked_at: Optional[datetime] = None


# ============================================
# Reorder Schemas
# ============================================


class ReorderRequest(BaseModel):
    """Schema for reordering compartments or items."""

    ordered_ids: List[str]


# ============================================
# Report Schemas
# ============================================


class ApparatusComplianceRecord(BaseModel):
    """Per-apparatus compliance summary for the report dashboard."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    apparatus_id: str
    apparatus_name: str
    last_check_date: Optional[datetime] = None
    last_checked_by: Optional[str] = None
    last_status: Optional[str] = None
    checks_completed: int = 0
    checks_expected: int = 0
    pass_count: int = 0
    fail_count: int = 0
    has_deficiency: bool = False
    deficiency_since: Optional[datetime] = None


class MemberComplianceReportRecord(BaseModel):
    """Per-member check completion stats."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    user_id: str
    user_name: str
    checks_completed: int = 0
    pass_count: int = 0
    fail_count: int = 0


class ComplianceReportResponse(BaseModel):
    """Aggregated compliance dashboard data."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    total_checks: int = 0
    pass_rate: float = 0.0
    overdue_count: int = 0
    avg_items_per_check: float = 0.0
    apparatus: List[ApparatusComplianceRecord] = []
    members: List[MemberComplianceReportRecord] = []


class FailureLogRecord(BaseModel):
    """A single failed-item entry for the failure log."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    check_id: str
    checked_at: Optional[datetime] = None
    apparatus_id: Optional[str] = None
    apparatus_name: Optional[str] = None
    compartment_name: str
    item_name: str
    check_type: Optional[str] = None
    status: str
    notes: Optional[str] = None
    checked_by_name: Optional[str] = None


class FailureLogResponse(BaseModel):
    """Paginated list of failure records."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    items: List[FailureLogRecord] = []
    total: int = 0


class ItemTrendEntry(BaseModel):
    """A single data point in item trend history."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    period: str
    pass_count: int = 0
    fail_count: int = 0
    not_checked_count: int = 0
    # Answered "not on truck". Counted apart from not_checked_count: one is a
    # crew's answer, the other is nobody having looked.
    not_applicable_count: int = 0


class ItemTrendResponse(BaseModel):
    """Trend data for a specific template item over time."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    item_name: str
    trends: List[ItemTrendEntry] = []
    history: List[CheckItemHistory] = []


# ============================================
# Template Change Log Schemas
# ============================================


class TemplateChangeLogResponse(UTCResponseBase):
    """Response schema for a template change log entry."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    template_id: str
    user_id: Optional[str] = None
    user_name: str
    action: str
    entity_type: str
    entity_id: Optional[str] = None
    entity_name: Optional[str] = None
    changes: Optional[dict] = None
    created_at: Optional[datetime] = None


class TemplateChangeLogListResponse(BaseModel):
    """Paginated list of template change log entries."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    items: List[TemplateChangeLogResponse] = []
    total: int = 0


# ============================================
# Supply Officer: Expiring Items + Lot Swap
# ============================================

_camel_config = ConfigDict(
    from_attributes=True,
    alias_generator=to_camel,
    populate_by_name=True,
)


class ReadyLot(BaseModel):
    """A ready-stock lot available to swap onto an apparatus."""

    model_config = _camel_config

    id: str
    lot_number: Optional[str] = None
    expiration_date: Optional[date] = None
    quantity: int = 0
    # Stock can expire on the shelf. Such a lot is still listed so the supply
    # officer can see and dispose of it, but it is excluded from ready_stock
    # and refused by the swap endpoint — putting it on a truck would fail the
    # item on the very next check.
    is_expired: bool = False


class SupplyExpiringItem(BaseModel):
    """A deployed checklist item nearing expiration, with ready-stock info."""

    model_config = _camel_config

    template_item_id: str
    item_name: str
    compartment_name: Optional[str] = None
    template_id: Optional[str] = None
    template_name: Optional[str] = None
    apparatus_id: Optional[str] = None
    apparatus_name: Optional[str] = None
    lot_number: Optional[str] = None
    expiration_date: Optional[date] = None
    days_until_expiration: Optional[int] = None
    is_expired: bool = False
    # An item reaches this worklist either by its date or by a crew reporting
    # it used; without this the two are indistinguishable in the response, and
    # a used item has no expiration to explain why it is listed.
    restock_needed: bool = False
    restock_note: Optional[str] = None
    restock_reported_at: Optional[datetime] = None
    quantity_on_truck: Optional[int] = None
    target_quantity: Optional[int] = None
    is_short: bool = False
    inventory_item_id: Optional[str] = None
    inventory_item_name: Optional[str] = None
    ready_stock: int = 0
    ready_lots: List[ReadyLot] = []


class SupplyOverviewResponse(BaseModel):
    """Supply-officer view of items expiring soon across all apparatus."""

    model_config = _camel_config

    days_ahead: int
    total: int = 0
    items: List[SupplyExpiringItem] = []


class DeployedLot(BaseModel):
    """One lot physically aboard for a checklist position.

    A four-slot bracket can hold units from three lots with three dates; the
    position's exposure is the earliest of them, which is why these are listed
    rather than collapsed into one number and one date.
    """

    model_config = _camel_config

    id: str
    lot_number: Optional[str] = None
    expiration_date: Optional[date] = None
    quantity: int = 0
    is_expired: bool = False


class ItemDeployedLots(BaseModel):
    """The lots aboard for one position, with the position's totals."""

    model_config = _camel_config

    template_item_id: str
    item_name: str
    target_quantity: Optional[int] = None
    quantity_on_truck: Optional[int] = None
    is_short: bool = False
    unit_of_measure: Optional[str] = None
    lots: List[DeployedLot] = []


class DeployedLotUpdateRequest(BaseModel):
    """Correct one lot aboard so the record matches what is in the bag.

    ``lot_number`` and ``expiration_date`` are partial: omitted leaves them
    alone, an explicit null clears them. A crew changing a drug out enters the
    new date here, which is what keeps the application and the bag saying the
    same thing.
    """

    quantity: int = Field(..., ge=0)
    lot_number: Optional[str] = Field(None, max_length=100)
    expiration_date: Optional[date] = None


class ApparatusInventoryItem(BaseModel):
    """One tracked position on an apparatus, with the stock behind it."""

    model_config = _camel_config

    template_item_id: str
    item_name: str
    check_type: Optional[str] = None
    # What the position should hold, and what it actually holds. The second is
    # NULL-backed on the model but never null here: an uncounted item reads as
    # its target, because the record of what was stocked is the best answer
    # until a crew contradicts it.
    target_quantity: Optional[int] = None
    quantity_on_truck: Optional[int] = None
    is_short: bool = False
    unit_of_measure: Optional[str] = None
    deployed_lots: List[DeployedLot] = []
    serial_number: Optional[str] = None
    lot_number: Optional[str] = None
    expiration_date: Optional[date] = None
    days_until_expiration: Optional[int] = None
    is_expired: bool = False
    restock_needed: bool = False
    restock_note: Optional[str] = None
    restock_reported_at: Optional[datetime] = None
    restock_reported_by_name: Optional[str] = None
    inventory_item_id: Optional[str] = None
    ready_stock: int = 0
    ready_lots: List[ReadyLot] = []


class ApparatusInventoryCompartment(BaseModel):
    """A compartment's worth of tracked positions."""

    model_config = _camel_config

    compartment_id: str
    compartment_name: str
    items: List[ApparatusInventoryItem] = []


class ApparatusInventoryResponse(BaseModel):
    """What an apparatus is carrying right now.

    Read at any hour, outside any check — the standing view a crew uses to
    record what they just used and to put fresh stock in a bracket.
    """

    model_config = _camel_config

    apparatus_id: str
    apparatus_name: Optional[str] = None
    compartments: List[ApparatusInventoryCompartment] = []


class ItemUsedRequest(BaseModel):
    """Report that a checklist item was used or pulled off the truck."""

    note: Optional[str] = Field(None, max_length=500)
    # Omitted for a position that is not counted (a single tool, a pass/fail
    # inspection), where the report itself is the whole message.
    quantity_used: Optional[int] = Field(None, ge=1)


class ItemQuantityRequest(BaseModel):
    """Set the on-truck count outright — a recount, or a hand restock."""

    quantity: int = Field(..., ge=0)


class ItemRestockStateResponse(BaseModel):
    """Where a checklist item stands after a use, restock or recount."""

    model_config = _camel_config

    template_item_id: str
    restock_needed: bool = False
    restock_note: Optional[str] = None
    restock_reported_at: Optional[datetime] = None
    quantity_on_truck: Optional[int] = None
    target_quantity: Optional[int] = None
    is_short: bool = False


class ItemDeployment(BaseModel):
    """A checklist position on an apparatus that an inventory item fills.

    The supply view answers "what is expiring on my trucks"; this answers the
    same link from the other side — "which trucks carry this item" — which is
    the direction a recall or an expiring lot is actually worked from.
    """

    model_config = _camel_config

    template_item_id: str
    item_name: str
    compartment_name: Optional[str] = None
    template_id: Optional[str] = None
    template_name: Optional[str] = None
    apparatus_id: Optional[str] = None
    apparatus_name: Optional[str] = None
    apparatus_type: Optional[str] = None
    lot_number: Optional[str] = None
    serial_number: Optional[str] = None
    expiration_date: Optional[date] = None
    days_until_expiration: Optional[int] = None
    is_expired: bool = False


class LotSwapRequest(BaseModel):
    """Move units from a ready-stock lot onto the apparatus."""

    inventory_lot_id: str
    # Defaults to one, which is the whole story for a single-unit bracket.
    quantity: int = Field(1, ge=1)


class LotSwapResponse(BaseModel):
    """Result of a lot swap: the deployed item now carries the new lot."""

    model_config = _camel_config

    template_item_id: str
    lot_number: Optional[str] = None
    expiration_date: Optional[date] = None
    remaining_quantity: int = 0
    # A full restock settles the report; a partial one leaves it standing,
    # because the truck is still short.
    restock_needed: bool = False
    quantity_on_truck: Optional[int] = None


# ============================================
# Catalog Linking (template setup)
# ============================================


class LinkCoverage(BaseModel):
    """How much of a template is wired to the inventory catalog."""

    model_config = _camel_config

    # Headers and unnamed rows are excluded — they are captions, not stock, so
    # counting them would understate coverage that is in fact complete.
    linkable: int = 0
    linked: int = 0
    unlinked: int = 0


class InventoryMatchSuggestion(BaseModel):
    """One catalog item proposed for an unlinked checklist position."""

    model_config = _camel_config

    id: str
    name: str
    # 1.0 only when the two names normalize identically. The review screen
    # pre-selects those and nothing else: a subset match ("Oxygen Mask" against
    # "Oxygen Mask Adult") scores high but is exactly the case a person needs
    # to arbitrate.
    score: float
    confidence: str


class InventoryMatch(BaseModel):
    """An unlinked checklist position and what the catalog might call it."""

    model_config = _camel_config

    template_item_id: str
    item_name: str
    check_type: Optional[str] = None
    suggestions: List[InventoryMatchSuggestion] = []


class InventoryMatchesResponse(BaseModel):
    """Proposed links for a whole template. Nothing here has been written."""

    model_config = _camel_config

    coverage: LinkCoverage
    matches: List[InventoryMatch] = []


class InventoryLinkRequest(BaseModel):
    """Apply a reviewed set of catalog links.

    Maps template item id -> inventory item id. An explicit null unlinks, so
    the same call that made a wrong match can undo it.
    """

    links: Dict[str, Optional[str]] = Field(..., min_length=1)


class InventoryLinkResponse(BaseModel):
    """What the link pass changed, and where coverage stands afterwards."""

    model_config = _camel_config

    linked: int = 0
    coverage: LinkCoverage


# CheckTemplateItemResponse references DeployedLot, which is declared with the
# supply schemas further down; bind the forward reference now that it exists.
CheckTemplateItemResponse.model_rebuild()
