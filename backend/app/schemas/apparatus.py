"""
Apparatus Pydantic Schemas

Request and response schemas for apparatus-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional, List, Any, Dict
from datetime import datetime, date
from decimal import Decimal
from uuid import UUID
from enum import Enum


# =============================================================================
# Enumerations (matching model enums)
# =============================================================================

class ApparatusCategoryEnum(str, Enum):
    FIRE = "fire"
    EMS = "ems"
    RESCUE = "rescue"
    SUPPORT = "support"
    COMMAND = "command"
    MARINE = "marine"
    AIRCRAFT = "aircraft"
    ADMIN = "admin"
    OTHER = "other"


class DefaultApparatusTypeEnum(str, Enum):
    ENGINE = "engine"
    LADDER = "ladder"
    QUINT = "quint"
    RESCUE = "rescue"
    AMBULANCE = "ambulance"
    SQUAD = "squad"
    TANKER = "tanker"
    BRUSH = "brush"
    HAZMAT = "hazmat"
    COMMAND = "command"
    UTILITY = "utility"
    BOAT = "boat"
    ATV = "atv"
    STAFF = "staff"
    RESERVE = "reserve"
    OTHER = "other"


class DefaultApparatusStatusEnum(str, Enum):
    IN_SERVICE = "in_service"
    OUT_OF_SERVICE = "out_of_service"
    IN_MAINTENANCE = "in_maintenance"
    RESERVE = "reserve"
    ON_ORDER = "on_order"
    SOLD = "sold"
    DISPOSED = "disposed"


class FuelTypeEnum(str, Enum):
    GASOLINE = "gasoline"
    DIESEL = "diesel"
    ELECTRIC = "electric"
    HYBRID = "hybrid"
    PROPANE = "propane"
    CNG = "cng"
    OTHER = "other"


class CustomFieldTypeEnum(str, Enum):
    TEXT = "text"
    NUMBER = "number"
    DECIMAL = "decimal"
    DATE = "date"
    DATETIME = "datetime"
    BOOLEAN = "boolean"
    SELECT = "select"
    MULTI_SELECT = "multi_select"
    URL = "url"
    EMAIL = "email"


class MaintenanceCategoryEnum(str, Enum):
    PREVENTIVE = "preventive"
    REPAIR = "repair"
    INSPECTION = "inspection"
    CERTIFICATION = "certification"
    FLUID = "fluid"
    CLEANING = "cleaning"
    OTHER = "other"


class MaintenanceIntervalUnitEnum(str, Enum):
    DAYS = "days"
    WEEKS = "weeks"
    MONTHS = "months"
    YEARS = "years"
    MILES = "miles"
    KILOMETERS = "kilometers"
    HOURS = "hours"


# =============================================================================
# Apparatus Type Schemas
# =============================================================================

class ApparatusTypeBase(BaseModel):
    """Base apparatus type schema"""
    name: str = Field(..., min_length=1, max_length=100, description="Display name")
    code: str = Field(..., min_length=1, max_length=50, description="Short code")
    description: Optional[str] = Field(None, description="Type description")
    category: ApparatusCategoryEnum = Field(default=ApparatusCategoryEnum.FIRE)
    icon: Optional[str] = Field(None, max_length=50, description="Icon identifier")
    color: Optional[str] = Field(None, max_length=20, description="Color code")
    sort_order: int = Field(default=0, ge=0)
    is_active: bool = Field(default=True)


class ApparatusTypeCreate(ApparatusTypeBase):
    """Schema for creating apparatus type"""
    pass


class ApparatusTypeUpdate(BaseModel):
    """Schema for updating apparatus type"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=50)
    description: Optional[str] = None
    category: Optional[ApparatusCategoryEnum] = None
    icon: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=20)
    sort_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None


class ApparatusTypeResponse(ApparatusTypeBase):
    """Schema for apparatus type response"""
    id: str
    organization_id: Optional[str] = None
    is_system: bool
    default_type: Optional[DefaultApparatusTypeEnum] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ApparatusTypeListItem(BaseModel):
    """Schema for apparatus type list items"""
    id: str
    name: str
    code: str
    category: ApparatusCategoryEnum
    is_system: bool
    icon: Optional[str] = None
    color: Optional[str] = None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Apparatus Status Schemas
