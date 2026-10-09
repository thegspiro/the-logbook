"""
Apparatus Database Models

SQLAlchemy models for vehicle/apparatus management, tracking, and maintenance.
Supports fire engines, ambulances, utility vehicles, and custom apparatus types.
"""

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, backref, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.location import Location
    from app.models.training import TrainingProgram
    from app.models.user import User

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Type Details
    name: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # Display name (e.g., "Engine", "Ladder Truck")
    code: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # Short code (e.g., "ENG", "LAD")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[ApparatusCategory] = mapped_column(
        Enum(ApparatusCategory, values_callable=lambda x: [e.value for e in x]),
        default=ApparatusCategory.FIRE,
        nullable=False,
        server_default="fire",
    )

    # System vs Custom
    is_system: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # System types can't be deleted
    default_type: Mapped[Optional[DefaultApparatusType]] = mapped_column(
        Enum(DefaultApparatusType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )  # Maps to default type if system

    # Display
    icon: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # Icon identifier for UI
    color: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # Color code for UI
    sort_order: Mapped[Optional[int]] = mapped_column(
        Integer, default=0
    )  # Display order

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    apparatus: Mapped[list["Apparatus"]] = relationship(
        "Apparatus", back_populates="apparatus_type"
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Status Details
    name: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # Display name (e.g., "In Service")
    code: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # Short code (e.g., "IS", "OOS")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # System vs Custom
    is_system: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    default_status: Mapped[Optional[DefaultApparatusStatus]] = mapped_column(
        Enum(DefaultApparatusStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )

    # Behavior flags
    is_available: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )  # Can respond to calls
    is_operational: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )  # Is functioning
    requires_reason: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # Needs explanation when set
    is_archived_status: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # Marks apparatus as archived (sold/disposed)

    # Display
    color: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # Color code for UI (e.g., "green", "#00FF00")
    icon: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    apparatus: Mapped[list["Apparatus"]] = relationship(
        "Apparatus", back_populates="status_record", foreign_keys="Apparatus.status_id"
    )

    __table_args__ = (
        Index(
            "idx_apparatus_statuses_org_code", "organization_id", "code", unique=True
        ),
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # ===========================================
    # Identification
    # ===========================================
    unit_number: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # Department unit number (e.g., "Engine 5", "Medic 1")
    name: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # Optional friendly name (e.g., "Old Reliable")
    vin: Mapped[Optional[str]] = mapped_column(
        String(17), nullable=True
    )  # Vehicle Identification Number
    license_plate: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    license_state: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    radio_id: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # Radio call sign
    asset_tag: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # Internal asset tracking number

    # ===========================================
    # Type and Status
    # ===========================================
    apparatus_type_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus_types.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus_statuses.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status_reason: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # Reason for current status (esp. if out of service)
    status_changed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status_changed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # ===========================================
    # Vehicle Specifications
    # ===========================================
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    make: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    body_manufacturer: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # For fire apparatus (e.g., Pierce, E-ONE)
    color: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Fuel. No default: the add form leaves it unset until the officer picks
    # one, and a default recorded every such apparatus as diesel.
    fuel_type: Mapped[Optional[FuelType]] = mapped_column(
        Enum(FuelType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    fuel_capacity_gallons: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )

    # Capacity
    seating_capacity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    gvwr: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Gross Vehicle Weight Rating (lbs)

    # Staffing
    min_staffing: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False, server_default="1"
    )
    crew_positions: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)

    # EVOC level required to drive this apparatus
    required_evoc_level_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("evoc_levels.id", ondelete="SET NULL"),
        nullable=True,
    )

    # ===========================================
    # Fire/EMS Specific Specifications
    # ===========================================
    pump_capacity_gpm: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Pump capacity in GPM
    tank_capacity_gallons: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Water tank capacity
    foam_capacity_gallons: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Foam tank capacity
    ladder_length_feet: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Aerial ladder length

    # ===========================================
    # Location Assignment
    # ===========================================
    primary_station_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("locations.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    current_location_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=True
    )  # Can differ from primary

    # ===========================================
    # Usage Tracking
    # ===========================================
    current_mileage: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    current_hours: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )  # Engine hours
    mileage_updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hours_updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ===========================================
    # Purchase Information
    # ===========================================
    purchase_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    purchase_price: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    purchase_vendor: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    purchase_order_number: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )
    in_service_date: Mapped[Optional[date]] = mapped_column(
        Date, nullable=True
    )  # When put into service

    # Financing
    is_financed: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    financing_company: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    financing_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    monthly_payment: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )

    # ===========================================
    # Value Tracking
    # ===========================================
    original_value: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    current_value: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    value_updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    depreciation_method: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # straight_line, declining_balance, etc.
    depreciation_years: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    salvage_value: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )

    # ===========================================
    # Warranty Information
    # ===========================================
    warranty_expiration: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    extended_warranty_expiration: Mapped[Optional[date]] = mapped_column(
        Date, nullable=True
    )
    warranty_provider: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    warranty_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ===========================================
    # Insurance
    # ===========================================
    insurance_policy_number: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )
    insurance_provider: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    insurance_expiration: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # ===========================================
    # Registration
    # ===========================================
    registration_expiration: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    inspection_expiration: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # ===========================================
    # Sale/Disposal Information
    # ===========================================
    is_archived: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # Moved to "Previously Owned"
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    archived_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    sold_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    sold_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    sold_to: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # Buyer name
    sold_to_contact: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # Buyer contact info

    disposal_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    disposal_method: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # sold, traded, donated, scrapped, etc.
    disposal_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    disposal_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ===========================================
    # NFPA Compliance
    # ===========================================
    nfpa_tracking_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # ===========================================
    # Equipment Check Deficiency Tracking
    # ===========================================
    has_deficiency: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    deficiency_since: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ===========================================
    # Custom Fields (JSON storage for user-defined fields)
    # ===========================================
    custom_field_values: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, default=dict
    )

    # ===========================================
    # Notes and Description
    # ===========================================
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ===========================================
    # Metadata
    # ===========================================
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # ===========================================
    # Relationships
    # ===========================================
    apparatus_type: Mapped["ApparatusType"] = relationship(
        "ApparatusType", back_populates="apparatus"
    )
    status_record: Mapped["ApparatusStatus"] = relationship(
        "ApparatusStatus", back_populates="apparatus", foreign_keys=[status_id]
    )
    primary_station: Mapped[Optional["Location"]] = relationship(
        "Location", foreign_keys=[primary_station_id]
    )
    current_location: Mapped[Optional["Location"]] = relationship(
        "Location", foreign_keys=[current_location_id]
    )
    required_evoc_level: Mapped[Optional["EvocLevel"]] = relationship(
        "EvocLevel", foreign_keys=[required_evoc_level_id]
    )

    # Related records
    photos: Mapped[list["ApparatusPhoto"]] = relationship(
        "ApparatusPhoto", back_populates="apparatus", cascade="all, delete-orphan"
    )
    documents: Mapped[list["ApparatusDocument"]] = relationship(
        "ApparatusDocument", back_populates="apparatus", cascade="all, delete-orphan"
    )
    maintenance_records: Mapped[list["ApparatusMaintenance"]] = relationship(
        "ApparatusMaintenance", back_populates="apparatus", cascade="all, delete-orphan"
    )
    fuel_logs: Mapped[list["ApparatusFuelLog"]] = relationship(
        "ApparatusFuelLog", back_populates="apparatus", cascade="all, delete-orphan"
    )
    operators: Mapped[list["ApparatusOperator"]] = relationship(
        "ApparatusOperator", back_populates="apparatus", cascade="all, delete-orphan"
    )
    equipment: Mapped[list["ApparatusEquipment"]] = relationship(
        "ApparatusEquipment", back_populates="apparatus", cascade="all, delete-orphan"
    )
    location_history: Mapped[list["ApparatusLocationHistory"]] = relationship(
        "ApparatusLocationHistory",
        back_populates="apparatus",
        cascade="all, delete-orphan",
    )
    status_history: Mapped[list["ApparatusStatusHistory"]] = relationship(
        "ApparatusStatusHistory",
        back_populates="apparatus",
        cascade="all, delete-orphan",
    )
    components: Mapped[list["ApparatusComponent"]] = relationship(
        "ApparatusComponent", back_populates="apparatus", cascade="all, delete-orphan"
    )
    component_notes: Mapped[list["ApparatusComponentNote"]] = relationship(
        "ApparatusComponentNote",
        back_populates="apparatus",
        cascade="all, delete-orphan",
    )
    nfpa_compliance: Mapped[list["ApparatusNFPACompliance"]] = relationship(
        "ApparatusNFPACompliance",
        back_populates="apparatus",
        cascade="all, delete-orphan",
    )

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
        display: str = self.name if self.name else self.unit_number
        return display

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Field Definition
    name: Mapped[str] = mapped_column(String(100), nullable=False)  # Display name
    field_key: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # Unique key for storage
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    field_type: Mapped[CustomFieldType] = mapped_column(
        Enum(CustomFieldType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=CustomFieldType.TEXT,
        server_default="text",
    )

    # Configuration
    is_required: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    default_value: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # Default value as string
    placeholder: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # Input placeholder

    # For SELECT and MULTI_SELECT types
    options: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )  # Array of {value, label} objects

    # Validation
    min_value: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(20, 6), nullable=True
    )  # For number fields
    max_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(20, 6), nullable=True)
    min_length: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # For text fields
    max_length: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    regex_pattern: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )  # Custom validation pattern

    # Applicability
    applies_to_types: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Array of apparatus_type_ids (null = all types)

    # Display
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    show_in_list: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # Show in apparatus list view
    show_in_detail: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )  # Show in detail view

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Timestamps
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index(
            "idx_apparatus_custom_fields_org_key",
            "organization_id",
            "field_key",
            unique=True,
        ),
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )

    # File Information
    file_path: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # Path in storage system
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Size in bytes
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Photo Details
    title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    taken_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # When photo was taken

    # Classification
    photo_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # exterior, interior, damage, detail, etc.
    is_primary: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # Primary display photo

    # Timestamps
    uploaded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship("Apparatus", back_populates="photos")

    __table_args__ = (
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )

    # File Information
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Document Details
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # title, registration, insurance, manual, inspection, etc.

    # Expiration (for documents that expire)
    expiration_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Timestamps
    document_date: Mapped[Optional[date]] = mapped_column(
        Date, nullable=True
    )  # Date of the document itself
    uploaded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="documents"
    )

    __table_args__ = (
        Index("idx_apparatus_documents_type", "apparatus_id", "document_type"),
        Index("idx_apparatus_documents_expiration", "expiration_date"),
    )

    def __repr__(self):
        return (
            f"<ApparatusDocument(apparatus_id={self.apparatus_id}, title={self.title})>"
        )


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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Type Details
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[MaintenanceCategory] = mapped_column(
        Enum(MaintenanceCategory, values_callable=lambda x: [e.value for e in x]),
        default=MaintenanceCategory.PREVENTIVE,
        nullable=False,
        server_default="preventive",
    )

    # System vs Custom
    is_system: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # Scheduling
    default_interval_value: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # e.g., 3 (for "every 3 months")
    default_interval_unit: Mapped[Optional[MaintenanceIntervalUnit]] = mapped_column(
        Enum(MaintenanceIntervalUnit, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )  # e.g., "months"
    default_interval_miles: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Alternative: every X miles
    default_interval_hours: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Alternative: every X engine hours

    # NFPA
    is_nfpa_required: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    nfpa_reference: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # e.g., "NFPA 1911 Section 5.2"

    # Applicability
    applies_to_types: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Array of apparatus_type_ids

    # Display
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    maintenance_records: Mapped[list["ApparatusMaintenance"]] = relationship(
        "ApparatusMaintenance", back_populates="maintenance_type"
    )

    __table_args__ = (
        Index(
            "idx_apparatus_maint_types_org_code", "organization_id", "code", unique=True
        ),
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )
    maintenance_type_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus_maintenance_types.id", ondelete="RESTRICT"),
        nullable=False,
    )
    component_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("apparatus_components.id", ondelete="SET NULL"),
        nullable=True,
    )
    service_provider_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("apparatus_service_providers.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Scheduling
    scheduled_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Completion
    completed_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    completed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )  # If internal
    performed_by: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # External vendor/person name

    # Status
    is_completed: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    is_overdue: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # Details
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    work_performed: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    findings: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # Inspection findings

    # Readings at time of service
    mileage_at_service: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    hours_at_service: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )

    # Cost
    cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    vendor: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    invoice_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Next Service
    next_due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    next_due_mileage: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    next_due_hours: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Attachments (file references stored as JSON array)
    attachments: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )  # [{file_path, file_name, mime_type, uploaded_at}]

    # Historic Entry Support
    # When is_historic=True the record was entered retroactively (e.g. onboarding
    # a vehicle that has years of prior service history).  occurred_date is the
    # authoritative date the work actually happened; created_at remains the date
    # the record was entered into the system.
    is_historic: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    occurred_date: Mapped[Optional[date]] = mapped_column(
        Date, nullable=True
    )  # Actual date of work (may differ from created_at)
    historic_source: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # Where the data came from, e.g. "Paper logbook", "Vendor invoice"

    # Timestamps
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="maintenance_records"
    )
    maintenance_type: Mapped["ApparatusMaintenanceType"] = relationship(
        "ApparatusMaintenanceType", back_populates="maintenance_records"
    )
    component: Mapped[Optional["ApparatusComponent"]] = relationship(
        "ApparatusComponent", back_populates="maintenance_records"
    )
    service_provider: Mapped[Optional["ApparatusServiceProvider"]] = relationship(
        "ApparatusServiceProvider", back_populates="maintenance_records"
    )

    __table_args__ = (
        Index("idx_apparatus_maint_apparatus", "apparatus_id"),
        Index("idx_apparatus_maint_type", "maintenance_type_id"),
        Index("idx_apparatus_maint_component", "component_id"),
        Index("idx_apparatus_maint_provider", "service_provider_id"),
        Index("idx_apparatus_maint_due_date", "due_date"),
        Index("idx_apparatus_maint_completed", "is_completed"),
        Index("idx_apparatus_maint_overdue", "is_overdue"),
        Index("idx_apparatus_maint_historic", "is_historic"),
        Index("idx_apparatus_maint_occurred", "occurred_date"),
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Fuel Details
    fuel_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fuel_type: Mapped[FuelType] = mapped_column(
        Enum(FuelType, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    gallons: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    price_per_gallon: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(6, 3), nullable=True
    )
    total_cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    # Readings
    mileage_at_fill: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    hours_at_fill: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )

    # Fill Details
    is_full_tank: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )
    station_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    station_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timestamps
    recorded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="fuel_logs"
    )

    __table_args__ = (
        Index("idx_apparatus_fuel_apparatus", "apparatus_id"),
        Index("idx_apparatus_fuel_date", "fuel_date"),
    )

    def __repr__(self):
        return f"<ApparatusFuelLog(apparatus_id={self.apparatus_id}, gallons={self.gallons})>"


