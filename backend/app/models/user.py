"""
User Database Models

SQLAlchemy models for user management, authentication, and authorization.
Compatible with MySQL database.
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Date,
    Integer,
    Text,
    Enum,
    ForeignKey,
    Table,
    Index,
    JSON,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum

from app.core.utils import generate_uuid

from app.core.database import Base


class UserStatus(str, enum.Enum):
    """User account status"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PROBATIONARY = "probationary"
    RETIRED = "retired"
    DROPPED_VOLUNTARY = "dropped_voluntary"
    DROPPED_INVOLUNTARY = "dropped_involuntary"
    ARCHIVED = "archived"


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
        nullable=False
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
        nullable=False
    )
    fdid = Column(String(50))  # Fire Department ID (NFIRS)
    state_id = Column(String(50))  # State license/certification number
    department_id = Column(String(50))  # Internal department ID

    # Additional Information
    county = Column(String(100))
    founded_year = Column(Integer)
    tax_id = Column(String(50))  # EIN for 501(c)(3) organizations

    # Logo stored as base64 or URL (MEDIUMTEXT for large base64 images)
    logo = Column(Text().with_variant(mysql.MEDIUMTEXT(), 'mysql'))

    # Legacy field - keep for compatibility
    type = Column(String(50), default="fire_department")

    # Settings JSON for extensibility
    settings = Column(JSON, default=dict)
    active = Column(Boolean, default=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    users = relationship("User", back_populates="organization")
    roles = relationship("Role", back_populates="organization")
    public_portal_config = relationship(
        "PublicPortalConfig",
        back_populates="organization",
        uselist=False,
        cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Organization(name={self.name}, type={self.organization_type})>"


class User(Base):
    """
    User model with comprehensive authentication and profile support
    """

    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Basic Info
    username = Column(String(100), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    personal_email = Column(String(255))  # Personal/home email for post-separation contact
    password_hash = Column(String(255))
    first_name = Column(String(100))
    middle_name = Column(String(100))
    last_name = Column(String(100))
    badge_number = Column(String(50))
    phone = Column(String(20))
    mobile = Column(String(20))

    # Profile
    photo_url = Column(Text)
    date_of_birth = Column(Date)
    hire_date = Column(Date)

    # Department/Rank Info
    rank = Column(String(100))  # e.g., "Captain", "Lieutenant", "Firefighter"
    station = Column(String(100))  # e.g., "Station 1", "Headquarters"

    # Address
    address_street = Column(String(255))
    address_city = Column(String(100))
    address_state = Column(String(50))
    address_zip = Column(String(20))
    address_country = Column(String(100), default="USA")

    # Emergency Contacts (stored as JSON array)
    # Format: [{"name": "...", "relationship": "...", "phone": "...", "email": "...", "is_primary": true}, ...]
    emergency_contacts = Column(JSON, default=list)

    # Notification Preferences (stored as JSON object)
    # Format: {"email": true, "sms": false, "push": true, "digest": "daily", ...}
    notification_preferences = Column(JSON, default=dict)

    # Membership
    membership_type = Column(String(50), default="active")  # Org-defined tier: probationary, active, senior, life, etc.
    membership_type_changed_at = Column(DateTime(timezone=True))  # When membership tier last changed

    # Status
    status = Column(Enum(UserStatus, values_callable=lambda x: [e.value for e in x]), default=UserStatus.ACTIVE, index=True)
    status_changed_at = Column(DateTime(timezone=True))  # When status last changed (used for drop-date tracking)
    status_change_reason = Column(Text)  # Reason for the last status change
    archived_at = Column(DateTime(timezone=True))  # When the member was archived (after all property returned)
    email_verified = Column(Boolean, default=False)
    email_verified_at = Column(DateTime(timezone=True))

    # MFA
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String(32))
    mfa_backup_codes = Column(JSON)
    
    # Password Management
    password_changed_at = Column(DateTime(timezone=True))
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime(timezone=True))
    password_reset_token = Column(String(128), index=True)
    password_reset_expires_at = Column(DateTime(timezone=True))

    # Timestamps
    last_login_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True))
    
    # Relationships
    organization = relationship("Organization", back_populates="users")
    roles = relationship(
        "Role",
        secondary="user_roles",
        back_populates="users",
        primaryjoin="User.id == user_roles.c.user_id",
        secondaryjoin="Role.id == user_roles.c.role_id",
    )
    
    # Indexes and constraints
    __table_args__ = (
        Index('idx_user_org_username', 'organization_id', 'username', unique=True),
        Index('idx_user_org_email', 'organization_id', 'email', unique=True),
    )
    
    @property
    def full_name(self) -> str:
        """Get user's full name"""
        return f"{self.first_name} {self.last_name}".strip()
    
    @property
    def is_active(self) -> bool:
        """Check if user account is active"""
        return self.status == UserStatus.ACTIVE and not self.deleted_at
    
    @property
    def is_locked(self) -> bool:
        """Check if account is locked"""
        if not self.locked_until:
            return False
        return datetime.utcnow() < self.locked_until
    
    def __repr__(self):
        return f"<User(username={self.username}, email={self.email})>"


class Role(Base):
    """
    Role model for RBAC (Role-Based Access Control)
    """

    __tablename__ = "roles"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(100), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text)
    permissions = Column(JSON, default=list)
    is_system = Column(Boolean, default=False)  # System roles can't be deleted
    priority = Column(Integer, default=0)  # Higher priority = more powerful
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    organization = relationship("Organization", back_populates="roles")
    users = relationship(
        "User",
        secondary="user_roles",
        back_populates="roles",
        primaryjoin="Role.id == user_roles.c.role_id",
        secondaryjoin="User.id == user_roles.c.user_id",
    )
    
    __table_args__ = (
        Index('idx_role_org_slug', 'organization_id', 'slug', unique=True),
    )
    
    def __repr__(self):
        return f"<Role(name={self.name})>"


# User-Role Association Table (Many-to-Many)
# Uses composite primary key (user_id, role_id) as per standard many-to-many pattern
user_roles = Table(
    'user_roles',
    Base.metadata,
    Column('user_id', String(36), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    Column('role_id', String(36), ForeignKey('roles.id', ondelete='CASCADE'), primary_key=True),
    Column('assigned_at', DateTime(timezone=True), server_default=func.now(), index=True),
    Column('assigned_by', String(36), ForeignKey('users.id'), index=True),
)


class Session(Base):
    """
    User session model for tracking active sessions
    """

    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    token = Column(String(512), nullable=False, unique=True, index=True)
    refresh_token = Column(String(512))
    ip_address = Column(String(45))
    user_agent = Column(Text)
    device_info = Column(JSON)
    geo_location = Column(JSON)
    
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_activity = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
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
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index('idx_password_history_user_created', 'user_id', 'created_at'),
    )
