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
"""

import enum
from datetime import datetime, timezone

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
from sqlalchemy.orm import relationship, synonym
from sqlalchemy.sql import and_, func

from app.core.database import Base
from app.core.utils import generate_uuid
from app.utils.membership import (
    DEFAULT_CLASS,
    DEFAULT_STATUS,
    derive_membership_type,
    split_membership_type,
)


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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False, unique=True)
    description = Column(Text)

    # Organization Type
    organization_type = Column(
        Enum(OrganizationType, values_callable=lambda x: [e.value for e in x]),
        default=OrganizationType.FIRE_DEPARTMENT,
        nullable=False,
        server_default="fire_department",
    )

    # Timezone
    timezone = Column(String(50), default="America/New_York")

    # Contact Information
    phone = Column(String(20))
    fax = Column(String(20))
    email = Column(String(255))
    website = Column(String(255))

    # Mailing Address
    mailing_address_line1 = Column(String(255))
    mailing_address_line2 = Column(String(255))
    mailing_city = Column(String(100))
    mailing_state = Column(String(50))
    mailing_zip = Column(String(20))
    mailing_country = Column(String(100), default="USA")

    # Physical Address (station/headquarters location)
    physical_address_same = Column(Boolean, default=True)
    physical_address_line1 = Column(String(255))
    physical_address_line2 = Column(String(255))
    physical_city = Column(String(100))
    physical_state = Column(String(50))
    physical_zip = Column(String(20))
    physical_country = Column(String(100), default="USA")

    # Department Identifiers
    identifier_type = Column(
        Enum(IdentifierType, values_callable=lambda x: [e.value for e in x]),
        default=IdentifierType.DEPARTMENT_ID,
        nullable=False,
        server_default="department_id",
    )
    fdid = Column(String(50))  # Fire Department ID (NFIRS)
    state_id = Column(String(50))  # State license/certification number
    department_id = Column(String(50))  # Internal department ID

    # Additional Information
    county = Column(String(100))
    founded_year = Column(Integer)
    tax_id = Column(String(50))  # EIN for 501(c)(3) organizations

    # Logo stored as base64 or URL (MEDIUMTEXT for large base64 images)
    # LONGTEXT, not MEDIUMTEXT: the logo is stored as a base64 data URI, and
    # migration 20260209_0600 widened this column to LONGTEXT on existing
    # databases. The model has to match, or fresh installs silently get the
    # narrower column that migration exists to prevent.
    logo = Column(Text().with_variant(mysql.LONGTEXT(), "mysql"))

    # Legacy field - keep for compatibility
    type = Column(String(50), default="fire_department")

    # Settings JSON for extensibility — MutableDict ensures SQLAlchemy detects
    # in-place mutations to nested dicts, preventing silent commit no-ops.
    settings = Column(MutableDict.as_mutable(JSON), default=dict)
    active = Column(Boolean, default=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    users = relationship("User", back_populates="organization")
    positions = relationship("Position", back_populates="organization")
    prospects = relationship("Prospect", back_populates="organization")
    public_portal_config = relationship(
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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Basic Info
    username = Column(String(100), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    personal_email = Column(
        String(255)
    )  # Personal/home email for post-separation contact
    password_hash = Column(String(255))
    # OAuth / external identity provider linkage. NULL for password-only users.
    # oauth_provider records the IdP ("google"); oauth_subject is the provider's
    # stable, immutable user id (Google's "sub" claim) used to re-match on later
    # logins even if the email address changes.
    oauth_provider = Column(String(50), nullable=True)
    oauth_subject = Column(String(255), nullable=True, index=True)
    first_name = Column(String(100))
    middle_name = Column(String(100))
    last_name = Column(String(100))
    membership_number = Column(
        String(50)
    )  # Organization-assigned membership ID (e.g., "001", "M-042")
    previous_membership_number = Column(
        String(50)
    )  # Preserved on soft-delete so returning members can reclaim their number
    phone = Column(String(20))
    mobile = Column(String(20))

    # Profile
    photo_url = Column(Text)
    date_of_birth = Column(Date)
    hire_date = Column(Date)

    # Operational Rank (one per member, has default permissions)
    rank = Column(String(100))  # e.g., "fire_chief", "captain", "firefighter"
    station = Column(String(100))  # e.g., "Station 1", "Headquarters"
    # Duty platoon / shift group for platoon-rotation scheduling (A/B/C/...).
    # Single source of truth consumed by shift pattern generation.
    platoon = Column(String(20))

    # Address
    address_street = Column(String(255))
    address_city = Column(String(100))
    address_state = Column(String(50))
    address_zip = Column(String(20))
    address_country = Column(String(100), default="USA")

    # Referral data preserved from prospect record on transfer
    referral_source = Column(String(255))
    interest_reason = Column(Text)
    referred_by_user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Emergency Contacts (stored as JSON array)
    # Format: [{"name": "...", "relationship": "...", "phone": "...", "email": "...", "is_primary": true}, ...]
    emergency_contacts = Column(JSON, default=list)

    # Notification Preferences (stored as JSON object)
    # Format: {"email_notifications": true, "sms_notifications": true,
    #          "event_reminders": true, "training_reminders": true}
    # Email is the primary channel; these flags govern what a member gets in
    # addition to it. sms_notifications mutes the text that accompanies an
    # urgent department message (the email still goes out) and is one of two
    # gates — the recorded TCPA consent is the other. See
    # app/services/notification_channels.
    notification_preferences = Column(JSON, default=dict)

    # Department Membership (one per member, no permissions – purely classification)
    #
    # Three columns, two facts. ``member_class`` (operational / administrative
    # / social) and ``member_status`` (prospective → retired) are the
    # authority; ``membership_type`` is the single legacy field that held both
    # at once and is now derived from them, because ~160 call sites still read
    # it. ``app/utils/membership.py`` owns the derivation, and the
    # ``_reconcile_membership`` listener below keeps the three consistent no
    # matter which of them a caller writes.
    membership_type = Column(String(50), default="active")  # See MembershipType enum
    # No column default, for the same reason the migration sets no server
    # default: a default would be applied to writes that name only
    # `membership_type`, and would be wrong for precisely the members who are
    # not plain operational regulars. NULL means "nobody has set this", and a
    # reader derives from `membership_type` when it sees one. ORM writes never
    # leave it NULL — `_reconcile_membership` below fills both.
    member_class = Column(String(20), index=True)
    member_status = Column(String(20), index=True)
    membership_type_changed_at = Column(
        DateTime(timezone=True)
    )  # When membership tier last changed

    # Status
    status = Column(
        Enum(UserStatus, values_callable=lambda x: [e.value for e in x]),
        default=UserStatus.ACTIVE,
        index=True,
    )
    status_changed_at = Column(
        DateTime(timezone=True)
    )  # When status last changed (used for drop-date tracking)
    status_change_reason = Column(Text)  # Reason for the last status change
    archived_at = Column(
        DateTime(timezone=True)
    )  # When the member was archived (after all property returned)
    # Compliance exemption — when True, the member is not evaluated against
    # training requirements, shift minimums, admin-hour targets, or
    # certificate maintenance.  Typical use: retired / honorary members.
    compliance_exempt = Column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    email_verified = Column(Boolean, default=False)

    # MFA — secret and backup codes are encrypted at rest via
    # application-layer AES-256 (Fernet) to protect against DB compromise.
    mfa_enabled = Column(Boolean, default=False)
    _mfa_secret_encrypted = Column("mfa_secret", String(255))
    _mfa_backup_codes_encrypted = Column("mfa_backup_codes", JSON)
    # Highest TOTP time-step (unix_time // period) already accepted at login.
    # A code whose step is <= this value is rejected as a replay, so a captured
    # or shoulder-surfed code cannot be reused within its ±30s validity window.
    mfa_last_timestep = Column(Integer, nullable=True)

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
            return self._mfa_secret_encrypted

    @mfa_secret.setter
    def mfa_secret(self, value: str | None) -> None:
        if value is None:
            self._mfa_secret_encrypted = None
        else:
            from app.core.security import encrypt_data

            self._mfa_secret_encrypted = encrypt_data(value)

    @property
    def mfa_backup_codes(self) -> list | None:
        raw = self._mfa_backup_codes_encrypted
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
    password_changed_at = Column(DateTime(timezone=True))
    must_change_password = Column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime(timezone=True))
    password_reset_token = Column(String(128), index=True)
    password_reset_expires_at = Column(DateTime(timezone=True))
    # Unguessable token for the member's personal read-only ICS calendar feed
    # (subscribed from Google/Apple Calendar, which can't do cookie auth).
    calendar_feed_token = Column(String(64), index=True, nullable=True)

    # Timestamps
    last_login_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at = Column(DateTime(timezone=True))
    # Set when this member's PII was scrubbed by the anonymization workflow
    # (member_anonymization_service). NULL = not anonymized. Operational
    # history rows stay linked to the anonymized shell record.
    anonymized_at = Column(DateTime(timezone=True))

    # Relationships
    organization = relationship("Organization", back_populates="users")
    positions = relationship(
        "Position",
        secondary="user_positions",
        back_populates="users",
        primaryjoin="User.id == user_positions.c.user_id",
        secondaryjoin="Position.id == user_positions.c.position_id",
    )

    # Indexes and constraints
    __table_args__ = (
        Index("idx_user_org_username", "organization_id", "username", unique=True),
        Index("idx_user_org_email", "organization_id", "email", unique=True),
        Index(
            "idx_user_org_membership_number",
            "organization_id",
            "membership_number",
            unique=True,
        ),
        Index("idx_user_org_status_deleted", "organization_id", "status", "deleted_at"),
        Index("idx_user_created_at", "created_at"),
        Index("idx_user_last_login_at", "last_login_at"),
    )

    # Backward-compatible alias so ``selectinload(User.roles)`` and
    # ``user.roles`` both resolve to the ``positions`` relationship.
    roles = synonym("positions")

    @property
    def full_name(self) -> str:
        """Get user's full name"""
        return f"{self.first_name} {self.last_name}".strip()

    @hybrid_property
    def is_active(self) -> bool:
        """Check if user account is active"""
        return self.status == UserStatus.ACTIVE and not self.deleted_at

    @is_active.expression
    @classmethod
    def is_active(cls):
        """SQL expression for is_active filtering in queries"""
        return and_(cls.status == UserStatus.ACTIVE, cls.deleted_at.is_(None))

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
        return datetime.now(timezone.utc) < locked

    def __repr__(self):
        return f"<User(username={self.username}, email={self.email})>"


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
        target.member_class = target.member_class or DEFAULT_CLASS
        target.member_status = target.member_status or DEFAULT_STATUS
        target.membership_type = derive_membership_type(
            target.member_class, target.member_status
        )
        return

    if legacy_written or target.member_class is None or target.member_status is None:
        member_class, member_status = split_membership_type(target.membership_type)
        target.member_class = member_class
        target.member_status = member_status


