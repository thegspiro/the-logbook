"""
Organization Pydantic Schemas

Request and response schemas for organization-related endpoints.
"""

import re
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.constants import ADMIN_NOTIFY_ROLE_SLUGS


class OrganizationTypeEnum(str, Enum):
    """Organization/Department type"""

    FIRE_DEPARTMENT = "fire_department"
    EMS_ONLY = "ems_only"
    FIRE_EMS_COMBINED = "fire_ems_combined"


class IdentifierTypeEnum(str, Enum):
    """Type of department identifier used"""

    FDID = "fdid"
    STATE_ID = "state_id"
    DEPARTMENT_ID = "department_id"


class AddressSchema(BaseModel):
    """Address schema for mailing and physical addresses"""

    line1: str = Field(..., min_length=1, max_length=255)
    line2: Optional[str] = Field(None, max_length=255)
    city: str = Field(..., min_length=1, max_length=100)
    state: str = Field(..., min_length=2, max_length=50)
    zip_code: str = Field(..., min_length=5, max_length=20)
    country: str = Field(default="USA", max_length=100)

    @field_validator("zip_code")
    @classmethod
    def validate_zip(cls, v: str) -> str:
        """Validate ZIP code format"""
        v = v.strip()
        # Allow US ZIP (12345 or 12345-6789) or Canadian postal codes
        if not re.match(r"^(\d{5}(-\d{4})?|[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d)$", v):
            raise ValueError("Invalid ZIP/postal code format")
        return v


class ContactInfoSettings(BaseModel):
    """Settings for controlling member contact information visibility"""

    enabled: bool = Field(
        default=False, description="Whether to show contact information on member list"
    )
    show_email: bool = Field(default=True, description="Show email addresses")
    show_phone: bool = Field(default=True, description="Show phone numbers")
    show_mobile: bool = Field(default=True, description="Show mobile phone numbers")


def _redact(value: Optional[str]) -> Optional[str]:
    """Redact a secret value for safe API responses. Returns None if unset, '••••••••' if set."""
    if not value:
        return None
    return "••••••••"


# SEC: Fields that contain secrets and must be encrypted at rest.
# Used by encrypt_settings_secrets / decrypt_settings_secrets in the service layer.
_EMAIL_SECRET_FIELDS = frozenset(
    {
        "google_client_secret",
        "google_app_password",
        "microsoft_client_secret",
        "smtp_password",
    }
)

_FILE_STORAGE_SECRET_FIELDS = frozenset(
    {
        "google_drive_client_secret",
        "onedrive_client_secret",
        "s3_secret_access_key",
    }
)

# Prefix that marks a value as already encrypted (avoids double-encryption)
_ENC_PREFIX = "enc:"


def encrypt_settings_secrets(settings_dict: dict) -> dict:
    """
    Encrypt secret fields inside email_service / file_storage sub-dicts
    before persisting to the database JSON column.

    Idempotent: already-encrypted values (prefixed with 'enc:') are skipped.
    Redacted placeholder values ('••••••••') are also skipped so PATCH
    operations that echo back the redacted response don't overwrite the
    real encrypted value.
    """
    from app.core.security import encrypt_data

    result = {**settings_dict}

    for section_key, secret_fields in [
        ("email_service", _EMAIL_SECRET_FIELDS),
        ("file_storage", _FILE_STORAGE_SECRET_FIELDS),
    ]:
        section = result.get(section_key)
        if not isinstance(section, dict):
            continue
        section = {**section}
        for field in secret_fields:
            val = section.get(field)
            if not val or not isinstance(val, str):
                continue
            # Skip already-encrypted, redacted, or empty values
            if val.startswith(_ENC_PREFIX) or val == "••••••••":
                continue
            section[field] = _ENC_PREFIX + encrypt_data(val)
        result[section_key] = section

    return result


def decrypt_settings_secrets(settings_dict: dict) -> dict:
    """
    Decrypt secret fields inside email_service / file_storage sub-dicts
    after reading from the database JSON column.

    Backward-compatible: plaintext values (without the 'enc:' prefix)
    are returned as-is so existing installations keep working.
    """
    from app.core.security import decrypt_data

    result = {**settings_dict}

    for section_key, secret_fields in [
        ("email_service", _EMAIL_SECRET_FIELDS),
        ("file_storage", _FILE_STORAGE_SECRET_FIELDS),
    ]:
        section = result.get(section_key)
        if not isinstance(section, dict):
            continue
        section = {**section}
        for field in secret_fields:
            val = section.get(field)
            if not val or not isinstance(val, str):
                continue
            if val.startswith(_ENC_PREFIX):
                try:
                    section[field] = decrypt_data(val[len(_ENC_PREFIX) :])
                except Exception:
                    # Decryption failed — return raw value so the admin can
                    # see there's a problem rather than silently swallowing it
                    pass
        result[section_key] = section

    return result