# =============================================================================
# EVOC Level
# =============================================================================


class EvocLevel(Base):
    """
    Organization-configurable EVOC (Emergency Vehicle Operator Course) levels.

    EVOC levels are a national standard (1-4) but departments can customize
    which level each apparatus requires based on local regulations and vehicle
    weight classifications. Levels are cumulative by default (EVOC 3 implies
    EVOC 2 privileges) but this can be overridden per level for exceptions.
    """

    __tablename__ = "evoc_levels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
    )

    level_number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Cumulative behavior: when True, holding this level also grants all
    # lower-numbered levels. Set False for local regulation exceptions.
    is_cumulative: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Link to the training program that certifies this level
    training_program_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("training_programs.id", ondelete="SET NULL"),
        nullable=True,
    )

    is_system: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False, server_default="0"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    training_program: Mapped[Optional["TrainingProgram"]] = relationship(
        "TrainingProgram", foreign_keys=[training_program_id]
    )

    __table_args__ = (
        Index(
            "idx_evoc_levels_org_level",
            "organization_id",
            "level_number",
            unique=True,
        ),
        Index("idx_evoc_levels_org_code", "organization_id", "code", unique=True),
        Index("idx_evoc_levels_active", "is_active"),
    )

    def __repr__(self):
        return f"<EvocLevel(level={self.level_number}, name={self.name})>"


