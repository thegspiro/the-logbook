"""
Facilities Database Models

SQLAlchemy models for facility/building management, tracking, and maintenance.
Supports fire stations, meeting halls, training centers, storage buildings,
and custom facility types.
"""

import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

# =============================================================================
# Enumerations
# =============================================================================


class FacilityCategory(str, enum.Enum):
    """High-level facility categories"""

    STATION = "station"
    TRAINING = "training"
    ADMINISTRATION = "administration"
    STORAGE = "storage"
    MEETING_HALL = "meeting_hall"
    COMMUNITY = "community"
    OTHER = "other"


class DefaultFacilityType(str, enum.Enum):
    """Default facility types seeded for new organizations"""

    FIRE_STATION = "fire_station"
    EMS_STATION = "ems_station"
    TRAINING_CENTER = "training_center"
    ADMINISTRATIVE_OFFICE = "administrative_office"
    MEETING_HALL = "meeting_hall"
    STORAGE_BUILDING = "storage_building"
    MAINTENANCE_SHOP = "maintenance_shop"
    COMMUNICATIONS_CENTER = "communications_center"
    COMMUNITY_CENTER = "community_center"
    OTHER = "other"


class DefaultFacilityStatus(str, enum.Enum):
    """Default facility statuses"""

    OPERATIONAL = "operational"
    UNDER_RENOVATION = "under_renovation"
    UNDER_CONSTRUCTION = "under_construction"
    TEMPORARILY_CLOSED = "temporarily_closed"
    DECOMMISSIONED = "decommissioned"
    OTHER = "other"


class FacilitySystemType(str, enum.Enum):
    """Major building systems that can be tracked"""

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


class FacilitySystemCondition(str, enum.Enum):
    """Condition ratings for facility systems"""

    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    CRITICAL = "critical"


class MaintenanceCategory(str, enum.Enum):
    """Categories for facility maintenance work"""

    PREVENTIVE = "preventive"
    REPAIR = "repair"
    INSPECTION = "inspection"
    RENOVATION = "renovation"
    CLEANING = "cleaning"
    SAFETY = "safety"
    OTHER = "other"


class MaintenanceIntervalUnit(str, enum.Enum):
    """Units for maintenance scheduling intervals"""

    DAYS = "days"
    WEEKS = "weeks"
    MONTHS = "months"
    YEARS = "years"


class InspectionType(str, enum.Enum):
    """Types of facility inspections"""

    FIRE = "fire"
    BUILDING_CODE = "building_code"
    HEALTH = "health"
    ADA = "ada"
    ENVIRONMENTAL = "environmental"
    INSURANCE = "insurance"
    ROUTINE = "routine"
    OTHER = "other"


# =============================================================================
# Facility Type (customizable by organization)
# =============================================================================


class FacilityType(Base):
    """
    Facility types (e.g. Fire Station, Meeting Hall, Training Center).
    Organizations get default types on creation and can add custom ones.
    """

    __tablename__ = "facility_types"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(
        Enum(FacilityCategory, values_callable=lambda x: [e.value for e in x]),
        default=FacilityCategory.OTHER,
    )

    is_system = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facilities = relationship("Facility", back_populates="facility_type")

    __table_args__ = (
        Index("idx_facility_types_org", "organization_id"),
        Index("idx_facility_types_org_name", "organization_id", "name", unique=True),
    )

    def __repr__(self):
        return f"<FacilityType(name={self.name})>"


# =============================================================================
# Facility Status (customizable by organization)
# =============================================================================


class FacilityStatus(Base):
    """
    Facility statuses (e.g. Operational, Under Renovation).
    Organizations get defaults and can add custom ones.
    """

    __tablename__ = "facility_statuses"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=True)  # Hex color for UI

    is_operational = Column(
        Boolean, default=True, nullable=False
    )  # Is the facility usable?
    is_system = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facilities = relationship("Facility", back_populates="status_record")

    __table_args__ = (
        Index("idx_facility_statuses_org", "organization_id"),
        Index("idx_facility_statuses_org_name", "organization_id", "name", unique=True),
    )

    def __repr__(self):
        return f"<FacilityStatus(name={self.name})>"