class EmailServiceSettings(BaseModel):
    """Settings for organization email service configuration"""

    enabled: bool = Field(
        default=False,
        description="Whether to use organization-specific email configuration",
    )
    platform: str = Field(
        default="other",
        description="Email platform: gmail, microsoft, selfhosted, other",
    )
    # Gmail / Google Workspace
    google_client_id: Optional[str] = Field(None, description="Google OAuth Client ID")
    google_client_secret: Optional[str] = Field(
        None, description="Google OAuth Client Secret"
    )
    google_app_password: Optional[str] = Field(None, description="Google App Password")
    # Microsoft 365
    microsoft_tenant_id: Optional[str] = Field(
        None, description="Microsoft 365 Tenant ID"
    )
    microsoft_client_id: Optional[str] = Field(
        None, description="Microsoft 365 Client ID"
    )
    microsoft_client_secret: Optional[str] = Field(
        None, description="Microsoft 365 Client Secret"
    )
    # Self-hosted SMTP
    smtp_host: Optional[str] = Field(None, description="SMTP server hostname")
    smtp_port: int = Field(default=587, description="SMTP server port")
    smtp_user: Optional[str] = Field(None, description="SMTP username")
    smtp_password: Optional[str] = Field(None, description="SMTP password")
    smtp_encryption: str = Field(
        default="tls", description="SMTP encryption: tls, ssl, none"
    )
    # Common
    from_email: Optional[str] = Field(None, description="From email address")
    from_name: Optional[str] = Field(None, description="From name")
    use_tls: bool = Field(default=True, description="Use TLS encryption")

    def redacted(self) -> "EmailServiceSettings":
        """Return a copy with secret fields replaced by redaction markers."""
        return self.model_copy(
            update={
                "google_client_secret": _redact(self.google_client_secret),
                "google_app_password": _redact(self.google_app_password),
                "microsoft_client_secret": _redact(self.microsoft_client_secret),
                "smtp_password": _redact(self.smtp_password),
            }
        )


class FileStorageSettings(BaseModel):
    """Settings for organization file storage configuration"""

    platform: str = Field(
        default="local",
        description="File storage platform: googledrive, onedrive, s3, local, other",
    )
    # Google Drive
    google_drive_client_id: Optional[str] = Field(
        None, description="Google Drive OAuth Client ID"
    )
    google_drive_client_secret: Optional[str] = Field(
        None, description="Google Drive OAuth Client Secret"
    )
    google_drive_folder_id: Optional[str] = Field(
        None, description="Google Drive root folder ID"
    )
    # OneDrive / SharePoint
    onedrive_tenant_id: Optional[str] = Field(
        None, description="Microsoft 365 Tenant ID"
    )
    onedrive_client_id: Optional[str] = Field(
        None, description="OneDrive OAuth Client ID"
    )
    onedrive_client_secret: Optional[str] = Field(
        None, description="OneDrive OAuth Client Secret"
    )
    sharepoint_site_url: Optional[str] = Field(None, description="SharePoint site URL")
    # Amazon S3
    s3_access_key_id: Optional[str] = Field(None, description="AWS S3 Access Key ID")
    s3_secret_access_key: Optional[str] = Field(
        None, description="AWS S3 Secret Access Key"
    )
    s3_bucket_name: Optional[str] = Field(None, description="S3 bucket name")
    s3_region: Optional[str] = Field(None, description="AWS region")
    s3_endpoint_url: Optional[str] = Field(
        None, description="Custom S3 endpoint (for MinIO)"
    )
    # Local storage
    local_storage_path: Optional[str] = Field(
        None, description="Local file storage path"
    )

    def redacted(self) -> "FileStorageSettings":
        """Return a copy with secret fields replaced by redaction markers."""
        return self.model_copy(
            update={
                "google_drive_client_secret": _redact(self.google_drive_client_secret),
                "onedrive_client_secret": _redact(self.onedrive_client_secret),
                "s3_secret_access_key": _redact(self.s3_secret_access_key),
            }
        )