# =============================================================================
# Apparatus Operator
# =============================================================================


class ApparatusOperator(Base):
    """
    Tracks which personnel are certified/qualified to operate apparatus

    Includes custom restrictions (parade only, daylight only, etc.)
    """

    __tablename__ = "apparatus_operators"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # EVOC certification level achieved by this operator
    evoc_level_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("evoc_levels.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Present only on eligibility granted by a specific training completion.
    completion_credit_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("requirement_progress_credits.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Certification
    is_certified: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )
    certification_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    certification_expiration: Mapped[Optional[date]] = mapped_column(
        Date, nullable=True
    )
    certified_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # License Requirements
    license_type_required: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # CDL, Class B, etc.
    license_verified: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    license_verified_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Restrictions
    has_restrictions: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    restrictions: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )  # Array of restriction objects
    restriction_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timestamps
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="operators"
    )
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    evoc_level: Mapped[Optional["EvocLevel"]] = relationship(
        "EvocLevel", foreign_keys=[evoc_level_id]
    )

    __table_args__ = (
        Index("idx_apparatus_operators_user", "user_id"),
        Index(
            "idx_apparatus_operators_apparatus_user",
            "apparatus_id",
            "user_id",
            unique=True,
        ),
        Index("idx_apparatus_operators_active", "is_active"),
        Index("idx_apparatus_operators_evoc", "evoc_level_id"),
        Index("idx_apparatus_operators_completion_credit", "completion_credit_id"),
    )

    def __repr__(self):
        return f"<ApparatusOperator(apparatus_id={self.apparatus_id}, user_id={self.user_id})>"


