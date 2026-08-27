"""
User Pydantic Schemas

Request and response schemas for user-related endpoints.
"""

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.schemas.base import UTCResponseBase
from app.utils.membership import MemberClass, MemberStatus, may_hold_rank

_response_config = ConfigDict(from_attributes=True)


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

    @model_validator(mode="after")
    def _no_rank_for_an_administrative_member(self) -> "MembershipClassificationFields":
        """Refuse a rank and the administrative class in the same payload.

        The listener on ``User`` would clear the rank anyway — see
        ``may_hold_rank`` — but silently discarding a value the operator just
        typed reads as the form having lost it. Rejecting here names the
        conflict while both halves are still in front of them.

        Only catches the pair when one request carries both, which is why the
        endpoints check a submitted rank against the member's *stored* class as
        well: a request that sets only ``rank`` has nothing here to compare it
        to. Clearing a rank stays allowed in every combination — an empty value
        is what this rule wants.
        """
        rank = getattr(self, "rank", None)
        if rank and str(rank).strip() and not may_hold_rank(self.member_class):
            raise ValueError(
                "An administrative member cannot hold an operational rank. "
                "Clear the rank, or set a member_class that rides."
            )
        return self


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
