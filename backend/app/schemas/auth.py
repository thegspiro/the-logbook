"""
Authentication Pydantic Schemas

Request and response schemas for authentication endpoints.

Security Features:
- Username validation: alphanumeric, underscores, hyphens only (prevents SQL injection)
- Password minimum length enforcement
- Email validation via EmailStr
- Rate limiting applied at endpoint level
"""

import json
import re
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

# Safe characters for usernames - prevents SQL injection and XSS
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


class UserLogin(BaseModel):
    """Schema for user login

    Security:
    - Username restricted to alphanumeric, underscores, hyphens
    - Also accepts email format for login flexibility
    """

    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        """Validate username contains only safe characters or is a valid email"""
        # Allow email format for login (contains @)
        if "@" in v:
            # Basic email validation - more thorough validation happens in auth service
            if not re.match(r"^[^@]+@[^@]+\.[^@]+$", v):
                raise ValueError("Invalid email format")
            return v.lower().strip()
        # For usernames, only allow safe characters
        if not USERNAME_PATTERN.match(v):
            raise ValueError(
                "Username can only contain letters, numbers, hyphens, and underscores"
            )
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
    password: str = Field(..., min_length=12, max_length=128)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    membership_number: Optional[str] = Field(None, max_length=50)

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        """Validate username contains only safe characters"""
        if not USERNAME_PATTERN.match(v):
            raise ValueError(
                "Username can only contain letters, numbers, hyphens, and underscores"
            )
        return v.strip()

    @field_validator("first_name", "last_name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate and sanitize names"""
        # Strip whitespace
        v = v.strip()
        # Block obvious injection attempts
        if any(char in v for char in ["<", ">", ";", "--", "/*", "*/"]):
            raise ValueError("Name contains invalid characters")
        return v

    @field_validator("membership_number")
    @classmethod
    def validate_membership_number(cls, v: Optional[str]) -> Optional[str]:
        """Validate membership number contains only safe characters"""
        if v is None:
            return v
        v = v.strip()
        # Allow alphanumeric and common membership number separators
        if not re.match(r"^[a-zA-Z0-9_\-\.]+$", v):
            raise ValueError(
                "Membership number can only contain letters, numbers, hyphens, underscores, and periods"
            )
        return v


class TokenResponse(BaseModel):
    """Schema for token response"""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class TokenRefresh(BaseModel):
    """Schema for token refresh request"""

    refresh_token: Optional[str] = None


class CurrentUser(BaseModel):
    """Schema for current user info"""

    id: UUID
    username: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    preferred_name: Optional[str] = None
    # Legal name (first + last); display_name substitutes the preferred name.
    full_name: Optional[str] = None
    display_name: Optional[str] = None
    organization_id: UUID
    timezone: str = Field(
        default="America/New_York", description="Organization timezone"
    )
    roles: list[str] = []  # List of role/position names (backward-compatible alias)
    positions: list[str] = []  # List of position names (same as roles)
    rank: Optional[str] = None  # Operational rank, e.g. "captain", "firefighter"
    platoon: Optional[str] = None  # Duty platoon / shift group, e.g. "A"
    membership_type: Optional[str] = None  # Membership tier, e.g. "active", "reserve"
    permissions: list[str] = []  # List of permission names (includes rank defaults)
    is_active: bool
    email_verified: bool
    mfa_enabled: bool
    # Registered passkeys. ``mfa_enabled`` is the authenticator app alone; a
    # member with either has a second factor.
    passkey_count: int = 0
    mfa_enrollment_required: bool = False  # Org requires MFA and user not enrolled
    mfa_grace_ends_at: datetime | None = None  # Privileged, un-enrolled, still in grace
    password_expired: bool = False  # True when password age exceeds HIPAA max
    must_change_password: bool = (
        False  # True when admin requires password change on next login
    )
    # The member's chosen phone bottom-bar tabs; None means the bar uses its
    # role-based defaults. See app.schemas.user.normalize_bottom_nav_slots.
    bottom_nav_slots: Optional[list[str]] = None


class PasswordChange(BaseModel):
    """Schema for changing password"""

    current_password: str = Field(..., max_length=128)
    new_password: str = Field(..., min_length=12, max_length=128)


class PasswordResetRequest(BaseModel):
    """Schema for requesting password reset"""

    email: EmailStr


class PasswordReset(BaseModel):
    """Schema for resetting password with token"""

    token: str
    new_password: str = Field(..., min_length=12, max_length=128)


class ValidateResetToken(BaseModel):
    """Schema for validating a password reset token"""

    token: str = Field(..., min_length=1)


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


# A WebAuthn response is a few kilobytes at most; the bound only stops an
# arbitrary JSON body from being parsed and stored.
_MAX_CREDENTIAL_BYTES = 64 * 1024


def _bounded_credential(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is not None and len(json.dumps(value)) > _MAX_CREDENTIAL_BYTES:
        raise ValueError("Passkey response is too large")
    return value


class StepUpRequest(BaseModel):
    """Re-verification before a sensitive action.

    A member with a passkey may answer with ``passkey_credential``; one with
    the authenticator app with ``code``; one with neither proves the account
    password with ``password``.
    """

    code: str | None = Field(None, min_length=6, max_length=6)
    password: str | None = Field(None, max_length=1024)
    passkey_credential: dict[str, Any] | None = None

    _bound_credential = field_validator("passkey_credential")(_bounded_credential)


class MFALogin(BaseModel):
    """Schema for MFA login (second step).

    Provide a 6-digit authenticator ``code``, a ``recovery_code``, or the
    browser's response to a passkey challenge as ``passkey_credential``.
    """

    temp_token: str
    code: str | None = Field(None, min_length=6, max_length=6)
    recovery_code: str | None = Field(None, max_length=32)
    passkey_credential: dict[str, Any] | None = None

    _bound_credential = field_validator("passkey_credential")(_bounded_credential)


class MFAChallengeRequest(BaseModel):
    """Ask which second factors a pending sign-in can be completed with."""

    temp_token: str


class MFAChallengeResponse(BaseModel):
    """The second factors on offer for a pending sign-in.

    ``passkey_options`` is ready to hand to ``navigator.credentials.get()``;
    it is ``None`` when the member has no passkey or the site cannot use them.
    """

    totp: bool
    passkey_options: dict[str, Any] | None = None


class MFAPolicy(BaseModel):
    """Organization-wide MFA requirement policy."""

    mfa_required: bool = False
    # Whether members may register new passkeys. Omitted on a PUT leaves the
    # stored value alone, so older clients that only send mfa_required keep
    # working.
    passkeys_enabled: bool | None = None


class PasskeyRegisterRequest(BaseModel):
    """The browser's registration response plus the member's label for it."""

    name: str = Field(..., min_length=1, max_length=100)
    credential: dict[str, Any]

    _bound_credential = field_validator("credential")(_bounded_credential)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Give the passkey a name")
        return value


class PasskeyResponse(BaseModel):
    """A registered passkey as shown to its owner or an administrator."""

    id: str
    name: str
    created_at: datetime
    last_used_at: datetime | None = None
    # True for a passkey that syncs between the member's devices (iCloud
    # Keychain, Google Password Manager); false for one bound to one device.
    backed_up: bool = False

    model_config = {"from_attributes": True}


class PasskeyListResponse(BaseModel):
    passkeys: list[PasskeyResponse]
    max_passkeys: int
    # The site is reachable over HTTPS on a hostname, so browsers will offer
    # passkeys at all.
    available: bool
    # The organization allows registering new ones.
    allowed: bool


class PasskeyRegisterResponse(BaseModel):
    passkey: PasskeyResponse
    # Issued, and shown once, when this passkey is the member's first second
    # factor. Empty when they already had a set.
    recovery_codes: list[str] = []