# =============================================================================
# Driver Qualification Exception
# =============================================================================


class DriverExceptionStatus(str, enum.Enum):
    """Lifecycle of a driver qualification exception."""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    REVOKED = "revoked"


class DriverExceptionReason(str, enum.Enum):
    """Why the EVOC requirement is being waived."""

    PARADE = "parade"
    SPECIAL_EVENT = "special_event"
    NON_EMERGENCY_TRANSPORT = "non_emergency_transport"
    MUTUAL_AID = "mutual_aid"
    OTHER = "other"


class DriverException(Base):
    """
    A chief-approved, time-boxed exception to the EVOC driving requirement.

    EVOC enforcement is a hard block: a member without the apparatus's required
    certification cannot be assigned or sign up as its driver. That is correct
    for emergency response and wrong for the parade a fifty-year life member has
    driven since before the certification existed. This record is the sanctioned
    way around the block, and it is deliberately expensive to obtain:

    * It must be **requested and approved by different people** (separation of
      duties) — an officer cannot wave themselves onto a truck.
    * It requires a **chief-level permission** to approve
      (``apparatus.approve_driver_exception``), not merely the ability to
      assign shifts.
    * It is **bounded in time**. There is no permanent waiver of a safety
      control; ``valid_until`` is required, so an exception granted for one
      parade cannot quietly become a standing qualification.
    * Approval, denial, and revocation are **audit-logged**.

    A NULL ``apparatus_id`` means the exception covers any apparatus the member
    would otherwise be blocked from — used when the specific unit is not known
    at approval time. It is the broader grant, so the UI asks for a unit first.
    """

    __tablename__ = "driver_exceptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # NULL = any apparatus.
    #
    # CASCADE, deliberately, not SET NULL. SET NULL would leave a deleted
    # unit's exception looking identical to a blanket one, so an approval
    # granted for a retired parade antique would silently start authorizing
    # the member on every remaining vehicle until it expired — a safety grant
    # widening itself as a side effect of fleet housekeeping. Deleting the
    # exception with its apparatus fails closed instead, and the approval
    # itself remains reconstructible from the audit log, which records the
    # exception id, subject, apparatus and reviewer independently of this row.
    apparatus_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=True,
    )

    reason: Mapped[DriverExceptionReason] = mapped_column(
        Enum(DriverExceptionReason, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=DriverExceptionReason.PARADE,
    )
    justification: Mapped[str] = mapped_column(Text, nullable=False)
    # Free-text operating limits carried onto the roster and the shift, e.g.
    # "parade route only, no emergency response, no lights or siren".
    restrictions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date] = mapped_column(Date, nullable=False)

    status: Mapped[DriverExceptionStatus] = mapped_column(
        Enum(DriverExceptionStatus, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=DriverExceptionStatus.PENDING,
        index=True,
    )

    requested_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    requested_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    reviewed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    apparatus: Mapped[Optional["Apparatus"]] = relationship(
        "Apparatus", foreign_keys=[apparatus_id]
    )
    requester: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[requested_by]
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[reviewed_by]
    )

    __table_args__ = (
        # The enforcement lookup: active exceptions for one member on one date.
        Index("idx_driver_exceptions_lookup", "organization_id", "user_id", "status"),
        Index("idx_driver_exceptions_validity", "valid_from", "valid_until"),
        CheckConstraint(
            "valid_until >= valid_from", name="ck_driver_exception_date_order"
        ),
    )

    def __repr__(self):
        return (
            f"<DriverException(user_id={self.user_id}, "
            f"status={self.status}, valid_until={self.valid_until})>"
        )


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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Equipment Details (can be linked or standalone)
    inventory_item_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True
    )  # Optional link to inventory

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    quantity: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False, server_default="1"
    )

    # Location on apparatus
    location_on_apparatus: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # e.g., "Driver side compartment 3"

    # Type
    is_mounted: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # Permanently mounted vs removable
    is_required: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # Required to be on apparatus

    # Tracking
    serial_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    asset_tag: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Status
    is_present: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )  # Currently on apparatus

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timestamps
    assigned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    assigned_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="equipment"
    )

    __table_args__ = (
        Index("idx_apparatus_equipment_apparatus", "apparatus_id"),
        Index("idx_apparatus_equipment_inventory", "inventory_item_id"),
    )

    def __repr__(self):
        return (
            f"<ApparatusEquipment(apparatus_id={self.apparatus_id}, name={self.name})>"
        )


