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

from app.models.email_template import (
    EmailTemplate,
    EmailAttachment,
    EmailTemplateType,
)

from app.models.location import (
    Location
)

from app.models.public_portal import (
    PublicPortalConfig,
    PublicPortalAPIKey,
    PublicPortalAccessLog,
    PublicPortalDataWhitelist
)

from app.models.apparatus import (
    Apparatus,
    ApparatusType,
    ApparatusStatus,
    ApparatusCustomField,
    ApparatusPhoto,
    ApparatusDocument,
    ApparatusMaintenanceType,
    ApparatusMaintenance,
    ApparatusFuelLog,
    ApparatusOperator,
    ApparatusEquipment,
    ApparatusLocationHistory,
    ApparatusStatusHistory,
    ApparatusNFPACompliance,
    ApparatusReportConfig,
    ApparatusCategory,
    DefaultApparatusType,
    DefaultApparatusStatus,
    FuelType,
    CustomFieldType,
    MaintenanceCategory,
    MaintenanceIntervalUnit,
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
    # Email template models
    "EmailTemplate",
    "EmailAttachment",
    "EmailTemplateType",
    # Location models
    "Location",
    # Public Portal models
    "PublicPortalConfig",
    "PublicPortalAPIKey",
    "PublicPortalAccessLog",
    "PublicPortalDataWhitelist",
    # Apparatus models
    "Apparatus",
    "ApparatusType",
    "ApparatusStatus",
    "ApparatusCustomField",
    "ApparatusPhoto",
    "ApparatusDocument",
    "ApparatusMaintenanceType",
    "ApparatusMaintenance",
    "ApparatusFuelLog",
    "ApparatusOperator",
    "ApparatusEquipment",
    "ApparatusLocationHistory",
    "ApparatusStatusHistory",
    "ApparatusNFPACompliance",
    "ApparatusReportConfig",
    # Apparatus enums
    "ApparatusCategory",
    "DefaultApparatusType",
    "DefaultApparatusStatus",
    "FuelType",
    "CustomFieldType",
    "MaintenanceCategory",
    "MaintenanceIntervalUnit",
]