class MemberDropNotificationSettings(BaseModel):
    """
    Configuration for notifications sent when a member is dropped.

    Controls message recipients, CC behavior, and whether the member's
    personal email is included in drop/property-return notifications.
    """

    cc_roles: List[str] = Field(
        default_factory=lambda: list(ADMIN_NOTIFY_ROLE_SLUGS),
        description="Role names whose holders are automatically CC'd on drop notifications",
    )
    cc_emails: List[str] = Field(
        default_factory=list,
        description="Additional static email addresses always CC'd on drop notifications",
    )
    include_personal_email: bool = Field(
        default=True,
        description="Also send the drop notification to the member's personal email (if on file)",
    )
    use_custom_template: bool = Field(
        default=False,
        description="Use the MEMBER_DROPPED email template instead of the default property return letter",
    )


class MembershipTierBenefits(BaseModel):
    """Benefits granted at a specific membership tier."""

    training_exempt: bool = Field(
        default=False,
        description="Exempt members at this tier from all training requirements",
    )
    training_exempt_types: List[str] = Field(
        default_factory=list,
        description="If not fully exempt, exempt only these requirement types (e.g. ['continuing_education'])",
    )
    voting_eligible: bool = Field(
        default=True,
        description="Whether members at this tier can vote in elections",
    )
    voting_requires_meeting_attendance: bool = Field(
        default=False,
        description="Require a minimum meeting attendance percentage to vote",
    )
    voting_min_attendance_pct: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Minimum meeting attendance percentage required to vote (0-100)",
    )
    voting_attendance_period_months: int = Field(
        default=12,
        ge=1,
        le=60,
        description="Look-back window (in months) for calculating meeting attendance",
    )
    can_hold_office: bool = Field(
        default=True,
        description="Whether members at this tier are eligible to hold elected office",
    )
    custom_benefits: Dict[str, Any] = Field(
        default_factory=dict,
        description="Extensible key-value map for department-specific benefits",
    )


class MembershipTier(BaseModel):
    """A single membership tier (e.g. Probationary, Active, Life)."""

    id: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Machine-readable identifier (e.g. 'probationary', 'life')",
    )
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Display name (e.g. 'Life Member')",
    )
    years_required: int = Field(
        default=0,
        ge=0,
        description="Minimum years of service (from hire_date) to reach this tier",
    )
    sort_order: int = Field(
        default=0,
        description="Display and progression order (lower = earlier tier)",
    )
    benefits: MembershipTierBenefits = Field(
        default_factory=MembershipTierBenefits,
        description="Benefits granted to members at this tier",
    )


class MembershipTierSettings(BaseModel):
    """
    Organization-level membership tier configuration.

    Defines the tiers a member progresses through based on years of service,
    the benefits at each tier, and whether auto-advancement is enabled.
    """

    auto_advance: bool = Field(
        default=True,
        description="Automatically advance members to higher tiers when they meet the years-of-service threshold",
    )
    tiers: List[MembershipTier] = Field(
        default_factory=lambda: [
            MembershipTier(
                id="probationary",
                name="Probationary",
                years_required=0,
                sort_order=0,
                benefits=MembershipTierBenefits(
                    voting_eligible=False,
                    can_hold_office=False,
                ),
            ),
            MembershipTier(
                id="active",
                name="Active Member",
                years_required=1,
                sort_order=1,
                benefits=MembershipTierBenefits(
                    voting_requires_meeting_attendance=True,
                    voting_min_attendance_pct=50.0,
                    voting_attendance_period_months=12,
                ),
            ),
            MembershipTier(
                id="senior",
                name="Senior Member",
                years_required=10,
                sort_order=2,
                benefits=MembershipTierBenefits(),
            ),
            MembershipTier(
                id="life",
                name="Life Member",
                years_required=20,
                sort_order=3,
                benefits=MembershipTierBenefits(
                    training_exempt=True,
                ),
            ),
        ],
        description="Ordered list of membership tiers",
    )


class MembershipIdSettings(BaseModel):
    """Settings for membership ID number display and generation"""

    enabled: bool = Field(
        default=False,
        description="Whether membership ID numbers are enabled for the organization",
    )
    auto_generate: bool = Field(
        default=False,
        description="Automatically assign the next sequential ID to new members",
    )
    prefix: str = Field(
        default="",
        max_length=10,
        description="Optional prefix for generated IDs (e.g. 'FD-')",
    )
    next_number: int = Field(
        default=1,
        ge=1,
        description="Next number to use when auto-generating IDs",
    )