event.listen(User, "before_insert", _reconcile_membership)
event.listen(User, "before_update", _reconcile_membership)


class Position(Base):
    """
    Corporate Position model for permission-based access control.

    Positions are the primary source of permissions.  Each member may
    hold multiple positions (e.g., Treasurer + Safety Officer).
    The ``it_manager`` position is the "System Owner" with wildcard
    access.  Every member receives the ``member`` position by default.
    """

    __tablename__ = "positions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    name = Column(String(100), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text)
    permissions = Column(JSON, default=list)
    is_system = Column(Boolean, default=False)  # System positions can't be deleted
    priority = Column(Integer, default=0)  # Higher priority = more powerful

    # Per-position UI preferences (e.g. the inventory label printer/size this
    # role uses). Nullable JSON; mutate via copy.deepcopy + reassign.
    settings = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    organization = relationship("Organization", back_populates="positions")
    users = relationship(
        "User",
        secondary="user_positions",
        back_populates="positions",
        primaryjoin="Position.id == user_positions.c.position_id",
        secondaryjoin="User.id == user_positions.c.user_id",
    )

    __table_args__ = (
        Index("idx_position_org_slug", "organization_id", "slug", unique=True),
    )

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
    Column("assigned_by", String(36), ForeignKey("users.id"), index=True),
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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Contact Information
    first_name = Column(String(100), nullable=False)
    middle_name = Column(String(100))
    last_name = Column(String(100), nullable=False)
    email = Column(String(255))  # Personal email
    phone = Column(String(20))
    mobile = Column(String(20))

    # Address
    address_street = Column(String(255))
    address_city = Column(String(100))
    address_state = Column(String(50))
    address_zip = Column(String(20))

    # Application Details
    status = Column(
        String(50), default="applied"
    )  # applied, interviewing, accepted, rejected, withdrawn
    notes = Column(Text)
    referred_by = Column(String(255))  # Who referred them

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    organization = relationship("Organization", back_populates="prospects")

    __table_args__ = (
        Index("idx_prospect_org_email", "organization_id", "email"),
        Index("idx_prospect_org_status", "organization_id", "status"),
    )

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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    leave_type = Column(
        Enum(LeaveType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=LeaveType.LEAVE_OF_ABSENCE,
        server_default="leave_of_absence",
    )
    reason = Column(Text, nullable=True)

    # The period the member is on leave (inclusive, month-level granularity)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)  # None = permanent leave

    # Approval
    granted_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    granted_at = Column(DateTime(timezone=True), nullable=True)

    active = Column(Boolean, default=True, nullable=False, server_default="1")

    # When True, no training waiver is auto-created for this leave.
    # Officers can set this to keep training requirements active during the leave.
    exempt_from_training_waiver = Column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # Back-reference to the auto-created training waiver (if any)
    linked_training_waiver_id = Column(String(36), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    grantor = relationship("User", foreign_keys=[granted_by])

    __table_args__ = (
        Index("idx_member_leave_org_user", "organization_id", "user_id"),
        Index("idx_member_leave_dates", "start_date", "end_date"),
    )

    def __repr__(self):
        return f"<MemberLeaveOfAbsence(user_id={self.user_id}, {self.start_date} - {self.end_date})>"


class Session(Base):
    """
    User session model for tracking active sessions
    """

    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    token = Column(String(512), nullable=False, unique=True, index=True)
    refresh_token = Column(String(512))
    # The immediately-previous refresh token, honored for a short grace window
    # after rotation so two concurrent legitimate refreshes (multi-tab, app
    # boot, network retry) don't look like token theft and trigger a mass logout.
    previous_refresh_token = Column(String(512), nullable=True, index=True)
    previous_refresh_expires_at = Column(DateTime(timezone=True), nullable=True)
    ip_address = Column(String(45))
    user_agent = Column(Text)
    geo_location = Column(JSON)

    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_activity = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_password_history_user_created", "user_id", "created_at"),
    )
