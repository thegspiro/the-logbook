"""
Apparatus Database Models

SQLAlchemy models for vehicle/apparatus management, tracking, and maintenance.
Supports fire engines, ambulances, utility vehicles, and custom apparatus types.
"""

from sqlalchemy import (
    CheckConstraint,
    Column,
    String,
    Boolean,
    DateTime,
    Date,
    Integer,
    Text,
    Enum,
    ForeignKey,
    Index,
    JSON,
    Numeric,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum

from app.core.utils import generate_uuid

from app.core.database import Base


# =============================================================================
# Enumerations
# =============================================================================

class ApparatusCategory(str, enum.Enum):
    """High-level apparatus categories"""
    FIRE = "fire"
    EMS = "ems"
    RESCUE = "rescue"
    SUPPORT = "support"
    COMMAND = "command"
    MARINE = "marine"
    AIRCRAFT = "aircraft"
    ADMIN = "admin"
    OTHER = "other"


class DefaultApparatusType(str, enum.Enum):
    """Default apparatus types (system-defined)"""
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


class DefaultApparatusStatus(str, enum.Enum):
    """Default apparatus statuses (system-defined)"""
    IN_SERVICE = "in_service"
    OUT_OF_SERVICE = "out_of_service"
    IN_MAINTENANCE = "in_maintenance"
    RESERVE = "reserve"
    ON_ORDER = "on_order"
    SOLD = "sold"
    DISPOSED = "disposed"


class FuelType(str, enum.Enum):
    """Fuel types"""
    GASOLINE = "gasoline"
    DIESEL = "diesel"
    ELECTRIC = "electric"
    HYBRID = "hybrid"
    PROPANE = "propane"
    CNG = "cng"  # Compressed Natural Gas
    OTHER = "other"


class CustomFieldType(str, enum.Enum):
    """Types for custom fields"""
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


class MaintenanceCategory(str, enum.Enum):
    """Categories for maintenance types"""
    PREVENTIVE = "preventive"
    REPAIR = "repair"
    INSPECTION = "inspection"
    CERTIFICATION = "certification"
    FLUID = "fluid"
    CLEANING = "cleaning"
    OTHER = "other"


class MaintenanceIntervalUnit(str, enum.Enum):
    """Units for maintenance intervals"""
    DAYS = "days"
    WEEKS = "weeks"
    MONTHS = "months"
    YEARS = "years"
    MILES = "miles"
    KILOMETERS = "kilometers"
    HOURS = "hours"


class ComponentType(str, enum.Enum):
    """Standard component areas of an apparatus"""
    ENGINE = "engine"
    PUMP = "pump"
    AERIAL = "aerial"
    CHASSIS = "chassis"
    DRIVETRAIN = "drivetrain"
    BRAKES = "brakes"
    ELECTRICAL = "electrical"
    HYDRAULIC = "hydraulic"
    BODY = "body"
    CAB = "cab"
    TANK = "tank"
    FOAM_SYSTEM = "foam_system"
    COOLING = "cooling"
    EXHAUST = "exhaust"
    LIGHTING = "lighting"
    COMMUNICATIONS = "communications"
    SAFETY_EQUIPMENT = "safety_equipment"
    HVAC = "hvac"
    TIRES_WHEELS = "tires_wheels"
    OTHER = "other"


class ComponentCondition(str, enum.Enum):
    """Condition rating for components"""
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    CRITICAL = "critical"


class NoteType(str, enum.Enum):
    """Types of component notes"""
    OBSERVATION = "observation"
    REPAIR = "repair"
    ISSUE = "issue"
    INSPECTION = "inspection"
    UPDATE = "update"


class NoteSeverity(str, enum.Enum):
    """Severity levels for notes"""
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class NoteStatus(str, enum.Enum):
    """Status of a component note/issue"""
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    DEFERRED = "deferred"


# =============================================================================
# Apparatus Type Model (Custom + System Types)
# =============================================================================

class ApparatusType(Base):
    """
    Apparatus Type model for categorizing vehicles

    Supports both system-defined types (engine, ladder, ambulance, etc.)
    and custom organization-defined types for specialty vehicles.
    """
    __tablename__ = "apparatus_types"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)

    # Type Details
    name = Column(String(100), nullable=False)  # Display name (e.g., "Engine", "Ladder Truck")
    code = Column(String(50), nullable=False)  # Short code (e.g., "ENG", "LAD")
    description = Column(Text, nullable=True)
    category = Column(Enum(ApparatusCategory, values_callable=lambda x: [e.value for e in x]), default=ApparatusCategory.FIRE, nullable=False)

    # System vs Custom
    is_system = Column(Boolean, default=False, nullable=False)  # System types can't be deleted
    default_type = Column(Enum(DefaultApparatusType, values_callable=lambda x: [e.value for e in x]), nullable=True)  # Maps to default type if system

    # Display
    icon = Column(String(50), nullable=True)  # Icon identifier for UI
    color = Column(String(20), nullable=True)  # Color code for UI
    sort_order = Column(Integer, default=0)  # Display order

    # Status
    is_active = Column(Boolean, default=True, nullable=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="apparatus_type")

    __table_args__ = (
        Index("idx_apparatus_types_org_code", "organization_id", "code", unique=True),
        Index("idx_apparatus_types_category", "category"),
        Index("idx_apparatus_types_is_system", "is_system"),
    )

    def __repr__(self):
        return f"<ApparatusType(name={self.name}, code={self.code})>"


