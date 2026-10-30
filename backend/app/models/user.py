"""
User Database Models

SQLAlchemy models for user management, authentication, and authorization.
Compatible with MySQL database.

Taxonomy
--------
- **Operational Rank** (one per member, stored in ``User.rank``):
  Configurable per organization via the ``operational_ranks`` table.
  Ranks carry *default* permissions that are combined with the
  member's position permissions at runtime.

- **Corporate Position** (many per member, via ``user_positions``):
  President, Vice President, Treasurer, Secretary, IT Manager, etc.
  Positions are the *primary* source of permissions.

- **Member Class and Status** (one each per member, ``User.member_class`` /
  ``User.member_status``):  *Class* is what kind of member somebody is —
  operational, administrative, social.  *Status* is where they sit on the
  membership ladder — prospective, probationary, regular, life, retired
  (also honorary, junior).  They are independent questions: an administrative
  member can be probationary, and a life member can still ride.  Neither
  carries permissions; both are organisational classification.

  ``User.membership_type`` is the single legacy field that held both at once,
  and is why "operational" could only ever be answered as ``== "active"``.
  It is still stored, still read by ~160 call sites, and now *derived* from
  the pair — see ``app/utils/membership.py``.  When the two disagree with it,
  the pair is right.

- **Qualification** (many per member, ``member_qualifications``):
  What a member is trained and certified to *do* — EMT, Paramedic,
  Driver/Operator, Firefighter I/II — as distinct from where they sit in the
  chain of command.  A Captain may also be a Paramedic.  Unlike a rank, a
  qualification expires, and shift eligibility reads it as of the shift date.

- **Prospect** (separate lightweight table):
  Individuals who have expressed interest in joining but have not yet
  been converted into full members (no User record, no department
  credentials).

Account status is a fourth axis, and it is not one of the above
-------------------------------------------------------------
``User.status`` (``UserStatus``) is the *account and roster* lifecycle: may
this person sign in, and do they appear as a current member.
``User.member_status`` is the *membership ladder*: how far through the
department's own progression they are.  Three spellings appear in both —
``probationary``, ``retired``, and the non-participating case — which is
precisely why they get read as one thing and are not.

They are reconciled in one direction only (owner decision 2026-10-20).
Membership drives status, between the two statuses that say nothing about
leave or separation: writing a membership type of ``probationary`` puts an
``active`` account on ``probationary``, and writing any other type moves a
``probationary`` account back to ``active``.  A member on leave, suspended,
inactive, retired or dropped keeps that status whatever their type says; the
status catches up when they return.  ``PATCH /users/{id}/status`` still
writes ``status`` on its own and never touches ``membership_type`` — an
officer can put an active-type member on probation by hand, and it holds
until the type is next written.  ``account_status_for_membership`` below is
the rule, ``sync_account_status_with_membership`` applies it, and the flush
listener runs it whenever a membership field was written.  A rule that
consults only membership still sees a retired member as a regular operational
one, so any gate about *participation* must ask both;
``ShiftEligibilityService`` does.

``membership_type`` cannot be enum-constrained
----------------------------------------------
It looks like it should be, and it must not be.  Besides the seven legacy
values, ``POST /member-status/{id}/tier`` writes organization-configurable
membership **tier ids** into this same column, validated against
``organization.settings["membership_tiers"]`` — and the shipped defaults
already include ``senior``.  Constraining the column would reject
configuration the application itself offers.  This is also why
``split_membership_type`` returns ``(None, None)`` for a value it does not
recognise rather than defaulting: guessing "regular operational member" would
enrol every custom tier in bodies they were never part of, including ballot
electorates.
"""

import enum
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING, Any, Mapping, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    event,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym
from sqlalchemy.sql import ColumnElement, and_, func

from app.core.database import Base
from app.core.encrypted_types import (
    EncryptedDate,
    EncryptedJSON,
    EncryptedText,
    keep_email_fingerprint,
)
from app.core.permissions import position_mirrors_rank
from app.core.utils import generate_uuid
from app.utils.member_badge import generate_badge_code
from app.utils.member_names import format_display_name, format_legal_name
from app.utils.membership import (
    DEFAULT_CLASS,
    DEFAULT_STATUS,
    MemberStatus,
    canonical_member_status,
    derive_membership_type,
    split_membership_type,
    status_for_tier,
)

if TYPE_CHECKING:
    from app.models.public_portal import PublicPortalConfig


class UserStatus(str, enum.Enum):
    """User account status"""

    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PROBATIONARY = "probationary"
    LEAVE = "leave"
    RETIRED = "retired"
    DROPPED_VOLUNTARY = "dropped_voluntary"
    DROPPED_INVOLUNTARY = "dropped_involuntary"
    ARCHIVED = "archived"


# Account statuses that may sign in and take part: be scheduled, receive
# messages, file checks. A probationary member is a current member on
# probation, not a former one. Admins set PROBATIONARY from the member's
# "Change status" menu, and junior members derive to it, so leaving it out
# locked every probie and junior out of the app with "Account is inactive".
ACTIVE_ACCOUNT_STATUSES = (UserStatus.ACTIVE, UserStatus.PROBATIONARY)


