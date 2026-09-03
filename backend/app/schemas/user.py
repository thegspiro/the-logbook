"""
User Pydantic Schemas

Request and response schemas for user-related endpoints.
"""

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.schemas.base import UTCResponseBase
from app.utils.membership import MemberClass, MemberStatus

_response_config = ConfigDict(from_attributes=True)


# --- Member-chosen profile visibility ---------------------------------------
#
# What of a member's own contact block other members may see. Two things decide
# whether a colleague sees a field: the organisation's ``contact_info_visibility``
# ceiling (work email, phone, mobile only) and the member's own choice here.
# Personal email and the home address have no organisation flag — they were
# leadership-only unconditionally until 2026-09, and are now the member's call.
#
# Defaults preserve exactly the pre-2026-09 behaviour, so a NULL column on an
# existing installation changes nothing: email/phone/mobile shown where the
# department allows, personal email and address hidden until the member opts in.
PROFILE_VISIBILITY_FIELDS: tuple[str, ...] = (
    "email",
    "personal_email",
    "phone",
    "mobile",
    "address",
)
PROFILE_VISIBILITY_DEFAULTS: dict[str, bool] = {
    "email": True,
    "personal_email": False,
    "phone": True,
    "mobile": True,
    "address": False,
}


class ProfileVisibility(BaseModel):
    """Which of a member's own contact fields other members may see.

    Written only as a whole object (``PUT /users/me/profile-visibility``), so
    every key is required and unknown keys are refused: a partial write would
    leave the stored shape ambiguous, and a misspelt key would silently do
    nothing while the member believed they had hidden something.
    """

    email: bool
    personal_email: bool
    phone: bool
    mobile: bool
    address: bool

    # strict: a JSON "true" or 1 is refused rather than coerced, matching
    # `normalize_profile_visibility`, which honours only genuine booleans.
    model_config = ConfigDict(extra="forbid", strict=True)


def normalize_profile_visibility(stored: object) -> dict[str, bool]:
    """Turn whatever the JSON column holds into the complete canonical dict.

    ``None`` (never chosen) and any malformed value resolve to the defaults,
    key by key: only a genuine ``bool`` is honoured — ``type(v) is bool``
    rather than ``isinstance``, because ``isinstance(1, bool)`` is False but
    ``isinstance(True, int)`` is True, and a ``1`` written by some future
    client must not read as "show". A bad value inside free-form JSON must
    degrade to the safe default rather than raise (pitfall #19).
    """
    result = dict(PROFILE_VISIBILITY_DEFAULTS)
    if isinstance(stored, dict):
        for key in PROFILE_VISIBILITY_FIELDS:
            value = stored.get(key)
            if type(value) is bool:
                result[key] = value
    return result


def resolve_profile_visibility(user: object) -> ProfileVisibility:
    """The member's effective choice, defaults applied.

    ``getattr`` rather than attribute access so the lightweight stand-ins the
    endpoint tests pass as ``current_user`` resolve to the defaults instead of
    raising.
    """
    return ProfileVisibility(
        **normalize_profile_visibility(getattr(user, "profile_visibility", None))
    )


class EmergencyContact(BaseModel):
    """Emergency contact schema"""

    name: str = Field(..., min_length=1, max_length=100)
    relationship: str = Field(..., min_length=1, max_length=50)
    phone: str = Field(..., max_length=20)
    email: Optional[EmailStr] = None
    is_primary: bool = False


class UserBase(BaseModel):
    """Base user schema with common fields"""

    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    first_name: Optional[str] = Field(None, max_length=100)
    middle_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    membership_number: Optional[str] = Field(None, max_length=50)
    date_of_birth: Optional[date] = None
    hire_date: Optional[date] = None


class UserCreate(UserBase):
    """Schema for creating a new user"""

    password: str = Field(..., min_length=12)
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)


