"""
Inventory Database Models

SQLAlchemy models for inventory management including items, categories,
assignments, checkouts, and maintenance records.
"""

import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
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
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class ItemType(str, enum.Enum):
    """Type of inventory item"""

    UNIFORM = "uniform"  # Shirts, jackets, Class A brass
    PPE = "ppe"  # Personal Protective Equipment
    TOOL = "tool"  # Hand tools, power tools
    EQUIPMENT = "equipment"  # Rescue equipment, medical supplies
    VEHICLE = "vehicle"  # Fire engines, ambulances, utility vehicles
    ELECTRONICS = "electronics"  # Radios, tablets, computers, cameras
    CONSUMABLE = "consumable"  # Items that get used up
    OTHER = "other"


class ItemCondition(str, enum.Enum):
    """Current condition of item"""

    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    DAMAGED = "damaged"
    OUT_OF_SERVICE = "out_of_service"
    RETIRED = "retired"


class ItemStatus(str, enum.Enum):
    """Status of inventory item"""

    AVAILABLE = "available"  # Available for checkout
    ASSIGNED = "assigned"  # Permanently assigned to member
    CHECKED_OUT = "checked_out"  # Temporarily checked out
    IN_MAINTENANCE = "in_maintenance"  # Being serviced
    LOST = "lost"
    STOLEN = "stolen"
    RETIRED = "retired"


class MaintenanceType(str, enum.Enum):
    """Type of maintenance"""

    INSPECTION = "inspection"
    REPAIR = "repair"
    CLEANING = "cleaning"
    TESTING = "testing"
    CALIBRATION = "calibration"
    REPLACEMENT = "replacement"
    PREVENTIVE = "preventive"
    # NFPA 1851 inspection levels
    ROUTINE_INSPECTION = "routine_inspection"
    ADVANCED_INSPECTION = "advanced_inspection"
    INDEPENDENT_INSPECTION = "independent_inspection"
    ADVANCED_CLEANING = "advanced_cleaning"
    DECONTAMINATION = "decontamination"


class NFPAInspectionLevel(str, enum.Enum):
    """NFPA 1851 inspection classification"""

    ROUTINE = "routine"  # After each use / regular visual
    ADVANCED = "advanced"  # Annual per NFPA 1851 Ch. 7
    INDEPENDENT = "independent"  # ISP organization per NFPA 1851 Ch. 8


class ContaminationLevel(str, enum.Enum):
    """Contamination classification per NFPA 1851"""

    NONE = "none"
    LIGHT = "light"  # Routine cleaning sufficient
    MODERATE = "moderate"  # Advanced cleaning required
    HEAVY = "heavy"  # Decontamination / may require retirement
    GROSS = "gross"  # Immediate retirement


class ExposureType(str, enum.Enum):
    """Types of hazardous exposure events"""

    STRUCTURE_FIRE = "structure_fire"
    VEHICLE_FIRE = "vehicle_fire"
    WILDLAND_FIRE = "wildland_fire"
    HAZMAT = "hazmat"
    BLOODBORNE_PATHOGEN = "bloodborne_pathogen"
    CHEMICAL = "chemical"
    SMOKE = "smoke"
    OTHER = "other"


class AssignmentType(str, enum.Enum):
    """Type of assignment"""

    PERMANENT = "permanent"  # Permanently assigned (shows on user dashboard)
    TEMPORARY = "temporary"  # Temporary checkout


class TrackingType(str, enum.Enum):
    """How inventory items are tracked"""

    INDIVIDUAL = (
        "individual"  # Unique item with serial number, assigned 1:1 to a member
    )
    POOL = "pool"  # Quantity-tracked pool; units are issued to members and returned


