"""
Organization Pydantic Schemas

Request and response schemas for organization-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID


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


class OrganizationSettings(BaseModel):
    """
    Organization-wide settings

    This is a flexible schema that can be extended with additional settings.
    """
    contact_info_visibility: ContactInfoSettings = Field(
        default_factory=ContactInfoSettings,
        description="Settings for member contact information visibility"
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

    model_config = ConfigDict(from_attributes=True, extra='allow')