class ITTeamMember(BaseModel):
    """An IT team member stored in organization settings"""

    name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None


class ITTeamSettings(BaseModel):
    """IT team and backup access configuration"""

    members: list[ITTeamMember] = Field(default_factory=list)
    backup_access: Dict[str, Any] = Field(default_factory=dict)


class AuthSettings(BaseModel):
    """Settings for organization authentication provider"""

    provider: str = Field(
        default="local",
        description="Authentication provider: local, google, microsoft, authentik",
    )
    # Google OAuth
    google_client_id: Optional[str] = Field(None, description="Google OAuth Client ID")
    google_client_secret: Optional[str] = Field(
        None, description="Google OAuth Client Secret"
    )
    # Microsoft Azure AD
    microsoft_tenant_id: Optional[str] = Field(
        None, description="Microsoft Azure AD Tenant ID"
    )
    microsoft_client_id: Optional[str] = Field(
        None, description="Microsoft Azure AD Client ID"
    )
    microsoft_client_secret: Optional[str] = Field(
        None, description="Microsoft Azure AD Client Secret"
    )
    # Authentik SSO
    authentik_url: Optional[str] = Field(None, description="Authentik server URL")
    authentik_client_id: Optional[str] = Field(
        None, description="Authentik OAuth Client ID"
    )
    authentik_client_secret: Optional[str] = Field(
        None, description="Authentik OAuth Client Secret"
    )

    def is_local_auth(self) -> bool:
        """Check if local password authentication is enabled"""
        return self.provider == "local"


class ModuleSettings(BaseModel):
    """Settings for module enablement across the organization"""

    # Essential modules are always enabled
    # members, events, documents, roles, settings

    # Configurable modules - can be enabled/disabled
    training: bool = Field(
        default=False, description="Training & Certifications module"
    )
    inventory: bool = Field(default=False, description="Equipment & Inventory module")
    scheduling: bool = Field(default=False, description="Scheduling & Shifts module")
    apparatus: bool = Field(default=False, description="Apparatus Management module")
    communications: bool = Field(
        default=False, description="Communications module (announcements, messaging)"
    )
    elections: bool = Field(default=False, description="Elections & Voting module")
    minutes: bool = Field(default=False, description="Meeting Minutes module")
    reports: bool = Field(default=False, description="Reports & Analytics module")
    notifications: bool = Field(default=False, description="Email Notifications module")
    mobile: bool = Field(default=False, description="Mobile App Access module")
    forms: bool = Field(default=False, description="Custom Forms module")
    integrations: bool = Field(
        default=False, description="External Integrations module"
    )
    facilities: bool = Field(
        default=False,
        description="Facilities Management module (maintenance, inspections, systems)",
    )
    incidents: bool = Field(default=False, description="Incidents & Reports module")
    hr_payroll: bool = Field(default=False, description="HR & Payroll module")
    grants: bool = Field(default=False, description="Grants & Fundraising module")
    prospective_members: bool = Field(
        default=False, description="Prospective Members Pipeline module"
    )
    public_info: bool = Field(default=False, description="Public Information module")

    def get_enabled_modules(self) -> list[str]:
        """Get list of all enabled module IDs including essential modules"""
        # Essential modules are always enabled
        enabled = ["members", "events", "documents", "roles", "settings"]

        # Add configurable modules that are enabled
        for field_name in self.model_fields:
            if getattr(self, field_name):
                enabled.append(field_name)

        return enabled

    def is_module_enabled(self, module_id: str) -> bool:
        """Check if a specific module is enabled"""
        return module_id in self.get_enabled_modules()


class ModuleSettingsUpdate(BaseModel):
    """Schema for updating module settings"""

    training: Optional[bool] = None
    inventory: Optional[bool] = None
    scheduling: Optional[bool] = None
    apparatus: Optional[bool] = None
    communications: Optional[bool] = None
    elections: Optional[bool] = None
    minutes: Optional[bool] = None
    reports: Optional[bool] = None
    notifications: Optional[bool] = None
    mobile: Optional[bool] = None
    forms: Optional[bool] = None
    integrations: Optional[bool] = None
    facilities: Optional[bool] = None
    incidents: Optional[bool] = None
    hr_payroll: Optional[bool] = None
    grants: Optional[bool] = None
    prospective_members: Optional[bool] = None
    public_info: Optional[bool] = None