# =============================================================================
# Apparatus Status Model (Custom + System Statuses)
# =============================================================================

class ApparatusStatus(Base):
    """
    Apparatus Status model for tracking vehicle availability

    Supports both system-defined statuses and custom organization-defined
    statuses for specific operational needs.
    """
    __tablename__ = "apparatus_statuses"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)

    # Status Details
    name = Column(String(100), nullable=False)  # Display name (e.g., "In Service")
    code = Column(String(50), nullable=False)  # Short code (e.g., "IS", "OOS")
    description = Column(Text, nullable=True)

    # System vs Custom
    is_system = Column(Boolean, default=False, nullable=False)
    default_status = Column(Enum(DefaultApparatusStatus, values_callable=lambda x: [e.value for e in x]), nullable=True)

    # Behavior flags
    is_available = Column(Boolean, default=True, nullable=False)  # Can respond to calls
    is_operational = Column(Boolean, default=True, nullable=False)  # Is functioning
    requires_reason = Column(Boolean, default=False, nullable=False)  # Needs explanation when set
    is_archived_status = Column(Boolean, default=False, nullable=False)  # Marks apparatus as archived (sold/disposed)

    # Display
    color = Column(String(20), nullable=True)  # Color code for UI (e.g., "green", "#00FF00")
    icon = Column(String(50), nullable=True)
    sort_order = Column(Integer, default=0)

    # Status
    is_active = Column(Boolean, default=True, nullable=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="status_record", foreign_keys="Apparatus.status_id")

    __table_args__ = (
        Index("idx_apparatus_statuses_org_code", "organization_id", "code", unique=True),
        Index("idx_apparatus_statuses_is_system", "is_system"),
        Index("idx_apparatus_statuses_is_available", "is_available"),
    )

    def __repr__(self):
        return f"<ApparatusStatus(name={self.name}, code={self.code})>"


# =============================================================================
# Main Apparatus Model
# =============================================================================

