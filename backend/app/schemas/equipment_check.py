"""
Equipment Check Pydantic Schemas

Request and response schemas for equipment check template management
and shift equipment check submissions.
"""

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.base import UTCResponseBase

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
    expected_quantity: Optional[int] = None
    critical_minimum_quantity: Optional[int] = None
    min_level: Optional[float] = None
    level_unit: Optional[str] = Field(None, max_length=50)
    serial_number: Optional[str] = Field(None, max_length=100)
    lot_number: Optional[str] = Field(None, max_length=100)
    image_url: Optional[str] = Field(None, max_length=500)
    equipment_id: Optional[str] = None
    has_expiration: bool = False
    expiration_date: Optional[date] = None
    expiration_warning_days: int = 30


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
    has_expiration: Optional[bool] = None
    expiration_date: Optional[date] = None
    expiration_warning_days: Optional[int] = None


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
    parent_compartment_id: Optional[str] = None
    items: Optional[List[CheckTemplateItemCreate]] = None


class CheckTemplateCompartmentUpdate(BaseModel):
    """Schema for updating a compartment."""

    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    sort_order: Optional[int] = None
    image_url: Optional[str] = Field(None, max_length=500)
    is_header: Optional[bool] = None
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
    parent_compartment_id: Optional[str] = None
    items: List[CheckTemplateItemResponse] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


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
    template_type: str = "equipment"
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
    check_type: Optional[str] = Field(None, max_length=30)
    status: str = Field(..., max_length=30)  # pass, fail, not_checked
    quantity_found: Optional[int] = None
    required_quantity: Optional[int] = None
    critical_minimum_quantity: Optional[int] = None
    level_reading: Optional[float] = None
    level_unit: Optional[str] = Field(None, max_length=50)
    serial_number: Optional[str] = Field(None, max_length=100)
    lot_number: Optional[str] = Field(None, max_length=100)
    serial_found: Optional[str] = Field(None, max_length=100)
    lot_found: Optional[str] = Field(None, max_length=100)
    photo_urls: Optional[List[str]] = None
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
