"""
Inventory Database Models

SQLAlchemy models for inventory management including items, categories,
assignments, checkouts, and maintenance records.
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Date,
    Integer,
    Float,
    Text,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

from app.core.database import Base


def generate_uuid() -> str:
    """Generate a UUID string for MySQL compatibility"""
    return str(uuid.uuid4())


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


class AssignmentType(str, enum.Enum):
    """Type of assignment"""
    PERMANENT = "permanent"  # Permanently assigned (shows on user dashboard)
    TEMPORARY = "temporary"  # Temporary checkout


class InventoryCategory(Base):
    """
    Inventory Category model

    Organizes inventory items into categories for better organization and reporting.
    """

    __tablename__ = "inventory_categories"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Category Information
    name = Column(String(255), nullable=False)
    description = Column(Text)
    item_type = Column(Enum(ItemType), nullable=False)

    # Organization
    parent_category_id = Column(String(36), ForeignKey("inventory_categories.id", ondelete="SET NULL"))

    # Settings
    requires_assignment = Column(Boolean, default=False)  # Must be assigned to member
    requires_serial_number = Column(Boolean, default=False)
    requires_maintenance = Column(Boolean, default=False)
    low_stock_threshold = Column(Integer)  # Alert when quantity falls below this

    # Metadata
    metadata = Column(JSON)  # Additional category-specific data

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    items = relationship("InventoryItem", back_populates="category", foreign_keys="InventoryItem.category_id")
    parent_category = relationship("InventoryCategory", remote_side=[id], foreign_keys=[parent_category_id])

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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id = Column(String(36), ForeignKey("inventory_categories.id", ondelete="SET NULL"), index=True)

    # Basic Information
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    manufacturer = Column(String(255))
    model_number = Column(String(255))

    # Identification
    serial_number = Column(String(255), index=True)
    asset_tag = Column(String(255), unique=True, index=True)
    barcode = Column(String(255), unique=True, index=True)

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
    storage_location = Column(String(255))  # Building, room, shelf, etc.
    station = Column(String(100))  # Which station it's assigned to

    # Condition & Status
    condition = Column(Enum(ItemCondition), default=ItemCondition.GOOD, nullable=False, index=True)
    status = Column(Enum(ItemStatus), default=ItemStatus.AVAILABLE, nullable=False, index=True)
    status_notes = Column(Text)

    # Quantity (for consumables or bulk items)
    quantity = Column(Integer, default=1)
    unit_of_measure = Column(String(50))  # "each", "pair", "box", etc.

    # Maintenance
    last_inspection_date = Column(Date)
    next_inspection_due = Column(Date, index=True)
    inspection_interval_days = Column(Integer)  # How often to inspect

    # Assignment (current assignment if any)
    assigned_to_user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), index=True)
    assigned_date = Column(DateTime(timezone=True))

    # Additional Data
    notes = Column(Text)
    custom_fields = Column(JSON)  # Organization-specific fields
    attachments = Column(JSON)  # Links to photos, manuals, etc.

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    category = relationship("InventoryCategory", back_populates="items", foreign_keys=[category_id])
    assigned_to_user = relationship("User", foreign_keys=[assigned_to_user_id])
    checkout_records = relationship("CheckOutRecord", back_populates="item", cascade="all, delete-orphan")
    maintenance_records = relationship("MaintenanceRecord", back_populates="item", cascade="all, delete-orphan")
    assignment_history = relationship("ItemAssignment", back_populates="item", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_inventory_items_org_category", "organization_id", "category_id"),
        Index("idx_inventory_items_org_status", "organization_id", "status"),
        Index("idx_inventory_items_org_active", "organization_id", "active"),
        Index("idx_inventory_items_assigned_to", "assigned_to_user_id"),
        Index("idx_inventory_items_next_inspection", "next_inspection_due"),
    )


class ItemAssignment(Base):
    """
    Item Assignment model

    Tracks history of permanent assignments (who has had which items over time).
    """

    __tablename__ = "item_assignments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Assignment Details
    item_id = Column(String(36), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    assignment_type = Column(Enum(AssignmentType), default=AssignmentType.PERMANENT, nullable=False)

    # Dates
    assigned_date = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    returned_date = Column(DateTime(timezone=True))
    expected_return_date = Column(DateTime(timezone=True))

    # Assignment Info
    assigned_by = Column(String(36), ForeignKey("users.id"))
    returned_by = Column(String(36), ForeignKey("users.id"))
    assignment_reason = Column(Text)
    return_condition = Column(Enum(ItemCondition))
    return_notes = Column(Text)

    # Status
    is_active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    item = relationship("InventoryItem", back_populates="assignment_history", foreign_keys=[item_id])
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("idx_item_assignments_org_item", "organization_id", "item_id"),
        Index("idx_item_assignments_org_user", "organization_id", "user_id"),
        Index("idx_item_assignments_org_active", "organization_id", "is_active"),
    )


class CheckOutRecord(Base):
    """
    Check Out Record model

    Tracks temporary check-in/check-out of items from the pool.
    Used for items that aren't permanently assigned.
    """

    __tablename__ = "checkout_records"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Checkout Details
    item_id = Column(String(36), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Dates & Times
    checked_out_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expected_return_at = Column(DateTime(timezone=True))
    checked_in_at = Column(DateTime(timezone=True), index=True)

    # Checkout Info
    checked_out_by = Column(String(36), ForeignKey("users.id"))  # Who approved/logged the checkout
    checked_in_by = Column(String(36), ForeignKey("users.id"))  # Who logged the return
    checkout_reason = Column(Text)

    # Return Condition
    checkout_condition = Column(Enum(ItemCondition))
    return_condition = Column(Enum(ItemCondition))
    damage_notes = Column(Text)

    # Status
    is_returned = Column(Boolean, default=False, index=True)
    is_overdue = Column(Boolean, default=False, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    item = relationship("InventoryItem", back_populates="checkout_records", foreign_keys=[item_id])
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Maintenance Details
    item_id = Column(String(36), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    maintenance_type = Column(Enum(MaintenanceType), nullable=False)

    # Dates
    scheduled_date = Column(Date, index=True)
    completed_date = Column(Date, index=True)
    next_due_date = Column(Date, index=True)

    # Details
    performed_by = Column(String(36), ForeignKey("users.id"))
    vendor_name = Column(String(255))  # If serviced by external vendor
    cost = Column(Numeric(10, 2))

    # Condition Assessment
    condition_before = Column(Enum(ItemCondition))
    condition_after = Column(Enum(ItemCondition))

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
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    item = relationship("InventoryItem", back_populates="maintenance_records", foreign_keys=[item_id])
    technician = relationship("User", foreign_keys=[performed_by])

    __table_args__ = (
        Index("idx_maintenance_records_org_item", "organization_id", "item_id"),
        Index("idx_maintenance_records_org_scheduled", "organization_id", "scheduled_date"),
        Index("idx_maintenance_records_org_next_due", "organization_id", "next_due_date"),
        Index("idx_maintenance_records_org_completed", "organization_id", "is_completed"),
    )