class Apparatus(Base):
    """
    Main Apparatus model for tracking department vehicles

    Comprehensive vehicle tracking including identification, specifications,
    purchase information, maintenance scheduling, and operational status.
    """
    __tablename__ = "apparatus"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # ===========================================
    # Identification
    # ===========================================
    unit_number = Column(String(50), nullable=False)  # Department unit number (e.g., "Engine 5", "Medic 1")
    name = Column(String(200), nullable=True)  # Optional friendly name (e.g., "Old Reliable")
    vin = Column(String(17), nullable=True)  # Vehicle Identification Number
    license_plate = Column(String(20), nullable=True)
    license_state = Column(String(50), nullable=True)
    radio_id = Column(String(50), nullable=True)  # Radio call sign
    asset_tag = Column(String(50), nullable=True)  # Internal asset tracking number

    # ===========================================
    # Type and Status
    # ===========================================
    apparatus_type_id = Column(String(36), ForeignKey("apparatus_types.id"), nullable=False, index=True)
    status_id = Column(String(36), ForeignKey("apparatus_statuses.id"), nullable=False, index=True)
    status_reason = Column(Text, nullable=True)  # Reason for current status (esp. if out of service)
    status_changed_at = Column(DateTime(timezone=True), nullable=True)
    status_changed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # ===========================================
    # Vehicle Specifications
    # ===========================================
    year = Column(Integer, nullable=True)
    make = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    body_manufacturer = Column(String(100), nullable=True)  # For fire apparatus (e.g., Pierce, E-ONE)
    color = Column(String(50), nullable=True)

    # Fuel
    fuel_type = Column(Enum(FuelType, values_callable=lambda x: [e.value for e in x]), default=FuelType.DIESEL, nullable=True)
    fuel_capacity_gallons = Column(Numeric(10, 2), nullable=True)

    # Capacity
    seating_capacity = Column(Integer, nullable=True)
    gvwr = Column(Integer, nullable=True)  # Gross Vehicle Weight Rating (lbs)

    # ===========================================
    # Fire/EMS Specific Specifications
    # ===========================================
    pump_capacity_gpm = Column(Integer, nullable=True)  # Pump capacity in GPM
    tank_capacity_gallons = Column(Integer, nullable=True)  # Water tank capacity
    foam_capacity_gallons = Column(Integer, nullable=True)  # Foam tank capacity
    ladder_length_feet = Column(Integer, nullable=True)  # Aerial ladder length

    # ===========================================
    # Location Assignment
    # ===========================================
    primary_station_id = Column(String(36), ForeignKey("locations.id"), nullable=True, index=True)
    current_location_id = Column(String(36), ForeignKey("locations.id"), nullable=True)  # Can differ from primary

    # ===========================================
    # Usage Tracking
    # ===========================================
    current_mileage = Column(Integer, nullable=True)
    current_hours = Column(Numeric(10, 2), nullable=True)  # Engine hours
    mileage_updated_at = Column(DateTime(timezone=True), nullable=True)
    hours_updated_at = Column(DateTime(timezone=True), nullable=True)

    # ===========================================
    # Purchase Information
    # ===========================================
    purchase_date = Column(Date, nullable=True)
    purchase_price = Column(Numeric(12, 2), nullable=True)
    purchase_vendor = Column(String(200), nullable=True)
    purchase_order_number = Column(String(100), nullable=True)
    in_service_date = Column(Date, nullable=True)  # When put into service

    # Financing
    is_financed = Column(Boolean, default=False)
    financing_company = Column(String(200), nullable=True)
    financing_end_date = Column(Date, nullable=True)
    monthly_payment = Column(Numeric(10, 2), nullable=True)

    # ===========================================
    # Value Tracking
    # ===========================================
    original_value = Column(Numeric(12, 2), nullable=True)
    current_value = Column(Numeric(12, 2), nullable=True)
    value_updated_at = Column(DateTime(timezone=True), nullable=True)
    depreciation_method = Column(String(50), nullable=True)  # straight_line, declining_balance, etc.
    depreciation_years = Column(Integer, nullable=True)
    salvage_value = Column(Numeric(12, 2), nullable=True)

    # ===========================================
    # Warranty Information
    # ===========================================
    warranty_expiration = Column(Date, nullable=True)
    extended_warranty_expiration = Column(Date, nullable=True)
    warranty_provider = Column(String(200), nullable=True)
    warranty_notes = Column(Text, nullable=True)

    # ===========================================
    # Insurance
    # ===========================================
    insurance_policy_number = Column(String(100), nullable=True)
    insurance_provider = Column(String(200), nullable=True)
    insurance_expiration = Column(Date, nullable=True)

    # ===========================================
    # Registration
    # ===========================================
    registration_expiration = Column(Date, nullable=True)
    inspection_expiration = Column(Date, nullable=True)

    # ===========================================
    # Sale/Disposal Information
    # ===========================================
    is_archived = Column(Boolean, default=False, nullable=False, index=True)  # Moved to "Previously Owned"
    archived_at = Column(DateTime(timezone=True), nullable=True)
    archived_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    sold_date = Column(Date, nullable=True)
    sold_price = Column(Numeric(12, 2), nullable=True)
    sold_to = Column(String(200), nullable=True)  # Buyer name
    sold_to_contact = Column(String(200), nullable=True)  # Buyer contact info

    disposal_date = Column(Date, nullable=True)
    disposal_method = Column(String(100), nullable=True)  # sold, traded, donated, scrapped, etc.
    disposal_reason = Column(Text, nullable=True)
    disposal_notes = Column(Text, nullable=True)

    # ===========================================
    # NFPA Compliance
    # ===========================================
    nfpa_tracking_enabled = Column(Boolean, default=False, nullable=False)

    # ===========================================
    # Custom Fields (JSON storage for user-defined fields)
    # ===========================================
    custom_field_values = Column(JSON, default=dict)

    # ===========================================
    # Notes and Description
    # ===========================================
    description = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    # ===========================================
    # Metadata
    # ===========================================
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # ===========================================
    # Relationships
    # ===========================================
    apparatus_type = relationship("ApparatusType", back_populates="apparatus")
    status_record = relationship("ApparatusStatus", back_populates="apparatus", foreign_keys=[status_id])
    primary_station = relationship("Location", foreign_keys=[primary_station_id])
    current_location = relationship("Location", foreign_keys=[current_location_id])

    # Related records
    photos = relationship("ApparatusPhoto", back_populates="apparatus", cascade="all, delete-orphan")
    documents = relationship("ApparatusDocument", back_populates="apparatus", cascade="all, delete-orphan")
    maintenance_records = relationship("ApparatusMaintenance", back_populates="apparatus", cascade="all, delete-orphan")
    fuel_logs = relationship("ApparatusFuelLog", back_populates="apparatus", cascade="all, delete-orphan")
    operators = relationship("ApparatusOperator", back_populates="apparatus", cascade="all, delete-orphan")
    equipment = relationship("ApparatusEquipment", back_populates="apparatus", cascade="all, delete-orphan")
    location_history = relationship("ApparatusLocationHistory", back_populates="apparatus", cascade="all, delete-orphan")
    status_history = relationship("ApparatusStatusHistory", back_populates="apparatus", cascade="all, delete-orphan")
    components = relationship("ApparatusComponent", back_populates="apparatus", cascade="all, delete-orphan")
    component_notes = relationship("ApparatusComponentNote", back_populates="apparatus", cascade="all, delete-orphan")
    nfpa_compliance = relationship("ApparatusNFPACompliance", back_populates="apparatus", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_apparatus_org_unit", "organization_id", "unit_number", unique=True),
        Index("idx_apparatus_org_type", "organization_id", "apparatus_type_id"),
        Index("idx_apparatus_org_status", "organization_id", "status_id"),
        Index("idx_apparatus_org_station", "organization_id", "primary_station_id"),
        Index("idx_apparatus_vin", "organization_id", "vin", unique=True),
        Index("idx_apparatus_is_archived", "is_archived"),
    )

    def __repr__(self):
        return f"<Apparatus(unit_number={self.unit_number}, type={self.apparatus_type_id})>"

    @property
    def display_name(self) -> str:
        """Get display name (unit number or friendly name)"""
        return self.name if self.name else self.unit_number

    @property
    def full_description(self) -> str:
        """Get full vehicle description"""
        parts = []
        if self.year:
            parts.append(str(self.year))
        if self.make:
            parts.append(self.make)
        if self.model:
            parts.append(self.model)
        return " ".join(parts) if parts else self.unit_number


