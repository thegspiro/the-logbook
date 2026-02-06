"""
Organization Pydantic Schemas

Request and response schemas for organization-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional, Dict, Any, Literal
from datetime import datetime
from uuid import UUID
from enum import Enum
import re


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

    @field_validator('zip_code')
    @classmethod
    def validate_zip(cls, v: str) -> str:
        """Validate ZIP code format"""
        v = v.strip()
        # Allow US ZIP (12345 or 12345-6789) or Canadian postal codes
        if not re.match(r'^(\d{5}(-\d{4})?|[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d)$', v):
            raise ValueError('Invalid ZIP/postal code format')
        return v


class ContactInfoSettings(BaseModel):
    """Settings for controlling member contact information visibility"""
    enabled: bool = Field(
        default=False,
        description="Whether to show contact information on member list"
    )
    show_email: bool = Field(
        default=True,
        description="Show email addresses"
    )
    show_phone: bool = Field(
        default=True,
        description="Show phone numbers"
    )
    show_mobile: bool = Field(
        default=True,
        description="Show mobile phone numbers"
    )


class EmailServiceSettings(BaseModel):
    """Settings for organization email service configuration"""
    enabled: bool = Field(
        default=False,
        description="Whether to use organization-specific email configuration"
    )
    smtp_host: Optional[str] = Field(None, description="SMTP server hostname")
    smtp_port: int = Field(default=587, description="SMTP server port")
    smtp_user: Optional[str] = Field(None, description="SMTP username")
    smtp_password: Optional[str] = Field(None, description="SMTP password")
    from_email: Optional[str] = Field(None, description="From email address")
    from_name: Optional[str] = Field(None, description="From name")
    use_tls: bool = Field(default=True, description="Use TLS encryption")


class AuthSettings(BaseModel):
    """Settings for organization authentication provider"""
    provider: str = Field(
        default="local",
        description="Authentication provider: local, google, microsoft, authentik"
    )

    def is_local_auth(self) -> bool:
        """Check if local password authentication is enabled"""
        return self.provider == "local"


class ModuleSettings(BaseModel):
    """Settings for module enablement across the organization"""
    # Essential modules are always enabled
    # members, events, documents, roles, settings

    # Configurable modules - can be enabled/disabled
    training: bool = Field(default=False, description="Training & Certifications module")
    inventory: bool = Field(default=False, description="Equipment & Inventory module")
    scheduling: bool = Field(default=False, description="Scheduling & Shifts module")
    elections: bool = Field(default=False, description="Elections & Voting module")
    minutes: bool = Field(default=False, description="Meeting Minutes module")
    reports: bool = Field(default=False, description="Reports & Analytics module")
    notifications: bool = Field(default=False, description="Email Notifications module")
    mobile: bool = Field(default=False, description="Mobile App Access module")
    forms: bool = Field(default=False, description="Custom Forms module")
    integrations: bool = Field(default=False, description="External Integrations module")

    def get_enabled_modules(self) -> list[str]:
        """Get list of all enabled module IDs including essential modules"""
        # Essential modules are always enabled
        enabled = ['members', 'events', 'documents', 'roles', 'settings']

        # Add configurable modules that are enabled
        if self.training:
            enabled.append('training')
        if self.inventory:
            enabled.append('inventory')
        if self.scheduling:
            enabled.append('scheduling')
        if self.elections:
            enabled.append('elections')
        if self.minutes:
            enabled.append('minutes')
        if self.reports:
            enabled.append('reports')
        if self.notifications:
            enabled.append('notifications')
        if self.mobile:
            enabled.append('mobile')
        if self.forms:
            enabled.append('forms')
        if self.integrations:
            enabled.append('integrations')

        return enabled

    def is_module_enabled(self, module_id: str) -> bool:
        """Check if a specific module is enabled"""
        return module_id in self.get_enabled_modules()


class ModuleSettingsUpdate(BaseModel):
    """Schema for updating module settings"""
    training: Optional[bool] = None
    inventory: Optional[bool] = None
    scheduling: Optional[bool] = None
    elections: Optional[bool] = None
    minutes: Optional[bool] = None
    reports: Optional[bool] = None
    notifications: Optional[bool] = None
    mobile: Optional[bool] = None
    forms: Optional[bool] = None
    integrations: Optional[bool] = None


class OrganizationSettings(BaseModel):
    """
    Organization-wide settings

    This is a flexible schema that can be extended with additional settings.
    """
    contact_info_visibility: ContactInfoSettings = Field(
        default_factory=ContactInfoSettings,
        description="Settings for member contact information visibility"
    )
    email_service: EmailServiceSettings = Field(
        default_factory=EmailServiceSettings,
        description="Email service configuration"
    )
    auth: AuthSettings = Field(
        default_factory=AuthSettings,
        description="Authentication provider configuration"
    )
    modules: ModuleSettings = Field(
        default_factory=ModuleSettings,
        description="Module enablement settings"
    )

    # Allow additional settings
    model_config = ConfigDict(extra='allow')


class OrganizationBase(BaseModel):
    """Base organization schema"""
    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    type: str = Field(default="fire_department", max_length=50)


class OrganizationCreate(OrganizationBase):
    """Schema for creating a new organization"""
    settings: Optional[OrganizationSettings] = Field(default_factory=OrganizationSettings)


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
    auth: Optional[AuthSettings] = None
    modules: Optional[ModuleSettingsUpdate] = None

    # Allow additional settings
    model_config = ConfigDict(extra='allow')


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
    auth: AuthSettings = Field(default_factory=AuthSettings)
    modules: ModuleSettings = Field(default_factory=ModuleSettings)

    model_config = ConfigDict(from_attributes=True, extra='allow')


class EnabledModulesResponse(BaseModel):
    """Schema for enabled modules response"""
    enabled_modules: list[str] = Field(
        default_factory=list,
        description="List of enabled module IDs for this organization"
    )
    module_settings: ModuleSettings = Field(
        default_factory=ModuleSettings,
        description="Detailed module enablement settings"
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
    name: str = Field(..., min_length=2, max_length=255, description="Organization/Department name")
    slug: Optional[str] = Field(None, max_length=100, description="URL-friendly identifier (auto-generated if not provided)")
    description: Optional[str] = Field(None, max_length=1000, description="Brief description of the organization")

    # Organization Type
    organization_type: OrganizationTypeEnum = Field(
        ...,
        description="Type of organization: fire_department, ems_only, or fire_ems_combined"
    )

    # Timezone
    timezone: str = Field(
        default="America/New_York",
        max_length=50,
        description="Organization timezone (e.g., America/New_York)"
    )

    # Contact Information
    phone: Optional[str] = Field(None, max_length=20, description="Main phone number")
    fax: Optional[str] = Field(None, max_length=20, description="Fax number")
    email: Optional[str] = Field(None, max_length=255, description="Main contact email")
    website: Optional[str] = Field(None, max_length=255, description="Organization website URL")

    # Mailing Address
    mailing_address: AddressSchema = Field(..., description="Mailing address")

    # Physical Address
    physical_address_same: bool = Field(
        default=True,
        description="Is physical address same as mailing address?"
    )
    physical_address: Optional[AddressSchema] = Field(
        None,
        description="Physical address (if different from mailing)"
    )

    # Department Identifiers
    identifier_type: IdentifierTypeEnum = Field(
        default=IdentifierTypeEnum.DEPARTMENT_ID,
        description="Type of identifier used: fdid, state_id, or department_id"
    )
    fdid: Optional[str] = Field(None, max_length=50, description="Fire Department ID (NFIRS)")
    state_id: Optional[str] = Field(None, max_length=50, description="State license/certification number")
    department_id: Optional[str] = Field(None, max_length=50, description="Internal department ID")

    # Additional Information
    county: Optional[str] = Field(None, max_length=100, description="County/jurisdiction")
    founded_year: Optional[int] = Field(None, ge=1700, le=2100, description="Year organization was founded")
    tax_id: Optional[str] = Field(None, max_length=50, description="EIN for 501(c)(3) organizations")

    # Logo
    logo: Optional[str] = Field(None, description="Logo as base64 data URL or external URL")

    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate and sanitize organization name"""
        v = v.strip()
        if any(char in v for char in ['<', '>', ';', '--', '/*', '*/']):
            raise ValueError('Organization name contains invalid characters')
        return v

    @field_validator('slug')
    @classmethod
    def validate_slug(cls, v: Optional[str]) -> Optional[str]:
        """Validate slug format"""
        if v is None:
            return v
        v = v.strip().lower()
        if not re.match(r'^[a-z0-9-]+$', v):
            raise ValueError('Slug can only contain lowercase letters, numbers, and hyphens')
        return v

    @field_validator('phone', 'fax')
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        """Validate phone number format"""
        if v is None:
            return v
        # Remove common formatting characters for storage
        cleaned = re.sub(r'[\s\-\.\(\)]', '', v)
        if not re.match(r'^\+?[\d]{10,15}$', cleaned):
            raise ValueError('Invalid phone number format')
        return v.strip()

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        """Validate email format"""
        if v is None:
            return v
        v = v.strip().lower()
        if not re.match(r'^[^@]+@[^@]+\.[^@]+$', v):
            raise ValueError('Invalid email format')
        return v

    @field_validator('website')
    @classmethod
    def validate_website(cls, v: Optional[str]) -> Optional[str]:
        """Validate website URL"""
        if v is None:
            return v
        v = v.strip()
        if not re.match(r'^https?://', v, re.IGNORECASE):
            v = 'https://' + v
        return v

    @field_validator('tax_id')
    @classmethod
    def validate_tax_id(cls, v: Optional[str]) -> Optional[str]:
        """Validate EIN format"""
        if v is None:
            return v
        # Remove formatting
        cleaned = re.sub(r'[\s\-]', '', v)
        if not re.match(r'^\d{9}$', cleaned):
            raise ValueError('Invalid EIN format (should be 9 digits)')
        return v.strip()


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