# =============================================================================
# Facility (Main Model)
# =============================================================================


class Facility(Base):
    """
    Main facility model for tracking buildings, stations, and properties.
    """

    __tablename__ = "facilities"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Identity
    name = Column(String(200), nullable=False)
    facility_number = Column(
        String(50), nullable=True
    )  # e.g. "Station 1", "Building A"
    facility_type_id = Column(
        String(36), ForeignKey("facility_types.id"), nullable=False, index=True
    )
    status_id = Column(
        String(36), ForeignKey("facility_statuses.id"), nullable=False, index=True
    )

    # Address
    address_line1 = Column(String(200), nullable=True)
    address_line2 = Column(String(200), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(50), nullable=True)
    zip_code = Column(String(20), nullable=True)
    county = Column(String(100), nullable=True)
    latitude = Column(Numeric(10, 7), nullable=True)
    longitude = Column(Numeric(10, 7), nullable=True)

    # Building Info
    year_built = Column(Integer, nullable=True)
    year_renovated = Column(Integer, nullable=True)
    square_footage = Column(Integer, nullable=True)
    num_floors = Column(Integer, nullable=True)
    num_bays = Column(Integer, nullable=True)  # Apparatus bays for stations
    lot_size_acres = Column(Numeric(10, 2), nullable=True)

    # Ownership
    is_owned = Column(Boolean, default=True, nullable=False)  # vs leased
    lease_expiration = Column(Date, nullable=True)
    property_tax_id = Column(String(100), nullable=True)

    # Capacity
    max_occupancy = Column(Integer, nullable=True)
    sleeping_quarters = Column(Integer, nullable=True)  # For stations with bunks

    # Contact
    phone = Column(String(50), nullable=True)
    fax = Column(String(50), nullable=True)
    email = Column(String(200), nullable=True)

    # Description
    description = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    # Status tracking
    status_changed_at = Column(DateTime(timezone=True), nullable=True)
    status_changed_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Archive (soft-delete)
    is_archived = Column(Boolean, default=False, nullable=False)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    archived_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Metadata
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility_type = relationship("FacilityType", back_populates="facilities")
    status_record = relationship("FacilityStatus", back_populates="facilities")
    photos = relationship(
        "FacilityPhoto", back_populates="facility", cascade="all, delete-orphan"
    )
    documents = relationship(
        "FacilityDocument", back_populates="facility", cascade="all, delete-orphan"
    )
    maintenance_records = relationship(
        "FacilityMaintenance", back_populates="facility", cascade="all, delete-orphan"
    )
    systems = relationship(
        "FacilitySystem", back_populates="facility", cascade="all, delete-orphan"
    )
    inspections = relationship(
        "FacilityInspection", back_populates="facility", cascade="all, delete-orphan"
    )
    utility_accounts = relationship(
        "FacilityUtilityAccount",
        back_populates="facility",
        cascade="all, delete-orphan",
    )
    access_keys = relationship(
        "FacilityAccessKey", back_populates="facility", cascade="all, delete-orphan"
    )
    rooms = relationship(
        "FacilityRoom", back_populates="facility", cascade="all, delete-orphan"
    )
    emergency_contacts = relationship(
        "FacilityEmergencyContact",
        back_populates="facility",
        cascade="all, delete-orphan",
    )
    shutoff_locations = relationship(
        "FacilityShutoffLocation",
        back_populates="facility",
        cascade="all, delete-orphan",
    )
    capital_projects = relationship(
        "FacilityCapitalProject",
        back_populates="facility",
        cascade="all, delete-orphan",
    )
    insurance_policies = relationship(
        "FacilityInsurancePolicy",
        back_populates="facility",
        cascade="all, delete-orphan",
    )
    occupants = relationship(
        "FacilityOccupant", back_populates="facility", cascade="all, delete-orphan"
    )
    compliance_checklists = relationship(
        "FacilityComplianceChecklist",
        back_populates="facility",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_facilities_org", "organization_id"),
        Index(
            "idx_facilities_org_number",
            "organization_id",
            "facility_number",
            unique=True,
        ),
        Index("idx_facilities_org_type", "organization_id", "facility_type_id"),
        Index("idx_facilities_org_status", "organization_id", "status_id"),
        Index("idx_facilities_archived", "is_archived"),
    )

    @property
    def display_name(self) -> str:
        if self.facility_number and self.name:
            return f"{self.facility_number} - {self.name}"
        return self.name or self.facility_number or "Unnamed Facility"

    def __repr__(self):
        return f"<Facility(name={self.name}, number={self.facility_number})>"