# =============================================================================
# Apparatus Custom Field Definition
# =============================================================================

class ApparatusCustomField(Base):
    """
    Custom field definitions for apparatus

    Allows organizations to define their own tracking fields beyond
    the standard apparatus fields.
    """
    __tablename__ = "apparatus_custom_fields"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Field Definition
    name = Column(String(100), nullable=False)  # Display name
    field_key = Column(String(100), nullable=False)  # Unique key for storage
    description = Column(Text, nullable=True)
    field_type = Column(Enum(CustomFieldType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=CustomFieldType.TEXT)

    # Configuration
    is_required = Column(Boolean, default=False, nullable=False)
    default_value = Column(Text, nullable=True)  # Default value as string
    placeholder = Column(String(200), nullable=True)  # Input placeholder

    # For SELECT and MULTI_SELECT types
    options = Column(JSON, nullable=True)  # Array of {value, label} objects

    # Validation
    min_value = Column(Numeric(20, 6), nullable=True)  # For number fields
    max_value = Column(Numeric(20, 6), nullable=True)
    min_length = Column(Integer, nullable=True)  # For text fields
    max_length = Column(Integer, nullable=True)
    regex_pattern = Column(String(500), nullable=True)  # Custom validation pattern

    # Applicability
    applies_to_types = Column(JSON, nullable=True)  # Array of apparatus_type_ids (null = all types)

    # Display
    sort_order = Column(Integer, default=0)
    show_in_list = Column(Boolean, default=False, nullable=False)  # Show in apparatus list view
    show_in_detail = Column(Boolean, default=True, nullable=False)  # Show in detail view

    # Status
    is_active = Column(Boolean, default=True, nullable=False)

    # Timestamps
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_apparatus_custom_fields_org_key", "organization_id", "field_key", unique=True),
        Index("idx_apparatus_custom_fields_org_active", "organization_id", "is_active"),
    )

    def __repr__(self):
        return f"<ApparatusCustomField(name={self.name}, type={self.field_type})>"


# =============================================================================
# Apparatus Photo
# =============================================================================

class ApparatusPhoto(Base):
    """
    Photos associated with apparatus

    Supports multiple photos per apparatus with metadata for
    tracking deterioration, damage documentation, etc.
    """
    __tablename__ = "apparatus_photos"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)

    # File Information
    file_path = Column(Text, nullable=False)  # Path in storage system
    file_name = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=True)  # Size in bytes
    mime_type = Column(String(100), nullable=True)

    # Photo Details
    title = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    taken_at = Column(DateTime(timezone=True), nullable=True)  # When photo was taken

    # Classification
    photo_type = Column(String(50), nullable=True)  # exterior, interior, damage, detail, etc.
    is_primary = Column(Boolean, default=False, nullable=False)  # Primary display photo

    # Timestamps
    uploaded_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="photos")

    __table_args__ = (
        Index("idx_apparatus_photos_apparatus", "apparatus_id"),
        Index("idx_apparatus_photos_is_primary", "apparatus_id", "is_primary"),
    )

    def __repr__(self):
        return f"<ApparatusPhoto(apparatus_id={self.apparatus_id}, file_name={self.file_name})>"


# =============================================================================
# Apparatus Document
# =============================================================================

class ApparatusDocument(Base):
    """
    Documents associated with apparatus

    Stores titles, registrations, manuals, inspection reports,
    and other documentation.
    """
    __tablename__ = "apparatus_documents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)

    # File Information
    file_path = Column(Text, nullable=False)
    file_name = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)

    # Document Details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    document_type = Column(String(50), nullable=False)  # title, registration, insurance, manual, inspection, etc.

    # Expiration (for documents that expire)
    expiration_date = Column(Date, nullable=True)

    # Timestamps
    document_date = Column(Date, nullable=True)  # Date of the document itself
    uploaded_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="documents")

    __table_args__ = (
        Index("idx_apparatus_documents_apparatus", "apparatus_id"),
        Index("idx_apparatus_documents_type", "apparatus_id", "document_type"),
        Index("idx_apparatus_documents_expiration", "expiration_date"),
    )

    def __repr__(self):
        return f"<ApparatusDocument(apparatus_id={self.apparatus_id}, title={self.title})>"


# =============================================================================
# Apparatus Maintenance Type
# =============================================================================