# =============================================================================

class ApparatusStatusBase(BaseModel):
    """Base apparatus status schema"""
    name: str = Field(..., min_length=1, max_length=100, description="Display name")
    code: str = Field(..., min_length=1, max_length=50, description="Short code")
    description: Optional[str] = Field(None, description="Status description")
    is_available: bool = Field(default=True, description="Can respond to calls")
    is_operational: bool = Field(default=True, description="Is functioning")
    requires_reason: bool = Field(default=False, description="Needs explanation when set")
    is_archived_status: bool = Field(default=False, description="Marks apparatus as archived")
    color: Optional[str] = Field(None, max_length=20, description="Color code")
    icon: Optional[str] = Field(None, max_length=50)
    sort_order: int = Field(default=0, ge=0)
    is_active: bool = Field(default=True)


class ApparatusStatusCreate(ApparatusStatusBase):
    """Schema for creating apparatus status"""
    pass


class ApparatusStatusUpdate(BaseModel):
    """Schema for updating apparatus status"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=50)
    description: Optional[str] = None
    is_available: Optional[bool] = None
    is_operational: Optional[bool] = None
    requires_reason: Optional[bool] = None
    is_archived_status: Optional[bool] = None
    color: Optional[str] = Field(None, max_length=20)
    icon: Optional[str] = Field(None, max_length=50)
    sort_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None


class ApparatusStatusResponse(ApparatusStatusBase):
    """Schema for apparatus status response"""
    id: str
    organization_id: Optional[str] = None
    is_system: bool
    default_status: Optional[DefaultApparatusStatusEnum] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ApparatusStatusListItem(BaseModel):
    """Schema for apparatus status list items"""
    id: str
    name: str
    code: str
    is_system: bool
    is_available: bool
    is_operational: bool
    is_archived_status: bool
    color: Optional[str] = None
    icon: Optional[str] = None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Main Apparatus Schemas
# =============================================================================

class ApparatusBase(BaseModel):
    """Base apparatus schema"""
    # Identification
    unit_number: str = Field(..., min_length=1, max_length=50, description="Department unit number")
    name: Optional[str] = Field(None, max_length=200, description="Optional friendly name")
    vin: Optional[str] = Field(None, max_length=17, description="Vehicle Identification Number")
    license_plate: Optional[str] = Field(None, max_length=20)
    license_state: Optional[str] = Field(None, max_length=50)
    radio_id: Optional[str] = Field(None, max_length=50, description="Radio call sign")
    asset_tag: Optional[str] = Field(None, max_length=50, description="Internal asset tracking number")

    # Type and Status
    apparatus_type_id: str = Field(..., description="Apparatus type ID")
    status_id: str = Field(..., description="Status ID")
    status_reason: Optional[str] = Field(None, description="Reason for current status")

    # Vehicle Specifications
    year: Optional[int] = Field(None, ge=1900, le=2100)
    make: Optional[str] = Field(None, max_length=100)
    model: Optional[str] = Field(None, max_length=100)
    body_manufacturer: Optional[str] = Field(None, max_length=100)
    color: Optional[str] = Field(None, max_length=50)

    # Fuel
    fuel_type: Optional[FuelTypeEnum] = Field(None)
    fuel_capacity_gallons: Optional[Decimal] = Field(None, ge=0)

    # Capacity
    seating_capacity: Optional[int] = Field(None, ge=1)
    gvwr: Optional[int] = Field(None, ge=0, description="Gross Vehicle Weight Rating (lbs)")

    # Fire/EMS Specifications
    pump_capacity_gpm: Optional[int] = Field(None, ge=0, description="Pump capacity in GPM")
    tank_capacity_gallons: Optional[int] = Field(None, ge=0, description="Water tank capacity")
    foam_capacity_gallons: Optional[int] = Field(None, ge=0, description="Foam tank capacity")
    ladder_length_feet: Optional[int] = Field(None, ge=0, description="Aerial ladder length")

    # Location
    primary_station_id: Optional[str] = Field(None, description="Primary station location ID")
    current_location_id: Optional[str] = Field(None, description="Current location ID")

    # Usage Tracking
    current_mileage: Optional[int] = Field(None, ge=0)
    current_hours: Optional[Decimal] = Field(None, ge=0, description="Engine hours")

    # Purchase Information
    purchase_date: Optional[date] = None
    purchase_price: Optional[Decimal] = Field(None, ge=0)
    purchase_vendor: Optional[str] = Field(None, max_length=200)
    purchase_order_number: Optional[str] = Field(None, max_length=100)
    in_service_date: Optional[date] = None

    # Financing
    is_financed: bool = Field(default=False)
    financing_company: Optional[str] = Field(None, max_length=200)
    financing_end_date: Optional[date] = None
    monthly_payment: Optional[Decimal] = Field(None, ge=0)

    # Value Tracking
    original_value: Optional[Decimal] = Field(None, ge=0)
    current_value: Optional[Decimal] = Field(None, ge=0)
    depreciation_method: Optional[str] = Field(None, max_length=50)
    depreciation_years: Optional[int] = Field(None, ge=0)
    salvage_value: Optional[Decimal] = Field(None, ge=0)

    # Warranty
    warranty_expiration: Optional[date] = None
    extended_warranty_expiration: Optional[date] = None
    warranty_provider: Optional[str] = Field(None, max_length=200)
    warranty_notes: Optional[str] = None

    # Insurance
    insurance_policy_number: Optional[str] = Field(None, max_length=100)
    insurance_provider: Optional[str] = Field(None, max_length=200)
    insurance_expiration: Optional[date] = None

    # Registration
    registration_expiration: Optional[date] = None
    inspection_expiration: Optional[date] = None

    # NFPA
    nfpa_tracking_enabled: bool = Field(default=False)

    # Custom Fields
    custom_field_values: Optional[Dict[str, Any]] = Field(default_factory=dict)

    # Notes
    description: Optional[str] = None
    notes: Optional[str] = None


class ApparatusCreate(ApparatusBase):
    """Schema for creating apparatus"""
    pass


class ApparatusUpdate(BaseModel):
    """Schema for updating apparatus"""
    # Identification
    unit_number: Optional[str] = Field(None, min_length=1, max_length=50)
    name: Optional[str] = Field(None, max_length=200)
    vin: Optional[str] = Field(None, max_length=17)
    license_plate: Optional[str] = Field(None, max_length=20)
    license_state: Optional[str] = Field(None, max_length=50)
    radio_id: Optional[str] = Field(None, max_length=50)
    asset_tag: Optional[str] = Field(None, max_length=50)

    # Type and Status
    apparatus_type_id: Optional[str] = None
    status_id: Optional[str] = None
    status_reason: Optional[str] = None

    # Vehicle Specifications
    year: Optional[int] = Field(None, ge=1900, le=2100)
    make: Optional[str] = Field(None, max_length=100)
    model: Optional[str] = Field(None, max_length=100)
    body_manufacturer: Optional[str] = Field(None, max_length=100)
    color: Optional[str] = Field(None, max_length=50)

    # Fuel
    fuel_type: Optional[FuelTypeEnum] = None
    fuel_capacity_gallons: Optional[Decimal] = Field(None, ge=0)

    # Capacity
    seating_capacity: Optional[int] = Field(None, ge=1)
    gvwr: Optional[int] = Field(None, ge=0)

    # Fire/EMS Specifications
    pump_capacity_gpm: Optional[int] = Field(None, ge=0)
    tank_capacity_gallons: Optional[int] = Field(None, ge=0)
    foam_capacity_gallons: Optional[int] = Field(None, ge=0)
    ladder_length_feet: Optional[int] = Field(None, ge=0)

    # Location
    primary_station_id: Optional[str] = None
    current_location_id: Optional[str] = None

    # Usage Tracking
    current_mileage: Optional[int] = Field(None, ge=0)
    current_hours: Optional[Decimal] = Field(None, ge=0)

    # Purchase Information
    purchase_date: Optional[date] = None
    purchase_price: Optional[Decimal] = Field(None, ge=0)
    purchase_vendor: Optional[str] = Field(None, max_length=200)
    purchase_order_number: Optional[str] = Field(None, max_length=100)
    in_service_date: Optional[date] = None

    # Financing
    is_financed: Optional[bool] = None
    financing_company: Optional[str] = Field(None, max_length=200)
    financing_end_date: Optional[date] = None
    monthly_payment: Optional[Decimal] = Field(None, ge=0)

    # Value Tracking
    original_value: Optional[Decimal] = Field(None, ge=0)
    current_value: Optional[Decimal] = Field(None, ge=0)
    depreciation_method: Optional[str] = Field(None, max_length=50)
    depreciation_years: Optional[int] = Field(None, ge=0)
    salvage_value: Optional[Decimal] = Field(None, ge=0)

    # Warranty
    warranty_expiration: Optional[date] = None
    extended_warranty_expiration: Optional[date] = None
    warranty_provider: Optional[str] = Field(None, max_length=200)
    warranty_notes: Optional[str] = None

    # Insurance
    insurance_policy_number: Optional[str] = Field(None, max_length=100)
    insurance_provider: Optional[str] = Field(None, max_length=200)
    insurance_expiration: Optional[date] = None

    # Registration
    registration_expiration: Optional[date] = None
    inspection_expiration: Optional[date] = None

    # NFPA
    nfpa_tracking_enabled: Optional[bool] = None

    # Custom Fields
    custom_field_values: Optional[Dict[str, Any]] = None

    # Notes
    description: Optional[str] = None
    notes: Optional[str] = None


class ApparatusResponse(ApparatusBase):
    """Schema for apparatus response"""
    id: str
    organization_id: str

    # Status change tracking
    status_changed_at: Optional[datetime] = None
    status_changed_by: Optional[str] = None

    # Usage tracking timestamps
    mileage_updated_at: Optional[datetime] = None
    hours_updated_at: Optional[datetime] = None
    value_updated_at: Optional[datetime] = None

    # Archive info
    is_archived: bool
    archived_at: Optional[datetime] = None
    archived_by: Optional[str] = None

    # Sale/Disposal info
    sold_date: Optional[date] = None
    sold_price: Optional[Decimal] = None
    sold_to: Optional[str] = None
    sold_to_contact: Optional[str] = None
    disposal_date: Optional[date] = None
    disposal_method: Optional[str] = None
    disposal_reason: Optional[str] = None
    disposal_notes: Optional[str] = None

    # Metadata
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    # Nested relationships (optional, populated when needed)
    apparatus_type: Optional[ApparatusTypeListItem] = None
    status_record: Optional[ApparatusStatusListItem] = None

    model_config = ConfigDict(from_attributes=True)


class ApparatusListItem(BaseModel):
    """Schema for apparatus list items"""
    id: str
    unit_number: str
    name: Optional[str] = None
    year: Optional[int] = None
    make: Optional[str] = None
    model: Optional[str] = None
    apparatus_type_id: str
    status_id: str
    primary_station_id: Optional[str] = None
    current_mileage: Optional[int] = None
    current_hours: Optional[Decimal] = None
    is_archived: bool

    # Nested type and status info
    apparatus_type: Optional[ApparatusTypeListItem] = None
    status_record: Optional[ApparatusStatusListItem] = None

    model_config = ConfigDict(from_attributes=True)


class ApparatusStatusChange(BaseModel):
    """Schema for changing apparatus status"""
    status_id: str = Field(..., description="New status ID")
    reason: Optional[str] = Field(None, description="Reason for status change")
    current_mileage: Optional[int] = Field(None, ge=0, description="Current mileage at time of change")
    current_hours: Optional[Decimal] = Field(None, ge=0, description="Current hours at time of change")


class ApparatusArchive(BaseModel):
    """Schema for archiving apparatus"""
    disposal_method: str = Field(..., description="Method of disposal (sold, traded, donated, scrapped)")
    disposal_reason: Optional[str] = Field(None, description="Reason for disposal")
    disposal_date: Optional[date] = Field(None, description="Date of disposal")
    disposal_notes: Optional[str] = Field(None, description="Additional notes")

    # For sold apparatus
    sold_date: Optional[date] = None
    sold_price: Optional[Decimal] = Field(None, ge=0)
    sold_to: Optional[str] = Field(None, max_length=200, description="Buyer name")
    sold_to_contact: Optional[str] = Field(None, max_length=200, description="Buyer contact info")


# =============================================================================
# Apparatus Custom Field Schemas
# =============================================================================

class CustomFieldOption(BaseModel):
    """Option for SELECT and MULTI_SELECT fields"""
    value: str
    label: str


class ApparatusCustomFieldBase(BaseModel):
    """Base custom field schema"""
    name: str = Field(..., min_length=1, max_length=100, description="Display name")
    field_key: str = Field(..., min_length=1, max_length=100, description="Unique key")
    description: Optional[str] = None
    field_type: CustomFieldTypeEnum = Field(default=CustomFieldTypeEnum.TEXT)

    is_required: bool = Field(default=False)
    default_value: Optional[str] = None
    placeholder: Optional[str] = Field(None, max_length=200)

    options: Optional[List[CustomFieldOption]] = None

    min_value: Optional[Decimal] = None
    max_value: Optional[Decimal] = None
    min_length: Optional[int] = Field(None, ge=0)
    max_length: Optional[int] = Field(None, ge=0)
    regex_pattern: Optional[str] = Field(None, max_length=500)

    applies_to_types: Optional[List[str]] = None

    sort_order: int = Field(default=0, ge=0)
    show_in_list: bool = Field(default=False)
    show_in_detail: bool = Field(default=True)
    is_active: bool = Field(default=True)


class ApparatusCustomFieldCreate(ApparatusCustomFieldBase):
    """Schema for creating custom field"""
    pass


class ApparatusCustomFieldUpdate(BaseModel):
    """Schema for updating custom field"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    field_key: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    field_type: Optional[CustomFieldTypeEnum] = None

    is_required: Optional[bool] = None
    default_value: Optional[str] = None
    placeholder: Optional[str] = Field(None, max_length=200)

    options: Optional[List[CustomFieldOption]] = None

    min_value: Optional[Decimal] = None
    max_value: Optional[Decimal] = None
    min_length: Optional[int] = Field(None, ge=0)
    max_length: Optional[int] = Field(None, ge=0)
    regex_pattern: Optional[str] = Field(None, max_length=500)

    applies_to_types: Optional[List[str]] = None

    sort_order: Optional[int] = Field(None, ge=0)
    show_in_list: Optional[bool] = None
    show_in_detail: Optional[bool] = None
    is_active: Optional[bool] = None


