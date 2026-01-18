"""
Authentication Pydantic Schemas

Request and response schemas for authentication endpoints.
"""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class UserLogin(BaseModel):
    """Schema for user login"""
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=1)


class UserRegister(BaseModel):
    """Schema for user registration"""
    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=12)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    badge_number: Optional[str] = Field(None, max_length=50)


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
