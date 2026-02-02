"""
Authentication Pydantic Schemas

Request and response schemas for authentication endpoints.

Security Features:
- Username validation: alphanumeric, underscores, hyphens only (prevents SQL injection)
- Password minimum length enforcement
- Email validation via EmailStr
- Rate limiting applied at endpoint level
"""

from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime
from uuid import UUID
import re


# Safe characters for usernames - prevents SQL injection and XSS
USERNAME_PATTERN = re.compile(r'^[a-zA-Z0-9_-]+$')


class UserLogin(BaseModel):
    """Schema for user login

    Security:
    - Username restricted to alphanumeric, underscores, hyphens
    - Also accepts email format for login flexibility
    """
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=1)

    @field_validator('username')
    @classmethod
    def validate_username(cls, v: str) -> str:
        """Validate username contains only safe characters or is a valid email"""
        # Allow email format for login (contains @)
        if '@' in v:
            # Basic email validation - more thorough validation happens in auth service
            if not re.match(r'^[^@]+@[^@]+\.[^@]+$', v):
                raise ValueError('Invalid email format')
            return v.lower().strip()
        # For usernames, only allow safe characters
        if not USERNAME_PATTERN.match(v):
            raise ValueError('Username can only contain letters, numbers, hyphens, and underscores')
        return v.strip()


class UserRegister(BaseModel):
    """Schema for user registration

    Security:
    - Username restricted to alphanumeric, underscores, hyphens (prevents injection)
    - Password minimum 12 characters (enforced here, strength validated in service)
    - Email validated via Pydantic EmailStr
    - Names stripped and length-limited
    """
    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=12)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    badge_number: Optional[str] = Field(None, max_length=50)

    @field_validator('username')
    @classmethod
    def validate_username(cls, v: str) -> str:
        """Validate username contains only safe characters"""
        if not USERNAME_PATTERN.match(v):
            raise ValueError('Username can only contain letters, numbers, hyphens, and underscores')
        return v.strip()

    @field_validator('first_name', 'last_name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate and sanitize names"""
        # Strip whitespace
        v = v.strip()
        # Block obvious injection attempts
        if any(char in v for char in ['<', '>', ';', '--', '/*', '*/']):
            raise ValueError('Name contains invalid characters')
        return v

    @field_validator('badge_number')
    @classmethod
    def validate_badge_number(cls, v: Optional[str]) -> Optional[str]:
        """Validate badge number contains only safe characters"""
        if v is None:
            return v
        v = v.strip()
        # Allow alphanumeric and common badge number separators
        if not re.match(r'^[a-zA-Z0-9_\-\.]+$', v):
            raise ValueError('Badge number can only contain letters, numbers, hyphens, underscores, and periods')
        return v


class TokenResponse(BaseModel):
    """Schema for token response"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class TokenRefresh(BaseModel):
    """Schema for token refresh request"""
    refresh_token: str


class CurrentUser(BaseModel):
    """Schema for current user info"""
    id: UUID
    username: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    organization_id: UUID
    roles: list[str] = []  # List of role names
    permissions: list[str] = []  # List of permission names
    is_active: bool
    email_verified: bool
    mfa_enabled: bool


class PasswordChange(BaseModel):
    """Schema for changing password"""
    current_password: str
    new_password: str = Field(..., min_length=12)


class PasswordResetRequest(BaseModel):
    """Schema for requesting password reset"""
    email: EmailStr


class PasswordReset(BaseModel):
    """Schema for resetting password with token"""
    token: str
    new_password: str = Field(..., min_length=12)


class EmailVerification(BaseModel):
    """Schema for email verification"""
    token: str


class MFASetup(BaseModel):
    """Schema for MFA setup response"""
    secret: str
    qr_code_url: str
    backup_codes: list[str]


class MFAVerify(BaseModel):
    """Schema for MFA verification"""
    code: str = Field(..., min_length=6, max_length=6)


class MFALogin(BaseModel):
    """Schema for MFA login (second step)"""
    temp_token: str
    code: str = Field(..., min_length=6, max_length=6)