class InventoryCategory(Base):
    """
    Inventory Category model

    Organizes inventory items into categories for better organization and reporting.
    """

    __tablename__ = "inventory_categories"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Category Information
    name = Column(String(255), nullable=False)
    description = Column(Text)
    item_type = Column(
        Enum(ItemType, values_callable=lambda x: [e.value for e in x]), nullable=False
    )

    # Organization
    parent_category_id = Column(
        String(36), ForeignKey("inventory_categories.id", ondelete="SET NULL")
    )

    # Settings
    requires_assignment = Column(Boolean, default=False)  # Must be assigned to member
    requires_serial_number = Column(Boolean, default=False)
    requires_maintenance = Column(Boolean, default=False)
    low_stock_threshold = Column(Integer)  # Alert when quantity falls below this
    nfpa_tracking_enabled = Column(
        Boolean, default=False, nullable=False, server_default="0"
    )  # Enable NFPA 1851/1852 lifecycle tracking for this category

    # Extra data
    extra_data = Column(JSON)  # Additional category-specific data

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    items = relationship(
        "InventoryItem",
        back_populates="category",
        foreign_keys="InventoryItem.category_id",
    )
    parent_category = relationship(
        "InventoryCategory", remote_side=[id], foreign_keys=[parent_category_id]
    )

    __table_args__ = (
        Index("idx_inventory_categories_org_type", "organization_id", "item_type"),
        Index("idx_inventory_categories_org_active", "organization_id", "active"),
    )


class InventoryItem(Base):
    """
    Inventory Item model

    Represents individual items in the inventory system with full tracking
    of serial numbers, purchase info, condition, maintenance, and assignments.
    """

    __tablename__ = "inventory_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id = Column(
        String(36),
        ForeignKey("inventory_categories.id", ondelete="SET NULL"),
        index=True,
    )

    # Basic Information
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    manufacturer = Column(String(255))
    model_number = Column(String(255))

    # Identification
    serial_number = Column(String(255), index=True)
    asset_tag = Column(String(255), index=True)
    barcode = Column(String(255), index=True)

    # Purchase Information
    purchase_date = Column(Date)
    purchase_price = Column(Numeric(10, 2))
    purchase_order = Column(String(255))
    vendor = Column(String(255))
    warranty_expiration = Column(Date)

    # Depreciation
    expected_lifetime_years = Column(Integer)
    current_value = Column(Numeric(10, 2))

    # Physical Details
    size = Column(String(50))  # Small, Medium, Large, or specific measurements
    color = Column(String(50))
    weight = Column(Float)  # Weight in pounds or kg

    # Location
    location_id = Column(
        String(36), ForeignKey("locations.id", ondelete="SET NULL"), index=True
    )  # Room reference
    storage_location = Column(
        String(255)
    )  # Free-text storage area (legacy, e.g., Shelf B-3)
    storage_area_id = Column(
        String(36), ForeignKey("storage_areas.id", ondelete="SET NULL"), index=True
    )  # Structured storage area
    station = Column(String(100))  # Which station it's assigned to

    # Condition & Status
    condition = Column(
        Enum(ItemCondition, values_callable=lambda x: [e.value for e in x]),
        default=ItemCondition.GOOD,
        nullable=False,
        index=True,
    )
    status = Column(
        Enum(ItemStatus, values_callable=lambda x: [e.value for e in x]),
        default=ItemStatus.AVAILABLE,
        nullable=False,
        index=True,
    )
    status_notes = Column(Text)

    # Tracking mode: "individual" (serial-numbered, 1:1 assignment) or "pool" (quantity-tracked, issue/return)
    tracking_type = Column(
        Enum(TrackingType, values_callable=lambda x: [e.value for e in x]),
        default=TrackingType.INDIVIDUAL,
        nullable=False,
        server_default="individual",
    )

    # Quantity (for pool items)
    quantity = Column(Integer, default=1)  # On-hand / available count
    quantity_issued = Column(Integer, default=0)  # Currently issued to members
    unit_of_measure = Column(String(50))  # "each", "pair", "box", etc.

    # Maintenance
    last_inspection_date = Column(Date)
    next_inspection_due = Column(Date)
    inspection_interval_days = Column(Integer)  # How often to inspect

    # Assignment (current assignment if any)
    assigned_to_user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL")
    )
    assigned_date = Column(DateTime(timezone=True))

    # Rank restriction — only members at or above this rank (sort_order <= value)
    # can request this item.  NULL means no restriction (available to all).
    min_rank_order = Column(Integer, nullable=True)

    # Position restriction — only members holding one of these corporate
    # positions (by slug) can request this item.  NULL / empty = no restriction.
    restricted_to_positions = Column(
        JSON, nullable=True
    )  # e.g. ["president", "safety_officer"]

    # Additional Data
    notes = Column(Text)
    custom_fields = Column(JSON)  # Organization-specific fields
    attachments = Column(JSON)  # Links to photos, manuals, etc.

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    category = relationship(
        "InventoryCategory", back_populates="items", foreign_keys=[category_id]
    )
    location = relationship("Location", foreign_keys=[location_id])
    storage_area = relationship("StorageArea", foreign_keys=[storage_area_id])
    assigned_to_user = relationship("User", foreign_keys=[assigned_to_user_id])
    checkout_records = relationship(
        "CheckOutRecord", back_populates="item", cascade="all, delete-orphan"
    )
    maintenance_records = relationship(
        "MaintenanceRecord", back_populates="item", cascade="all, delete-orphan"
    )
    assignment_history = relationship(
        "ItemAssignment", back_populates="item", cascade="all, delete-orphan"
    )
    issuance_records = relationship(
        "ItemIssuance", back_populates="item", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_inventory_items_org_category", "organization_id", "category_id"),
        Index("idx_inventory_items_org_status", "organization_id", "status"),
        Index("idx_inventory_items_org_active", "organization_id", "active"),
        Index("idx_inventory_items_assigned_to", "assigned_to_user_id"),
        Index("idx_inventory_items_next_inspection", "next_inspection_due"),
        Index("idx_inventory_items_tracking_type", "organization_id", "tracking_type"),
        # Barcode, asset_tag, and serial_number uniqueness scoped per organization (multi-tenant)
        UniqueConstraint("organization_id", "barcode", name="uq_item_org_barcode"),
        UniqueConstraint("organization_id", "asset_tag", name="uq_item_org_asset_tag"),
        UniqueConstraint(
            "organization_id", "serial_number", name="uq_item_org_serial_number"
        ),
    )


