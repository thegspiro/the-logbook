"""
Inventory Pydantic Schemas

Request and response schemas for inventory-related endpoints.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ============================================
# Category Schemas
# ============================================


class InventoryCategoryBase(BaseModel):
    """Base inventory category schema"""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    item_type: str
    parent_category_id: Optional[UUID] = None
    requires_assignment: bool = False
    requires_serial_number: bool = False
    requires_maintenance: bool = False
    low_stock_threshold: Optional[int] = Field(None, ge=0)
    metadata: Optional[Dict[str, Any]] = None


class InventoryCategoryCreate(InventoryCategoryBase):
    """Schema for creating a new inventory category"""


class InventoryCategoryUpdate(BaseModel):
    """Schema for updating an inventory category"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    item_type: Optional[str] = None
    parent_category_id: Optional[UUID] = None
    requires_assignment: Optional[bool] = None
    requires_serial_number: Optional[bool] = None
    requires_maintenance: Optional[bool] = None
    low_stock_threshold: Optional[int] = Field(None, ge=0)
    metadata: Optional[Dict[str, Any]] = None
    active: Optional[bool] = None


class InventoryCategoryResponse(InventoryCategoryBase):
    """Schema for inventory category response"""

    id: UUID
    organization_id: UUID
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    # Override: DB column is "extra_data"; SQLAlchemy reserves "metadata" as a class attr
    metadata: Optional[Dict[str, Any]] = Field(None, validation_alias="extra_data")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ============================================
# Item Schemas
# ============================================


class InventoryItemBase(BaseModel):
    """Base inventory item schema"""

    category_id: Optional[UUID] = None
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    manufacturer: Optional[str] = Field(None, max_length=255)
    model_number: Optional[str] = Field(None, max_length=255)
    serial_number: Optional[str] = Field(None, max_length=255)
    asset_tag: Optional[str] = Field(None, max_length=255)
    barcode: Optional[str] = Field(None, max_length=255)
    purchase_date: Optional[date] = None
    purchase_price: Optional[Decimal] = Field(None, ge=0)
    purchase_order: Optional[str] = Field(None, max_length=255)
    vendor: Optional[str] = Field(None, max_length=255)
    warranty_expiration: Optional[date] = None
    expected_lifetime_years: Optional[int] = Field(None, ge=0)
    current_value: Optional[Decimal] = Field(None, ge=0)
    size: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=50)
    weight: Optional[float] = Field(None, ge=0)
    location_id: Optional[UUID] = None
    storage_location: Optional[str] = Field(None, max_length=255)
    storage_area_id: Optional[UUID] = None
    station: Optional[str] = Field(None, max_length=100)
    condition: str = "good"
    status: str = "available"
    status_notes: Optional[str] = None
    tracking_type: str = "individual"  # "individual" or "pool"
    quantity: int = Field(default=1, ge=0)
    unit_of_measure: Optional[str] = Field(None, max_length=50)
    inspection_interval_days: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = None
    attachments: Optional[List[str]] = None


class InventoryItemCreate(InventoryItemBase):
    """Schema for creating a new inventory item"""


class InventoryItemUpdate(BaseModel):
    """Schema for updating an inventory item"""

    category_id: Optional[UUID] = None
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    manufacturer: Optional[str] = Field(None, max_length=255)
    model_number: Optional[str] = Field(None, max_length=255)
    serial_number: Optional[str] = Field(None, max_length=255)
    asset_tag: Optional[str] = Field(None, max_length=255)
    barcode: Optional[str] = Field(None, max_length=255)
    purchase_date: Optional[date] = None
    purchase_price: Optional[Decimal] = Field(None, ge=0)
    purchase_order: Optional[str] = Field(None, max_length=255)
    vendor: Optional[str] = Field(None, max_length=255)
    warranty_expiration: Optional[date] = None
    expected_lifetime_years: Optional[int] = Field(None, ge=0)
    current_value: Optional[Decimal] = Field(None, ge=0)
    size: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=50)
    weight: Optional[float] = Field(None, ge=0)
    location_id: Optional[UUID] = None
    storage_location: Optional[str] = Field(None, max_length=255)
    storage_area_id: Optional[UUID] = None
    station: Optional[str] = Field(None, max_length=100)
    condition: Optional[str] = None
    status: Optional[str] = None
    status_notes: Optional[str] = None
    tracking_type: Optional[str] = None
    quantity: Optional[int] = Field(None, ge=0)
    unit_of_measure: Optional[str] = Field(None, max_length=50)
    last_inspection_date: Optional[date] = None
    next_inspection_due: Optional[date] = None
    inspection_interval_days: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = None
    attachments: Optional[List[str]] = None
    active: Optional[bool] = None


