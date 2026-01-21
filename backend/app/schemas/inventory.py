"""
Inventory Pydantic Schemas

Request and response schemas for inventory-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime, date
from uuid import UUID
from decimal import Decimal


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
    pass


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

    model_config = ConfigDict(from_attributes=True)


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
    storage_location: Optional[str] = Field(None, max_length=255)
    station: Optional[str] = Field(None, max_length=100)
    condition: str = "good"
    status: str = "available"
    status_notes: Optional[str] = None
    quantity: int = Field(default=1, ge=0)
    unit_of_measure: Optional[str] = Field(None, max_length=50)
    inspection_interval_days: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = None
    attachments: Optional[List[str]] = None


class InventoryItemCreate(InventoryItemBase):
    """Schema for creating a new inventory item"""
    pass


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
    storage_location: Optional[str] = Field(None, max_length=255)
    station: Optional[str] = Field(None, max_length=100)
    condition: Optional[str] = None
    status: Optional[str] = None
    status_notes: Optional[str] = None
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

class LowStockItem(BaseModel):
    """Schema for low stock alert"""
    category_id: UUID
    category_name: str
    item_type: str
    current_stock: int
    threshold: int


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


class UserCheckoutItem(BaseModel):
    """Schema for user's checked out item"""
    checkout_id: UUID
    item_id: UUID
    item_name: str
    checked_out_at: datetime
    expected_return_at: Optional[datetime] = None
    is_overdue: bool


class UserInventoryResponse(BaseModel):
    """Schema for user's complete inventory view"""
    permanent_assignments: List[UserInventoryItem]
    active_checkouts: List[UserCheckoutItem]


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