class MembershipType(str, enum.Enum):
    """
    Department membership classification.

    Membership types carry **no** system permissions – they are purely
    organisational.  ``PROSPECTIVE`` members live in the separate
    ``prospects`` table; the enum value is here only for reference.
    """

    PROSPECTIVE = "prospective"
    PROBATIONARY = "probationary"
    ACTIVE = "active"
    LIFE = "life"
    RETIRED = "retired"
    HONORARY = "honorary"
    ADMINISTRATIVE = "administrative"


class OrganizationType(str, enum.Enum):
    """Organization/Department type"""

    FIRE_DEPARTMENT = "fire_department"
    EMS_ONLY = "ems_only"
    FIRE_EMS_COMBINED = "fire_ems_combined"


class IdentifierType(str, enum.Enum):
    """Type of department identifier used"""

    FDID = "fdid"  # Fire Department ID (NFIRS)
    STATE_ID = "state_id"  # State license/certification number
    DEPARTMENT_ID = "department_id"  # Internal department ID only


class Organization(Base):
    """
    Organization/Department model

    Supports multi-tenancy - each organization is isolated.
    Contains comprehensive organization details including addresses,
    contact information, and regulatory identifiers.
    """

    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    # Purchasing controls are explicit department policy, not client hints.
    reorder_vendor_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    reorder_po_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    # Organization Type
    organization_type: Mapped[OrganizationType] = mapped_column(
        Enum(OrganizationType, values_callable=lambda x: [e.value for e in x]),
        default=OrganizationType.FIRE_DEPARTMENT,
        nullable=False,
        server_default="fire_department",
    )

    # Timezone
    timezone: Mapped[Optional[str]] = mapped_column(
        String(50), default="America/New_York"
    )

    # Contact Information
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    fax: Mapped[Optional[str]] = mapped_column(String(20))
    email: Mapped[Optional[str]] = mapped_column(String(255))
    website: Mapped[Optional[str]] = mapped_column(String(255))

    # Mailing Address
    mailing_address_line1: Mapped[Optional[str]] = mapped_column(String(255))
    mailing_address_line2: Mapped[Optional[str]] = mapped_column(String(255))
    mailing_city: Mapped[Optional[str]] = mapped_column(String(100))
    mailing_state: Mapped[Optional[str]] = mapped_column(String(50))
    mailing_zip: Mapped[Optional[str]] = mapped_column(String(20))
    mailing_country: Mapped[Optional[str]] = mapped_column(String(100), default="USA")

    # Physical Address (station/headquarters location)
    physical_address_same: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)
    physical_address_line1: Mapped[Optional[str]] = mapped_column(String(255))
    physical_address_line2: Mapped[Optional[str]] = mapped_column(String(255))
    physical_city: Mapped[Optional[str]] = mapped_column(String(100))
    physical_state: Mapped[Optional[str]] = mapped_column(String(50))
    physical_zip: Mapped[Optional[str]] = mapped_column(String(20))
    physical_country: Mapped[Optional[str]] = mapped_column(String(100), default="USA")

    # Department Identifiers
    identifier_type: Mapped[IdentifierType] = mapped_column(
        Enum(IdentifierType, values_callable=lambda x: [e.value for e in x]),
        default=IdentifierType.DEPARTMENT_ID,
        nullable=False,
        server_default="department_id",
    )
    fdid: Mapped[Optional[str]] = mapped_column(
        String(50)
    )  # Fire Department ID (NFIRS)
    state_id: Mapped[Optional[str]] = mapped_column(
        String(50)
    )  # State license/certification number
    department_id: Mapped[Optional[str]] = mapped_column(
        String(50)
    )  # Internal department ID

    # Additional Information
    county: Mapped[Optional[str]] = mapped_column(String(100))
    founded_year: Mapped[Optional[int]] = mapped_column(Integer)
    tax_id: Mapped[Optional[str]] = mapped_column(
        String(50)
    )  # EIN for 501(c)(3) organizations

    # Logo stored as base64 or URL (MEDIUMTEXT for large base64 images)
    # LONGTEXT, not MEDIUMTEXT: the logo is stored as a base64 data URI, and
    # migration 20260209_0600 widened this column to LONGTEXT on existing
    # databases. The model has to match, or fresh installs silently get the
    # narrower column that migration exists to prevent.
    logo: Mapped[Optional[str]] = mapped_column(
        Text().with_variant(mysql.LONGTEXT(), "mysql")
    )

    # Legacy field - keep for compatibility
    type: Mapped[Optional[str]] = mapped_column(String(50), default="fire_department")

    # Settings JSON for extensibility — MutableDict ensures SQLAlchemy detects
    # in-place mutations to nested dicts, preventing silent commit no-ops.
    settings: Mapped[Optional[dict[str, Any]]] = mapped_column(
        MutableDict.as_mutable(JSON), default=dict
    )
    # server_default matches what the migrations give this column. Without it,
    # a table built by create_all() — the fast-path install, and the test
    # database — has no column default, so a raw-SQL insert that omits
    # `active` stores NULL, and every `if not org.active` check then treats a
    # brand-new department as deactivated.
    active: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=True, server_default="1", index=True
    )

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    users: Mapped[list["User"]] = relationship("User", back_populates="organization")
    positions: Mapped[list["Position"]] = relationship(
        "Position", back_populates="organization"
    )
    prospects: Mapped[list["Prospect"]] = relationship(
        "Prospect", back_populates="organization"
    )
    public_portal_config: Mapped[Optional["PublicPortalConfig"]] = relationship(
        "PublicPortalConfig",
        back_populates="organization",
        uselist=False,
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<Organization(name={self.name}, type={self.organization_type})>"


class User(Base):
    """
    User model with comprehensive authentication and profile support.

    Every converted member has a User record.  Prospective members do
    **not** – they live in the ``prospects`` table until accepted.
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Basic Info
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    # Encrypted at rest; SQL matches on email_hash, which keep_email_fingerprint
    # recomputes on every ORM write of the address (see the end of this module).
    # Nullable only because raw-SQL inserts bypass that listener; a row written
    # that way has no fingerprint and cannot be found by its address.
    email: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    email_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    personal_email: Mapped[Optional[str]] = mapped_column(
        EncryptedText
    )  # Personal/home email for post-separation contact
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))
    # OAuth / external identity provider linkage. NULL for password-only users.
    # oauth_provider records the IdP ("google"); oauth_subject is the provider's
    # stable, immutable user id (Google's "sub" claim) used to re-match on later
    # logins even if the email address changes.
    oauth_provider: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    oauth_subject: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, index=True
    )
    first_name: Mapped[Optional[str]] = mapped_column(String(100))
    middle_name: Mapped[Optional[str]] = mapped_column(String(100))
    last_name: Mapped[Optional[str]] = mapped_column(String(100))
    # The name a member goes by ("Terry" for John Terry Heather). It replaces
    # first_name on everyday screens only; first_name stays the legal name of
    # record that reports, training records, certificates, ballots and legal
    # documents must carry. NULL means "goes by first_name".
    preferred_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    membership_number: Mapped[Optional[str]] = mapped_column(
        String(50)
    )  # Organization-assigned membership ID (e.g., "001", "M-042")
    # The code a member's printed and on-screen badge carries, issued at
    # random by the server (app/utils/member_badge.py). Unlike the membership
    # number it appears nowhere in the directory, so a colleague cannot print
    # a working copy; reissuing it cancels a lost badge. Never add it to a
    # general user response — it is served only by /member-badges.
    badge_code: Mapped[Optional[str]] = mapped_column(
        String(16), nullable=True, default=generate_badge_code
    )
    previous_membership_number: Mapped[Optional[str]] = mapped_column(
        String(50)
    )  # Preserved on soft-delete so returning members can reclaim their number
    phone: Mapped[Optional[str]] = mapped_column(EncryptedText)
    mobile: Mapped[Optional[str]] = mapped_column(EncryptedText)

    # Profile
    photo_url: Mapped[Optional[str]] = mapped_column(Text)
    # Encrypted at rest (HIPAA): not searchable or sortable in SQL.
    date_of_birth: Mapped[Optional[date]] = mapped_column(EncryptedDate)
    hire_date: Mapped[Optional[date]] = mapped_column(Date)

    # Operational Rank (one per member, has default permissions)
    rank: Mapped[Optional[str]] = mapped_column(
        String(100)
    )  # e.g., "fire_chief", "captain", "firefighter"
    station: Mapped[Optional[str]] = mapped_column(
        String(100)
    )  # e.g., "Station 1", "Headquarters"
    # Duty platoon / shift group for platoon-rotation scheduling (A/B/C/...).
    # Single source of truth consumed by shift pattern generation.
    platoon: Mapped[Optional[str]] = mapped_column(String(20))

    # Address. Phone, mobile and these four are encrypted at rest so a stolen
    # dump or backup does not carry a member's home address; nothing filters or
    # sorts on them in SQL. Country alone identifies no one and stays plain.
    address_street: Mapped[Optional[str]] = mapped_column(EncryptedText)
    address_city: Mapped[Optional[str]] = mapped_column(EncryptedText)
    address_state: Mapped[Optional[str]] = mapped_column(EncryptedText)
    address_zip: Mapped[Optional[str]] = mapped_column(EncryptedText)
    address_country: Mapped[Optional[str]] = mapped_column(String(100), default="USA")

    # Referral data preserved from prospect record on transfer
    referral_source: Mapped[Optional[str]] = mapped_column(String(255))
    interest_reason: Mapped[Optional[str]] = mapped_column(Text)
    referred_by_user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Emergency Contacts (stored as JSON array)
    # Format: [{"name": "...", "relationship": "...", "phone": "...", "email": "...", "is_primary": true}, ...]
    # Encrypted at rest: names, phone numbers and emails of people who are not
    # members and never agreed to be in this database.
    emergency_contacts: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        EncryptedJSON, default=list
    )

    # Notification Preferences (stored as JSON object)
    # Format: {"email_notifications": true, "sms_notifications": true,
    #          "event_reminders": true, "training_reminders": true}
    # Email is the primary channel; these flags govern what a member gets in
    # addition to it. sms_notifications mutes the text that accompanies an
    # urgent department message (the email still goes out) and is one of two
    # gates — the recorded TCPA consent is the other. See
    # app/services/notification_channels.
    notification_preferences: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, default=dict
    )

    # What of the member's own contact block other members may see. Canonical
    # shape is the five booleans in
    # ``app.schemas.user.PROFILE_VISIBILITY_DEFAULTS``; NULL means the member
    # has never chosen, which resolves to those defaults. Only the member
    # writes it (``PUT /users/me/profile-visibility``), and always as a whole
    # new dict — there is no nested-key mutation path (pitfall #12). No
    # ``default=``: ``{}`` and NULL would otherwise be two spellings of "never
    # chosen".
    profile_visibility: Mapped[Optional[dict[str, bool]]] = mapped_column(
        JSON, nullable=True
    )

    # The member's choice of the two configurable tabs on the phone bottom bar,
    # as a JSON array of app paths (``["/events", "/account"]``). NULL means
    # never chosen, which leaves the bar on its role-based defaults. Written
    # only as a whole list by ``PUT /users/me/bottom-navigation`` and read
    # through ``normalize_bottom_nav_slots``, so a malformed value degrades to
    # the defaults rather than breaking the bar.
    bottom_nav_slots: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)

    # The member's own layout for the dashboard's Department pulse cards, as
    # ``{"period", "cards": [{"id", "visible", "title"}]}``. NULL means never
    # chosen, which falls back to the department default in
    # ``Organization.settings["dashboard_pulse"]`` and then to the built-in
    # layout. Written only as a whole by ``PUT /dashboard/pulse-layout`` and
    # read through ``normalize_pulse_layout``, so a malformed value degrades to
    # the default rather than breaking the dashboard.
    dashboard_pulse: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )

    # Department Membership (one per member, no permissions – purely classification)
    #
    # Three columns, two facts. ``member_class`` (operational / administrative
    # / social) and ``member_status`` (prospective → retired) are the
    # authority; ``membership_type`` is the single legacy field that held both
    # at once and is now derived from them, because ~160 call sites still read
    # it. ``app/utils/membership.py`` owns the derivation, and the
    # ``_reconcile_membership`` listener below keeps the three consistent no
    # matter which of them a caller writes.
    membership_type: Mapped[Optional[str]] = mapped_column(
        String(50), default="active"
    )  # See MembershipType enum
    # No column default, for the same reason the migration sets no server
    # default: a default would be applied to writes that name only
    # `membership_type`, and would be wrong for precisely the members who are
    # not plain operational regulars. NULL means "nobody has set this", and a
    # reader derives from `membership_type` when it sees one. ORM writes never
    # leave it NULL — `_reconcile_membership` below fills both.
    # active_history: the previous value is loaded on assignment, so
    # `_reconcile_membership` can tell a real change from a re-save of the
    # same value when it stamps the `*_since` columns below.
    member_class: Mapped[Optional[str]] = mapped_column(
        String(20), index=True, active_history=True
    )
    # Fifty, not twenty: this column also holds a department's own membership
    # tier ids (``senior``), which ``MembershipTier.id`` allows up to 50
    # characters. See ``canonical_member_status`` for the spelling rule.
    member_status: Mapped[Optional[str]] = mapped_column(
        String(50), index=True, active_history=True
    )
    # When the member's class / status became what it is now. Stamped by
    # `_reconcile_membership` on every write path, and read as the start of a
    # voting waiting period ("administrative members may vote a year after
    # becoming administrative"). Rows that predate the columns hold a backfilled
    # best guess; a secretary corrects one with `voting_wait_from`.
    member_class_since: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    member_status_since: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # A secretary's per-member override of the voting waiting period: the
    # date the wait counts from instead of the `*_since` stamp, and/or a
    # waiver of the wait. Neither lifts a "never eligible" type or an
    # attendance requirement. The reason is required whenever either is set.
    voting_wait_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    voting_wait_waived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    voting_wait_override_reason: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    membership_type_changed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )  # When membership tier last changed

    # Status
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, values_callable=lambda x: [e.value for e in x]),
        default=UserStatus.ACTIVE,
        index=True,
        nullable=False,
        server_default="active",
    )
    status_changed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )  # When status last changed (used for drop-date tracking)
    status_change_reason: Mapped[Optional[str]] = mapped_column(
        Text
    )  # Reason for the last status change
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )  # When the member was archived (after all property returned)
    # Compliance exemption — when True, the member is not evaluated against
    # training requirements, shift minimums, admin-hour targets, or
    # certificate maintenance.  Typical use: retired / honorary members.
    compliance_exempt: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    email_verified: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)

    # MFA — secret and backup codes are encrypted at rest via
    # application-layer AES-256 (Fernet) to protect against DB compromise.
    mfa_enabled: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    _mfa_secret_encrypted: Mapped[Optional[str]] = mapped_column(
        "mfa_secret", String(255)
    )
    _mfa_backup_codes_encrypted: Mapped[Optional[list[str]]] = mapped_column(
        "mfa_backup_codes", JSON
    )
    # Highest TOTP time-step (unix_time // period) already accepted at login.
    # A code whose step is <= this value is rejected as a replay, so a captured
    # or shoulder-surfed code cannot be reused within its ±30s validity window.
    mfa_last_timestep: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # When the server first saw this member privileged and un-enrolled; the
    # MFA grace period is measured from it. See services/mfa_policy.py.
    mfa_grace_started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @property
    def mfa_secret(self) -> str | None:
        if not self._mfa_secret_encrypted:
            return None
        try:
            from cryptography.fernet import InvalidToken

            from app.core.security import decrypt_data

            return decrypt_data(self._mfa_secret_encrypted)
        except InvalidToken:
            # Fallback for legacy pre-encryption plaintext values only; a real
            # error (missing key, bug) propagates instead of being masked.
            legacy: str = self._mfa_secret_encrypted
            return legacy

    @mfa_secret.setter
    def mfa_secret(self, value: str | None) -> None:
        if value is None:
            self._mfa_secret_encrypted = None
        else:
            from app.core.security import encrypt_data

            self._mfa_secret_encrypted = encrypt_data(value)

    @property
    def mfa_backup_codes(self) -> list | None:
        raw: list | None = self._mfa_backup_codes_encrypted
        if raw is None:
            return None
        # If stored as a list of encrypted strings, decrypt each
        if (
            isinstance(raw, list)
            and raw
            and isinstance(raw[0], str)
            and len(raw[0]) > 40
        ):
            try:
                from cryptography.fernet import InvalidToken

                from app.core.security import decrypt_data

                return [decrypt_data(c) for c in raw]
            except InvalidToken:
                # Legacy pre-encryption plaintext codes only.
                return raw
        return raw

    @mfa_backup_codes.setter
    def mfa_backup_codes(self, value: list | None) -> None:
        if value is None:
            self._mfa_backup_codes_encrypted = None
        else:
            from app.core.security import encrypt_data

            self._mfa_backup_codes_encrypted = [encrypt_data(c) for c in value]

    # Password Management
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    # When the member was first told their password had expired; the server
    # refuses an expired password HIPAA_PASSWORD_EXPIRY_GRACE_DAYS after this
    # (AUTH-15). Cleared whenever the password changes.
    password_expiry_notified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    failed_login_attempts: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    password_reset_token: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    password_reset_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )
    # Unguessable token for the member's personal read-only ICS calendar feed
    # (subscribed from Google/Apple Calendar, which can't do cookie auth).
    calendar_feed_token: Mapped[Optional[str]] = mapped_column(
        String(64), index=True, nullable=True
    )

    # Timestamps
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Set when this member's PII was scrubbed by the anonymization workflow
    # (member_anonymization_service). NULL = not anonymized. Operational
    # history rows stay linked to the anonymized shell record.
    anonymized_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="users"
    )
    positions: Mapped[list["Position"]] = relationship(
        "Position",
        secondary="user_positions",
        back_populates="users",
        primaryjoin="User.id == user_positions.c.user_id",
        secondaryjoin="Position.id == user_positions.c.position_id",
    )

    # Indexes and constraints
    __table_args__ = (
        Index("idx_user_org_username", "organization_id", "username", unique=True),
        Index("idx_user_org_email_hash", "organization_id", "email_hash", unique=True),
        Index(
            "idx_user_org_membership_number",
            "organization_id",
            "membership_number",
            unique=True,
        ),
        Index("idx_user_org_badge_code", "organization_id", "badge_code", unique=True),
        Index("idx_user_org_status_deleted", "organization_id", "status", "deleted_at"),
        Index("idx_user_created_at", "created_at"),
        Index("idx_user_last_login_at", "last_login_at"),
    )

    # Backward-compatible alias so ``selectinload(User.roles)`` and
    # ``user.roles`` both resolve to the ``positions`` relationship.
    roles = synonym("positions")

    @property
    def full_name(self) -> str:
        """The legal name of record: first and last name.

        Reports, exports, training records, certificates, ballots and legal
        documents read this. It deliberately ignores ``preferred_name`` — use
        ``display_name`` for everyday references to a member.
        """
        return format_legal_name(self.first_name, self.last_name)

    @property
    def display_name(self) -> str:
        """The name a member is known by: preferred name (else first) + last."""
        return format_display_name(self.first_name, self.last_name, self.preferred_name)

    @hybrid_property
    def is_active(self) -> bool:
        """Whether the account may sign in and take part.

        True for ACTIVE and PROBATIONARY (see ``ACTIVE_ACCOUNT_STATUSES``)
        when the record is not deleted.
        """
        return self.status in ACTIVE_ACCOUNT_STATUSES and not self.deleted_at

    # ``inplace`` attaches the expression to the hybrid above rather than
    # rebinding the name, so the class keeps one ``is_active`` definition.
    @is_active.inplace.expression
    @classmethod
    def _is_active_expression(cls) -> ColumnElement[bool]:
        """SQL form of ``is_active``; the two must stay identical."""
        return and_(cls.status.in_(ACTIVE_ACCOUNT_STATUSES), cls.deleted_at.is_(None))

    @property
    def is_locked(self) -> bool:
        """Check if account is locked"""
        if not self.locked_until:
            return False
        locked = (
            self.locked_until
            if self.locked_until.tzinfo
            else self.locked_until.replace(tzinfo=timezone.utc)
        )
        return bool(datetime.now(timezone.utc) < locked)

    def __repr__(self):
        return f"<User(id={self.id}, username={self.username})>"


def _reconcile_membership(_mapper, _connection, target: "User") -> None:
    """Keep ``member_class``/``member_status`` and ``membership_type`` agreeing.

    Reconciled at flush rather than on attribute assignment, because the three
    fields set each other: a ``@validates`` hook on any one of them would
    re-enter the others' hooks and recurse. One pass here, after every
    assignment in the transaction has landed, has no such ordering problem.

    Whichever side the caller wrote is the side that wins. New code sets class
    and status; the ~160 existing call sites set ``membership_type`` and keep
    working unchanged. When both are written in the same flush the two new
    columns win, because they can express standings the legacy field cannot —
    an administrative probationer collapses to plain "administrative" on the
    way back out, and letting that derived value overwrite the real one would
    silently discard the status.
    """
    from sqlalchemy import inspect as sa_inspect

    state = sa_inspect(target)

    def _was_set(field: str) -> bool:
        history = state.attrs[field].history
        return bool(history.added)

    class_written = _was_set("member_class") or _was_set("member_status")
    legacy_written = _was_set("membership_type")

    if class_written:
        # The class defaults on insert, and on an update that names it (an
        # explicit null is a request to clear it, which lands on the default).
        # An update that writes only the status leaves the class exactly as
        # stored -- including NULL. A member whose class was never recorded
        # (one backfilled onto a department tier before the class existed)
        # must not become operational because the tier job moved them a rung:
        # the roster flags the missing class and an officer sets it.
        if _was_set("member_class") or not state.persistent:
            target.member_class = target.member_class or DEFAULT_CLASS
        target.member_status = (
            canonical_member_status(target.member_status) or DEFAULT_STATUS
        )
        target.membership_type = derive_membership_type(
            target.member_class, target.member_status
        )
    elif legacy_written or target.member_class is None or target.member_status is None:
        member_class, member_status = split_membership_type(target.membership_type)
        # Keep the class already recorded when the split cannot answer.
        #
        # An unrecognised value is a membership *tier* — org-configurable, and
        # the shipped defaults include `senior`. `split_membership_type`
        # returns (None, None) there because it must not guess a class. But
        # refusing to guess is not the same as erasing: a member advanced onto
        # the senior tier is the same operational firefighter they were the
        # moment before, and overwriting their class with None dropped the only
        # affirmative answer anything downstream had. Every rule that asks "is
        # this member operational?" then had to choose between excluding them
        # and treating an unknown class as a yes — which is how an open-to-all
        # shift came to waive rank, training and qualification checks for any
        # custom tier, including one a department created for members who do
        # not ride.
        #
        # The status is different: a tier id *is* a status, in the spelling
        # `canonical_member_status` fixes, so a legacy write of `senior` puts
        # `senior` on the ladder column rather than leaving the rung the
        # member stood on before.
        target.member_class = member_class or target.member_class
        target.member_status = member_status or canonical_member_status(
            target.membership_type
        )

    # Only a membership write moves the account status. Gating on the write,
    # not on the pair disagreeing, is what lets an officer's by-hand
    # "probationary" (set from the profile on an active-type member) survive
    # every later save of an unrelated field.
    if class_written or legacy_written:
        sync_account_status_with_membership(target)

    _stamp_membership_since(state, target)


def _stamp_membership_since(state: Any, target: "User") -> None:
    """Record when the member's class / status became what it now is.

    Runs after reconciliation, so whichever field a caller wrote, the stamp
    follows the reconciled value. A re-save of the same value is not a change:
    ``active_history`` on both columns puts the previous value in the history,
    so a profile save that sends the member's unchanged status leaves the date
    alone.

    A real change also clears ``voting_wait_from``: that date was a
    secretary's correction of when the member became their *previous* type,
    and carried over it would start the new type's wait in the past.
    """
    now = datetime.now(timezone.utc)
    inserting = not state.has_identity
    changed = False
    for field, stamp in (
        ("member_class", "member_class_since"),
        ("member_status", "member_status_since"),
    ):
        value = getattr(target, field)
        if value is None:
            continue
        if inserting:
            if getattr(target, stamp) is None:
                setattr(target, stamp, now)
            continue
        history = state.attrs[field].history
        if history.added and value not in (history.deleted or ()):
            setattr(target, stamp, now)
            changed = True
    if changed and target.voting_wait_from is not None:
        target.voting_wait_from = None
        if not target.voting_wait_waived:
            target.voting_wait_override_reason = None


#: Prefix of the status-change reason the sync records, so the profile's
#: status history says where an automatic move came from.
STATUS_FOLLOWS_MEMBERSHIP_REASON = "Follows membership type"


def account_status_for_membership(
    member_status: Optional[str],
    status: "UserStatus | str | None",
    ranks_as_by_tier: Optional[Mapping[str, str]] = None,
) -> Optional["UserStatus"]:
    """The account status a membership write implies, or None to leave it.

    Membership standing drives account status one way, and only between the
    two statuses that say nothing about leave or separation (owner decision
    2026-10-20):

    * standing ``probationary`` and status ``active`` (or unset, on insert) ->
      ``probationary``;
    * any other standing and status ``probationary`` -> ``active``;
    * every other status is left alone — a member on leave who is promoted
      off probation stays on leave, and comes back as active.

    Judged on ``member_status``, not on the legacy ``membership_type``: the
    legacy word collapses an administrative probationer to plain
    ``administrative``, which kept every probationary member outside the
    operational class off probation. A legacy word passed here still answers
    (``canonical_member_status`` spells it as the status it splits to), and a
    department tier that counts as probationary (``ranks_as``) does too.
    """
    standing = status_for_tier(member_status, ranks_as_by_tier)
    probationary = standing == MemberStatus.PROBATIONARY
    current = status.value if isinstance(status, UserStatus) else status
    if probationary and current in (None, UserStatus.ACTIVE.value):
        return UserStatus.PROBATIONARY
    if not probationary and current == UserStatus.PROBATIONARY.value:
        return UserStatus.ACTIVE
    return None


def sync_account_status_with_membership(
    target: "User",
    now: Optional[datetime] = None,
    member_status: Optional[str] = None,
    ranks_as_by_tier: Optional[Mapping[str, str]] = None,
) -> Optional[tuple[Optional[str], str]]:
    """Apply ``account_status_for_membership`` to ``target``.

    Returns ``(previous, new)`` status values when the status moved, else
    None. Idempotent, so the flush listener and an endpoint that wants the
    outcome for its audit entry can both call it on the same change.

    ``member_status`` is the standing to judge, for a caller that has written
    the legacy column and not yet flushed: the reconciler fills the ladder
    column at flush, so before it the stored one is stale. Omitted, the
    stored column is used, which is right after reconciliation.
    """
    standing = member_status if member_status is not None else target.member_status
    new_status = account_status_for_membership(
        standing, target.status, ranks_as_by_tier
    )
    if new_status is None:
        return None
    previous = target.status
    previous_value = previous.value if isinstance(previous, UserStatus) else previous
    if previous_value == new_status.value:
        return None
    target.status = new_status
    target.status_changed_at = now or datetime.now(timezone.utc)
    target.status_change_reason = (
        f"{STATUS_FOLLOWS_MEMBERSHIP_REASON} '{target.membership_type}'"
    )
    return (previous_value, new_status.value)


event.listen(User, "before_insert", _reconcile_membership)
event.listen(User, "before_update", _reconcile_membership)


class PositionKind(str, Enum):
    """What a position is; mirrors ``POSITION_KINDS`` in core/permissions."""

    OFFICE = "office"
    COMMITTEE = "committee"
    SYSTEM = "system"


class Position(Base):
    """
    Corporate Position model for permission-based access control.

    Positions are the primary source of permissions.  Each member may
    hold multiple positions (e.g., Treasurer + Safety Officer).
    The ``it_manager`` position is the "System Owner" with wildcard
    access.  Every member receives the ``member`` position by default.
    """

    __tablename__ = "positions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    permissions: Mapped[Optional[list[str]]] = mapped_column(JSON, default=list)
    is_system: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False
    )  # System positions can't be deleted
    priority: Mapped[Optional[int]] = mapped_column(
        Integer, default=0
    )  # Higher priority = more powerful
    # office | committee | system -- see ``PositionKind``. Decides how the
    # member screens group a held position ("Offices" beside "Committees")
    # and nothing about permissions, which stay on ``permissions``.
    kind: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="office",
        server_default="office",
        index=True,
    )

    # Per-position UI preferences (e.g. the inventory label printer/size this
    # role uses). Nullable JSON; mutate via copy.deepcopy + reassign.
    settings: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="positions"
    )
    users: Mapped[list["User"]] = relationship(
        "User",
        secondary="user_positions",
        back_populates="positions",
        primaryjoin="Position.id == user_positions.c.position_id",
        secondaryjoin="User.id == user_positions.c.user_id",
    )

    __table_args__ = (
        Index("idx_position_org_slug", "organization_id", "slug", unique=True),
    )

    @property
    def mirrors_rank(self) -> bool:
        """True for the seeded position that duplicates an operational rank.

        Reported on every role response so the member screens can keep the
        position out of their pickers and chips; see
        ``RANK_MIRRORING_POSITION_SLUGS``.
        """
        return position_mirrors_rank(self.slug, self.is_system)

    def __repr__(self):
        return f"<Position(name={self.name})>"


# User-Position Association Table (Many-to-Many)
# Uses composite primary key (user_id, position_id)
user_positions = Table(
    "user_positions",
    Base.metadata,
    Column(
        "user_id",
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "position_id",
        String(36),
        ForeignKey("positions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "assigned_at", DateTime(timezone=True), server_default=func.now(), index=True
    ),
    Column(
        "assigned_by",
        String(36),
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
    ),
)


# Backward-compatible aliases so existing imports don't break during migration
Role = Position
user_roles = user_positions


class Prospect(Base):
    """
    Prospective member – someone who has expressed interest in joining
    the department but has not yet been accepted.

    Prospects are lightweight records without department credentials
    (no department ID, no department email, no User record).  When a
    prospect is accepted and converted to Probationary membership, a
    full User record is created and this record is marked as converted.
    """

    __tablename__ = "prospects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Contact Information
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    middle_name: Mapped[Optional[str]] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(EncryptedText)  # Personal email
    phone: Mapped[Optional[str]] = mapped_column(EncryptedText)
    mobile: Mapped[Optional[str]] = mapped_column(EncryptedText)

    # Address
    address_street: Mapped[Optional[str]] = mapped_column(EncryptedText)
    address_city: Mapped[Optional[str]] = mapped_column(EncryptedText)
    address_state: Mapped[Optional[str]] = mapped_column(EncryptedText)
    address_zip: Mapped[Optional[str]] = mapped_column(EncryptedText)

    # Application Details
    status: Mapped[Optional[str]] = mapped_column(
        String(50), default="applied"
    )  # applied, interviewing, accepted, rejected, withdrawn
    notes: Mapped[Optional[str]] = mapped_column(Text)
    referred_by: Mapped[Optional[str]] = mapped_column(String(255))  # Who referred them

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="prospects"
    )

    __table_args__ = (Index("idx_prospect_org_status", "organization_id", "status"),)

    def __repr__(self):
        return (
            f"<Prospect(name={self.first_name} {self.last_name}, status={self.status})>"
        )


class LeaveType(str, enum.Enum):
    """Type of leave of absence."""

    LEAVE_OF_ABSENCE = "leave_of_absence"
    MEDICAL = "medical"
    MILITARY = "military"
    PERSONAL = "personal"
    ADMINISTRATIVE = "administrative"
    NEW_MEMBER = "new_member"
    OTHER = "other"


class MemberLeaveOfAbsence(Base):
    """
    Member Leave of Absence

    Records periods where a member is on leave from the department.
    When a rolling-period requirement is calculated, months that fall
    within a leave period are excluded from the denominator so the
    member is not penalised for time they were inactive.

    Managed through the membership module and read by training and
    shift modules.
    """

    __tablename__ = "member_leaves_of_absence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    leave_type: Mapped[LeaveType] = mapped_column(
        Enum(LeaveType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=LeaveType.LEAVE_OF_ABSENCE,
        server_default="leave_of_absence",
    )
    # Encrypted at rest: members explain a leave in their own words, and the
    # explanation is often medical or family detail.
    reason: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)

    # The period the member is on leave (inclusive, month-level granularity)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[Optional[date]] = mapped_column(
        Date, nullable=True
    )  # None = permanent leave

    # Approval
    granted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    granted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # When True, no training waiver is auto-created for this leave.
    # Officers can set this to keep training requirements active during the leave.
    exempt_from_training_waiver: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # Back-reference to the auto-created training waiver (if any)
    linked_training_waiver_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    grantor: Mapped[Optional["User"]] = relationship("User", foreign_keys=[granted_by])

    __table_args__ = (
        Index("idx_member_leave_org_user", "organization_id", "user_id"),
        Index("idx_member_leave_dates", "start_date", "end_date"),
    )

    def __repr__(self):
        return f"<MemberLeaveOfAbsence(user_id={self.user_id}, {self.start_date} - {self.end_date})>"


class MemberServicePeriod(Base):
    """
    One continuous stint of membership, for calculating length of service.

    A member who leaves (dropped or retired) and later rejoins has two or more
    rows here. Credited service is the sum of the rows with
    ``counts_toward_service`` set, so the time away between stints is never
    counted. When a department restarts a returning member's clock, the
    earlier stints stay on record with ``counts_toward_service`` false: they
    are shown as prior service rather than deleted.

    A member with no rows at all has never separated, and their service is
    derived from ``users.hire_date`` exactly as it was before this table
    existed -- which is why no backfill was needed.

    ``start_date`` NULL means "the member's hire date". The stint written when
    a member first separates is the one that began at hire, and pointing at
    the column rather than copying it keeps a later correction of
    ``hire_date`` flowing through instead of leaving a stale copy behind.
    Rows written through the API always carry an explicit date.
    """

    __tablename__ = "member_service_periods"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    end_date: Mapped[Optional[date]] = mapped_column(
        Date, nullable=True
    )  # None = still serving
    # The status the member separated into (dropped_voluntary,
    # dropped_involuntary, retired); None while the stint is open.
    separation_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    counts_toward_service: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_member_service_periods_org_user", "organization_id", "user_id"),
    )


class Session(Base):
    """
    User session model for tracking active sessions
    """

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    token: Mapped[str] = mapped_column(
        String(512), nullable=False, unique=True, index=True
    )
    refresh_token: Mapped[Optional[str]] = mapped_column(String(512), index=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    user_agent: Mapped[Optional[str]] = mapped_column(Text)
    geo_location: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON)

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_activity: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    # Set by the owner via POST /auth/session/kiosk. Only honoured while the
    # user still holds security.kiosk_session; see session_end_reason.
    is_kiosk: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # Set by POST /auth/step-up. Server-side and per session, so a step-up on
    # one device or tab never unlocks another.
    stepup_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self):
        return f"<Session(user_id={self.user_id}, expires_at={self.expires_at})>"


class PasswordHistory(Base):
    """
    Password history for HIPAA compliance (§164.312(d))

    Stores hashes of previous passwords to prevent reuse.
    The system checks the last N entries (configured via
    HIPAA_PASSWORD_HISTORY_COUNT) before allowing a password change.
    """

    __tablename__ = "password_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("idx_password_history_user_created", "user_id", "created_at"),
    )


keep_email_fingerprint(User.email, "email_hash")