class InventoryItemResponse(InventoryItemBase):
    """Schema for inventory item response"""

    id: UUID
    organization_id: UUID
    assigned_to_user_id: Optional[UUID] = None
    assigned_date: Optional[datetime] = None
    quantity_issued: int = 0
    last_inspection_date: Optional[date] = None
    next_inspection_due: Optional[date] = None
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


class InventoryItemDetailResponse(InventoryItemResponse):
    """Extended item response with relationships"""

    category: Optional[InventoryCategoryResponse] = None
    assigned_to_user: Optional[Dict[str, Any]] = None  # User info
    checkout_count: int = 0
    maintenance_count: int = 0

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Assignment Schemas
# ============================================


class ItemAssignmentBase(BaseModel):
    """Base assignment schema"""

    assignment_type: str = "permanent"
    assignment_reason: Optional[str] = None
    expected_return_date: Optional[datetime] = None


class ItemAssignmentCreate(ItemAssignmentBase):
    """Schema for creating an assignment"""

    item_id: UUID
    user_id: UUID


class ItemAssignmentResponse(ItemAssignmentBase):
    """Schema for assignment response"""

    id: UUID
    organization_id: UUID
    item_id: UUID
    user_id: UUID
    assigned_date: datetime
    returned_date: Optional[datetime] = None
    assigned_by: Optional[UUID] = None
    returned_by: Optional[UUID] = None
    return_condition: Optional[str] = None
    return_notes: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UnassignItemRequest(BaseModel):
    """Schema for unassigning an item"""

    return_condition: Optional[str] = None
    return_notes: Optional[str] = None


# ============================================
# Pool Item Issuance Schemas
# ============================================


class ItemIssuanceCreate(BaseModel):
    """Schema for issuing units from a pool item to a member"""

    user_id: UUID
    quantity: int = Field(default=1, ge=1, description="Number of units to issue")
    issue_reason: Optional[str] = None


class ItemIssuanceReturnRequest(BaseModel):
    """Schema for returning issued units back to the pool"""

    return_condition: Optional[str] = None
    return_notes: Optional[str] = None
    quantity_returned: Optional[int] = Field(
        None, ge=1, description="Partial return; defaults to full issuance quantity"
    )


class ItemIssuanceResponse(BaseModel):
    """Schema for issuance record response"""

    id: UUID
    organization_id: UUID
    item_id: UUID
    user_id: UUID
    quantity_issued: int
    issued_at: datetime
    returned_at: Optional[datetime] = None
    issued_by: Optional[UUID] = None
    returned_by: Optional[UUID] = None
    issue_reason: Optional[str] = None
    return_condition: Optional[str] = None
    return_notes: Optional[str] = None
    is_returned: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Check-Out Schemas
# ============================================


class CheckOutRecordBase(BaseModel):
    """Base checkout record schema"""

    expected_return_at: Optional[datetime] = None
    checkout_reason: Optional[str] = None


class CheckOutCreate(CheckOutRecordBase):
    """Schema for checking out an item"""

    item_id: UUID
    user_id: UUID


class CheckInRequest(BaseModel):
    """Schema for checking in an item"""

    return_condition: str
    damage_notes: Optional[str] = None


class CheckOutRecordResponse(CheckOutRecordBase):
    """Schema for checkout record response"""

    id: UUID
    organization_id: UUID
    item_id: UUID
    user_id: UUID
    checked_out_at: datetime
    checked_in_at: Optional[datetime] = None
    checked_out_by: Optional[UUID] = None
    checked_in_by: Optional[UUID] = None
    checkout_condition: Optional[str] = None
    return_condition: Optional[str] = None
    damage_notes: Optional[str] = None
    is_returned: bool
    is_overdue: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Maintenance Schemas
# ============================================


class MaintenanceRecordBase(BaseModel):
    """Base maintenance record schema"""

    maintenance_type: str
    scheduled_date: Optional[date] = None
    completed_date: Optional[date] = None
    next_due_date: Optional[date] = None
    performed_by: Optional[UUID] = None
    vendor_name: Optional[str] = Field(None, max_length=255)
    cost: Optional[Decimal] = Field(None, ge=0)
    condition_before: Optional[str] = None
    condition_after: Optional[str] = None
    description: Optional[str] = None
    parts_replaced: Optional[List[str]] = None
    parts_cost: Optional[Decimal] = Field(None, ge=0)
    labor_hours: Optional[float] = Field(None, ge=0)
    passed: Optional[bool] = None
    notes: Optional[str] = None
    issues_found: Optional[List[str]] = None
    attachments: Optional[List[str]] = None
    is_completed: bool = False


