"""
User Pydantic Schemas

Request and response schemas for user-related endpoints.
"""

from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, List
from datetime import datetime, date
from uuid import UUID


class EmergencyContact(BaseModel):
    """Emergency contact schema"""
    name: str = Field(..., min_length=1, max_length=100)
    relationship: str = Field(..., min_length=1, max_length=50)
    phone: str = Field(..., max_length=20)
    email: Optional[EmailStr] = None
    is_primary: bool = False


class AddressInfo(BaseModel):
    """Address information schema"""
    street: Optional[str] = Field(None, max_length=255)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=50)
    zip_code: Optional[str] = Field(None, max_length=20)
    country: Optional[str] = Field(default="USA", max_length=100)


class UserBase(BaseModel):
    """Base user schema with common fields"""
    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    first_name: Optional[str] = Field(None, max_length=100)
    middle_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    badge_number: Optional[str] = Field(None, max_length=50)
    date_of_birth: Optional[date] = None
    hire_date: Optional[date] = None


class UserCreate(UserBase):
    """Schema for creating a new user"""
    password: str = Field(..., min_length=12)
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)


class AdminUserCreate(BaseModel):
    """Schema for admin/secretary creating a new member"""
    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    first_name: str = Field(..., min_length=1, max_length=100)
    middle_name: Optional[str] = Field(None, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    badge_number: Optional[str] = Field(None, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)
    date_of_birth: Optional[date] = None
    hire_date: Optional[date] = None

    # Department info
    rank: Optional[str] = Field(None, max_length=100)
    station: Optional[str] = Field(None, max_length=100)

    # Address
    address_street: Optional[str] = Field(None, max_length=255)
    address_city: Optional[str] = Field(None, max_length=100)
    address_state: Optional[str] = Field(None, max_length=50)
    address_zip: Optional[str] = Field(None, max_length=20)
    address_country: Optional[str] = Field(default="USA", max_length=100)

    # Emergency contacts
    emergency_contacts: List[EmergencyContact] = Field(default_factory=list)

    # Admin options
    role_ids: List[UUID] = Field(default_factory=list, description="Initial roles to assign")
    send_welcome_email: bool = Field(default=True, description="Send welcome email with password setup link")


class UserUpdate(BaseModel):
    """Schema for updating a user"""
    first_name: Optional[str] = Field(None, max_length=100)
    middle_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)
    badge_number: Optional[str] = Field(None, max_length=50)
    date_of_birth: Optional[date] = None
    hire_date: Optional[date] = None
    photo_url: Optional[str] = None

    # Department info
    rank: Optional[str] = Field(None, max_length=100)
    station: Optional[str] = Field(None, max_length=100)

    # Address
    address_street: Optional[str] = Field(None, max_length=255)
    address_city: Optional[str] = Field(None, max_length=100)
    address_state: Optional[str] = Field(None, max_length=50)
    address_zip: Optional[str] = Field(None, max_length=20)
    address_country: Optional[str] = Field(None, max_length=100)

    # Emergency contacts
    emergency_contacts: Optional[List[EmergencyContact]] = None


class UserResponse(UserBase):
    """
    Schema for user response (without sensitive data like password)

    Contact information (phone, email, mobile) will be conditionally
    included based on organization settings.
    """
    id: UUID
    organization_id: UUID
    photo_url: Optional[str] = None
    status: str
    email_verified: bool
    mfa_enabled: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    # Contact info - conditionally included
    phone: Optional[str] = None
    mobile: Optional[str] = None

    # Department info
    rank: Optional[str] = None
    station: Optional[str] = None

    # Address info
    address_street: Optional[str] = None
    address_city: Optional[str] = None
    address_state: Optional[str] = None
    address_zip: Optional[str] = None
    address_country: Optional[str] = None

    # Emergency contacts
    emergency_contacts: List[EmergencyContact] = Field(default_factory=list)

    # Computed field
    full_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class UserListResponse(BaseModel):
    """Schema for listing users with optional contact information"""
    id: UUID
    organization_id: UUID
    username: str
    email: Optional[str] = None  # Conditionally included
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    badge_number: Optional[str] = None
    phone: Optional[str] = None  # Conditionally included
    mobile: Optional[str] = None  # Conditionally included
    photo_url: Optional[str] = None
    status: str
    hire_date: Optional[date] = None

    # Department info
    rank: Optional[str] = None
    station: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class RoleResponse(BaseModel):
    """Schema for role response"""
    id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    permissions: List[str] = []
    is_system: bool
    priority: int

    model_config = ConfigDict(from_attributes=True)


class UserWithRolesResponse(UserResponse):
    """User response with roles included"""
    roles: List[RoleResponse] = []

    model_config = ConfigDict(from_attributes=True)


class NotificationPreferences(BaseModel):
    """Notification preferences schema"""
    email: bool = True
    sms: bool = False
    push: bool = False
    email_notifications: bool = True
    event_reminders: bool = True
    training_reminders: bool = True
    announcement_notifications: bool = True

    model_config = ConfigDict(from_attributes=True)


class ContactInfoUpdate(BaseModel):
    """Schema for updating contact information and notification preferences"""
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)
    notification_preferences: Optional[NotificationPreferences] = None


class UserProfileResponse(UserResponse):
    """Extended user response with notification preferences"""
    notification_preferences: Optional[dict] = None

    model_config = ConfigDict(from_attributes=True)
