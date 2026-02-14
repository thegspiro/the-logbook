"""
Facilities Database Models

SQLAlchemy models for facility/building management, tracking, and maintenance.
Supports fire stations, meeting halls, training centers, storage buildings,
and custom facility types.
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(
        Enum(FacilityCategory, values_callable=lambda x: [e.value for e in x]),
        default=FacilityCategory.OTHER,
    )

    is_system = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=True)  # Hex color for UI

    is_operational = Column(Boolean, default=True, nullable=False)  # Is the facility usable?
    is_system = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Identity
    name = Column(String(200), nullable=False)
    facility_number = Column(String(50), nullable=True)  # e.g. "Station 1", "Building A"
    facility_type_id = Column(String(36), ForeignKey("facility_types.id"), nullable=False, index=True)
    status_id = Column(String(36), ForeignKey("facility_statuses.id"), nullable=False, index=True)

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
    status_changed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Archive (soft-delete)
    is_archived = Column(Boolean, default=False, nullable=False, index=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    archived_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    facility_type = relationship("FacilityType", back_populates="facilities")
    status_record = relationship("FacilityStatus", back_populates="facilities")
    photos = relationship("FacilityPhoto", back_populates="facility", cascade="all, delete-orphan")
    documents = relationship("FacilityDocument", back_populates="facility", cascade="all, delete-orphan")
    maintenance_records = relationship("FacilityMaintenance", back_populates="facility", cascade="all, delete-orphan")
    systems = relationship("FacilitySystem", back_populates="facility", cascade="all, delete-orphan")
    inspections = relationship("FacilityInspection", back_populates="facility", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_facilities_org", "organization_id"),
        Index("idx_facilities_org_number", "organization_id", "facility_number", unique=True),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    facility_id = Column(String(36), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)

    file_path = Column(String(500), nullable=False)
    file_name = Column(String(200), nullable=False)
    mime_type = Column(String(100), nullable=True)
    caption = Column(String(500), nullable=True)
    is_primary = Column(Boolean, default=False, nullable=False)

    uploaded_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    facility = relationship("Facility", back_populates="photos")

    __table_args__ = (
        Index("idx_facility_photos_facility", "facility_id"),
    )


# =============================================================================
# Facility Document
# =============================================================================

class FacilityDocument(Base):
    """Documents associated with a facility (blueprints, permits, leases, etc.)"""
    __tablename__ = "facility_documents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    facility_id = Column(String(36), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)

    file_path = Column(String(500), nullable=False)
    file_name = Column(String(200), nullable=False)
    mime_type = Column(String(100), nullable=True)
    document_type = Column(String(100), nullable=True)  # blueprint, permit, lease, insurance, etc.
    description = Column(Text, nullable=True)
    document_date = Column(Date, nullable=True)
    expiration_date = Column(Date, nullable=True)  # For permits, insurance, leases

    uploaded_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

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
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    maintenance_records = relationship("FacilityMaintenance", back_populates="maintenance_type")

    __table_args__ = (
        Index("idx_facility_maint_types_org", "organization_id"),
        Index("idx_facility_maint_types_org_name", "organization_id", "name", unique=True),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    facility_id = Column(String(36), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)
    maintenance_type_id = Column(String(36), ForeignKey("facility_maintenance_types.id"), nullable=False, index=True)
    system_id = Column(String(36), ForeignKey("facility_systems.id", ondelete="SET NULL"), nullable=True, index=True)

    # Scheduling
    scheduled_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)

    # Completion
    completed_date = Column(Date, nullable=True)
    completed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
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
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    facility = relationship("Facility", back_populates="maintenance_records")
    maintenance_type = relationship("FacilityMaintenanceType", back_populates="maintenance_records")
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    facility_id = Column(String(36), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)

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
    archived_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Timestamps
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    facility_id = Column(String(36), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)

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
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

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