class MaintenanceRecordCreate(MaintenanceRecordBase):
    """Schema for creating a maintenance record"""

    item_id: UUID


class MaintenanceRecordUpdate(BaseModel):
    """Schema for updating a maintenance record"""

    maintenance_type: Optional[str] = None
    scheduled_date: Optional[date] = None
    completed_date: Optional[date] = None
    next_due_date: Optional[date] = None
    performed_by: Optional[UUID] = None
    vendor_name: Optional[str] = Field(None, max_length=255)
    cost: Optional[Decimal] = Field(None, ge=0)
    condition_before: Optional[str] = None
    condition_after: Optional[str] = None
    description: Optional[str] = None
    parts_replaced: Optional[List[str]] = None
    parts_cost: Optional[Decimal] = Field(None, ge=0)
    labor_hours: Optional[float] = Field(None, ge=0)
    passed: Optional[bool] = None
    notes: Optional[str] = None
    issues_found: Optional[List[str]] = None
    attachments: Optional[List[str]] = None
    is_completed: Optional[bool] = None


class MaintenanceRecordResponse(MaintenanceRecordBase):
    """Schema for maintenance record response"""

    id: UUID
    organization_id: UUID
    item_id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Summary & Reporting Schemas
# ============================================


class LowStockItemDetail(BaseModel):
    """Schema for an individual item in a low stock category"""

    name: str
    quantity: int


class LowStockItem(BaseModel):
    """Schema for low stock alert"""

    category_id: UUID
    category_name: str
    item_type: str
    current_stock: int
    threshold: int
    items: List[LowStockItemDetail] = []


class InventorySummary(BaseModel):
    """Schema for overall inventory summary"""

    total_items: int
    items_by_status: Dict[str, int]
    items_by_condition: Dict[str, int]
    total_value: float
    active_checkouts: int
    overdue_checkouts: int
    maintenance_due_count: int


class UserInventoryItem(BaseModel):
    """Schema for user's assigned item"""

    assignment_id: UUID
    item_id: UUID
    item_name: str
    serial_number: Optional[str] = None
    asset_tag: Optional[str] = None
    condition: str
    assigned_date: datetime
    category_name: Optional[str] = None
    quantity: int = 1


class UserCheckoutItem(BaseModel):
    """Schema for user's checked out item"""

    checkout_id: UUID
    item_id: UUID
    item_name: str
    checked_out_at: datetime
    expected_return_at: Optional[datetime] = None
    is_overdue: bool


class UserIssuedItem(BaseModel):
    """Schema for a pool item issued to a user"""

    issuance_id: UUID
    item_id: UUID
    item_name: str
    quantity_issued: int
    issued_at: datetime
    size: Optional[str] = None
    category_name: Optional[str] = None


class UserInventoryResponse(BaseModel):
    """Schema for user's complete inventory view"""

    permanent_assignments: List[UserInventoryItem]
    active_checkouts: List[UserCheckoutItem]
    issued_items: List[UserIssuedItem] = []


class MemberInventorySummary(BaseModel):
    """Summary of a single member's inventory holdings"""

    user_id: UUID
    username: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    membership_number: Optional[str] = None
    permanent_count: int = 0
    checkout_count: int = 0
    issued_count: int = 0
    overdue_count: int = 0
    total_items: int = 0


class MembersInventoryListResponse(BaseModel):
    """Response listing all members with inventory summary"""

    members: List[MemberInventorySummary]
    total: int


class ItemRetireRequest(BaseModel):
    """Schema for retiring an item"""

    notes: Optional[str] = None


class ItemsListResponse(BaseModel):
    """Schema for paginated items list"""

    items: List[InventoryItemResponse]
    total: int
    skip: int
    limit: int


class MaintenanceDueItem(BaseModel):
    """Schema for item with maintenance due"""

    id: UUID
    name: str
    serial_number: Optional[str] = None
    asset_tag: Optional[str] = None
    category_name: Optional[str] = None
    next_inspection_due: date
    days_until_due: int
    condition: str
    status: str