class ApparatusMaintenanceType(Base):
    """
    Maintenance type definitions

    Supports both system-defined maintenance types (oil change, pump test)
    and custom organization-defined types (custom fluid checks, etc.)
    """
    __tablename__ = "apparatus_maintenance_types"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)

    # Type Details
    name = Column(String(100), nullable=False)
    code = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(Enum(MaintenanceCategory, values_callable=lambda x: [e.value for e in x]), default=MaintenanceCategory.PREVENTIVE, nullable=False)

    # System vs Custom
    is_system = Column(Boolean, default=False, nullable=False)

    # Scheduling
    default_interval_value = Column(Integer, nullable=True)  # e.g., 3 (for "every 3 months")
    default_interval_unit = Column(Enum(MaintenanceIntervalUnit, values_callable=lambda x: [e.value for e in x]), nullable=True)  # e.g., "months"
    default_interval_miles = Column(Integer, nullable=True)  # Alternative: every X miles
    default_interval_hours = Column(Integer, nullable=True)  # Alternative: every X engine hours

    # NFPA
    is_nfpa_required = Column(Boolean, default=False, nullable=False)
    nfpa_reference = Column(String(100), nullable=True)  # e.g., "NFPA 1911 Section 5.2"

    # Applicability
    applies_to_types = Column(JSON, nullable=True)  # Array of apparatus_type_ids

    # Display
    sort_order = Column(Integer, default=0)

    # Status
    is_active = Column(Boolean, default=True, nullable=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    maintenance_records = relationship("ApparatusMaintenance", back_populates="maintenance_type")

    __table_args__ = (
        Index("idx_apparatus_maint_types_org_code", "organization_id", "code", unique=True),
        Index("idx_apparatus_maint_types_category", "category"),
        Index("idx_apparatus_maint_types_is_system", "is_system"),
    )

    def __repr__(self):
        return f"<ApparatusMaintenanceType(name={self.name}, code={self.code})>"


# =============================================================================
# Apparatus Maintenance Record
# =============================================================================

class ApparatusMaintenance(Base):
    """
    Maintenance records for apparatus

    Tracks scheduled and unscheduled maintenance, repairs,
    inspections, and certifications.
    """
    __tablename__ = "apparatus_maintenance"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)
    maintenance_type_id = Column(String(36), ForeignKey("apparatus_maintenance_types.id"), nullable=False, index=True)
    component_id = Column(String(36), ForeignKey("apparatus_components.id", ondelete="SET NULL"), nullable=True, index=True)
    service_provider_id = Column(String(36), ForeignKey("apparatus_service_providers.id", ondelete="SET NULL"), nullable=True, index=True)

    # Scheduling
    scheduled_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)

    # Completion
    completed_date = Column(Date, nullable=True)
    completed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # If internal
    performed_by = Column(String(200), nullable=True)  # External vendor/person name

    # Status
    is_completed = Column(Boolean, default=False, nullable=False)
    is_overdue = Column(Boolean, default=False, nullable=False)

    # Details
    description = Column(Text, nullable=True)
    work_performed = Column(Text, nullable=True)
    findings = Column(Text, nullable=True)  # Inspection findings

    # Readings at time of service
    mileage_at_service = Column(Integer, nullable=True)
    hours_at_service = Column(Numeric(10, 2), nullable=True)

    # Cost
    cost = Column(Numeric(10, 2), nullable=True)
    vendor = Column(String(200), nullable=True)
    invoice_number = Column(String(100), nullable=True)

    # Next Service
    next_due_date = Column(Date, nullable=True)
    next_due_mileage = Column(Integer, nullable=True)
    next_due_hours = Column(Numeric(10, 2), nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Timestamps
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="maintenance_records")
    maintenance_type = relationship("ApparatusMaintenanceType", back_populates="maintenance_records")
    component = relationship("ApparatusComponent", back_populates="maintenance_records")
    service_provider = relationship("ApparatusServiceProvider", back_populates="maintenance_records")

    __table_args__ = (
        Index("idx_apparatus_maint_apparatus", "apparatus_id"),
        Index("idx_apparatus_maint_type", "maintenance_type_id"),
        Index("idx_apparatus_maint_component", "component_id"),
        Index("idx_apparatus_maint_provider", "service_provider_id"),
        Index("idx_apparatus_maint_due_date", "due_date"),
        Index("idx_apparatus_maint_completed", "is_completed"),
        Index("idx_apparatus_maint_overdue", "is_overdue"),
    )

    def __repr__(self):
        return f"<ApparatusMaintenance(apparatus_id={self.apparatus_id}, type={self.maintenance_type_id})>"


# =============================================================================
# Apparatus Fuel Log
# =============================================================================

