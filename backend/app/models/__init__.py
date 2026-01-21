"""
Database Models

Exports all SQLAlchemy models for the application.
"""

from app.models.user import (
    Organization,
    User,
    Role,
    Session,
    UserStatus,
    user_roles
)

from app.models.audit import (
    AuditLog,
    AuditLogCheckpoint,
    SeverityLevel
)

from app.models.onboarding import (
    OnboardingStatus,
    OnboardingChecklistItem
)

from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ItemAssignment,
    CheckOutRecord,
    MaintenanceRecord,
    ItemType,
    ItemCondition,
    ItemStatus,
    MaintenanceType,
    AssignmentType,
)

__all__ = [
    # User models
    "Organization",
    "User",
    "Role",
    "Session",
    "UserStatus",
    "user_roles",
    # Audit models
    "AuditLog",
    "AuditLogCheckpoint",
    "SeverityLevel",
    # Onboarding models
    "OnboardingStatus",
    "OnboardingChecklistItem",
    # Inventory models
    "InventoryCategory",
    "InventoryItem",
    "ItemAssignment",
    "CheckOutRecord",
    "MaintenanceRecord",
    "ItemType",
    "ItemCondition",
    "ItemStatus",
    "MaintenanceType",
    "AssignmentType",
]