class ItemAssignment(Base):
    """
    Item Assignment model

    Tracks history of permanent assignments (who has had which items over time).
    """

    __tablename__ = "item_assignments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Assignment Details
    item_id = Column(
        String(36),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assignment_type = Column(
        Enum(AssignmentType, values_callable=lambda x: [e.value for e in x]),
        default=AssignmentType.PERMANENT,
        nullable=False,
    )

    # Dates
    assigned_date = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    returned_date = Column(DateTime(timezone=True))
    expected_return_date = Column(DateTime(timezone=True))

    # Assignment Info
    assigned_by = Column(String(36), ForeignKey("users.id"))
    returned_by = Column(String(36), ForeignKey("users.id"))
    assignment_reason = Column(Text)
    return_condition = Column(
        Enum(ItemCondition, values_callable=lambda x: [e.value for e in x])
    )
    return_notes = Column(Text)

    # Status
    is_active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    item = relationship(
        "InventoryItem", back_populates="assignment_history", foreign_keys=[item_id]
    )
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("idx_item_assignments_org_item", "organization_id", "item_id"),
        Index("idx_item_assignments_org_user", "organization_id", "user_id"),
        Index("idx_item_assignments_org_active", "organization_id", "is_active"),
    )


class ItemIssuance(Base):
    """
    Item Issuance model

    Tracks units issued from a pool-tracked inventory item.
    For example: "Dept T-Shirt (Medium)" has quantity=20; issuing 1 to
    a member creates an ItemIssuance, decrements the pool's quantity,
    and increments quantity_issued.  Returning reverses the operation.
    """

    __tablename__ = "item_issuances"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Which pool item and who received the issuance
    item_id = Column(
        String(36),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # How many units were issued (usually 1)
    quantity_issued = Column(Integer, nullable=False, default=1)

    # Dates
    issued_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    returned_at = Column(DateTime(timezone=True))

    # Audit trail
    issued_by = Column(String(36), ForeignKey("users.id"))
    returned_by = Column(String(36), ForeignKey("users.id"))

    # Context
    issue_reason = Column(Text)
    return_condition = Column(
        Enum(ItemCondition, values_callable=lambda x: [e.value for e in x])
    )
    return_notes = Column(Text)

    # Status
    is_returned = Column(Boolean, default=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    item = relationship(
        "InventoryItem", back_populates="issuance_records", foreign_keys=[item_id]
    )
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("idx_item_issuances_org_item", "organization_id", "item_id"),
        Index("idx_item_issuances_org_user", "organization_id", "user_id"),
        Index("idx_item_issuances_org_returned", "organization_id", "is_returned"),
    )


class CheckOutRecord(Base):
    """
    Check Out Record model

    Tracks temporary check-in/check-out of items from the pool.
    Used for items that aren't permanently assigned.
    """

    __tablename__ = "checkout_records"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Checkout Details
    item_id = Column(
        String(36),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Dates & Times
    checked_out_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expected_return_at = Column(DateTime(timezone=True))
    checked_in_at = Column(DateTime(timezone=True), index=True)

    # Checkout Info
    checked_out_by = Column(
        String(36), ForeignKey("users.id")
    )  # Who approved/logged the checkout
    checked_in_by = Column(String(36), ForeignKey("users.id"))  # Who logged the return
    checkout_reason = Column(Text)

    # Return Condition
    checkout_condition = Column(
        Enum(ItemCondition, values_callable=lambda x: [e.value for e in x])
    )
    return_condition = Column(
        Enum(ItemCondition, values_callable=lambda x: [e.value for e in x])
    )
    damage_notes = Column(Text)

    # Status
    is_returned = Column(Boolean, default=False, index=True)
    is_overdue = Column(Boolean, default=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    item = relationship(
        "InventoryItem", back_populates="checkout_records", foreign_keys=[item_id]
    )
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("idx_checkout_records_org_item", "organization_id", "item_id"),
        Index("idx_checkout_records_org_user", "organization_id", "user_id"),
        Index("idx_checkout_records_org_returned", "organization_id", "is_returned"),
        Index("idx_checkout_records_org_overdue", "organization_id", "is_overdue"),
    )


class MaintenanceRecord(Base):
    """
    Maintenance Record model

    Tracks inspections, repairs, cleaning, and other maintenance activities.
    """

    __tablename__ = "maintenance_records"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Maintenance Details
    item_id = Column(
        String(36),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    maintenance_type = Column(
        Enum(MaintenanceType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Dates
    scheduled_date = Column(Date, index=True)
    completed_date = Column(Date, index=True)
    next_due_date = Column(Date, index=True)

    # Details
    performed_by = Column(String(36), ForeignKey("users.id"))
    vendor_name = Column(String(255))  # If serviced by external vendor
    cost = Column(Numeric(10, 2))

    # Condition Assessment
    condition_before = Column(
        Enum(ItemCondition, values_callable=lambda x: [e.value for e in x])
    )
    condition_after = Column(
        Enum(ItemCondition, values_callable=lambda x: [e.value for e in x])
    )

    # Work Performed
    description = Column(Text)
    parts_replaced = Column(JSON)  # List of parts that were replaced
    parts_cost = Column(Numeric(10, 2))
    labor_hours = Column(Float)

    # Results
    passed = Column(Boolean)  # For inspections
    notes = Column(Text)
    issues_found = Column(JSON)  # List of issues discovered
    attachments = Column(JSON)  # Photos, service reports, etc.

    # Status
    is_completed = Column(Boolean, default=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    item = relationship(
        "InventoryItem", back_populates="maintenance_records", foreign_keys=[item_id]
    )
    technician = relationship("User", foreign_keys=[performed_by])

    __table_args__ = (
        Index("idx_maintenance_records_org_item", "organization_id", "item_id"),
        Index(
            "idx_maintenance_records_org_scheduled", "organization_id", "scheduled_date"
        ),
        Index(
            "idx_maintenance_records_org_next_due", "organization_id", "next_due_date"
        ),
        Index(
            "idx_maintenance_records_org_completed", "organization_id", "is_completed"
        ),
    )


class ClearanceStatus(str, enum.Enum):
    """Status of a departure clearance"""

    INITIATED = "initiated"  # Clearance created, items being collected
    IN_PROGRESS = "in_progress"  # Some items returned, some outstanding
    COMPLETED = "completed"  # All items returned or accounted for
    CLOSED_INCOMPLETE = "closed_incomplete"  # Closed with outstanding items (write-off)


class ClearanceLineDisposition(str, enum.Enum):
    """How an individual clearance line item was resolved"""

    PENDING = "pending"  # Not yet returned
    RETURNED = "returned"  # Physically returned in acceptable condition
    RETURNED_DAMAGED = "returned_damaged"  # Returned but damaged
    WRITTEN_OFF = "written_off"  # Lost/unreturnable, written off by leadership
    WAIVED = "waived"  # Department chose not to require return


class DepartureClearance(Base):
    """
    Departure Clearance model

    Tracks the overall clearance process when a member leaves the department.
    Created when a member is dropped; completed when all outstanding items
    are returned or accounted for. Serves as the single record of the
    member's departure property pipeline.
    """

    __tablename__ = "departure_clearances"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # Clearance status
    status = Column(
        Enum(ClearanceStatus, values_callable=lambda x: [e.value for e in x]),
        default=ClearanceStatus.INITIATED,
        nullable=False,
    )

    # Summary counts (denormalized for quick dashboard reads)
    total_items = Column(Integer, nullable=False, default=0)
    items_cleared = Column(Integer, nullable=False, default=0)
    items_outstanding = Column(Integer, nullable=False, default=0)
    total_value = Column(Numeric(10, 2), nullable=False, default=0)
    value_outstanding = Column(Numeric(10, 2), nullable=False, default=0)

    # Dates
    initiated_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))
    return_deadline = Column(DateTime(timezone=True))

    # Who initiated and who signed off
    initiated_by = Column(String(36), ForeignKey("users.id"))
    completed_by = Column(String(36), ForeignKey("users.id"))

    # Notes / context
    departure_type = Column(
        String(30)
    )  # "dropped_voluntary", "dropped_involuntary", "retired"
    notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    initiated_by_user = relationship("User", foreign_keys=[initiated_by])
    completed_by_user = relationship("User", foreign_keys=[completed_by])
    line_items = relationship(
        "DepartureClearanceItem",
        back_populates="clearance",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_departure_clearance_org_user", "organization_id", "user_id"),
        Index("idx_departure_clearance_org_status", "organization_id", "status"),
    )


class DepartureClearanceItem(Base):
    """
    Departure Clearance Line Item

    One row per outstanding item (assignment, checkout, or pool issuance)
    that a departing member must return. Tracks the disposition of each
    line — returned, damaged, written off, or waived.
    """

    __tablename__ = "departure_clearance_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    clearance_id = Column(
        String(36),
        ForeignKey("departure_clearances.id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # What type of record this line refers to
    source_type = Column(
        String(20), nullable=False
    )  # "assignment", "checkout", "issuance"
    source_id = Column(
        String(36), nullable=False
    )  # ID of the ItemAssignment / CheckOutRecord / ItemIssuance

    # Snapshot of item info at clearance creation (so it remains readable even if item is later retired)
    item_id = Column(String(36), ForeignKey("inventory_items.id", ondelete="SET NULL"))
    item_name = Column(String(255), nullable=False)
    item_serial_number = Column(String(255))
    item_asset_tag = Column(String(255))
    item_value = Column(Numeric(10, 2))
    quantity = Column(Integer, nullable=False, default=1)

    # Resolution
    disposition = Column(
        Enum(ClearanceLineDisposition, values_callable=lambda x: [e.value for e in x]),
        default=ClearanceLineDisposition.PENDING,
        nullable=False,
    )
    return_condition = Column(
        Enum(ItemCondition, values_callable=lambda x: [e.value for e in x])
    )
    resolved_at = Column(DateTime(timezone=True))
    resolved_by = Column(String(36), ForeignKey("users.id"))
    resolution_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    clearance = relationship(
        "DepartureClearance", back_populates="line_items", foreign_keys=[clearance_id]
    )
    item = relationship("InventoryItem", foreign_keys=[item_id])
    resolved_by_user = relationship("User", foreign_keys=[resolved_by])

    __table_args__ = (
        Index("idx_clearance_item_clearance", "clearance_id"),
        Index("idx_clearance_item_disposition", "clearance_id", "disposition"),
    )


class InventoryActionType(str, enum.Enum):
    """Types of inventory actions that generate notifications"""

    ASSIGNED = "assigned"  # Individual item permanently assigned
    UNASSIGNED = "unassigned"  # Individual item returned / unassigned
    ISSUED = "issued"  # Pool item units issued to member
    RETURNED = "returned"  # Pool item units returned to pool
    CHECKED_OUT = "checked_out"  # Individual item temporarily checked out
    CHECKED_IN = "checked_in"  # Individual item checked back in
    RETIRED = "retired"  # Item retired / decommissioned


class InventoryNotificationQueue(Base):
    """
    Queues inventory change events for delayed, consolidated email
    notifications.  A scheduled task processes records older than 1 hour,
    groups them per member, nets out offsetting actions (e.g. issue + return
    of the same item cancel out), and sends a single email per member
    summarising the net changes.
    """

    __tablename__ = "inventory_notification_queue"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # What happened
    action_type = Column(
        Enum(InventoryActionType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Item snapshot (readable even if item is later retired)
    item_id = Column(String(36), ForeignKey("inventory_items.id", ondelete="SET NULL"))
    item_name = Column(String(255), nullable=False)
    item_serial_number = Column(String(255))
    item_asset_tag = Column(String(255))
    quantity = Column(Integer, nullable=False, default=1)

    # Who performed the action
    performed_by = Column(String(36), ForeignKey("users.id"))

    # Processing state
    processed = Column(Boolean, default=False, nullable=False, index=True)
    processed_at = Column(DateTime(timezone=True))

    # Timestamps
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    item = relationship("InventoryItem", foreign_keys=[item_id])

    __table_args__ = (
        Index("idx_inv_notif_queue_pending", "processed", "created_at"),
        Index("idx_inv_notif_queue_org_user", "organization_id", "user_id"),
    )


class PropertyReturnReminder(Base):
    """
    Tracks which property-return reminder notices have been sent to
    dropped members so we don't send duplicates.
    """

    __tablename__ = "property_return_reminders"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    reminder_type = Column(String(20), nullable=False)  # "30_day" or "90_day"
    items_outstanding = Column(Integer, nullable=False, default=0)
    total_value_outstanding = Column(Numeric(10, 2), nullable=False, default=0)
    sent_to_member = Column(Boolean, nullable=False, default=True)
    sent_to_admin = Column(Boolean, nullable=False, default=True)
    sent_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("idx_prop_reminder_org_user", "organization_id", "user_id"),
        Index("idx_prop_reminder_type", "user_id", "reminder_type"),
    )

    def __repr__(self):
        return f"<PropertyReturnReminder(user_id={self.user_id}, type={self.reminder_type})>"


class RequestType(str, enum.Enum):
    """Type of equipment request"""

    CHECKOUT = "checkout"  # Temporary checkout
    ISSUANCE = "issuance"  # Pool item issuance
    PURCHASE = "purchase"  # Request to purchase new item


class RequestStatus(str, enum.Enum):
    """Status of equipment request"""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    FULFILLED = "fulfilled"


class RequestPriority(str, enum.Enum):
    """Priority of equipment request"""

    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


class EquipmentRequest(Base):
    """
    Equipment Request model

    Members can request equipment checkouts, pool issuances, or purchases.
    Admins/quartermasters review and approve/deny requests.
    """

    __tablename__ = "equipment_requests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Requester
    requester_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # What they're requesting
    item_name = Column(String(255), nullable=False)  # Description of what's needed
    item_id = Column(
        String(36), ForeignKey("inventory_items.id", ondelete="SET NULL")
    )  # Specific item (optional)
    category_id = Column(
        String(36), ForeignKey("inventory_categories.id", ondelete="SET NULL")
    )  # Category (optional)
    quantity = Column(Integer, nullable=False, default=1)
    request_type = Column(
        Enum(RequestType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=RequestType.CHECKOUT,
    )
    priority = Column(
        Enum(RequestPriority, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=RequestPriority.NORMAL,
    )
    reason = Column(Text)

    # Review
    status = Column(
        Enum(RequestStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=RequestStatus.PENDING,
        index=True,
    )
    reviewed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at = Column(DateTime(timezone=True))
    review_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    requester = relationship("User", foreign_keys=[requester_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    item = relationship("InventoryItem", foreign_keys=[item_id])
    category = relationship("InventoryCategory", foreign_keys=[category_id])

    __table_args__ = (
        Index("idx_equip_requests_org_status", "organization_id", "status"),
        Index("idx_equip_requests_requester", "requester_id", "status"),
    )


class StorageLocationType(str, enum.Enum):
    """Type of storage location in the hierarchy"""

    RACK = "rack"  # Storage rack or closet
    SHELF = "shelf"  # Shelf within a rack/closet
    BOX = "box"  # Box (may be on a shelf or standalone)
    CABINET = "cabinet"  # Cabinet or locker
    DRAWER = "drawer"  # Drawer within a cabinet
    BIN = "bin"  # Bin or container
    OTHER = "other"


class StorageArea(Base):
    """
    Storage Area model

    Provides structured storage location hierarchy within rooms/locations.
    Hierarchy: Room (Location) → Storage Area → Rack/Closet → Shelf → Box

    Each storage area can have a parent, enabling flexible nesting:
    - A rack belongs to a room (via location_id)
    - A shelf belongs to a rack (via parent_id)
    - A box belongs to a shelf (via parent_id) or directly to a room
    """

    __tablename__ = "storage_areas"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Name and label (e.g., "Rack A", "Shelf 3", "Box 12")
    name = Column(String(255), nullable=False)
    label = Column(String(100))  # Short label/number for quick reference
    description = Column(Text)

    # Type of storage location
    storage_type = Column(
        Enum(StorageLocationType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Hierarchy: parent storage area (e.g., shelf's parent = rack)
    parent_id = Column(
        String(36), ForeignKey("storage_areas.id", ondelete="CASCADE"), index=True
    )

    # Room/location this storage area belongs to (top-level only; children inherit)
    location_id = Column(
        String(36), ForeignKey("locations.id", ondelete="SET NULL"), index=True
    )

    # Optional: barcode or QR code for scanning
    barcode = Column(String(255))

    # Ordering within parent
    sort_order = Column(Integer, default=0)

    # Status
    is_active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    parent = relationship("StorageArea", remote_side=[id], foreign_keys=[parent_id])
    children = relationship(
        "StorageArea", foreign_keys=[parent_id], cascade="all, delete-orphan"
    )
    location = relationship("Location", foreign_keys=[location_id])

    __table_args__ = (
        Index("idx_storage_areas_org", "organization_id"),
        Index("idx_storage_areas_parent", "parent_id"),
        Index("idx_storage_areas_location", "location_id"),
    )


class WriteOffStatus(str, enum.Enum):
    """Status of a write-off request"""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


class WriteOffRequest(Base):
    """
    Write-Off Request model

    When an inventory item is lost, damaged beyond repair, or otherwise needs
    to be removed from active inventory, a write-off request is created.
    Items above a configurable value threshold require supervisor approval
    before the write-off is finalized. Lower-value items may be auto-approved
    by quartermasters.
    """

    __tablename__ = "inventory_write_offs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The item being written off
    item_id = Column(String(36), ForeignKey("inventory_items.id", ondelete="SET NULL"))
    item_name = Column(String(255), nullable=False)
    item_serial_number = Column(String(255))
    item_asset_tag = Column(String(255))
    item_value = Column(Numeric(10, 2))

    # Reason / justification
    reason = Column(
        String(50),
        nullable=False,
        default="lost",
    )  # lost, damaged_beyond_repair, obsolete, stolen, other
    description = Column(Text, nullable=False)

    # Approval status
    status = Column(
        Enum(WriteOffStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=WriteOffStatus.PENDING,
        index=True,
    )

    # Who requested and who reviewed
    requested_by = Column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    reviewed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at = Column(DateTime(timezone=True))
    review_notes = Column(Text)

    # Optional link to departure clearance
    clearance_id = Column(
        String(36), ForeignKey("departure_clearances.id", ondelete="SET NULL")
    )
    clearance_item_id = Column(String(36))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    item = relationship("InventoryItem", foreign_keys=[item_id])
    requester = relationship("User", foreign_keys=[requested_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    clearance = relationship("DepartureClearance", foreign_keys=[clearance_id])

    __table_args__ = (
        Index("idx_write_off_org_status", "organization_id", "status"),
        Index("idx_write_off_item", "item_id"),
    )


# ============================================
# NFPA 1851/1852 Compliance Models
# ============================================


class NFPAItemCompliance(Base):
    """
    NFPA 1851/1852 compliance record for PPE and SCBA items.

    Stores lifecycle dates, ensemble grouping, and SCBA-specific fields
    required by NFPA standards.  One-to-one with InventoryItem; only
    created when the item's category has nfpa_tracking_enabled = True.
    """

    __tablename__ = "nfpa_item_compliance"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    item_id = Column(
        String(36),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # NFPA 1851 §10.1.2 — Lifecycle Dates
    manufacture_date = Column(Date, nullable=True)
    first_in_service_date = Column(Date, nullable=True)
    expected_retirement_date = Column(Date, nullable=True)
    retirement_reason = Column(String(255), nullable=True)
    is_retired_by_age = Column(Boolean, default=False)

    # Ensemble tracking — group coat + pants + helmet + gloves + boots
    ensemble_id = Column(String(36), nullable=True, index=True)
    ensemble_role = Column(
        String(50), nullable=True
    )  # "coat", "pants", "helmet", "gloves", "boots", "hood"

    # SCBA-specific (NFPA 1852)
    cylinder_manufacture_date = Column(Date, nullable=True)
    cylinder_expiration_date = Column(Date, nullable=True)
    hydrostatic_test_date = Column(Date, nullable=True)
    hydrostatic_test_due = Column(Date, nullable=True)
    flow_test_date = Column(Date, nullable=True)
    flow_test_due = Column(Date, nullable=True)

    # Last known contamination level
    contamination_level = Column(
        Enum(ContaminationLevel, values_callable=lambda x: [e.value for e in x]),
        default=ContaminationLevel.NONE,
    )

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    item = relationship("InventoryItem", foreign_keys=[item_id])

    __table_args__ = (
        Index("idx_nfpa_compliance_org", "organization_id"),
        Index("idx_nfpa_compliance_ensemble", "organization_id", "ensemble_id"),
        Index(
            "idx_nfpa_compliance_retirement",
            "organization_id",
            "expected_retirement_date",
        ),
    )


class NFPAInspectionDetail(Base):
    """
    NFPA-specific inspection fields extending a MaintenanceRecord.

    When a maintenance record is created for an NFPA-tracked item with
    maintenance_type in (inspection, routine_inspection, advanced_inspection,
    independent_inspection), this record stores the structured pass/fail
    results required by NFPA 1851 Chapters 6-8.
    """

    __tablename__ = "nfpa_inspection_details"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    maintenance_record_id = Column(
        String(36),
        ForeignKey("maintenance_records.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # NFPA 1851 inspection level
    inspection_level = Column(
        Enum(NFPAInspectionLevel, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Structured pass/fail assessments (NFPA 1851 Ch. 6-8)
    thermal_damage = Column(Boolean, nullable=True)  # True = passed
    moisture_barrier = Column(Boolean, nullable=True)
    seam_integrity = Column(Boolean, nullable=True)
    reflective_trim = Column(Boolean, nullable=True)
    closure_systems = Column(Boolean, nullable=True)  # Zippers, hooks, snaps
    liner_integrity = Column(Boolean, nullable=True)

    # Contamination assessment
    contamination_level = Column(
        Enum(ContaminationLevel, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )

    # SCBA-specific inspection fields
    facepiece_seal = Column(Boolean, nullable=True)
    regulator_function = Column(Boolean, nullable=True)
    cylinder_pressure = Column(Float, nullable=True)  # psi at inspection
    low_air_alarm = Column(Boolean, nullable=True)

    # Overall recommendation
    recommendation = Column(
        String(50), nullable=True
    )  # "pass", "repair", "advanced_cleaning", "retire"

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    maintenance_record = relationship(
        "MaintenanceRecord", foreign_keys=[maintenance_record_id]
    )

    __table_args__ = (
        Index("idx_nfpa_inspection_org_level", "organization_id", "inspection_level"),
    )


class NFPAExposureRecord(Base):
    """
    Tracks hazardous exposure events for NFPA-tracked PPE items.

    NFPA 1851 §6.2 requires recording exposure events (fire, hazmat,
    bloodborne pathogen) so that appropriate cleaning and inspection
    can be performed.
    """

    __tablename__ = "nfpa_exposure_records"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    item_id = Column(
        String(36),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Exposure details
    exposure_type = Column(
        Enum(ExposureType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    exposure_date = Column(Date, nullable=False)
    incident_number = Column(String(100), nullable=True)  # CAD / incident reference
    description = Column(Text, nullable=True)

    # Decontamination status
    decon_required = Column(Boolean, default=False)
    decon_completed = Column(Boolean, default=False)
    decon_completed_date = Column(Date, nullable=True)
    decon_method = Column(String(255), nullable=True)

    # Who was using the item during exposure
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    item = relationship("InventoryItem", foreign_keys=[item_id])
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("idx_nfpa_exposure_org_item", "organization_id", "item_id"),
        Index("idx_nfpa_exposure_org_date", "organization_id", "exposure_date"),
    )