# =============================================================================
# Facility Photo
# =============================================================================


class FacilityPhoto(Base):
    """Photos associated with a facility"""

    __tablename__ = "facility_photos"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    file_path = Column(String(500), nullable=False)
    file_name = Column(String(200), nullable=False)
    mime_type = Column(String(100), nullable=True)
    caption = Column(String(500), nullable=True)
    is_primary = Column(Boolean, default=False, nullable=False)

    uploaded_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    facility = relationship("Facility", back_populates="photos")

    __table_args__ = (Index("idx_facility_photos_facility", "facility_id"),)


# =============================================================================
# Facility Document
# =============================================================================


class FacilityDocument(Base):
    """Documents associated with a facility (blueprints, permits, leases, etc.)"""

    __tablename__ = "facility_documents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    file_path = Column(String(500), nullable=False)
    file_name = Column(String(200), nullable=False)
    mime_type = Column(String(100), nullable=True)
    document_type = Column(
        String(100), nullable=True
    )  # blueprint, permit, lease, insurance, etc.
    description = Column(Text, nullable=True)
    document_date = Column(Date, nullable=True)
    expiration_date = Column(Date, nullable=True)  # For permits, insurance, leases

    uploaded_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    facility = relationship("Facility", back_populates="documents")

    __table_args__ = (
        Index("idx_facility_documents_facility", "facility_id"),
        Index("idx_facility_documents_type", "document_type"),
        Index("idx_facility_documents_expiration", "expiration_date"),
    )


# =============================================================================
# Facility Maintenance Type
# =============================================================================


