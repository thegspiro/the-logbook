"""
Equipment Check Pydantic Schemas

Request and response schemas for equipment check template management
and shift equipment check submissions.
"""

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from app.schemas.base import stamp_naive_datetimes_utc


# ============================================
# Check Template Item Schemas
# ============================================


class CheckTemplateItemCreate(BaseModel):
    """Schema for creating a check template item."""

    name: str = Field(..., max_length=200)
    description: Optional[str] = None
    sort_order: int = 0
    check_type: str = Field(default="pass_fail", max_length=30)
    is_required: bool = False
    required_quantity: Optional[int] = None
    image_url: Optional[str] = Field(None, max_length=500)
    equipment_id: Optional[str] = None
    has_expiration: bool = False
    expiration_date: Optional[date] = None
    expiration_warning_days: int = 30


class CheckTemplateItemUpdate(BaseModel):
    """Schema for updating a check template item."""

    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    sort_order: Optional[int] = None
    check_type: Optional[str] = Field(None, max_length=30)
    is_required: Optional[bool] = None
    required_quantity: Optional[int] = None
    image_url: Optional[str] = Field(None, max_length=500)
    equipment_id: Optional[str] = None
    has_expiration: Optional[bool] = None
    expiration_date: Optional[date] = None
    expiration_warning_days: Optional[int] = None


class CheckTemplateItemResponse(BaseModel):
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
    image_url: Optional[str] = None
    equipment_id: Optional[str] = None
    has_expiration: bool
    expiration_date: Optional[date] = None
    expiration_warning_days: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @model_validator(mode="after")
    def ensure_utc(self) -> "CheckTemplateItemResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Check Template Compartment Schemas
# ============================================


class CheckTemplateCompartmentCreate(BaseModel):
    """Schema for creating a compartment."""

    name: str = Field(..., max_length=200)
    description: Optional[str] = None
    sort_order: int = 0
    image_url: Optional[str] = Field(None, max_length=500)
    parent_compartment_id: Optional[str] = None
    items: Optional[List[CheckTemplateItemCreate]] = None


class CheckTemplateCompartmentUpdate(BaseModel):
    """Schema for updating a compartment."""

    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    sort_order: Optional[int] = None
    image_url: Optional[str] = Field(None, max_length=500)
    parent_compartment_id: Optional[str] = None


class CheckTemplateCompartmentResponse(BaseModel):
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
    parent_compartment_id: Optional[str] = None
    items: List[CheckTemplateItemResponse] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @model_validator(mode="after")
    def ensure_utc(self) -> "CheckTemplateCompartmentResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


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
    assigned_positions: Optional[List[str]] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class EquipmentCheckTemplateResponse(BaseModel):
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
    assigned_positions: Optional[List[str]] = None
    is_active: bool
    sort_order: int
    compartments: List[CheckTemplateCompartmentResponse] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None

    @model_validator(mode="after")
    def ensure_utc(self) -> "EquipmentCheckTemplateResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class EquipmentCheckTemplateSummary(BaseModel):
    """Lightweight response for template listing."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    name: str
    apparatus_id: Optional[str] = None
    apparatus_type: Optional[str] = None
    check_timing: str
    assigned_positions: Optional[List[str]] = None
    is_active: bool
    sort_order: int
    compartment_count: int = 0
    item_count: int = 0


# ============================================
# Shift Equipment Check Submission Schemas
# ============================================


class CheckItemResultSubmit(BaseModel):
    """A single item result in a check submission."""

    template_item_id: str
    compartment_name: str = Field(..., max_length=200)
    item_name: str = Field(..., max_length=200)
    status: str = Field(..., max_length=30)  # pass, fail, not_checked
    quantity_found: Optional[int] = None
    required_quantity: Optional[int] = None
    is_expired: bool = False
    expiration_date: Optional[date] = None
    notes: Optional[str] = None


class ShiftEquipmentCheckCreate(BaseModel):
    """Schema for submitting an equipment check."""

    template_id: str
    check_timing: str = Field(..., max_length=30)
    items: List[CheckItemResultSubmit]
    notes: Optional[str] = None
    signature_data: Optional[str] = None


class ShiftEquipmentCheckItemResponse(BaseModel):
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
    status: str
    quantity_found: Optional[int] = None
    required_quantity: Optional[int] = None
    is_expired: bool
    expiration_date: Optional[date] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None

    @model_validator(mode="after")
    def ensure_utc(self) -> "ShiftEquipmentCheckItemResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class ShiftEquipmentCheckResponse(BaseModel):
    """Response schema for a completed equipment check."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    organization_id: str
    shift_id: str
    template_id: Optional[str] = None
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

    @model_validator(mode="after")
    def ensure_utc(self) -> "ShiftEquipmentCheckResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class ShiftCheckSummary(BaseModel):
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

    @model_validator(mode="after")
    def ensure_utc(self) -> "ShiftCheckSummary":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class CheckItemHistory(BaseModel):
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
    is_expired: bool = False
    notes: Optional[str] = None
    checked_by_name: Optional[str] = None
    checked_at: Optional[datetime] = None

    @model_validator(mode="after")
    def ensure_utc(self) -> "CheckItemHistory":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Reorder Schemas
# ============================================


class ReorderRequest(BaseModel):
    """Schema for reordering compartments or items."""

    ordered_ids: List[str]