# ============================================
# Departure Clearance Schemas
# ============================================


class DepartureClearanceCreate(BaseModel):
    """Schema for initiating a departure clearance"""

    user_id: UUID
    departure_type: Optional[str] = (
        None  # "dropped_voluntary", "dropped_involuntary", "retired"
    )
    return_deadline_days: int = Field(default=14, ge=1, le=90)
    notes: Optional[str] = None


class ClearanceLineItemResponse(BaseModel):
    """Schema for a single clearance line item"""

    id: UUID
    clearance_id: UUID
    source_type: str  # "assignment", "checkout", "issuance"
    source_id: UUID
    item_id: Optional[UUID] = None
    item_name: str
    item_serial_number: Optional[str] = None
    item_asset_tag: Optional[str] = None
    item_value: Optional[float] = None
    quantity: int
    disposition: (
        str  # "pending", "returned", "returned_damaged", "written_off", "waived"
    )
    return_condition: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[UUID] = None
    resolution_notes: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DepartureClearanceResponse(BaseModel):
    """Schema for departure clearance response"""

    id: UUID
    organization_id: UUID
    user_id: UUID
    status: str  # "initiated", "in_progress", "completed", "closed_incomplete"
    total_items: int
    items_cleared: int
    items_outstanding: int
    total_value: float
    value_outstanding: float
    initiated_at: datetime
    completed_at: Optional[datetime] = None
    return_deadline: Optional[datetime] = None
    initiated_by: Optional[UUID] = None
    completed_by: Optional[UUID] = None
    departure_type: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    line_items: List[ClearanceLineItemResponse] = []

    model_config = ConfigDict(from_attributes=True)


class DepartureClearanceSummaryResponse(BaseModel):
    """Lightweight clearance summary (no line items)"""

    id: UUID
    user_id: UUID
    member_name: Optional[str] = None
    status: str
    total_items: int
    items_cleared: int
    items_outstanding: int
    total_value: float
    value_outstanding: float
    initiated_at: datetime
    completed_at: Optional[datetime] = None
    return_deadline: Optional[datetime] = None
    departure_type: Optional[str] = None


class ResolveClearanceItemRequest(BaseModel):
    """Schema for resolving (returning/writing off) a clearance line item"""

    disposition: str = Field(
        ..., description="One of: returned, returned_damaged, written_off, waived"
    )
    return_condition: Optional[str] = None
    resolution_notes: Optional[str] = None


class CompleteClearanceRequest(BaseModel):
    """Schema for completing/closing a clearance"""

    force_close: bool = Field(
        default=False,
        description="If True, close with status 'closed_incomplete' even if items are outstanding",
    )
    notes: Optional[str] = None


# ============================================
# Barcode Scan & Quick-Action Schemas
# ============================================


class ScanLookupResponse(BaseModel):
    """Response from scanning/looking up an item by barcode, serial, or asset tag"""

    item: InventoryItemResponse
    matched_field: str  # "barcode", "serial_number", or "asset_tag"
    matched_value: str


class ScanLookupListResponse(BaseModel):
    """Response from searching items by partial barcode, serial, or asset tag"""

    results: List[ScanLookupResponse]
    total: int


class BatchScanItem(BaseModel):
    """A single scanned item in a batch operation"""

    code: str = Field(
        ..., description="Barcode, serial number, or asset tag that was scanned"
    )
    item_id: Optional[UUID] = Field(
        default=None, description="Item ID for direct lookup (bypasses code search)"
    )
    quantity: int = Field(default=1, ge=1, description="Quantity (for pool items)")


class BatchCheckoutRequest(BaseModel):
    """Request to assign/checkout/issue multiple scanned items to a member at once"""

    user_id: UUID
    items: List[BatchScanItem] = Field(..., min_length=1)
    reason: Optional[str] = None


class BatchCheckoutResultItem(BaseModel):
    """Result for a single item in a batch checkout"""

    code: str
    item_name: str
    item_id: str
    action: str  # "assigned", "checked_out", "issued"
    success: bool
    error: Optional[str] = None


class BatchCheckoutResponse(BaseModel):
    """Response from a batch checkout operation"""

    user_id: UUID
    total_scanned: int
    successful: int
    failed: int
    results: List[BatchCheckoutResultItem]