# =============================================================================
# Apparatus Location History
# =============================================================================


class ApparatusLocationHistory(Base):
    """
    History of station/location assignments for apparatus
    """

    __tablename__ = "apparatus_location_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )
    location_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=False
    )

    # Assignment Period
    assigned_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    unassigned_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # Null if current

    # Reason
    assignment_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timestamps
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="location_history"
    )
    location: Mapped["Location"] = relationship("Location")

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )
    status_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus_statuses.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Status Change Details
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Readings at time of change
    mileage_at_change: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    hours_at_change: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )

    # Timestamps
    changed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="status_history"
    )
    status: Mapped["ApparatusStatus"] = relationship("ApparatusStatus")

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )

    # NFPA Standard
    standard_code: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # e.g., "NFPA 1911"
    section_reference: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # e.g., "Section 5.2.1"
    requirement_description: Mapped[str] = mapped_column(Text, nullable=False)

    # Compliance Status
    is_compliant: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    compliance_status: Mapped[Optional[str]] = mapped_column(
        String(50), default="pending"
    )  # compliant, non_compliant, pending, exempt

    # Last Check
    last_checked_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    last_checked_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Next Due
    next_due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exemption_reason: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # If exempt

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="nfpa_compliance"
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Report Details
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    report_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # fleet_status, maintenance, cost_analysis, custom

    # Schedule
    is_scheduled: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    schedule_frequency: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # daily, weekly, monthly, quarterly, yearly
    schedule_day: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # For weekly: day of week (1=Mon..7=Sun); for monthly: day of month (1-31)
    next_run_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_run_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Data Range
    data_range_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # last_month, since_last_report, last_year, since_purchase, custom
    data_range_days: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # For custom range

    # Filters
    include_apparatus_ids: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Specific apparatus to include (null = all)
    include_type_ids: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Specific types to include
    include_status_ids: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Specific statuses to include
    include_archived: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # Report Fields
    fields_to_include: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Array of field names to include
    group_by: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # Field to group by
    sort_by: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # Field to sort by
    sort_direction: Mapped[Optional[str]] = mapped_column(
        String(10), default="asc"
    )  # asc or desc

    # Output
    output_format: Mapped[Optional[str]] = mapped_column(
        String(50), default="pdf"
    )  # pdf, csv, excel

    # Recipients
    email_recipients: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Array of email addresses or user_ids

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Timestamps
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Provider Identity
    name: Mapped[str] = mapped_column(
        String(200), nullable=False
    )  # Business or person name
    company_name: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # If name is a contact person
    contact_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    # Contact Information
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    zip_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    # Capabilities
    specialties: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # List of ComponentType values they service
    certifications: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # List of certifications held
    is_emergency_service: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # Available for emergency repairs

    # Business Details
    license_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    insurance_info: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tax_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Preference
    is_preferred: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    rating: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # 1-5 star rating

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    contract_info: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # Contract terms, SLAs, etc.

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Archive (soft-delete for compliance — providers are never hard-deleted)
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    archived_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Timestamps
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    maintenance_records: Mapped[list["ApparatusMaintenance"]] = relationship(
        "ApparatusMaintenance", back_populates="service_provider"
    )
    component_notes: Mapped[list["ApparatusComponentNote"]] = relationship(
        "ApparatusComponentNote", back_populates="service_provider"
    )

    __table_args__ = (
        Index("idx_service_providers_org_name", "organization_id", "name"),
        Index("idx_service_providers_preferred", "organization_id", "is_preferred"),
        Index("idx_service_providers_active", "organization_id", "is_active"),
        CheckConstraint(
            "rating IS NULL OR (rating >= 1 AND rating <= 5)",
            name="ck_service_provider_rating",
        ),
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Component Identity
    name: Mapped[str] = mapped_column(
        String(200), nullable=False
    )  # e.g., "Main Engine", "Pump Assembly"
    component_type: Mapped[ComponentType] = mapped_column(
        Enum(ComponentType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ComponentType.OTHER,
        server_default="other",
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Manufacturer Details
    manufacturer: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    model_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    serial_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Lifecycle
    install_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    warranty_expiration: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expected_life_years: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Condition
    condition: Mapped[ComponentCondition] = mapped_column(
        Enum(ComponentCondition, values_callable=lambda x: [e.value for e in x]),
        default=ComponentCondition.GOOD,
        nullable=False,
        server_default="good",
    )
    last_serviced_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    last_inspected_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Display
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Archive (soft-delete)
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    archived_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Timestamps
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="components"
    )
    component_notes: Mapped[list["ApparatusComponentNote"]] = relationship(
        "ApparatusComponentNote",
        back_populates="component",
        cascade="all, delete-orphan",
    )
    maintenance_records: Mapped[list["ApparatusMaintenance"]] = relationship(
        "ApparatusMaintenance", back_populates="component"
    )

    __table_args__ = (
        Index("idx_apparatus_components_type", "apparatus_id", "component_type"),
        Index("idx_apparatus_components_condition", "condition"),
    )

    def __repr__(self):
        return (
            f"<ApparatusComponent(apparatus_id={self.apparatus_id}, name={self.name})>"
        )


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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=False,
    )
    component_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus_components.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Note Details
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    note_type: Mapped[NoteType] = mapped_column(
        Enum(NoteType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NoteType.OBSERVATION,
        server_default="observation",
    )
    severity: Mapped[NoteSeverity] = mapped_column(
        Enum(NoteSeverity, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NoteSeverity.INFO,
        server_default="info",
    )
    status: Mapped[NoteStatus] = mapped_column(
        Enum(NoteStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=NoteStatus.OPEN,
        server_default="open",
    )

    # Service Provider (who did or will do the work)
    service_provider_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("apparatus_service_providers.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Cost tracking
    estimated_cost: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    actual_cost: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )

    # Resolution
    reported_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolution_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Attachments (file references stored as JSON array)
    attachments: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )  # [{file_path, file_name, mime_type}]

    # Tags for categorization
    tags: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # ["warranty_claim", "recurring", "safety"]

    # Timestamps
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    component: Mapped["ApparatusComponent"] = relationship(
        "ApparatusComponent", back_populates="component_notes"
    )
    apparatus: Mapped["Apparatus"] = relationship(
        "Apparatus", back_populates="component_notes"
    )
    service_provider: Mapped[Optional["ApparatusServiceProvider"]] = relationship(
        "ApparatusServiceProvider", back_populates="component_notes"
    )

    __table_args__ = (
        Index("idx_component_notes_apparatus", "apparatus_id"),
        Index("idx_component_notes_component", "component_id"),
        Index("idx_component_notes_status", "status"),
        Index("idx_component_notes_severity", "severity"),
        Index("idx_component_notes_type", "note_type"),
        Index("idx_component_notes_provider", "service_provider_id"),
    )


# =============================================================================
# Equipment Check Templates
# =============================================================================


class EquipmentCheckTemplate(Base):
    """
    Master template for an equipment checklist.

    Multiple templates can exist per apparatus (e.g., start-of-shift driver
    vehicle check, start-of-shift officer medical check, end-of-shift check).
    Templates can be defined at the apparatus-type level (defaults) or for a
    specific apparatus (overrides).
    """

    __tablename__ = "equipment_check_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    apparatus_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="CASCADE"),
        nullable=True,
    )
    apparatus_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    check_timing: Mapped[str] = mapped_column(
        String(30), nullable=False
    )  # start_of_shift, end_of_shift
    template_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="equipment", server_default="equipment"
    )  # equipment, vehicle, combined
    assigned_positions: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # e.g. ["officer","driver"]
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    content_revision: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    compartments: Mapped[list["CheckTemplateCompartment"]] = relationship(
        "CheckTemplateCompartment",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="CheckTemplateCompartment.sort_order",
    )

    __table_args__ = (
        Index("idx_equip_check_tmpl_org", "organization_id"),
        Index("idx_equip_check_tmpl_apparatus", "apparatus_id"),
        Index("idx_equip_check_tmpl_type", "apparatus_type"),
    )

    def __repr__(self):
        return f"<EquipmentCheckTemplate(name={self.name})>"


class CheckTemplateCompartment(Base):
    """
    A named section/area within a checklist template.

    Represents a physical compartment on the apparatus (e.g.,
    "Officer Door Entry", "Driver Side Action Area", "Cabinets").
    Supports nesting via parent_compartment_id.
    """

    __tablename__ = "check_template_compartments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    template_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("equipment_check_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_header: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    # Storage container kind. Holds either a known preset key
    # (compartment, bag, pack, cabinet, drawer, shelf, box, kit, pouch,
    # tray, case) or a department's own custom label. Lets each
    # department describe where equipment lives in their own terms
    # (e.g. a "pack" inside a "bag" inside a "compartment").
    container_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="compartment", server_default="compartment"
    )
    parent_compartment_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("check_template_compartments.id", ondelete="SET NULL"),
        nullable=True,
    )
    # This container is closed with a numbered tamper seal — a drug bag, a
    # trauma kit, a sealed pack. A seal that matches the last count is proof
    # nothing inside was touched, so on the check form it clears the contents
    # count in one tap and leaves only what a seal cannot vouch for: expiry
    # dates and pressure readings, which move on their own while the bag sits
    # shut.
    is_sealed: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    template: Mapped["EquipmentCheckTemplate"] = relationship(
        "EquipmentCheckTemplate", back_populates="compartments"
    )
    # AP-12 (Codex, on top of AP-8): passive_deletes=True stops SQLAlchemy from
    # lazy-loading this collection itself when a compartment is deleted via
    # the ORM (``session.delete()``). Without it, that lazy-load is a *plain*
    # SELECT and answers from the deleting transaction's REPEATABLE READ
    # snapshot -- stale relative to EquipmentCheckService.delete_compartment's
    # own locking subtree walk (_lock_compartment_subtree), which always sees
    # latest committed state. delete_compartment now deletes the subtree's
    # CheckTemplateItem rows via the database's own
    # ondelete="CASCADE" on CheckTemplateItem.compartment_id (a bulk
    # ``DELETE ... WHERE id IN (...)`` against the locked compartment rows,
    # not a per-object ``session.delete()``) -- this relationship's own
    # cascade must stay out of that decision entirely rather than separately,
    # and unreliably, re-deriving the same set from a stale snapshot.
    items: Mapped[list["CheckTemplateItem"]] = relationship(
        "CheckTemplateItem",
        back_populates="compartment",
        cascade="all, delete-orphan",
        order_by="CheckTemplateItem.sort_order",
        passive_deletes=True,
    )
    # ``remote_side`` belongs on the *singular* backref (``parent``), not on
    # ``children`` itself -- the same inverted shape FAC-16 found and fixed on
    # ``DocumentFolder.children`` (docs/security-review/FAC-12-facilities.md).
    # Placed on ``children`` (as this was before), it inverts the
    # self-referential join, so SQLAlchemy proactively NULLs each descendant's
    # ``parent_compartment_id`` before a delete runs instead of cascading to
    # it -- confirmed live (three-level fixture, delete_compartment's own
    # `db.delete()` cascade) in
    # test_apparatus_check_template_compartment_cascade.py.
    #
    # AP-12 (Codex): passive_deletes=True here too, and for the same reason as
    # ``items`` above -- but with a sharper consequence, because unlike
    # CheckTemplateItem.compartment_id (ondelete="CASCADE"),
    # parent_compartment_id is ondelete="SET NULL". Without passive_deletes,
    # a plain ``session.delete(compartment)`` on a single root would lazy-load
    # this collection from the same stale snapshot and cascade off of it --
    # exactly the AP-8 shape, just reintroduced through staleness rather than
    # an inverted remote_side. delete_compartment no longer calls
    # ``session.delete()`` on any compartment at all: it deletes every row in
    # the locked, authoritative subtree via a bulk
    # ``DELETE ... WHERE id IN (...)``, so this relationship's cascade must
    # never independently re-derive (and potentially disagree with) that set.
    children: Mapped[list["CheckTemplateCompartment"]] = relationship(
        "CheckTemplateCompartment",
        backref=backref("parent", remote_side=[id]),
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
    )

    __table_args__ = (
        Index("idx_check_compartment_template", "template_id"),
        Index("idx_check_compartment_parent", "parent_compartment_id"),
    )

    def __repr__(self):
        return f"<CheckTemplateCompartment(name={self.name})>"