class ApparatusFuelLog(Base):
    """
    Fuel purchase and usage log for apparatus
    """
    __tablename__ = "apparatus_fuel_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)

    # Fuel Details
    fuel_date = Column(DateTime(timezone=True), nullable=False)
    fuel_type = Column(Enum(FuelType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    gallons = Column(Numeric(10, 3), nullable=False)
    price_per_gallon = Column(Numeric(6, 3), nullable=True)
    total_cost = Column(Numeric(10, 2), nullable=True)

    # Readings
    mileage_at_fill = Column(Integer, nullable=True)
    hours_at_fill = Column(Numeric(10, 2), nullable=True)

    # Fill Details
    is_full_tank = Column(Boolean, default=True, nullable=False)
    station_name = Column(String(200), nullable=True)
    station_address = Column(Text, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Timestamps
    recorded_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="fuel_logs")

    __table_args__ = (
        Index("idx_apparatus_fuel_apparatus", "apparatus_id"),
        Index("idx_apparatus_fuel_date", "fuel_date"),
    )

    def __repr__(self):
        return f"<ApparatusFuelLog(apparatus_id={self.apparatus_id}, gallons={self.gallons})>"


# =============================================================================
# Apparatus Operator
# =============================================================================

class ApparatusOperator(Base):
    """
    Tracks which personnel are certified/qualified to operate apparatus

    Includes custom restrictions (parade only, daylight only, etc.)
    """
    __tablename__ = "apparatus_operators"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Certification
    is_certified = Column(Boolean, default=True, nullable=False)
    certification_date = Column(Date, nullable=True)
    certification_expiration = Column(Date, nullable=True)
    certified_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # License Requirements
    license_type_required = Column(String(50), nullable=True)  # CDL, Class B, etc.
    license_verified = Column(Boolean, default=False, nullable=False)
    license_verified_date = Column(Date, nullable=True)

    # Restrictions
    has_restrictions = Column(Boolean, default=False, nullable=False)
    restrictions = Column(JSON, nullable=True)  # Array of restriction objects
    restriction_notes = Column(Text, nullable=True)

    # Status
    is_active = Column(Boolean, default=True, nullable=False)

    # Notes
    notes = Column(Text, nullable=True)

    # Timestamps
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="operators")
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("idx_apparatus_operators_apparatus", "apparatus_id"),
        Index("idx_apparatus_operators_user", "user_id"),
        Index("idx_apparatus_operators_apparatus_user", "apparatus_id", "user_id", unique=True),
        Index("idx_apparatus_operators_active", "is_active"),
    )

    def __repr__(self):
        return f"<ApparatusOperator(apparatus_id={self.apparatus_id}, user_id={self.user_id})>"


# =============================================================================
# Apparatus Equipment
# =============================================================================

class ApparatusEquipment(Base):
    """
    Equipment assigned to apparatus

    Links to inventory items and tracks what equipment is
    mounted or carried on each apparatus.
    """
    __tablename__ = "apparatus_equipment"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)

    # Equipment Details (can be linked or standalone)
    inventory_item_id = Column(String(36), nullable=True)  # Optional link to inventory

    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    quantity = Column(Integer, default=1, nullable=False)

    # Location on apparatus
    location_on_apparatus = Column(String(200), nullable=True)  # e.g., "Driver side compartment 3"

    # Type
    is_mounted = Column(Boolean, default=False, nullable=False)  # Permanently mounted vs removable
    is_required = Column(Boolean, default=False, nullable=False)  # Required to be on apparatus

    # Tracking
    serial_number = Column(String(100), nullable=True)
    asset_tag = Column(String(50), nullable=True)

    # Status
    is_present = Column(Boolean, default=True, nullable=False)  # Currently on apparatus

    # Notes
    notes = Column(Text, nullable=True)

    # Timestamps
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())
    assigned_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="equipment")

    __table_args__ = (
        Index("idx_apparatus_equipment_apparatus", "apparatus_id"),
        Index("idx_apparatus_equipment_inventory", "inventory_item_id"),
    )

    def __repr__(self):
        return f"<ApparatusEquipment(apparatus_id={self.apparatus_id}, name={self.name})>"


# =============================================================================
# Apparatus Location History
# =============================================================================

class ApparatusLocationHistory(Base):
    """
    History of station/location assignments for apparatus
    """
    __tablename__ = "apparatus_location_history"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = Column(String(36), ForeignKey("locations.id"), nullable=False, index=True)

    # Assignment Period
    assigned_date = Column(DateTime(timezone=True), nullable=False)
    unassigned_date = Column(DateTime(timezone=True), nullable=True)  # Null if current

    # Reason
    assignment_reason = Column(Text, nullable=True)

    # Timestamps
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="location_history")
    location = relationship("Location")

    __table_args__ = (
        Index("idx_apparatus_loc_hist_apparatus", "apparatus_id"),
        Index("idx_apparatus_loc_hist_location", "location_id"),
        Index("idx_apparatus_loc_hist_dates", "assigned_date", "unassigned_date"),
    )

    def __repr__(self):
        return f"<ApparatusLocationHistory(apparatus_id={self.apparatus_id}, location_id={self.location_id})>"


# =============================================================================
# Apparatus Status History
# =============================================================================

class ApparatusStatusHistory(Base):
    """
    History of status changes for apparatus
    """
    __tablename__ = "apparatus_status_history"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)
    status_id = Column(String(36), ForeignKey("apparatus_statuses.id"), nullable=False, index=True)

    # Status Change Details
    changed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reason = Column(Text, nullable=True)

    # Readings at time of change
    mileage_at_change = Column(Integer, nullable=True)
    hours_at_change = Column(Numeric(10, 2), nullable=True)

    # Timestamps
    changed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    apparatus = relationship("Apparatus", back_populates="status_history")
    status = relationship("ApparatusStatus")

    __table_args__ = (
        Index("idx_apparatus_status_hist_apparatus", "apparatus_id"),
        Index("idx_apparatus_status_hist_status", "status_id"),
        Index("idx_apparatus_status_hist_changed", "changed_at"),
    )

    def __repr__(self):
        return f"<ApparatusStatusHistory(apparatus_id={self.apparatus_id}, status_id={self.status_id})>"