class ApparatusCustomFieldResponse(ApparatusCustomFieldBase):
    """Schema for custom field response"""
    id: str
    organization_id: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Apparatus Maintenance Type Schemas
# =============================================================================

class ApparatusMaintenanceTypeBase(BaseModel):
    """Base maintenance type schema"""
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=50)
    description: Optional[str] = None
    category: MaintenanceCategoryEnum = Field(default=MaintenanceCategoryEnum.PREVENTIVE)

    default_interval_value: Optional[int] = Field(None, ge=1)
    default_interval_unit: Optional[MaintenanceIntervalUnitEnum] = None
    default_interval_miles: Optional[int] = Field(None, ge=0)
    default_interval_hours: Optional[int] = Field(None, ge=0)

    is_nfpa_required: bool = Field(default=False)
    nfpa_reference: Optional[str] = Field(None, max_length=100)

    applies_to_types: Optional[List[str]] = None
    sort_order: int = Field(default=0, ge=0)
    is_active: bool = Field(default=True)


class ApparatusMaintenanceTypeCreate(ApparatusMaintenanceTypeBase):
    """Schema for creating maintenance type"""
    pass


class ApparatusMaintenanceTypeUpdate(BaseModel):
    """Schema for updating maintenance type"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=50)
    description: Optional[str] = None
    category: Optional[MaintenanceCategoryEnum] = None

    default_interval_value: Optional[int] = Field(None, ge=1)
    default_interval_unit: Optional[MaintenanceIntervalUnitEnum] = None
    default_interval_miles: Optional[int] = Field(None, ge=0)
    default_interval_hours: Optional[int] = Field(None, ge=0)

    is_nfpa_required: Optional[bool] = None
    nfpa_reference: Optional[str] = Field(None, max_length=100)

    applies_to_types: Optional[List[str]] = None
    sort_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None


class ApparatusMaintenanceTypeResponse(ApparatusMaintenanceTypeBase):
    """Schema for maintenance type response"""
    id: str
    organization_id: Optional[str] = None
    is_system: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Apparatus Maintenance Record Schemas
# =============================================================================

class ApparatusMaintenanceBase(BaseModel):
    """Base maintenance record schema"""
    apparatus_id: str = Field(..., description="Apparatus ID")
    maintenance_type_id: str = Field(..., description="Maintenance type ID")

    scheduled_date: Optional[date] = None
    due_date: Optional[date] = None
    completed_date: Optional[date] = None
    performed_by: Optional[str] = Field(None, max_length=200, description="External vendor/person")

    description: Optional[str] = None
    work_performed: Optional[str] = None
    findings: Optional[str] = None

    mileage_at_service: Optional[int] = Field(None, ge=0)
    hours_at_service: Optional[Decimal] = Field(None, ge=0)

    cost: Optional[Decimal] = Field(None, ge=0)
    vendor: Optional[str] = Field(None, max_length=200)
    invoice_number: Optional[str] = Field(None, max_length=100)

    next_due_date: Optional[date] = None
    next_due_mileage: Optional[int] = Field(None, ge=0)
    next_due_hours: Optional[Decimal] = Field(None, ge=0)

    notes: Optional[str] = None


class ApparatusMaintenanceCreate(ApparatusMaintenanceBase):
    """Schema for creating maintenance record"""
    is_completed: bool = Field(default=False)


class ApparatusMaintenanceUpdate(BaseModel):
    """Schema for updating maintenance record"""
    maintenance_type_id: Optional[str] = None

    scheduled_date: Optional[date] = None
    due_date: Optional[date] = None
    completed_date: Optional[date] = None
    performed_by: Optional[str] = Field(None, max_length=200)

    is_completed: Optional[bool] = None

    description: Optional[str] = None
    work_performed: Optional[str] = None
    findings: Optional[str] = None

    mileage_at_service: Optional[int] = Field(None, ge=0)
    hours_at_service: Optional[Decimal] = Field(None, ge=0)

    cost: Optional[Decimal] = Field(None, ge=0)
    vendor: Optional[str] = Field(None, max_length=200)
    invoice_number: Optional[str] = Field(None, max_length=100)

    next_due_date: Optional[date] = None
    next_due_mileage: Optional[int] = Field(None, ge=0)
    next_due_hours: Optional[Decimal] = Field(None, ge=0)

    notes: Optional[str] = None


class ApparatusMaintenanceResponse(ApparatusMaintenanceBase):
    """Schema for maintenance record response"""
    id: str
    organization_id: str
    is_completed: bool
    is_overdue: bool
    completed_by: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    # Nested info
    maintenance_type: Optional[ApparatusMaintenanceTypeResponse] = None

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Apparatus Fuel Log Schemas
# =============================================================================

class ApparatusFuelLogBase(BaseModel):
    """Base fuel log schema"""
    apparatus_id: str = Field(..., description="Apparatus ID")
    fuel_date: datetime
    fuel_type: FuelTypeEnum
    gallons: Decimal = Field(..., gt=0)
    price_per_gallon: Optional[Decimal] = Field(None, ge=0)
    total_cost: Optional[Decimal] = Field(None, ge=0)

    mileage_at_fill: Optional[int] = Field(None, ge=0)
    hours_at_fill: Optional[Decimal] = Field(None, ge=0)

    is_full_tank: bool = Field(default=True)
    station_name: Optional[str] = Field(None, max_length=200)
    station_address: Optional[str] = None

    notes: Optional[str] = None


class ApparatusFuelLogCreate(ApparatusFuelLogBase):
    """Schema for creating fuel log"""
    pass


class ApparatusFuelLogUpdate(BaseModel):
    """Schema for updating fuel log"""
    fuel_date: Optional[datetime] = None
    fuel_type: Optional[FuelTypeEnum] = None
    gallons: Optional[Decimal] = Field(None, gt=0)
    price_per_gallon: Optional[Decimal] = Field(None, ge=0)
    total_cost: Optional[Decimal] = Field(None, ge=0)

    mileage_at_fill: Optional[int] = Field(None, ge=0)
    hours_at_fill: Optional[Decimal] = Field(None, ge=0)

    is_full_tank: Optional[bool] = None
    station_name: Optional[str] = Field(None, max_length=200)
    station_address: Optional[str] = None

    notes: Optional[str] = None


class ApparatusFuelLogResponse(ApparatusFuelLogBase):
    """Schema for fuel log response"""
    id: str
    organization_id: str
    recorded_by: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Apparatus Operator Schemas
# =============================================================================

class OperatorRestriction(BaseModel):
    """Restriction detail for operators"""
    type: str = Field(..., description="Restriction type (e.g., 'weather', 'event', 'time')")
    description: str = Field(..., description="Restriction description")
    is_active: bool = Field(default=True)


class ApparatusOperatorBase(BaseModel):
    """Base operator schema"""
    apparatus_id: str = Field(..., description="Apparatus ID")
    user_id: str = Field(..., description="User ID")

    is_certified: bool = Field(default=True)
    certification_date: Optional[date] = None
    certification_expiration: Optional[date] = None

    license_type_required: Optional[str] = Field(None, max_length=50)
    license_verified: bool = Field(default=False)
    license_verified_date: Optional[date] = None

    has_restrictions: bool = Field(default=False)
    restrictions: Optional[List[OperatorRestriction]] = None
    restriction_notes: Optional[str] = None

    is_active: bool = Field(default=True)
    notes: Optional[str] = None


class ApparatusOperatorCreate(ApparatusOperatorBase):
    """Schema for creating operator"""
    pass


class ApparatusOperatorUpdate(BaseModel):
    """Schema for updating operator"""
    is_certified: Optional[bool] = None
    certification_date: Optional[date] = None
    certification_expiration: Optional[date] = None

    license_type_required: Optional[str] = Field(None, max_length=50)
    license_verified: Optional[bool] = None
    license_verified_date: Optional[date] = None

    has_restrictions: Optional[bool] = None
    restrictions: Optional[List[OperatorRestriction]] = None
    restriction_notes: Optional[str] = None

    is_active: Optional[bool] = None
    notes: Optional[str] = None


class ApparatusOperatorResponse(ApparatusOperatorBase):
    """Schema for operator response"""
    id: str
    organization_id: str
    certified_by: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Apparatus Equipment Schemas
# =============================================================================

class ApparatusEquipmentBase(BaseModel):
    """Base equipment schema"""
    apparatus_id: str = Field(..., description="Apparatus ID")
    inventory_item_id: Optional[str] = Field(None, description="Link to inventory item")

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    quantity: int = Field(default=1, ge=1)

    location_on_apparatus: Optional[str] = Field(None, max_length=200)

    is_mounted: bool = Field(default=False, description="Permanently mounted")
    is_required: bool = Field(default=False, description="Required on apparatus")

    serial_number: Optional[str] = Field(None, max_length=100)
    asset_tag: Optional[str] = Field(None, max_length=50)

    is_present: bool = Field(default=True, description="Currently on apparatus")
    notes: Optional[str] = None


class ApparatusEquipmentCreate(ApparatusEquipmentBase):
    """Schema for creating equipment"""
    pass


class ApparatusEquipmentUpdate(BaseModel):
    """Schema for updating equipment"""
    inventory_item_id: Optional[str] = None

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    quantity: Optional[int] = Field(None, ge=1)

    location_on_apparatus: Optional[str] = Field(None, max_length=200)

    is_mounted: Optional[bool] = None
    is_required: Optional[bool] = None

    serial_number: Optional[str] = Field(None, max_length=100)
    asset_tag: Optional[str] = Field(None, max_length=50)

    is_present: Optional[bool] = None
    notes: Optional[str] = None


class ApparatusEquipmentResponse(ApparatusEquipmentBase):
    """Schema for equipment response"""
    id: str
    organization_id: str
    assigned_by: Optional[str] = None
    assigned_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Apparatus Photo Schemas
# =============================================================================

class ApparatusPhotoBase(BaseModel):
    """Base photo schema"""
    title: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    taken_at: Optional[datetime] = None
    photo_type: Optional[str] = Field(None, max_length=50, description="exterior, interior, damage, detail")
    is_primary: bool = Field(default=False)


class ApparatusPhotoCreate(ApparatusPhotoBase):
    """Schema for creating photo"""
    apparatus_id: str = Field(..., description="Apparatus ID")
    file_path: str = Field(..., description="Path in storage system")
    file_name: str = Field(..., max_length=255)
    file_size: Optional[int] = Field(None, ge=0)
    mime_type: Optional[str] = Field(None, max_length=100)


class ApparatusPhotoUpdate(BaseModel):
    """Schema for updating photo"""
    title: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    taken_at: Optional[datetime] = None
    photo_type: Optional[str] = Field(None, max_length=50)
    is_primary: Optional[bool] = None


class ApparatusPhotoResponse(ApparatusPhotoBase):
    """Schema for photo response"""
    id: str
    organization_id: str
    apparatus_id: str
    file_path: str
    file_name: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    uploaded_by: Optional[str] = None
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Apparatus Document Schemas
# =============================================================================

class ApparatusDocumentBase(BaseModel):
    """Base document schema"""
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    document_type: str = Field(..., max_length=50, description="title, registration, insurance, manual, inspection")
    expiration_date: Optional[date] = None
    document_date: Optional[date] = None


class ApparatusDocumentCreate(ApparatusDocumentBase):
    """Schema for creating document"""
    apparatus_id: str = Field(..., description="Apparatus ID")
    file_path: str = Field(..., description="Path in storage system")
    file_name: str = Field(..., max_length=255)
    file_size: Optional[int] = Field(None, ge=0)
    mime_type: Optional[str] = Field(None, max_length=100)


class ApparatusDocumentUpdate(BaseModel):
    """Schema for updating document"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    document_type: Optional[str] = Field(None, max_length=50)
    expiration_date: Optional[date] = None
    document_date: Optional[date] = None