class OrganizationSettings(BaseModel):
    """
    Organization-wide settings

    This is a flexible schema that can be extended with additional settings.
    """

    contact_info_visibility: ContactInfoSettings = Field(
        default_factory=ContactInfoSettings,
        description="Settings for member contact information visibility",
    )
    email_service: EmailServiceSettings = Field(
        default_factory=EmailServiceSettings, description="Email service configuration"
    )
    file_storage: FileStorageSettings = Field(
        default_factory=FileStorageSettings, description="File storage configuration"
    )
    auth: AuthSettings = Field(
        default_factory=AuthSettings,
        description="Authentication provider configuration",
    )
    modules: ModuleSettings = Field(
        default_factory=ModuleSettings, description="Module enablement settings"
    )
    it_team: ITTeamSettings = Field(
        default_factory=ITTeamSettings,
        description="IT team members and backup access configuration",
    )
    member_drop_notifications: MemberDropNotificationSettings = Field(
        default_factory=MemberDropNotificationSettings,
        description="Configuration for drop/separation notifications (CC, personal email, template)",
    )
    membership_tiers: MembershipTierSettings = Field(
        default_factory=MembershipTierSettings,
        description="Membership tier definitions, years-of-service thresholds, and tier benefits",
    )
    membership_id: MembershipIdSettings = Field(
        default_factory=MembershipIdSettings,
        description="Membership ID number configuration",
    )

    # Allow additional settings
    model_config = ConfigDict(extra="allow")


class OrganizationBase(BaseModel):
    """Base organization schema"""

    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    type: str = Field(default="fire_department", max_length=50)


class OrganizationCreate(OrganizationBase):
    """Schema for creating a new organization"""

    settings: Optional[OrganizationSettings] = Field(
        default_factory=OrganizationSettings
    )