# =============================================================================
# NFPA Compliance Item (Optional Tracking)
# =============================================================================

class ApparatusNFPACompliance(Base):
    """
    NFPA compliance tracking for apparatus

    Only used when nfpa_tracking_enabled is True for the apparatus.
    """
    __tablename__ = "apparatus_nfpa_compliance"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)

    # NFPA Standard
    standard_code = Column(String(50), nullable=False)  # e.g., "NFPA 1911"
    section_reference = Column(String(100), nullable=False)  # e.g., "Section 5.2.1"
    requirement_description = Column(Text, nullable=False)

    # Compliance Status
    is_compliant = Column(Boolean, default=False, nullable=False)
    compliance_status = Column(String(50), default="pending")  # compliant, non_compliant, pending, exempt

    # Last Check
    last_checked_date = Column(Date, nullable=True)
    last_checked_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Next Due
    next_due_date = Column(Date, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)
    exemption_reason = Column(Text, nullable=True)  # If exempt

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="nfpa_compliance")

    __table_args__ = (
        Index("idx_apparatus_nfpa_apparatus", "apparatus_id"),
        Index("idx_apparatus_nfpa_standard", "standard_code"),
        Index("idx_apparatus_nfpa_status", "compliance_status"),
        Index("idx_apparatus_nfpa_due", "next_due_date"),
    )

    def __repr__(self):
        return f"<ApparatusNFPACompliance(apparatus_id={self.apparatus_id}, standard={self.standard_code})>"


# =============================================================================
# Apparatus Report Configuration
# =============================================================================

class ApparatusReportConfig(Base):
    """
    Configuration for scheduled and custom apparatus reports
    """
    __tablename__ = "apparatus_report_configs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Report Details
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    report_type = Column(String(50), nullable=False)  # fleet_status, maintenance, cost_analysis, custom

    # Schedule
    is_scheduled = Column(Boolean, default=False, nullable=False)
    schedule_frequency = Column(String(50), nullable=True)  # daily, weekly, monthly, quarterly, yearly
    schedule_day = Column(Integer, nullable=True)  # For weekly: day of week (1=Mon..7=Sun); for monthly: day of month (1-31)
    next_run_date = Column(DateTime(timezone=True), nullable=True)
    last_run_date = Column(DateTime(timezone=True), nullable=True)

    # Data Range
    data_range_type = Column(String(50), nullable=True)  # last_month, since_last_report, last_year, since_purchase, custom
    data_range_days = Column(Integer, nullable=True)  # For custom range

    # Filters
    include_apparatus_ids = Column(JSON, nullable=True)  # Specific apparatus to include (null = all)
    include_type_ids = Column(JSON, nullable=True)  # Specific types to include
    include_status_ids = Column(JSON, nullable=True)  # Specific statuses to include
    include_archived = Column(Boolean, default=False, nullable=False)

    # Report Fields
    fields_to_include = Column(JSON, nullable=True)  # Array of field names to include
    group_by = Column(String(100), nullable=True)  # Field to group by
    sort_by = Column(String(100), nullable=True)  # Field to sort by
    sort_direction = Column(String(10), default="asc")  # asc or desc

    # Output
    output_format = Column(String(50), default="pdf")  # pdf, csv, excel

    # Recipients
    email_recipients = Column(JSON, nullable=True)  # Array of email addresses or user_ids

    # Status
    is_active = Column(Boolean, default=True, nullable=False)

    # Timestamps
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_apparatus_report_configs_org", "organization_id"),
        Index("idx_apparatus_report_configs_scheduled", "is_scheduled"),
        Index("idx_apparatus_report_configs_next_run", "next_run_date"),
    )

    def __repr__(self):
        return f"<ApparatusReportConfig(name={self.name}, type={self.report_type})>"


# =============================================================================
# Service Provider
# =============================================================================