class ApparatusDocumentResponse(ApparatusDocumentBase):
    """Schema for document response"""
    id: str
    organization_id: str
    apparatus_id: str
    file_path: str
    file_name: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    uploaded_by: Optional[str] = None
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# List/Filter Schemas
# =============================================================================

class ApparatusListFilters(BaseModel):
    """Filters for apparatus list"""
    apparatus_type_id: Optional[str] = None
    status_id: Optional[str] = None
    primary_station_id: Optional[str] = None
    is_archived: Optional[bool] = None
    year_min: Optional[int] = None
    year_max: Optional[int] = None
    make: Optional[str] = None
    search: Optional[str] = None  # Search in unit_number, name, vin


class PaginatedApparatusList(BaseModel):
    """Paginated apparatus list response"""
    items: List[ApparatusListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


# =============================================================================
# Summary/Dashboard Schemas
# =============================================================================

class ApparatusFleetSummary(BaseModel):
    """Fleet summary for dashboard"""
    total_apparatus: int
    in_service_count: int
    out_of_service_count: int
    in_maintenance_count: int
    reserve_count: int
    archived_count: int

    # By type
    by_type: Dict[str, int]

    # Upcoming maintenance
    maintenance_due_soon: int  # Due within 30 days
    maintenance_overdue: int

    # Expiring items
    registrations_expiring_soon: int  # Within 30 days
    inspections_expiring_soon: int
    insurance_expiring_soon: int


class ApparatusMaintenanceDue(BaseModel):
    """Maintenance due item"""
    apparatus_id: str
    apparatus_unit_number: str
    maintenance_type_name: str
    due_date: Optional[date] = None
    due_mileage: Optional[int] = None
    due_hours: Optional[Decimal] = None
    is_overdue: bool
