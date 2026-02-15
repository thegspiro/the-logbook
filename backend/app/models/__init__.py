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

from app.models.forms import (
    Form,
    FormField,
    FormSubmission,
    FormIntegration,
    FormStatus,
    FormCategory,
    FieldType,
    IntegrationTarget,
    IntegrationType,
)

from app.models.document import (
    Document,
    DocumentFolder,
    DocumentStatus,
    DocumentType,
    SYSTEM_FOLDERS,
)

from app.models.meeting import (
    Meeting,
    MeetingAttendee,
    MeetingActionItem,
    MeetingType,
    MeetingStatus,
    ActionItemStatus,
)

from app.models.notification import (
    NotificationRule,
    NotificationLog,
    NotificationTrigger,
    NotificationCategory,
    NotificationChannel,
)

from app.models.integration import (
    Integration,
)

from app.models.analytics import (
    AnalyticsEvent,
)

from app.models.error_log import (
    ErrorLog,
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

from app.models.minute import (
    MeetingMinutes,
    MinutesTemplate,
    Motion,
    ActionItem,
    MinutesMeetingType,
    MinutesStatus,
    MotionStatus,
    MinutesActionItemStatus,
    ActionItemPriority,
)

from app.models.election import (
    Election,
    Candidate,
    VotingToken,
    Vote,
    ElectionStatus,
)

from app.models.event import (
    Event,
    EventRSVP,
    EventType,
    RSVPStatus,
    CheckInWindowType,
)

from app.models.training import (
    TrainingCategory,
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingApproval,
    TrainingProgram,
    ProgramPhase,
    ProgramRequirement,
    ProgramMilestone,
    ProgramEnrollment,
    RequirementProgress,
    SkillEvaluation,
    SkillCheckoff,
    ExternalTrainingProvider,
    ExternalCategoryMapping,
    ExternalUserMapping,
    ExternalTrainingSyncLog,
    ExternalTrainingImport,
    Shift,
    ShiftAttendance,
    ShiftCall,
)

from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ItemAssignment,
    CheckOutRecord,
    MaintenanceRecord as InventoryMaintenanceRecord,
    ItemType,
    ItemCondition,
    ItemStatus,
    AssignmentType,
)

from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    ProspectiveMember,
    ProspectStepProgress,
    ProspectActivityLog,
    PipelineStepType,
    ActionType,
    ProspectStatus,
    StepProgressStatus,
)

from app.models.ip_security import (
    IPException,
    BlockedAccessAttempt,
    CountryBlockRule,
    IPExceptionAuditLog,
    IPExceptionType,
    IPExceptionApprovalStatus,
)

from app.models.facilities import (
    FacilityType,
    FacilityStatus,
    Facility,
    FacilityPhoto,
    FacilityDocument,
    FacilityMaintenanceType,
    FacilityMaintenance,
    FacilitySystem,
    FacilityInspection,
    FacilityUtilityAccount,
    FacilityUtilityReading,
    FacilityAccessKey,
    FacilityRoom,
    FacilityEmergencyContact,
    FacilityShutoffLocation,
    FacilityCapitalProject,
    FacilityInsurancePolicy,
    FacilityOccupant,
    FacilityComplianceChecklist,
    FacilityComplianceItem,
    FacilityCategory,
    DefaultFacilityType,
    DefaultFacilityStatus,
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
    # Forms models
    "Form",
    "FormField",
    "FormSubmission",
    "FormIntegration",
    "FormStatus",
    "FormCategory",
    "FieldType",
    "IntegrationTarget",
    "IntegrationType",
    # Document models
    "Document",
    "DocumentFolder",
    "DocumentStatus",
    "DocumentType",
    "SYSTEM_FOLDERS",
    # Meeting models
    "Meeting",
    "MeetingAttendee",
    "MeetingActionItem",
    "MeetingType",
    "MeetingStatus",
    "ActionItemStatus",
    # Notification models
    "NotificationRule",
    "NotificationLog",
    "NotificationTrigger",
    "NotificationCategory",
    "NotificationChannel",
    # Integration models
    "Integration",
    # Analytics models
    "AnalyticsEvent",
    # Error log models
    "ErrorLog",
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
    # Minutes models
    "MeetingMinutes",
    "MinutesTemplate",
    "Motion",
    "ActionItem",
    "MinutesMeetingType",
    "MinutesStatus",
    "MotionStatus",
    "MinutesActionItemStatus",
    "ActionItemPriority",
    # Election models
    "Election",
    "Candidate",
    "VotingToken",
    "Vote",
    "ElectionStatus",
    # Event models
    "Event",
    "EventRSVP",
    "EventType",
    "RSVPStatus",
    "CheckInWindowType",
    # Training models
    "TrainingCategory",
    "TrainingCourse",
    "TrainingRecord",
    "TrainingRequirement",
    "TrainingSession",
    "TrainingApproval",
    "TrainingProgram",
    "ProgramPhase",
    "ProgramRequirement",
    "ProgramMilestone",
    "ProgramEnrollment",
    "RequirementProgress",
    "SkillEvaluation",
    "SkillCheckoff",
    "ExternalTrainingProvider",
    "ExternalCategoryMapping",
    "ExternalUserMapping",
    "ExternalTrainingSyncLog",
    "ExternalTrainingImport",
    "Shift",
    "ShiftAttendance",
    "ShiftCall",
    # Inventory models
    "InventoryCategory",
    "InventoryItem",
    "ItemAssignment",
    "CheckOutRecord",
    "InventoryMaintenanceRecord",
    "ItemType",
    "ItemCondition",
    "ItemStatus",
    "AssignmentType",
    # Membership pipeline models
    "MembershipPipeline",
    "MembershipPipelineStep",
    "ProspectiveMember",
    "ProspectStepProgress",
    "ProspectActivityLog",
    "PipelineStepType",
    "ActionType",
    "ProspectStatus",
    "StepProgressStatus",
    # IP Security models
    "IPException",
    "BlockedAccessAttempt",
    "CountryBlockRule",
    "IPExceptionAuditLog",
    "IPExceptionType",
    "IPExceptionApprovalStatus",
    # Facilities models
    "FacilityType",
    "FacilityStatus",
    "Facility",
    "FacilityPhoto",
    "FacilityDocument",
    "FacilityMaintenanceType",
    "FacilityMaintenance",
    "FacilitySystem",
    "FacilityInspection",
    "FacilityUtilityAccount",
    "FacilityUtilityReading",
    "FacilityAccessKey",
    "FacilityRoom",
    "FacilityEmergencyContact",
    "FacilityShutoffLocation",
    "FacilityCapitalProject",
    "FacilityInsurancePolicy",
    "FacilityOccupant",
    "FacilityComplianceChecklist",
    "FacilityComplianceItem",
    "FacilityCategory",
    "DefaultFacilityType",
    "DefaultFacilityStatus",
]