class ApparatusServiceProvider(Base):
    """
    Service providers (companies or individuals) who perform maintenance,
    repairs, and inspections on apparatus.
    """
    __tablename__ = "apparatus_service_providers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Provider Identity
    name = Column(String(200), nullable=False)  # Business or person name
    company_name = Column(String(200), nullable=True)  # If name is a contact person
    contact_name = Column(String(200), nullable=True)

    # Contact Information
    phone = Column(String(50), nullable=True)
    email = Column(String(200), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(50), nullable=True)
    zip_code = Column(String(20), nullable=True)
    website = Column(String(300), nullable=True)

    # Capabilities
    specialties = Column(JSON, nullable=True)  # List of ComponentType values they service
    certifications = Column(JSON, nullable=True)  # List of certifications held
    is_emergency_service = Column(Boolean, default=False, nullable=False)  # Available for emergency repairs

    # Business Details
    license_number = Column(String(100), nullable=True)
    insurance_info = Column(Text, nullable=True)
    tax_id = Column(String(50), nullable=True)

    # Preference
    is_preferred = Column(Boolean, default=False, nullable=False)
    rating = Column(Integer, nullable=True)  # 1-5 star rating

    # Notes
    notes = Column(Text, nullable=True)
    contract_info = Column(Text, nullable=True)  # Contract terms, SLAs, etc.

    # Status
    is_active = Column(Boolean, default=True, nullable=False)

    # Archive (soft-delete for compliance — providers are never hard-deleted)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    archived_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Timestamps
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    maintenance_records = relationship("ApparatusMaintenance", back_populates="service_provider")
    component_notes = relationship("ApparatusComponentNote", back_populates="service_provider")

    __table_args__ = (
        Index("idx_service_providers_org", "organization_id"),
        Index("idx_service_providers_org_name", "organization_id", "name"),
        Index("idx_service_providers_preferred", "organization_id", "is_preferred"),
        Index("idx_service_providers_active", "organization_id", "is_active"),
        CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name="ck_service_provider_rating"),
    )

    def __repr__(self):
        return f"<ApparatusServiceProvider(name={self.name})>"


# =============================================================================
# Apparatus Component (Vehicle Sub-System Segmentation)
# =============================================================================

class ApparatusComponent(Base):
    """
    Segments an apparatus into logical components (engine, pump, aerial, etc.)
    for targeted maintenance tracking and service notes.

    Each apparatus can have system-default components plus custom ones.
    """
    __tablename__ = "apparatus_components"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)

    # Component Identity
    name = Column(String(200), nullable=False)  # e.g., "Main Engine", "Pump Assembly"
    component_type = Column(
        Enum(ComponentType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ComponentType.OTHER,
    )
    description = Column(Text, nullable=True)

    # Manufacturer Details
    manufacturer = Column(String(200), nullable=True)
    model_number = Column(String(100), nullable=True)
    serial_number = Column(String(100), nullable=True)

    # Lifecycle
    install_date = Column(Date, nullable=True)
    warranty_expiration = Column(Date, nullable=True)
    expected_life_years = Column(Integer, nullable=True)

    # Condition
    condition = Column(
        Enum(ComponentCondition, values_callable=lambda x: [e.value for e in x]),
        default=ComponentCondition.GOOD,
        nullable=False,
    )
    last_serviced_date = Column(Date, nullable=True)
    last_inspected_date = Column(Date, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Display
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True, nullable=False)

    # Archive (soft-delete)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    archived_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Timestamps
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    apparatus = relationship("Apparatus", back_populates="components")
    component_notes = relationship("ApparatusComponentNote", back_populates="component", cascade="all, delete-orphan")
    maintenance_records = relationship("ApparatusMaintenance", back_populates="component")

    __table_args__ = (
        Index("idx_apparatus_components_apparatus", "apparatus_id"),
        Index("idx_apparatus_components_type", "apparatus_id", "component_type"),
        Index("idx_apparatus_components_condition", "condition"),
    )

    def __repr__(self):
        return f"<ApparatusComponent(apparatus_id={self.apparatus_id}, name={self.name})>"


# =============================================================================
# Component Note (Per-Component Service Notes / Issues)
# =============================================================================

class ApparatusComponentNote(Base):
    """
    Notes, observations, issues, and repair records tied to a specific
    apparatus component. Provides the apparatus coordinator with a
    detailed service history per component area.
    """
    __tablename__ = "apparatus_component_notes"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    apparatus_id = Column(String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False, index=True)
    component_id = Column(String(36), ForeignKey("apparatus_components.id", ondelete="CASCADE"), nullable=False, index=True)

    # Note Details
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=False)
    note_type = Column(
        Enum(NoteType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NoteType.OBSERVATION,
    )
    severity = Column(
        Enum(NoteSeverity, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NoteSeverity.INFO,
    )
    status = Column(
        Enum(NoteStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NoteStatus.OPEN,
    )

    # Service Provider (who did or will do the work)
    service_provider_id = Column(String(36), ForeignKey("apparatus_service_providers.id", ondelete="SET NULL"), nullable=True)

    # Cost tracking
    estimated_cost = Column(Numeric(10, 2), nullable=True)
    actual_cost = Column(Numeric(10, 2), nullable=True)

    # Resolution
    reported_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolution_notes = Column(Text, nullable=True)

    # Attachments (file references stored as JSON array)
    attachments = Column(JSON, nullable=True)  # [{file_path, file_name, mime_type}]

    # Tags for categorization
    tags = Column(JSON, nullable=True)  # ["warranty_claim", "recurring", "safety"]

    # Timestamps
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    component = relationship("ApparatusComponent", back_populates="component_notes")
    apparatus = relationship("Apparatus", back_populates="component_notes")
    service_provider = relationship("ApparatusServiceProvider", back_populates="component_notes")

    __table_args__ = (
        Index("idx_component_notes_apparatus", "apparatus_id"),
        Index("idx_component_notes_component", "component_id"),
        Index("idx_component_notes_status", "status"),
        Index("idx_component_notes_severity", "severity"),
        Index("idx_component_notes_type", "note_type"),
        Index("idx_component_notes_provider", "service_provider_id"),
    )