class CheckTemplateItem(Base):
    """
    An individual item to check within a compartment.

    Supports pass/fail, quantity (with state-mandated minimums),
    and reading check types. Items can track expiration dates
    and include reference images.
    """

    __tablename__ = "check_template_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    compartment_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("check_template_compartments.id", ondelete="CASCADE"),
        nullable=False,
    )
    equipment_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("apparatus_equipment.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Direct link to the inventory catalog item this checklist entry consumes.
    # Enables ready-stock tracking and swapping a fresh lot onto the apparatus
    # during a check. Nullable so checklist items without a catalog entry (e.g.
    # pass/fail inspections) still work.
    inventory_item_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("inventory_items.id", ondelete="SET NULL"),
        nullable=True,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    check_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="pass_fail"
    )  # pass_fail, present, functional, quantity, level, date_lot, reading, text
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    required_quantity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    expected_quantity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    critical_minimum_quantity: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    # How many are on the truck right now, as against required/expected, which
    # say how many *should* be. NULL means nobody has counted since the item
    # was defined, and the template's expected figure stands in — the record of
    # what was stocked is the best available answer until a crew contradicts it,
    # and reading NULL as zero would report every untouched truck as empty.
    quantity_on_truck: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    min_level: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    level_unit: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # psi, %, gallons, etc.
    serial_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    lot_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    has_expiration: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expiration_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expiration_warning_days: Mapped[int] = mapped_column(
        Integer, default=30, nullable=False
    )

    # Raised by whoever used or pulled the unit, at the time they did it, so
    # the gap is on the record rather than waiting to be discovered by the
    # next crew's morning check. Cleared by swapping fresh stock in.
    restock_needed: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    restock_reported_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    restock_reported_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    restock_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    compartment: Mapped["CheckTemplateCompartment"] = relationship(
        "CheckTemplateCompartment", back_populates="items"
    )
    # lazy="selectin" rather than a per-query option: this collection is read
    # by the count, the expiry and every screen that shows either, and a missed
    # eager-load in an async session is a MissingGreenlet at runtime rather
    # than a slow query. One extra select per item fetch is the cheaper risk.
    deployed_lots: Mapped[list["CheckItemDeployedLot"]] = relationship(
        "CheckItemDeployedLot",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        Index("idx_check_item_compartment", "compartment_id"),
        Index("idx_check_item_equipment", "equipment_id"),
        Index("idx_check_item_inventory", "inventory_item_id"),
        Index("idx_check_item_restock", "restock_needed"),
    )