class MembershipClassificationFields(BaseModel):
    """The two independent facts ``membership_type`` used to fuse.

    Mixed into both the create and update schemas rather than repeated,
    because the validators have to agree: a value one endpoint accepts and the
    other rejects would be worse than neither accepting it.

    Accepting these at all is what makes the motivating cases reachable — an
    administrative probationer, an operational life member — since the
    reconciliation listener on ``User`` can only preserve a pair some caller is
    able to set. Omit both and the listener derives them from
    ``membership_type`` exactly as before, so existing clients are unaffected.
    """

    member_class: Optional[str] = Field(
        None, description="operational | administrative | social"
    )
    member_status: Optional[str] = Field(
        None,
        description=(
            "prospective | probationary | regular | life | retired | "
            "honorary | junior"
        ),
    )

    @field_validator("member_class")
    @classmethod
    def _known_member_class(cls, value: Optional[str]) -> Optional[str]:
        """Reject an unknown class rather than storing it.

        Unlike ``membership_type`` — which doubles as a free-form membership
        *tier* id and so cannot be constrained — these two are a closed
        vocabulary. A typo would put a member in no class at all, which reads
        as "not operational" and quietly removes them from ballots.
        """
        if value is None:
            return None
        normalised = value.strip().lower()
        if normalised not in MemberClass.ALL:
            raise ValueError(
                f"Unknown member_class '{value}'. "
                f"Expected one of: {', '.join(MemberClass.ALL)}."
            )
        return normalised

    @field_validator("member_status")
    @classmethod
    def _known_member_status(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalised = value.strip().lower()
        if normalised not in MemberStatus.ALL:
            raise ValueError(
                f"Unknown member_status '{value}'. "
                f"Expected one of: {', '.join(MemberStatus.ALL)}."
            )
        return normalised


class AdminUserCreate(MembershipClassificationFields):
    """Schema for admin/secretary creating a new member"""

    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    first_name: str = Field(..., min_length=1, max_length=100)
    middle_name: Optional[str] = Field(None, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)

    membership_number: Optional[str] = Field(
        None,
        max_length=50,
        description="Membership number; auto-assigned if not provided and membership ID is enabled",
    )
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)
    date_of_birth: Optional[date] = None
    hire_date: Optional[date] = None

    member_status: Optional[str] = Field(
        None,
        description=(
            "prospective | probationary | regular | life | retired | "
            "honorary | junior"
        ),
    )

    # Department info
    rank: Optional[str] = Field(None, max_length=100)
    station: Optional[str] = Field(None, max_length=100)
    platoon: Optional[str] = Field(None, max_length=20)

    # Address
    address_street: Optional[str] = Field(None, max_length=255)
    address_city: Optional[str] = Field(None, max_length=100)
    address_state: Optional[str] = Field(None, max_length=50)
    address_zip: Optional[str] = Field(None, max_length=20)
    address_country: Optional[str] = Field(default="USA", max_length=100)

    # Emergency contacts
    emergency_contacts: List[EmergencyContact] = Field(default_factory=list)

    # Admin options
    password: Optional[str] = Field(
        None,
        min_length=12,
        description="Optional initial password. If omitted a temporary password is auto-generated.",
    )
    role_ids: List[UUID] = Field(
        default_factory=list, description="Initial roles to assign"
    )
    send_welcome_email: bool = Field(
        default=True, description="Send welcome email with password setup link"
    )


class UserUpdate(MembershipClassificationFields):
    """Schema for updating a user"""

    # Member class and status are the two independent facts `membership_type`
    # used to fuse. Accepting them here is what makes an administrative
    # probationer expressible at all — the reconciliation listener on `User`
    # can only preserve a pair some caller is able to set. Omit both and the
    # listener derives them from `membership_type` as before, so existing
    # clients are unaffected.
    member_class: Optional[str] = Field(
        None, description="operational | administrative | social"
    )
    member_status: Optional[str] = Field(
        None,
        description=(
            "prospective | probationary | regular | life | retired | "
            "honorary | junior"
        ),
    )

    first_name: Optional[str] = Field(None, max_length=100)
    middle_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)
    personal_email: Optional[str] = Field(None, max_length=255)
    membership_number: Optional[str] = Field(None, max_length=50)
    date_of_birth: Optional[date] = None
    hire_date: Optional[date] = None

    # Department info
    rank: Optional[str] = Field(None, max_length=100)
    station: Optional[str] = Field(None, max_length=100)
    platoon: Optional[str] = Field(None, max_length=20)

    # Address
    address_street: Optional[str] = Field(None, max_length=255)
    address_city: Optional[str] = Field(None, max_length=100)
    address_state: Optional[str] = Field(None, max_length=50)
    address_zip: Optional[str] = Field(None, max_length=20)
    address_country: Optional[str] = Field(None, max_length=100)

    # Emergency contacts
    emergency_contacts: Optional[List[EmergencyContact]] = None