class FacilityMaintenanceType(Base):
    """
    Types of maintenance work that can be performed on facilities.
    Organizations get defaults and can add custom ones.
    """

    __tablename__ = "facility_maintenance_types"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(
        Enum(MaintenanceCategory, values_callable=lambda x: [e.value for e in x]),
        default=MaintenanceCategory.OTHER,
    )

    # Scheduling defaults
    default_interval_value = Column(Integer, nullable=True)
    default_interval_unit = Column(
        Enum(MaintenanceIntervalUnit, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )

    is_system = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    maintenance_records = relationship(
        "FacilityMaintenance", back_populates="maintenance_type"
    )

    __table_args__ = (
        Index("idx_facility_maint_types_org", "organization_id"),
        Index(
            "idx_facility_maint_types_org_name", "organization_id", "name", unique=True
        ),
    )

    def __repr__(self):
        return f"<FacilityMaintenanceType(name={self.name})>"


# =============================================================================
# Facility Maintenance Record
# =============================================================================


class FacilityMaintenance(Base):
    """
    Maintenance records for facilities.
    Tracks scheduled and unscheduled maintenance, repairs, inspections,
    and renovations. Supports historic back-dated entries.
    """

    __tablename__ = "facility_maintenance"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    maintenance_type_id = Column(
        String(36),
        ForeignKey("facility_maintenance_types.id"),
        nullable=False,
        index=True,
    )
    system_id = Column(
        String(36),
        ForeignKey("facility_systems.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Scheduling
    scheduled_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)

    # Completion
    completed_date = Column(Date, nullable=True)
    completed_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    performed_by = Column(String(200), nullable=True)  # External contractor name

    # Status
    is_completed = Column(Boolean, default=False, nullable=False)
    is_overdue = Column(Boolean, default=False, nullable=False)

    # Details
    description = Column(Text, nullable=True)
    work_performed = Column(Text, nullable=True)
    findings = Column(Text, nullable=True)

    # Cost
    cost = Column(Numeric(10, 2), nullable=True)
    vendor = Column(String(200), nullable=True)
    invoice_number = Column(String(100), nullable=True)
    work_order_number = Column(String(100), nullable=True)

    # Next service
    next_due_date = Column(Date, nullable=True)

    # Notes & attachments
    notes = Column(Text, nullable=True)
    attachments = Column(JSON, nullable=True)  # [{file_path, file_name, mime_type}]

    # Historic entry support
    is_historic = Column(Boolean, default=False, nullable=False)
    occurred_date = Column(Date, nullable=True)
    historic_source = Column(String(200), nullable=True)

    # Timestamps
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="maintenance_records")
    maintenance_type = relationship(
        "FacilityMaintenanceType", back_populates="maintenance_records"
    )
    system = relationship("FacilitySystem", back_populates="maintenance_records")

    __table_args__ = (
        Index("idx_facility_maint_facility", "facility_id"),
        Index("idx_facility_maint_type", "maintenance_type_id"),
        Index("idx_facility_maint_system", "system_id"),
        Index("idx_facility_maint_due_date", "due_date"),
        Index("idx_facility_maint_completed", "is_completed"),
        Index("idx_facility_maint_overdue", "is_overdue"),
        Index("idx_facility_maint_historic", "is_historic"),
        Index("idx_facility_maint_occurred", "occurred_date"),
    )

    def __repr__(self):
        return f"<FacilityMaintenance(facility_id={self.facility_id}, type={self.maintenance_type_id})>"


# =============================================================================
# Facility System (building sub-systems: HVAC, electrical, plumbing, etc.)
# =============================================================================


class FacilitySystem(Base):
    """
    Segments a facility into logical building systems (HVAC, electrical,
    plumbing, etc.) for targeted maintenance and inspection tracking.
    """

    __tablename__ = "facility_systems"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # System identity
    name = Column(String(200), nullable=False)
    system_type = Column(
        Enum(FacilitySystemType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=FacilitySystemType.OTHER,
    )
    description = Column(Text, nullable=True)

    # Details
    manufacturer = Column(String(200), nullable=True)
    model_number = Column(String(100), nullable=True)
    serial_number = Column(String(100), nullable=True)

    # Lifecycle
    install_date = Column(Date, nullable=True)
    warranty_expiration = Column(Date, nullable=True)
    expected_life_years = Column(Integer, nullable=True)

    # Condition
    condition = Column(
        Enum(FacilitySystemCondition, values_callable=lambda x: [e.value for e in x]),
        default=FacilitySystemCondition.GOOD,
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
    archived_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Timestamps
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="systems")
    maintenance_records = relationship("FacilityMaintenance", back_populates="system")

    __table_args__ = (
        Index("idx_facility_systems_facility", "facility_id"),
        Index("idx_facility_systems_type", "facility_id", "system_type"),
        Index("idx_facility_systems_condition", "condition"),
    )

    def __repr__(self):
        return f"<FacilitySystem(facility_id={self.facility_id}, name={self.name})>"


# =============================================================================
# Facility Inspection
# =============================================================================


class FacilityInspection(Base):
    """
    Inspection records for facilities — fire inspections, building code,
    ADA compliance, insurance, etc.
    """

    __tablename__ = "facility_inspections"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Inspection details
    inspection_type = Column(
        Enum(InspectionType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=InspectionType.ROUTINE,
    )
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)

    # Dates
    inspection_date = Column(Date, nullable=False)
    next_inspection_date = Column(Date, nullable=True)

    # Results
    passed = Column(Boolean, nullable=True)  # null = pending/not yet determined
    inspector_name = Column(String(200), nullable=True)
    inspector_organization = Column(String(200), nullable=True)
    certificate_number = Column(String(100), nullable=True)

    # Findings / deficiencies
    findings = Column(Text, nullable=True)
    corrective_actions = Column(Text, nullable=True)
    corrective_action_deadline = Column(Date, nullable=True)
    corrective_action_completed = Column(Boolean, default=False, nullable=False)

    # Attachments (inspection reports, certificates)
    attachments = Column(JSON, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Timestamps
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="inspections")

    __table_args__ = (
        Index("idx_facility_inspections_facility", "facility_id"),
        Index("idx_facility_inspections_type", "inspection_type"),
        Index("idx_facility_inspections_date", "inspection_date"),
        Index("idx_facility_inspections_next", "next_inspection_date"),
        Index("idx_facility_inspections_passed", "passed"),
    )

    def __repr__(self):
        return f"<FacilityInspection(facility_id={self.facility_id}, type={self.inspection_type})>"


# =============================================================================
# Utility Type Enum
# =============================================================================


class UtilityType(str, enum.Enum):
    """Types of utilities tracked for facilities"""

    ELECTRIC = "electric"
    GAS = "gas"
    WATER = "water"
    SEWER = "sewer"
    INTERNET = "internet"
    PHONE = "phone"
    TRASH = "trash"
    OTHER = "other"


class BillingCycle(str, enum.Enum):
    """Billing cycle frequencies"""

    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"
    OTHER = "other"


class KeyType(str, enum.Enum):
    """Types of access keys/credentials"""

    PHYSICAL_KEY = "physical_key"
    FOB = "fob"
    ACCESS_CODE = "access_code"
    KEY_CARD = "key_card"
    BIOMETRIC = "biometric"
    COMBINATION = "combination"
    OTHER = "other"


class RoomType(str, enum.Enum):
    """Types of rooms/spaces in a facility"""

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


class EmergencyContactType(str, enum.Enum):
    """Types of emergency/vendor contacts"""

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


class ShutoffType(str, enum.Enum):
    """Types of utility shutoffs in a facility"""

    WATER_MAIN = "water_main"
    GAS_MAIN = "gas_main"
    ELECTRICAL_MAIN = "electrical_main"
    FIRE_SUPPRESSION = "fire_suppression"
    HVAC = "hvac"
    IRRIGATION = "irrigation"
    OTHER = "other"


class CapitalProjectType(str, enum.Enum):
    """Types of capital improvement projects"""

    RENOVATION = "renovation"
    NEW_CONSTRUCTION = "new_construction"
    REPAIR = "repair"
    UPGRADE = "upgrade"
    EXPANSION = "expansion"
    DEMOLITION = "demolition"
    ENVIRONMENTAL = "environmental"
    ADA_COMPLIANCE = "ada_compliance"
    OTHER = "other"


class CapitalProjectStatus(str, enum.Enum):
    """Status of a capital improvement project"""

    PLANNING = "planning"
    APPROVED = "approved"
    BIDDING = "bidding"
    IN_PROGRESS = "in_progress"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class InsurancePolicyType(str, enum.Enum):
    """Types of insurance policies"""

    PROPERTY = "property"
    LIABILITY = "liability"
    FLOOD = "flood"
    EARTHQUAKE = "earthquake"
    WORKERS_COMP = "workers_comp"
    UMBRELLA = "umbrella"
    EQUIPMENT = "equipment"
    OTHER = "other"


class ComplianceType(str, enum.Enum):
    """Types of compliance/regulatory domains"""

    ADA = "ada"
    FIRE_CODE = "fire_code"
    BUILDING_CODE = "building_code"
    HEALTH = "health"
    ENVIRONMENTAL = "environmental"
    OSHA = "osha"
    NFPA = "nfpa"
    OTHER = "other"


# =============================================================================
# Facility Utility Account
# =============================================================================


class FacilityUtilityAccount(Base):
    """Utility accounts (electric, gas, water, etc.) for a facility"""

    __tablename__ = "facility_utility_accounts"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    utility_type = Column(
        Enum(UtilityType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    provider_name = Column(String(200), nullable=False)
    account_number = Column(String(100), nullable=True)
    meter_number = Column(String(100), nullable=True)

    contact_phone = Column(String(50), nullable=True)
    contact_email = Column(String(200), nullable=True)
    emergency_phone = Column(String(50), nullable=True)

    billing_cycle = Column(
        Enum(BillingCycle, values_callable=lambda x: [e.value for e in x]),
        default=BillingCycle.MONTHLY,
    )

    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="utility_accounts")
    readings = relationship(
        "FacilityUtilityReading",
        back_populates="utility_account",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_facility_utility_facility", "facility_id"),
        Index("idx_facility_utility_type", "facility_id", "utility_type"),
    )

    def __repr__(self):
        return f"<FacilityUtilityAccount(facility_id={self.facility_id}, type={self.utility_type})>"


# =============================================================================
# Facility Utility Reading (monthly cost/usage records)
# =============================================================================


class FacilityUtilityReading(Base):
    """Monthly/periodic utility cost and usage readings"""

    __tablename__ = "facility_utility_readings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    utility_account_id = Column(
        String(36),
        ForeignKey("facility_utility_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    reading_date = Column(Date, nullable=False)
    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)

    amount = Column(Numeric(10, 2), nullable=True)  # Cost in dollars
    usage_quantity = Column(Numeric(12, 3), nullable=True)  # kWh, gallons, therms, etc.
    usage_unit = Column(String(50), nullable=True)  # kWh, gallons, therms, ccf, etc.

    notes = Column(Text, nullable=True)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    utility_account = relationship("FacilityUtilityAccount", back_populates="readings")

    __table_args__ = (
        Index("idx_facility_utility_readings_account", "utility_account_id"),
        Index("idx_facility_utility_readings_date", "reading_date"),
    )


# =============================================================================
# Facility Access Key / Credential
# =============================================================================


class FacilityAccessKey(Base):
    """Keys, fobs, codes, and access credentials for a facility"""

    __tablename__ = "facility_access_keys"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    key_type = Column(
        Enum(KeyType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    key_identifier = Column(String(100), nullable=True)  # Key number, code, fob ID
    description = Column(String(300), nullable=True)

    # Assignment
    assigned_to_user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_to_name = Column(String(200), nullable=True)  # For external people
    issued_date = Column(Date, nullable=True)
    returned_date = Column(Date, nullable=True)

    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text, nullable=True)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="access_keys")

    __table_args__ = (
        Index("idx_facility_access_keys_facility", "facility_id"),
        Index("idx_facility_access_keys_user", "assigned_to_user_id"),
        Index("idx_facility_access_keys_type", "key_type"),
    )

    def __repr__(self):
        return (
            f"<FacilityAccessKey(facility_id={self.facility_id}, type={self.key_type})>"
        )


# =============================================================================
# Facility Room / Space
# =============================================================================


class FacilityRoom(Base):
    """Individual rooms and spaces within a facility"""

    __tablename__ = "facility_rooms"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(200), nullable=False)
    room_number = Column(String(50), nullable=True)
    floor = Column(Integer, nullable=True)

    room_type = Column(
        Enum(RoomType, values_callable=lambda x: [e.value for e in x]),
        default=RoomType.OTHER,
        nullable=False,
    )

    square_footage = Column(Integer, nullable=True)
    capacity = Column(Integer, nullable=True)
    description = Column(Text, nullable=True)
    equipment = Column(Text, nullable=True)  # Notable equipment in this room

    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True, nullable=False)

    created_by = Column(String(36), nullable=True)
    updated_by = Column(String(36), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="rooms")

    __table_args__ = (
        Index("idx_facility_rooms_facility", "facility_id"),
        Index("idx_facility_rooms_type", "room_type"),
        Index("idx_facility_rooms_floor", "facility_id", "floor"),
    )

    def __repr__(self):
        return f"<FacilityRoom(facility_id={self.facility_id}, name={self.name})>"


# =============================================================================
# Facility Emergency Contact
# =============================================================================


class FacilityEmergencyContact(Base):
    """Emergency/vendor contacts for a facility (alarm company, plumber, etc.)"""

    __tablename__ = "facility_emergency_contacts"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    contact_type = Column(
        Enum(EmergencyContactType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    company_name = Column(String(200), nullable=False)
    contact_name = Column(String(200), nullable=True)
    phone = Column(String(50), nullable=True)
    alt_phone = Column(String(50), nullable=True)
    email = Column(String(200), nullable=True)
    service_contract_number = Column(String(100), nullable=True)

    priority = Column(Integer, default=1, nullable=False)  # 1 = primary, 2 = secondary
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="emergency_contacts")

    __table_args__ = (
        Index("idx_facility_emerg_contacts_facility", "facility_id"),
        Index("idx_facility_emerg_contacts_type", "contact_type"),
    )

    def __repr__(self):
        return f"<FacilityEmergencyContact(facility_id={self.facility_id}, type={self.contact_type})>"


# =============================================================================
# Facility Shutoff Location
# =============================================================================


class FacilityShutoffLocation(Base):
    """Utility shutoff locations within a facility (water main, gas main, etc.)"""

    __tablename__ = "facility_shutoff_locations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    shutoff_type = Column(
        Enum(ShutoffType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    location_description = Column(Text, nullable=False)
    floor = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    photo_path = Column(String(500), nullable=True)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="shutoff_locations")

    __table_args__ = (
        Index("idx_facility_shutoffs_facility", "facility_id"),
        Index("idx_facility_shutoffs_type", "shutoff_type"),
    )

    def __repr__(self):
        return f"<FacilityShutoffLocation(facility_id={self.facility_id}, type={self.shutoff_type})>"


# =============================================================================
# Facility Capital Improvement Project
# =============================================================================


class FacilityCapitalProject(Base):
    """Capital improvement and renovation projects for a facility"""

    __tablename__ = "facility_capital_projects"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    project_name = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)

    project_type = Column(
        Enum(CapitalProjectType, values_callable=lambda x: [e.value for e in x]),
        default=CapitalProjectType.OTHER,
        nullable=False,
    )
    project_status = Column(
        Enum(CapitalProjectStatus, values_callable=lambda x: [e.value for e in x]),
        default=CapitalProjectStatus.PLANNING,
        nullable=False,
    )

    # Budget
    estimated_cost = Column(Numeric(12, 2), nullable=True)
    actual_cost = Column(Numeric(12, 2), nullable=True)
    budget_source = Column(String(300), nullable=True)

    # Timeline
    start_date = Column(Date, nullable=True)
    estimated_completion = Column(Date, nullable=True)
    actual_completion = Column(Date, nullable=True)

    # Contractor
    contractor_name = Column(String(200), nullable=True)
    contractor_phone = Column(String(50), nullable=True)
    contractor_email = Column(String(200), nullable=True)
    project_manager = Column(String(200), nullable=True)

    # Administrative
    permit_numbers = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    attachments = Column(JSON, nullable=True)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="capital_projects")

    __table_args__ = (
        Index("idx_facility_capital_facility", "facility_id"),
        Index("idx_facility_capital_status", "project_status"),
        Index("idx_facility_capital_type", "project_type"),
    )

    def __repr__(self):
        return f"<FacilityCapitalProject(facility_id={self.facility_id}, name={self.project_name})>"