class OrganizationUpdate(BaseModel):
    """Schema for updating an organization"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    type: Optional[str] = Field(None, max_length=50)
    active: Optional[bool] = None


class OrganizationSettingsUpdate(BaseModel):
    """Schema for updating organization settings"""

    contact_info_visibility: Optional[ContactInfoSettings] = None
    email_service: Optional[EmailServiceSettings] = None
    file_storage: Optional[FileStorageSettings] = None
    auth: Optional[AuthSettings] = None
    modules: Optional[ModuleSettingsUpdate] = None
    it_team: Optional[ITTeamSettings] = None
    member_drop_notifications: Optional[MemberDropNotificationSettings] = None
    membership_tiers: Optional[MembershipTierSettings] = None
    membership_id: Optional[MembershipIdSettings] = None

    # Allow additional settings
    model_config = ConfigDict(extra="allow")


class OrganizationResponse(OrganizationBase):
    """Schema for organization response"""

    id: UUID
    settings: Dict[str, Any] = {}
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OrganizationSettingsResponse(BaseModel):
    """Schema for organization settings response"""

    contact_info_visibility: ContactInfoSettings
    email_service: EmailServiceSettings
    file_storage: FileStorageSettings = Field(default_factory=FileStorageSettings)
    auth: AuthSettings = Field(default_factory=AuthSettings)
    it_team: ITTeamSettings = Field(default_factory=ITTeamSettings)
    modules: ModuleSettings = Field(default_factory=ModuleSettings)
    membership_id: MembershipIdSettings = Field(default_factory=MembershipIdSettings)

    model_config = ConfigDict(from_attributes=True, extra="allow")

    def redacted(self) -> "OrganizationSettingsResponse":
        """Return a copy with secret fields in nested settings replaced by redaction markers."""
        return self.model_copy(
            update={
                "email_service": self.email_service.redacted(),
                "file_storage": self.file_storage.redacted(),
            }
        )


class EnabledModulesResponse(BaseModel):
    """Schema for enabled modules response"""

    enabled_modules: list[str] = Field(
        default_factory=list,
        description="List of enabled module IDs for this organization",
    )
    module_settings: ModuleSettings = Field(
        default_factory=ModuleSettings,
        description="Detailed module enablement settings",
    )

    def is_module_enabled(self, module_id: str) -> bool:
        """Check if a specific module is enabled"""
        return module_id in self.enabled_modules


# ============================================
# Organization Setup Schemas (Onboarding)
# ============================================


class OrganizationSetupCreate(BaseModel):
    """
    Schema for creating an organization during onboarding setup.

    This is the comprehensive schema used in Step 1 of onboarding
    to collect all organization details and commit to database.
    """

    # Basic Information
    name: str = Field(
        ..., min_length=2, max_length=255, description="Organization/Department name"
    )
    slug: Optional[str] = Field(
        None,
        max_length=100,
        description="URL slug (automatically generated from name - used for unique web addresses)",
    )

    # Organization Type
    organization_type: OrganizationTypeEnum = Field(
        ...,
        description="Type of organization: fire_department, ems_only, or fire_ems_combined",
    )

    # Timezone
    timezone: str = Field(
        default="America/New_York",
        max_length=50,
        description="Organization timezone (e.g., America/New_York)",
    )

    # Contact Information
    phone: Optional[str] = Field(None, max_length=20, description="Main phone number")
    fax: Optional[str] = Field(None, max_length=20, description="Fax number")
    email: Optional[str] = Field(None, max_length=255, description="Main contact email")
    website: Optional[str] = Field(
        None, max_length=255, description="Organization website URL"
    )

    # Mailing Address
    mailing_address: AddressSchema = Field(..., description="Mailing address")

    # Physical Address
    physical_address_same: bool = Field(
        default=True, description="Is physical address same as mailing address?"
    )
    physical_address: Optional[AddressSchema] = Field(
        None, description="Physical address (if different from mailing)"
    )

    # Department Identifiers (Optional - can be configured later in Members module)
    identifier_type: IdentifierTypeEnum = Field(
        default=IdentifierTypeEnum.DEPARTMENT_ID,
        description="Type of identifier used: fdid, state_id, or department_id",
    )
    fdid: Optional[str] = Field(
        None,
        max_length=50,
        description="Fire Department ID (NFIRS) - Optional, can be set later in Members module",
    )
    state_id: Optional[str] = Field(
        None,
        max_length=50,
        description="State license/certification number - Optional, can be set later in Members module",
    )
    department_id: Optional[str] = Field(
        None,
        max_length=50,
        description="Internal department ID - Optional, can be set later in Members module",
    )

    # Additional Information
    county: Optional[str] = Field(
        None, max_length=100, description="County/jurisdiction"
    )
    founded_year: Optional[int] = Field(
        None, ge=1700, le=2100, description="Year organization was founded"
    )

    # Logo
    logo: Optional[str] = Field(
        None, description="Logo as base64 data URL or external URL"
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate and sanitize organization name"""
        v = v.strip()
        if any(char in v for char in ["<", ">", ";", "--", "/*", "*/"]):
            raise ValueError("Organization name contains invalid characters")
        return v

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: Optional[str]) -> Optional[str]:
        """Validate slug format"""
        if v is None:
            return v
        v = v.strip().lower()
        if not re.match(r"^[a-z0-9-]+$", v):
            raise ValueError(
                "Slug can only contain lowercase letters, numbers, and hyphens"
            )
        return v

    @field_validator("phone", "fax")
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        """Validate phone number format"""
        if v is None:
            return v
        # Remove common formatting characters for storage
        cleaned = re.sub(r"[\s\-\.\(\)]", "", v)
        if not re.match(r"^\+?[\d]{10,15}$", cleaned):
            raise ValueError("Invalid phone number format")
        return v.strip()

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        """Validate email format"""
        if v is None:
            return v
        v = v.strip().lower()
        if not re.match(r"^[^@]+@[^@]+\.[^@]+$", v):
            raise ValueError("Invalid email format")
        return v

    @field_validator("website")
    @classmethod
    def validate_website(cls, v: Optional[str]) -> Optional[str]:
        """Validate website URL"""
        if v is None:
            return v
        v = v.strip()
        if not re.match(r"^https?://", v, re.IGNORECASE):
            v = "https://" + v
        return v


class SetupChecklistItem(BaseModel):
    """A single item on the department setup checklist"""

    key: str
    title: str
    description: str
    path: str
    category: str
    is_complete: bool = False
    count: int = 0
    required: bool = True


class SetupChecklistResponse(BaseModel):
    """Department setup checklist with completion status for each step"""

    items: List[SetupChecklistItem]
    completed_count: int = 0
    total_count: int = 0
    enabled_modules: List[str] = Field(default_factory=list)


class OrganizationSetupResponse(BaseModel):
    """Response schema for organization setup"""

    id: UUID
    name: str
    slug: str
    organization_type: str
    timezone: str
    active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