class UserResponse(UserBase, UTCResponseBase):
    """
    Schema for user response (without sensitive data like password)

    Contact information (phone, email, mobile) will be conditionally
    included based on organization settings.
    """

    id: UUID
    organization_id: UUID
    photo_url: Optional[str] = None
    personal_email: Optional[str] = None
    status: str
    membership_type: Optional[str] = None
    member_class: Optional[str] = None
    member_status: Optional[str] = None
    compliance_exempt: bool = False
    # Optional so profile redaction can withhold them from directory-only
    # callers (see `_clear_directory_only_profile_metadata` in the users
    # endpoint). None means "not disclosed to this caller" — a neutral False
    # would misreport an MFA-enabled account as unprotected, so absence must
    # stay distinguishable from a real value. Always populated from the ORM
    # for self/leadership.
    email_verified: Optional[bool] = None
    mfa_enabled: Optional[bool] = None
    last_login_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    # Contact info - conditionally included
    phone: Optional[str] = None
    mobile: Optional[str] = None

    # Department info
    rank: Optional[str] = None
    station: Optional[str] = None
    platoon: Optional[str] = None

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

    @field_validator("emergency_contacts", mode="before")
    @classmethod
    def coerce_null_emergency_contacts(cls, v: object) -> object:
        """Coerce NULL (from DB) to empty list so Pydantic doesn't reject it."""
        return v if v is not None else []

    model_config = _response_config


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
    membership_number: Optional[str] = None
    phone: Optional[str] = None  # Conditionally included
    mobile: Optional[str] = None  # Conditionally included
    photo_url: Optional[str] = None
    status: str
    membership_type: Optional[str] = None
    member_class: Optional[str] = None
    member_status: Optional[str] = None
    compliance_exempt: bool = False
    hire_date: Optional[date] = None

    # Department info
    rank: Optional[str] = None
    station: Optional[str] = None
    platoon: Optional[str] = None

    model_config = _response_config


class RoleResponse(BaseModel):
    """Schema for role response"""

    id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    permissions: List[str] = []
    is_system: bool
    priority: int

    @field_validator("permissions", mode="before")
    @classmethod
    def coerce_null_permissions(cls, v: object) -> object:
        """Coerce NULL (from DB) to empty list so Pydantic doesn't reject it."""
        return v if v is not None else []

    model_config = _response_config


class UserWithRolesResponse(UserResponse):
    """User response with roles included"""

    roles: List[RoleResponse] = []
    temporary_password: Optional[str] = Field(
        None, description="Auto-generated temporary password (only present on creation)"
    )

    model_config = _response_config


class NotificationPreferences(BaseModel):
    """Notification preferences schema.

    Email is the primary channel; the flags here govern which notifications a
    member receives on top of the announcements they always get by email.
    """

    # The single master email switch. A second `email` key used to sit beside
    # this one meaning the same thing, read by one sender and written by a
    # different screen; migration 20260816_0007 folded it in here.
    email_notifications: bool = True
    # Mutes the SMS *addition* to the emails a member already receives, and
    # only for the urgent alerts in notification_channels.SmsAlert. Defaults
    # to True because the effective opt-in is the recorded TCPA consent, which
    # fails closed — turning this off is how a consenting member silences
    # texts without losing the email.
    sms_notifications: bool = True
    event_reminders: bool = True
    training_reminders: bool = True

    model_config = _response_config


class ContactInfoUpdate(BaseModel):
    """Schema for updating contact information and notification preferences"""

    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)
    notification_preferences: Optional[NotificationPreferences] = None


class UserProfileResponse(UserResponse):
    """Extended user response with roles and notification preferences"""

    # These account-management fields are cleared when this schema is used as
    # a directory profile for a caller who has only ``members.view``.
    email_verified: Optional[bool] = None
    mfa_enabled: Optional[bool] = None
    last_login_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    roles: List[RoleResponse] = []
    notification_preferences: Optional[dict] = None
    # Resolved (defaults applied) for the member themselves and for
    # members.manage holders; cleared to None for anyone else — what a
    # colleague chose to hide is itself private. See `get_user_with_roles`.
    profile_visibility: Optional[ProfileVisibility] = None

    @field_validator("profile_visibility", mode="before")
    @classmethod
    def _resolve_profile_visibility(cls, v: object) -> object:
        """A NULL column is "never chosen", not "no visibility object".

        Resolving here means every payload built from the ORM carries the
        complete five-key object, so no reader has to know the defaults. An
        already-built ``ProfileVisibility`` passes through untouched.
        """
        if isinstance(v, ProfileVisibility):
            return v
        return normalize_profile_visibility(v)

    model_config = _response_config


class AdminPasswordReset(BaseModel):
    """Schema for admin resetting a user's password"""

    new_password: str = Field(
        ..., min_length=12, max_length=128, description="New password for the user"
    )
    force_change: bool = Field(
        default=True,
        description="Require the user to change the password on next login",
    )


class MemberAuditLogEntry(UTCResponseBase):
    """Schema for member audit history entries"""

    id: int
    timestamp: datetime
    event_type: str
    severity: str
    description: str
    changed_by_username: Optional[str] = None
    changed_by_user_id: Optional[str] = None
    event_data: Optional[dict] = None

    model_config = _response_config


class DeletionImpactResponse(BaseModel):
    """Schema for member deletion impact assessment"""

    user_id: str
    full_name: Optional[str] = None
    status: str
    training_records: int = 0
    inventory_items: int = 0
    documents: int = 0
    total_records: int = 0