# =============================================================================
# Facility Insurance Policy
# =============================================================================


class FacilityInsurancePolicy(Base):
    """Insurance policies covering a facility"""

    __tablename__ = "facility_insurance_policies"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    policy_type = Column(
        Enum(InsurancePolicyType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    policy_number = Column(String(100), nullable=True)
    carrier_name = Column(String(200), nullable=False)

    agent_name = Column(String(200), nullable=True)
    agent_phone = Column(String(50), nullable=True)
    agent_email = Column(String(200), nullable=True)

    coverage_amount = Column(Numeric(14, 2), nullable=True)
    deductible = Column(Numeric(10, 2), nullable=True)
    annual_premium = Column(Numeric(10, 2), nullable=True)

    effective_date = Column(Date, nullable=True)
    expiration_date = Column(Date, nullable=True)

    notes = Column(Text, nullable=True)
    attachments = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="insurance_policies")

    __table_args__ = (
        Index("idx_facility_insurance_facility", "facility_id"),
        Index("idx_facility_insurance_type", "policy_type"),
        Index("idx_facility_insurance_expiration", "expiration_date"),
    )

    def __repr__(self):
        return f"<FacilityInsurancePolicy(facility_id={self.facility_id}, type={self.policy_type})>"


# =============================================================================
# Facility Occupant / Unit Assignment
# =============================================================================


class FacilityOccupant(Base):
    """Units, crews, or teams assigned to a facility"""

    __tablename__ = "facility_occupants"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    unit_name = Column(
        String(200), nullable=False
    )  # e.g., "Engine Co. 1", "Rescue Squad 2"
    description = Column(Text, nullable=True)
    contact_name = Column(String(200), nullable=True)
    contact_phone = Column(String(50), nullable=True)

    effective_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    notes = Column(Text, nullable=True)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="occupants")

    __table_args__ = (
        Index("idx_facility_occupants_facility", "facility_id"),
        Index("idx_facility_occupants_active", "is_active"),
    )

    def __repr__(self):
        return (
            f"<FacilityOccupant(facility_id={self.facility_id}, unit={self.unit_name})>"
        )