class EquipmentCheckBulkRequest(Base):
    """Durable idempotency ledger for atomic template-item batches."""

    __tablename__ = "equipment_check_bulk_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    compartment_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("check_template_compartments.id", ondelete="CASCADE"),
        nullable=False,
    )
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    item_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index(
            "uq_equipment_check_bulk_request",
            "organization_id",
            "compartment_id",
            "idempotency_key",
            unique=True,
        ),
    )


class EquipmentCheckBulkDeleteRequest(Base):
    """Durable result ledger for retry-safe atomic template-item deletion."""

    __tablename__ = "equipment_check_bulk_delete_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    compartment_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("check_template_compartments.id", ondelete="CASCADE"),
        nullable=False,
    )
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    item_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index(
            "uq_equipment_check_bulk_delete_request",
            "organization_id",
            "compartment_id",
            "idempotency_key",
            unique=True,
        ),
    )


class TemplateChangeLog(Base):
    """
    Granular audit trail for equipment check template edits.

    Records every add/update/delete action on templates, compartments,
    and items so leadership can review who changed what and when.
    Visible only to users with inventory.check_manage permission.
    """

    __tablename__ = "template_change_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    template_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("equipment_check_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_name: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(
        String(30), nullable=False
    )  # add, update, delete
    # template, compartment, or item
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    entity_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    changes: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("idx_tmpl_changelog_org", "organization_id"),
        Index("idx_tmpl_changelog_template", "template_id"),
        Index("idx_tmpl_changelog_created", "created_at"),
    )