class BatchReturnItem(BaseModel):
    """A single scanned item being returned"""

    code: str = Field(..., description="Barcode, serial number, or asset tag")
    item_id: Optional[UUID] = Field(
        default=None, description="Item ID for direct lookup (bypasses code search)"
    )
    return_condition: str = Field(default="good", description="Condition at return")
    damage_notes: Optional[str] = None
    quantity: int = Field(
        default=1, ge=1, description="Quantity returned (for pool items)"
    )


class BatchReturnRequest(BaseModel):
    """Request to return multiple scanned items from a member at once"""

    user_id: UUID
    items: List[BatchReturnItem] = Field(..., min_length=1)
    notes: Optional[str] = None


class BatchReturnResultItem(BaseModel):
    """Result for a single item in a batch return"""

    code: str
    item_name: str
    item_id: str
    action: str  # "unassigned", "checked_in", "returned_to_pool"
    success: bool
    error: Optional[str] = None


class BatchReturnResponse(BaseModel):
    """Response from a batch return operation"""

    user_id: UUID
    total_scanned: int
    successful: int
    failed: int
    results: List[BatchReturnResultItem]


class LabelGenerateRequest(BaseModel):
    """Schema for generating barcode label PDFs"""

    item_ids: List[UUID] = Field(
        ..., min_length=1, description="Item UUIDs to generate labels for"
    )
    label_format: str = Field(
        default="letter",
        description="Label format: letter, dymo_30252, dymo_30256, dymo_30334, rollo_4x6, or custom",
    )
    custom_width: Optional[float] = Field(
        None, gt=0, description="Width in inches (required for custom format)"
    )
    custom_height: Optional[float] = Field(
        None, gt=0, description="Height in inches (required for custom format)"
    )


# ============================================
# Equipment Request Schemas
# ============================================


class EquipmentRequestCreate(BaseModel):
    """Schema for creating an equipment request"""

    item_name: str = Field(..., min_length=1, max_length=255)
    item_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    quantity: int = Field(default=1, ge=1)
    request_type: str = Field(default="checkout")
    priority: str = Field(default="normal")
    reason: Optional[str] = None


class EquipmentRequestReview(BaseModel):
    """Schema for reviewing an equipment request"""

    status: str = Field(..., description="approved or denied")
    review_notes: Optional[str] = None


class EquipmentRequestResponse(BaseModel):
    """Schema for equipment request response"""

    id: UUID
    organization_id: UUID
    requester_id: UUID
    requester_name: Optional[str] = None
    item_name: str
    item_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    quantity: int
    request_type: str
    priority: str
    reason: Optional[str] = None
    status: str
    reviewed_by: Optional[UUID] = None
    reviewer_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Storage Area Schemas
# ============================================


class StorageAreaCreate(BaseModel):
    """Schema for creating a storage area"""

    name: str = Field(..., min_length=1, max_length=255)
    label: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    storage_type: str  # "rack", "shelf", "box", "cabinet", "drawer", "bin", "other"
    parent_id: Optional[UUID] = None
    location_id: Optional[UUID] = None
    barcode: Optional[str] = Field(None, max_length=255)
    sort_order: int = 0


class StorageAreaUpdate(BaseModel):
    """Schema for updating a storage area"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    label: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    storage_type: Optional[str] = None
    parent_id: Optional[UUID] = None
    location_id: Optional[UUID] = None
    barcode: Optional[str] = Field(None, max_length=255)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class StorageAreaResponse(BaseModel):
    """Schema for storage area response"""

    id: UUID
    organization_id: UUID
    name: str
    label: Optional[str] = None
    description: Optional[str] = None
    storage_type: str
    parent_id: Optional[UUID] = None
    location_id: Optional[UUID] = None
    barcode: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    # Populated by the API for tree views
    children: List["StorageAreaResponse"] = []
    item_count: int = 0
    location_name: Optional[str] = None
    parent_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Write-Off Schemas
# ============================================


class WriteOffRequestCreate(BaseModel):
    """Create a write-off request"""

    item_id: UUID
    reason: str  # lost, damaged_beyond_repair, obsolete, stolen, other
    description: str


class WriteOffReview(BaseModel):
    """Approve or deny a write-off request"""

    status: str  # approved, denied
    review_notes: Optional[str] = None


class WriteOffRequestResponse(BaseModel):
    """Write-off request response"""

    id: str
    item_id: Optional[str] = None
    item_name: str
    item_serial_number: Optional[str] = None
    item_asset_tag: Optional[str] = None
    item_value: Optional[float] = None
    reason: str
    description: str
    status: str
    requested_by: Optional[str] = None
    requester_name: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewer_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    clearance_id: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