# =============================================================================
# Facility Compliance Checklist
# =============================================================================


class FacilityComplianceChecklist(Base):
    """Regulatory/compliance checklists for a facility"""

    __tablename__ = "facility_compliance_checklists"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    checklist_name = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)

    compliance_type = Column(
        Enum(ComplianceType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    due_date = Column(Date, nullable=True)
    completed_date = Column(Date, nullable=True)
    completed_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_completed = Column(Boolean, default=False, nullable=False)

    notes = Column(Text, nullable=True)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    facility = relationship("Facility", back_populates="compliance_checklists")
    items = relationship(
        "FacilityComplianceItem",
        back_populates="checklist",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_facility_compliance_facility", "facility_id"),
        Index("idx_facility_compliance_type", "compliance_type"),
        Index("idx_facility_compliance_due", "due_date"),
        Index("idx_facility_compliance_completed", "is_completed"),
    )

    def __repr__(self):
        return f"<FacilityComplianceChecklist(facility_id={self.facility_id}, name={self.checklist_name})>"


# =============================================================================
# Facility Compliance Item (individual checklist line items)
# =============================================================================


class FacilityComplianceItem(Base):
    """Individual items within a compliance checklist"""

    __tablename__ = "facility_compliance_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    checklist_id = Column(
        String(36),
        ForeignKey("facility_compliance_checklists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    item_number = Column(Integer, nullable=True)
    description = Column(Text, nullable=False)

    is_compliant = Column(Boolean, nullable=True)  # null = not yet checked
    findings = Column(Text, nullable=True)
    corrective_action = Column(Text, nullable=True)
    corrective_action_deadline = Column(Date, nullable=True)
    corrective_action_completed = Column(Boolean, default=False, nullable=False)

    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    checklist = relationship("FacilityComplianceChecklist", back_populates="items")

    __table_args__ = (Index("idx_facility_compliance_items_checklist", "checklist_id"),)