class CheckItemDeployedLot(Base):
    """A lot physically on the apparatus for one checklist position.

    A position that carries four of something can be carrying four units from
    three different lots with three different expiration dates. The single
    ``lot_number`` / ``expiration_date`` pair on ``CheckTemplateItem`` can only
    describe one of them, so the truck's real exposure — the *soonest* date
    aboard — was unrepresentable, and restocking a partial shortfall silently
    overwrote the date of the units already there.

    Each row is one lot's presence on one position. The position's on-truck
    count is the sum of these, and the date that matters is the earliest.

    Lot number and expiration are snapshotted rather than read through
    ``inventory_lot_id``: shelf lots get consumed and deleted, and what is on
    the truck must remain answerable after the shelf record is gone.
    """

    __tablename__ = "check_item_deployed_lots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    template_item_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("check_template_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # The shelf lot it was drawn from, kept for provenance. Nullable because a
    # depleted lot may be deleted while its units are still on a truck.
    inventory_lot_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("inventory_lots.id", ondelete="SET NULL"),
        nullable=True,
    )

    lot_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    expiration_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    quantity: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False, server_default="0"
    )

    deployed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    deployed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        # Serves both the per-item drill-in and the first-expiring-first-out
        # consumption order.
        Index("idx_deployed_lot_item_exp", "template_item_id", "expiration_date"),
    )

    def __repr__(self):
        return (
            f"<CheckItemDeployedLot(item={self.template_item_id}, "
            f"lot={self.lot_number}, qty={self.quantity})>"
        )
