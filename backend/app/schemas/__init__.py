"""
Pydantic Schemas

This module exports all Pydantic schemas for the API.
"""

from app.schemas.user import (
    UserBase,
    UserCreate,
    UserUpdate,
    UserResponse,
    UserListResponse,
    UserWithRolesResponse,
    RoleResponse,
    NotificationPreferences,
    ContactInfoUpdate,
    UserProfileResponse,
)
from app.schemas.organization import (
    OrganizationBase,
    OrganizationCreate,
    OrganizationUpdate,
    OrganizationResponse,
    OrganizationSettings,
    OrganizationSettingsUpdate,
    OrganizationSettingsResponse,
    ContactInfoSettings,
)
from app.schemas.role import (
    RoleBase,
    RoleCreate,
    RoleUpdate,
    PermissionDetail,
    PermissionCategory,
    UserRoleAssignment,
    UserRoleResponse,
)
from app.schemas.auth import (
    UserLogin,
    UserRegister,
    TokenResponse,
    TokenRefresh,
    CurrentUser,
    PasswordChange,
    PasswordResetRequest,
    PasswordReset,
    EmailVerification,
    MFASetup,
    MFAVerify,
    MFALogin,
)

__all__ = [
    # User schemas
    "UserBase",
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "UserListResponse",
    "UserWithRolesResponse",
    "RoleResponse",
    "NotificationPreferences",
    "ContactInfoUpdate",
    "UserProfileResponse",
    # Organization schemas
    "OrganizationBase",
    "OrganizationCreate",
    "OrganizationUpdate",
    "OrganizationResponse",
    "OrganizationSettings",
    "OrganizationSettingsUpdate",
    "OrganizationSettingsResponse",
    "ContactInfoSettings",
    # Role schemas
    "RoleBase",
    "RoleCreate",
    "RoleUpdate",
    "PermissionDetail",
    "PermissionCategory",
    "UserRoleAssignment",
    "UserRoleResponse",
    # Auth schemas
    "UserLogin",
    "UserRegister",
    "TokenResponse",
    "TokenRefresh",
    "CurrentUser",
    "PasswordChange",
    "PasswordResetRequest",
    "PasswordReset",
    "EmailVerification",
    "MFASetup",
    "MFAVerify",
    "MFALogin",
]
