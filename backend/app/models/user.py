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
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

from app.core.database import Base


def generate_uuid():
    """Generate UUID as string for MySQL compatibility"""
    return str(uuid.uuid4())


class UserStatus(str, enum.Enum):
    """User account status"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PROBATIONARY = "probationary"
    RETIRED = "retired"


class Organization(Base):
    """
    Organization/Department model

    Supports multi-tenancy - each organization is isolated.
    """

    __tablename__ = "organizations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False, unique=True)
    description = Column(Text)
    type = Column(String(50), default="fire_department")
    settings = Column(JSON, default={})
    active = Column(Boolean, default=True, index=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    users = relationship("User", back_populates="organization")
    roles = relationship("Role", back_populates="organization")
    
    def __repr__(self):
        return f"<Organization(name={self.name})>"


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
    password_hash = Column(String(255))
    first_name = Column(String(100))
    last_name = Column(String(100))
    badge_number = Column(String(50))
    phone = Column(String(20))
    mobile = Column(String(20))

    # Profile
    photo_url = Column(Text)
    date_of_birth = Column(Date)
    hire_date = Column(Date)

    # Status
    status = Column(Enum(UserStatus), default=UserStatus.ACTIVE, index=True)
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
    
    # Timestamps
    last_login_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True))
    
    # Relationships
    organization = relationship("Organization", back_populates="users")
    roles = relationship("Role", secondary="user_roles", back_populates="users")
    
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
    permissions = Column(JSON, default=[])
    is_system = Column(Boolean, default=False)  # System roles can't be deleted
    priority = Column(Integer, default=0)  # Higher priority = more powerful
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    organization = relationship("Organization", back_populates="roles")
    users = relationship("User", secondary="user_roles", back_populates="roles")
    
    __table_args__ = (
        Index('idx_role_org_slug', 'organization_id', 'slug', unique=True),
    )
    
    def __repr__(self):
        return f"<Role(name={self.name})>"


# User-Role Association Table (Many-to-Many)
user_roles = Table(
    'user_roles',
    Base.metadata,
    Column('id', String(36), primary_key=True, default=generate_uuid),
    Column('user_id', String(36), ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
    Column('role_id', String(36), ForeignKey('roles.id', ondelete='CASCADE'), nullable=False),
    Column('assigned_at', DateTime(timezone=True), server_default=func.now()),
    Column('assigned_by', String(36), ForeignKey('users.id')),
    Index('idx_user_role', 'user_id', 'role_id', unique=True),
)


class Session(Base):
    """
    User session model for tracking active sessions
    """

    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    token = Column(Text, nullable=False, unique=True, index=True)
    refresh_token = Column(Text)
    ip_address = Column(String(45))
    user_agent = Column(Text)
    device_info = Column(JSON)
    geo_location = Column(JSON)
    
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_activity = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    def __repr__(self):
        return f"<Session(user_id={self.user_id}, expires_at={self.expires_at})>"
