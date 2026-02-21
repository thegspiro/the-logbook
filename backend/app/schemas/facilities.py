"""
Facilities Pydantic Schemas

Request and response schemas for facility-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal
from enum import Enum


# Shared config for response schemas
_response_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


# =============================================================================
# Schema Enums (mirror model enums for API layer)
# =============================================================================

class FacilityCategoryEnum(str, Enum):
    STATION = "station"
    TRAINING = "training"
    ADMINISTRATION = "administration"
    STORAGE = "storage"
    MEETING_HALL = "meeting_hall"
    COMMUNITY = "community"
    OTHER = "other"


class FacilitySystemTypeEnum(str, Enum):
    HVAC = "hvac"
    ELECTRICAL = "electrical"
    PLUMBING = "plumbing"
    FIRE_SUPPRESSION = "fire_suppression"
    FIRE_ALARM = "fire_alarm"
    SECURITY = "security"
    ROOFING = "roofing"
    STRUCTURAL = "structural"
    ELEVATOR = "elevator"
    GENERATOR = "generator"
    COMMUNICATIONS = "communications"
    DOORS_WINDOWS = "doors_windows"
    FLOORING = "flooring"
    PAINTING = "painting"
    LANDSCAPING = "landscaping"
    PARKING = "parking"
    OTHER = "other"


class FacilitySystemConditionEnum(str, Enum):
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    CRITICAL = "critical"


class MaintenanceCategoryEnum(str, Enum):
    PREVENTIVE = "preventive"
    REPAIR = "repair"
    INSPECTION = "inspection"
    RENOVATION = "renovation"
    CLEANING = "cleaning"
    SAFETY = "safety"
    OTHER = "other"


class MaintenanceIntervalUnitEnum(str, Enum):
    DAYS = "days"
    WEEKS = "weeks"
    MONTHS = "months"
    YEARS = "years"


class InspectionTypeEnum(str, Enum):
    FIRE = "fire"
    BUILDING_CODE = "building_code"
    HEALTH = "health"
    ADA = "ada"
    ENVIRONMENTAL = "environmental"
    INSURANCE = "insurance"
    ROUTINE = "routine"
    OTHER = "other"


class UtilityTypeEnum(str, Enum):
    ELECTRIC = "electric"
    GAS = "gas"
    WATER = "water"
    SEWER = "sewer"
    INTERNET = "internet"
    PHONE = "phone"
    TRASH = "trash"
    OTHER = "other"


class BillingCycleEnum(str, Enum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"
    OTHER = "other"


class KeyTypeEnum(str, Enum):
    PHYSICAL_KEY = "physical_key"
    FOB = "fob"
    ACCESS_CODE = "access_code"
    KEY_CARD = "key_card"
    BIOMETRIC = "biometric"
    COMBINATION = "combination"
    OTHER = "other"


class RoomTypeEnum(str, Enum):
    APPARATUS_BAY = "apparatus_bay"
    BUNK_ROOM = "bunk_room"
    KITCHEN = "kitchen"
    BATHROOM = "bathroom"
    OFFICE = "office"
    TRAINING_ROOM = "training_room"
    STORAGE = "storage"
    MECHANICAL = "mechanical"
    LOBBY = "lobby"
    COMMON_AREA = "common_area"
    LAUNDRY = "laundry"
    GYM = "gym"
    DECONTAMINATION = "decontamination"
    DISPATCH = "dispatch"
    OTHER = "other"


class EmergencyContactTypeEnum(str, Enum):
    UTILITY_PROVIDER = "utility_provider"
    ALARM_COMPANY = "alarm_company"
    ELEVATOR_SERVICE = "elevator_service"
    PLUMBER = "plumber"
    ELECTRICIAN = "electrician"
    HVAC_SERVICE = "hvac_service"
    LOCKSMITH = "locksmith"
    GENERAL_CONTRACTOR = "general_contractor"
    FIRE_PROTECTION = "fire_protection"
    PEST_CONTROL = "pest_control"
    ROOFING = "roofing"
    JANITORIAL = "janitorial"
    OTHER = "other"


class ShutoffTypeEnum(str, Enum):
    WATER_MAIN = "water_main"
    GAS_MAIN = "gas_main"
    ELECTRICAL_MAIN = "electrical_main"
    FIRE_SUPPRESSION = "fire_suppression"
    HVAC = "hvac"
    IRRIGATION = "irrigation"
    OTHER = "other"


class CapitalProjectTypeEnum(str, Enum):
    RENOVATION = "renovation"
    NEW_CONSTRUCTION = "new_construction"
    REPAIR = "repair"
    UPGRADE = "upgrade"
    EXPANSION = "expansion"
    DEMOLITION = "demolition"
    ENVIRONMENTAL = "environmental"
    ADA_COMPLIANCE = "ada_compliance"
    OTHER = "other"


class CapitalProjectStatusEnum(str, Enum):
    PLANNING = "planning"
    APPROVED = "approved"
    BIDDING = "bidding"
    IN_PROGRESS = "in_progress"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class InsurancePolicyTypeEnum(str, Enum):
    PROPERTY = "property"
    LIABILITY = "liability"
    FLOOD = "flood"
    EARTHQUAKE = "earthquake"
    WORKERS_COMP = "workers_comp"
    UMBRELLA = "umbrella"
    EQUIPMENT = "equipment"
    OTHER = "other"


class ComplianceTypeEnum(str, Enum):
    ADA = "ada"
    FIRE_CODE = "fire_code"
    BUILDING_CODE = "building_code"
    HEALTH = "health"
    ENVIRONMENTAL = "environmental"
    OSHA = "osha"
    NFPA = "nfpa"
    OTHER = "other"


# =============================================================================
# Shared Attachment Schema
# =============================================================================

class FileAttachment(BaseModel):
    """Attachment reference for files"""
    file_path: str
    file_name: str
    mime_type: Optional[str] = None


# =============================================================================
# Facility Type Schemas
# =============================================================================

class FacilityTypeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    category: Optional[FacilityCategoryEnum] = FacilityCategoryEnum.OTHER


class FacilityTypeCreate(FacilityTypeBase):
    pass


class FacilityTypeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    category: Optional[FacilityCategoryEnum] = None
    is_active: Optional[bool] = None


class FacilityTypeResponse(FacilityTypeBase):
    id: str
    organization_id: str
    is_system: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


class FacilityTypeListItem(BaseModel):
    id: str
    name: str
    category: Optional[FacilityCategoryEnum] = None
    is_system: bool
    is_active: bool
    model_config = _response_config


# =============================================================================
# Facility Status Schemas
# =============================================================================

class FacilityStatusBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7, pattern=r"^#[0-9a-fA-F]{6}$")
    is_operational: bool = True


class FacilityStatusCreate(FacilityStatusBase):
    pass


class FacilityStatusUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7, pattern=r"^#[0-9a-fA-F]{6}$")
    is_operational: Optional[bool] = None
    is_active: Optional[bool] = None


class FacilityStatusResponse(FacilityStatusBase):
    id: str
    organization_id: str
    is_system: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


class FacilityStatusListItem(BaseModel):
    id: str
    name: str
    color: Optional[str] = None
    is_operational: bool
    is_system: bool
    is_active: bool
    model_config = _response_config


# =============================================================================
# Facility Schemas
# =============================================================================

class FacilityBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    facility_number: Optional[str] = Field(None, max_length=50)
    facility_type_id: str = Field(..., description="Facility type ID")
    status_id: str = Field(..., description="Facility status ID")

    # Address
    address_line1: Optional[str] = Field(None, max_length=200)
    address_line2: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=50)
    zip_code: Optional[str] = Field(None, max_length=20)
    county: Optional[str] = Field(None, max_length=100)
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None

    # Building info
    year_built: Optional[int] = Field(None, ge=1800, le=2100)
    year_renovated: Optional[int] = Field(None, ge=1800, le=2100)
    square_footage: Optional[int] = Field(None, ge=0)
    num_floors: Optional[int] = Field(None, ge=1)
    num_bays: Optional[int] = Field(None, ge=0)
    lot_size_acres: Optional[Decimal] = Field(None, ge=0)

    # Ownership
    is_owned: bool = True
    lease_expiration: Optional[date] = None
    property_tax_id: Optional[str] = Field(None, max_length=100)

    # Capacity
    max_occupancy: Optional[int] = Field(None, ge=0)
    sleeping_quarters: Optional[int] = Field(None, ge=0)

    # Contact
    phone: Optional[str] = Field(None, max_length=50)
    fax: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=200)

    # Description
    description: Optional[str] = None
    notes: Optional[str] = None


class FacilityCreate(FacilityBase):
    pass


class FacilityUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    facility_number: Optional[str] = Field(None, max_length=50)
    facility_type_id: Optional[str] = None
    status_id: Optional[str] = None

    address_line1: Optional[str] = Field(None, max_length=200)
    address_line2: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=50)
    zip_code: Optional[str] = Field(None, max_length=20)
    county: Optional[str] = Field(None, max_length=100)
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None

    year_built: Optional[int] = Field(None, ge=1800, le=2100)
    year_renovated: Optional[int] = Field(None, ge=1800, le=2100)
    square_footage: Optional[int] = Field(None, ge=0)
    num_floors: Optional[int] = Field(None, ge=1)
    num_bays: Optional[int] = Field(None, ge=0)
    lot_size_acres: Optional[Decimal] = Field(None, ge=0)

    is_owned: Optional[bool] = None
    lease_expiration: Optional[date] = None
    property_tax_id: Optional[str] = Field(None, max_length=100)

    max_occupancy: Optional[int] = Field(None, ge=0)
    sleeping_quarters: Optional[int] = Field(None, ge=0)

    phone: Optional[str] = Field(None, max_length=50)
    fax: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=200)

    description: Optional[str] = None
    notes: Optional[str] = None


class FacilityResponse(FacilityBase):
    id: str
    organization_id: str
    is_archived: bool
    status_changed_at: Optional[datetime] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    facility_type: Optional[FacilityTypeListItem] = None
    status_record: Optional[FacilityStatusListItem] = None

    model_config = _response_config


class FacilityListItem(BaseModel):
    id: str
    name: str
    facility_number: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    is_archived: bool
    facility_type: Optional[FacilityTypeListItem] = None
    status_record: Optional[FacilityStatusListItem] = None
    model_config = _response_config


# =============================================================================
# Facility Photo Schemas
# =============================================================================

class FacilityPhotoCreate(BaseModel):
    facility_id: str
    file_path: str
    file_name: str = Field(..., max_length=200)
    mime_type: Optional[str] = Field(None, max_length=100)
    caption: Optional[str] = Field(None, max_length=500)
    is_primary: bool = False


class FacilityPhotoUpdate(BaseModel):
    caption: Optional[str] = Field(None, max_length=500)
    is_primary: Optional[bool] = None


class FacilityPhotoResponse(FacilityPhotoCreate):
    id: str
    organization_id: str
    uploaded_by: Optional[str] = None
    uploaded_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Document Schemas
# =============================================================================

class FacilityDocumentCreate(BaseModel):
    facility_id: str
    file_path: str
    file_name: str = Field(..., max_length=200)
    mime_type: Optional[str] = Field(None, max_length=100)
    document_type: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    document_date: Optional[date] = None
    expiration_date: Optional[date] = None


class FacilityDocumentUpdate(BaseModel):
    document_type: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    document_date: Optional[date] = None
    expiration_date: Optional[date] = None


class FacilityDocumentResponse(FacilityDocumentCreate):
    id: str
    organization_id: str
    uploaded_by: Optional[str] = None
    uploaded_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Maintenance Type Schemas
# =============================================================================

class FacilityMaintenanceTypeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[MaintenanceCategoryEnum] = MaintenanceCategoryEnum.OTHER
    default_interval_value: Optional[int] = Field(None, ge=1)
    default_interval_unit: Optional[MaintenanceIntervalUnitEnum] = None


class FacilityMaintenanceTypeCreate(FacilityMaintenanceTypeBase):
    pass


class FacilityMaintenanceTypeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[MaintenanceCategoryEnum] = None
    default_interval_value: Optional[int] = Field(None, ge=1)
    default_interval_unit: Optional[MaintenanceIntervalUnitEnum] = None
    is_active: Optional[bool] = None


class FacilityMaintenanceTypeResponse(FacilityMaintenanceTypeBase):
    id: str
    organization_id: str
    is_system: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Maintenance Record Schemas
# =============================================================================

class FacilityMaintenanceBase(BaseModel):
    facility_id: str = Field(..., description="Facility ID")
    maintenance_type_id: str = Field(..., description="Maintenance type ID")
    system_id: Optional[str] = Field(None, description="Building system this maintenance targets")

    scheduled_date: Optional[date] = None
    due_date: Optional[date] = None
    completed_date: Optional[date] = None
    performed_by: Optional[str] = Field(None, max_length=200)

    description: Optional[str] = None
    work_performed: Optional[str] = None
    findings: Optional[str] = None

    cost: Optional[Decimal] = Field(None, ge=0)
    vendor: Optional[str] = Field(None, max_length=200)
    invoice_number: Optional[str] = Field(None, max_length=100)
    work_order_number: Optional[str] = Field(None, max_length=100)

    next_due_date: Optional[date] = None

    notes: Optional[str] = None
    attachments: Optional[List[FileAttachment]] = None


class FacilityMaintenanceCreate(FacilityMaintenanceBase):
    is_completed: bool = Field(default=False)

    # Historic entry support
    is_historic: bool = Field(default=False)
    occurred_date: Optional[date] = Field(None, description="Actual date the work was performed (required when is_historic=True)")
    historic_source: Optional[str] = Field(None, max_length=200)


class FacilityMaintenanceUpdate(BaseModel):
    maintenance_type_id: Optional[str] = None
    system_id: Optional[str] = None

    scheduled_date: Optional[date] = None
    due_date: Optional[date] = None
    completed_date: Optional[date] = None
    performed_by: Optional[str] = Field(None, max_length=200)

    is_completed: Optional[bool] = None

    description: Optional[str] = None
    work_performed: Optional[str] = None
    findings: Optional[str] = None

    cost: Optional[Decimal] = Field(None, ge=0)
    vendor: Optional[str] = Field(None, max_length=200)
    invoice_number: Optional[str] = Field(None, max_length=100)
    work_order_number: Optional[str] = Field(None, max_length=100)

    next_due_date: Optional[date] = None

    notes: Optional[str] = None
    attachments: Optional[List[FileAttachment]] = None

    occurred_date: Optional[date] = None
    historic_source: Optional[str] = Field(None, max_length=200)


class FacilityMaintenanceResponse(FacilityMaintenanceBase):
    id: str
    organization_id: str
    is_completed: bool
    is_overdue: bool
    completed_by: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    is_historic: bool = False
    occurred_date: Optional[date] = None
    historic_source: Optional[str] = None

    maintenance_type: Optional[FacilityMaintenanceTypeResponse] = None

    model_config = _response_config


# =============================================================================
# Facility System Schemas
# =============================================================================

class FacilitySystemBase(BaseModel):
    facility_id: str = Field(..., description="Facility ID")
    name: str = Field(..., min_length=1, max_length=200)
    system_type: FacilitySystemTypeEnum = FacilitySystemTypeEnum.OTHER
    description: Optional[str] = None

    manufacturer: Optional[str] = Field(None, max_length=200)
    model_number: Optional[str] = Field(None, max_length=100)
    serial_number: Optional[str] = Field(None, max_length=100)

    install_date: Optional[date] = None
    warranty_expiration: Optional[date] = None
    expected_life_years: Optional[int] = Field(None, ge=0)

    condition: FacilitySystemConditionEnum = FacilitySystemConditionEnum.GOOD
    last_serviced_date: Optional[date] = None
    last_inspected_date: Optional[date] = None

    notes: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True


class FacilitySystemCreate(FacilitySystemBase):
    pass


class FacilitySystemUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    system_type: Optional[FacilitySystemTypeEnum] = None
    description: Optional[str] = None

    manufacturer: Optional[str] = Field(None, max_length=200)
    model_number: Optional[str] = Field(None, max_length=100)
    serial_number: Optional[str] = Field(None, max_length=100)

    install_date: Optional[date] = None
    warranty_expiration: Optional[date] = None
    expected_life_years: Optional[int] = Field(None, ge=0)

    condition: Optional[FacilitySystemConditionEnum] = None
    last_serviced_date: Optional[date] = None
    last_inspected_date: Optional[date] = None

    notes: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class FacilitySystemResponse(FacilitySystemBase):
    id: str
    organization_id: str
    archived_at: Optional[datetime] = None
    archived_by: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Inspection Schemas
# =============================================================================

class FacilityInspectionBase(BaseModel):
    facility_id: str = Field(..., description="Facility ID")
    inspection_type: InspectionTypeEnum = InspectionTypeEnum.ROUTINE
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None

    inspection_date: date
    next_inspection_date: Optional[date] = None

    passed: Optional[bool] = None
    inspector_name: Optional[str] = Field(None, max_length=200)
    inspector_organization: Optional[str] = Field(None, max_length=200)
    certificate_number: Optional[str] = Field(None, max_length=100)

    findings: Optional[str] = None
    corrective_actions: Optional[str] = None
    corrective_action_deadline: Optional[date] = None
    corrective_action_completed: bool = False

    attachments: Optional[List[FileAttachment]] = None
    notes: Optional[str] = None


class FacilityInspectionCreate(FacilityInspectionBase):
    pass


class FacilityInspectionUpdate(BaseModel):
    inspection_type: Optional[InspectionTypeEnum] = None
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None

    inspection_date: Optional[date] = None
    next_inspection_date: Optional[date] = None

    passed: Optional[bool] = None
    inspector_name: Optional[str] = Field(None, max_length=200)
    inspector_organization: Optional[str] = Field(None, max_length=200)
    certificate_number: Optional[str] = Field(None, max_length=100)

    findings: Optional[str] = None
    corrective_actions: Optional[str] = None
    corrective_action_deadline: Optional[date] = None
    corrective_action_completed: Optional[bool] = None

    attachments: Optional[List[FileAttachment]] = None
    notes: Optional[str] = None


class FacilityInspectionResponse(FacilityInspectionBase):
    id: str
    organization_id: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Utility Account Schemas
# =============================================================================

class FacilityUtilityAccountBase(BaseModel):
    facility_id: str
    utility_type: UtilityTypeEnum
    provider_name: str = Field(..., max_length=200)
    account_number: Optional[str] = Field(None, max_length=100)
    meter_number: Optional[str] = Field(None, max_length=100)
    contact_phone: Optional[str] = Field(None, max_length=50)
    contact_email: Optional[str] = Field(None, max_length=200)
    emergency_phone: Optional[str] = Field(None, max_length=50)
    billing_cycle: Optional[BillingCycleEnum] = BillingCycleEnum.MONTHLY
    notes: Optional[str] = None
    is_active: bool = True


class FacilityUtilityAccountCreate(FacilityUtilityAccountBase):
    pass


class FacilityUtilityAccountUpdate(BaseModel):
    facility_id: Optional[str] = None
    utility_type: Optional[UtilityTypeEnum] = None
    provider_name: Optional[str] = Field(None, max_length=200)
    account_number: Optional[str] = Field(None, max_length=100)
    meter_number: Optional[str] = Field(None, max_length=100)
    contact_phone: Optional[str] = Field(None, max_length=50)
    contact_email: Optional[str] = Field(None, max_length=200)
    emergency_phone: Optional[str] = Field(None, max_length=50)
    billing_cycle: Optional[BillingCycleEnum] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class FacilityUtilityAccountResponse(FacilityUtilityAccountBase):
    id: str
    organization_id: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Utility Reading Schemas
# =============================================================================

class FacilityUtilityReadingCreate(BaseModel):
    utility_account_id: str
    reading_date: date
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    amount: Optional[Decimal] = Field(None, ge=0)
    usage_quantity: Optional[Decimal] = None
    usage_unit: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None


class FacilityUtilityReadingUpdate(BaseModel):
    reading_date: Optional[date] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    amount: Optional[Decimal] = Field(None, ge=0)
    usage_quantity: Optional[Decimal] = None
    usage_unit: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None


class FacilityUtilityReadingResponse(BaseModel):
    id: str
    organization_id: str
    utility_account_id: str
    reading_date: date
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    amount: Optional[Decimal] = None
    usage_quantity: Optional[Decimal] = None
    usage_unit: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Access Key Schemas
# =============================================================================

class FacilityAccessKeyBase(BaseModel):
    facility_id: str
    key_type: KeyTypeEnum
    key_identifier: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=300)
    assigned_to_user_id: Optional[str] = None
    assigned_to_name: Optional[str] = Field(None, max_length=200)
    issued_date: Optional[date] = None
    returned_date: Optional[date] = None
    is_active: bool = True
    notes: Optional[str] = None


class FacilityAccessKeyCreate(FacilityAccessKeyBase):
    pass


class FacilityAccessKeyUpdate(BaseModel):
    facility_id: Optional[str] = None
    key_type: Optional[KeyTypeEnum] = None
    key_identifier: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=300)
    assigned_to_user_id: Optional[str] = None
    assigned_to_name: Optional[str] = Field(None, max_length=200)
    issued_date: Optional[date] = None
    returned_date: Optional[date] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class FacilityAccessKeyResponse(FacilityAccessKeyBase):
    id: str
    organization_id: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Room Schemas
# =============================================================================

class FacilityRoomBase(BaseModel):
    facility_id: str
    name: str = Field(..., max_length=200)
    room_number: Optional[str] = Field(None, max_length=50)
    floor: Optional[int] = None
    room_type: RoomTypeEnum = RoomTypeEnum.OTHER
    square_footage: Optional[int] = Field(None, ge=0)
    capacity: Optional[int] = Field(None, ge=0)
    description: Optional[str] = None
    equipment: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True


class FacilityRoomCreate(FacilityRoomBase):
    pass


class FacilityRoomUpdate(BaseModel):
    facility_id: Optional[str] = None
    name: Optional[str] = Field(None, max_length=200)
    room_number: Optional[str] = Field(None, max_length=50)
    floor: Optional[int] = None
    room_type: Optional[RoomTypeEnum] = None
    square_footage: Optional[int] = Field(None, ge=0)
    capacity: Optional[int] = Field(None, ge=0)
    description: Optional[str] = None
    equipment: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class FacilityRoomResponse(FacilityRoomBase):
    id: str
    organization_id: str
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Emergency Contact Schemas
# =============================================================================

class FacilityEmergencyContactBase(BaseModel):
    facility_id: str
    contact_type: EmergencyContactTypeEnum
    company_name: str = Field(..., max_length=200)
    contact_name: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=50)
    alt_phone: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=200)
    service_contract_number: Optional[str] = Field(None, max_length=100)
    priority: int = Field(default=1, ge=1)
    notes: Optional[str] = None
    is_active: bool = True


class FacilityEmergencyContactCreate(FacilityEmergencyContactBase):
    pass


class FacilityEmergencyContactUpdate(BaseModel):
    facility_id: Optional[str] = None
    contact_type: Optional[EmergencyContactTypeEnum] = None
    company_name: Optional[str] = Field(None, max_length=200)
    contact_name: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=50)
    alt_phone: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=200)
    service_contract_number: Optional[str] = Field(None, max_length=100)
    priority: Optional[int] = Field(None, ge=1)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class FacilityEmergencyContactResponse(FacilityEmergencyContactBase):
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Shutoff Location Schemas
# =============================================================================

class FacilityShutoffLocationCreate(BaseModel):
    facility_id: str
    shutoff_type: ShutoffTypeEnum
    location_description: str
    floor: Optional[int] = None
    notes: Optional[str] = None
    photo_path: Optional[str] = Field(None, max_length=500)


class FacilityShutoffLocationUpdate(BaseModel):
    facility_id: Optional[str] = None
    shutoff_type: Optional[ShutoffTypeEnum] = None
    location_description: Optional[str] = None
    floor: Optional[int] = None
    notes: Optional[str] = None
    photo_path: Optional[str] = Field(None, max_length=500)


class FacilityShutoffLocationResponse(BaseModel):
    id: str
    organization_id: str
    facility_id: str
    shutoff_type: ShutoffTypeEnum
    location_description: str
    floor: Optional[int] = None
    notes: Optional[str] = None
    photo_path: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Capital Project Schemas
# =============================================================================

class FacilityCapitalProjectBase(BaseModel):
    facility_id: str
    project_name: str = Field(..., max_length=300)
    description: Optional[str] = None
    project_type: CapitalProjectTypeEnum = CapitalProjectTypeEnum.OTHER
    project_status: CapitalProjectStatusEnum = CapitalProjectStatusEnum.PLANNING
    estimated_cost: Optional[Decimal] = Field(None, ge=0)
    actual_cost: Optional[Decimal] = Field(None, ge=0)
    budget_source: Optional[str] = Field(None, max_length=300)
    start_date: Optional[date] = None
    estimated_completion: Optional[date] = None
    actual_completion: Optional[date] = None
    contractor_name: Optional[str] = Field(None, max_length=200)
    contractor_phone: Optional[str] = Field(None, max_length=50)
    contractor_email: Optional[str] = Field(None, max_length=200)
    project_manager: Optional[str] = Field(None, max_length=200)
    permit_numbers: Optional[str] = None
    notes: Optional[str] = None
    attachments: Optional[List[FileAttachment]] = None


class FacilityCapitalProjectCreate(FacilityCapitalProjectBase):
    pass


class FacilityCapitalProjectUpdate(BaseModel):
    facility_id: Optional[str] = None
    project_name: Optional[str] = Field(None, max_length=300)
    description: Optional[str] = None
    project_type: Optional[CapitalProjectTypeEnum] = None
    project_status: Optional[CapitalProjectStatusEnum] = None
    estimated_cost: Optional[Decimal] = Field(None, ge=0)
    actual_cost: Optional[Decimal] = Field(None, ge=0)
    budget_source: Optional[str] = Field(None, max_length=300)
    start_date: Optional[date] = None
    estimated_completion: Optional[date] = None
    actual_completion: Optional[date] = None
    contractor_name: Optional[str] = Field(None, max_length=200)
    contractor_phone: Optional[str] = Field(None, max_length=50)
    contractor_email: Optional[str] = Field(None, max_length=200)
    project_manager: Optional[str] = Field(None, max_length=200)
    permit_numbers: Optional[str] = None
    notes: Optional[str] = None
    attachments: Optional[List[FileAttachment]] = None


class FacilityCapitalProjectResponse(FacilityCapitalProjectBase):
    id: str
    organization_id: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Insurance Policy Schemas
# =============================================================================

class FacilityInsurancePolicyBase(BaseModel):
    facility_id: str
    policy_type: InsurancePolicyTypeEnum
    policy_number: Optional[str] = Field(None, max_length=100)
    carrier_name: str = Field(..., max_length=200)
    agent_name: Optional[str] = Field(None, max_length=200)
    agent_phone: Optional[str] = Field(None, max_length=50)
    agent_email: Optional[str] = Field(None, max_length=200)
    coverage_amount: Optional[Decimal] = Field(None, ge=0)
    deductible: Optional[Decimal] = Field(None, ge=0)
    annual_premium: Optional[Decimal] = Field(None, ge=0)
    effective_date: Optional[date] = None
    expiration_date: Optional[date] = None
    notes: Optional[str] = None
    attachments: Optional[List[FileAttachment]] = None
    is_active: bool = True


class FacilityInsurancePolicyCreate(FacilityInsurancePolicyBase):
    pass


class FacilityInsurancePolicyUpdate(BaseModel):
    facility_id: Optional[str] = None
    policy_type: Optional[InsurancePolicyTypeEnum] = None
    policy_number: Optional[str] = Field(None, max_length=100)
    carrier_name: Optional[str] = Field(None, max_length=200)
    agent_name: Optional[str] = Field(None, max_length=200)
    agent_phone: Optional[str] = Field(None, max_length=50)
    agent_email: Optional[str] = Field(None, max_length=200)
    coverage_amount: Optional[Decimal] = Field(None, ge=0)
    deductible: Optional[Decimal] = Field(None, ge=0)
    annual_premium: Optional[Decimal] = Field(None, ge=0)
    effective_date: Optional[date] = None
    expiration_date: Optional[date] = None
    notes: Optional[str] = None
    attachments: Optional[List[FileAttachment]] = None
    is_active: Optional[bool] = None


class FacilityInsurancePolicyResponse(FacilityInsurancePolicyBase):
    id: str
    organization_id: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Occupant Schemas
# =============================================================================

class FacilityOccupantBase(BaseModel):
    facility_id: str
    unit_name: str = Field(..., max_length=200)
    description: Optional[str] = None
    contact_name: Optional[str] = Field(None, max_length=200)
    contact_phone: Optional[str] = Field(None, max_length=50)
    effective_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: bool = True
    notes: Optional[str] = None


class FacilityOccupantCreate(FacilityOccupantBase):
    pass


class FacilityOccupantUpdate(BaseModel):
    facility_id: Optional[str] = None
    unit_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    contact_name: Optional[str] = Field(None, max_length=200)
    contact_phone: Optional[str] = Field(None, max_length=50)
    effective_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class FacilityOccupantResponse(FacilityOccupantBase):
    id: str
    organization_id: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Compliance Checklist Schemas
# =============================================================================

class FacilityComplianceChecklistBase(BaseModel):
    facility_id: str
    checklist_name: str = Field(..., max_length=300)
    description: Optional[str] = None
    compliance_type: ComplianceTypeEnum
    due_date: Optional[date] = None


class FacilityComplianceChecklistCreate(FacilityComplianceChecklistBase):
    pass


class FacilityComplianceChecklistUpdate(BaseModel):
    facility_id: Optional[str] = None
    checklist_name: Optional[str] = Field(None, max_length=300)
    description: Optional[str] = None
    compliance_type: Optional[ComplianceTypeEnum] = None
    due_date: Optional[date] = None
    is_completed: Optional[bool] = None
    completed_date: Optional[date] = None


class FacilityComplianceChecklistResponse(FacilityComplianceChecklistBase):
    id: str
    organization_id: str
    is_completed: bool
    completed_date: Optional[date] = None
    completed_by: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config


# =============================================================================
# Facility Compliance Item Schemas
# =============================================================================

class FacilityComplianceItemCreate(BaseModel):
    checklist_id: str
    item_number: Optional[int] = None
    description: str
    is_compliant: Optional[bool] = None
    findings: Optional[str] = None
    corrective_action: Optional[str] = None
    corrective_action_deadline: Optional[date] = None
    corrective_action_completed: bool = False
    notes: Optional[str] = None


class FacilityComplianceItemUpdate(BaseModel):
    checklist_id: Optional[str] = None
    item_number: Optional[int] = None
    description: Optional[str] = None
    is_compliant: Optional[bool] = None
    findings: Optional[str] = None
    corrective_action: Optional[str] = None
    corrective_action_deadline: Optional[date] = None
    corrective_action_completed: Optional[bool] = None
    notes: Optional[str] = None


class FacilityComplianceItemResponse(BaseModel):
    id: str
    organization_id: str
    checklist_id: str
    item_number: Optional[int] = None
    description: str
    is_compliant: Optional[bool] = None
    findings: Optional[str] = None
    corrective_action: Optional[str] = None
    corrective_action_deadline: Optional[date] = None
    corrective_action_completed: bool
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = _response_config
