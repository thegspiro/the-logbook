"""
Notification Database Models

SQLAlchemy models for notification management including rules,
logs, preferences, and department messages.
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Integer,
    Text,
    Enum,
    ForeignKey,
    Index,
    JSON,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.core.utils import generate_uuid

from app.core.database import Base


class NotificationChannel(str, enum.Enum):
    """Notification delivery channel"""
    EMAIL = "email"
    IN_APP = "in_app"


class NotificationTrigger(str, enum.Enum):
    """Events that trigger notifications"""
    EVENT_REMINDER = "event_reminder"
    TRAINING_EXPIRY = "training_expiry"
    SCHEDULE_CHANGE = "schedule_change"
    NEW_MEMBER = "new_member"
    MEMBER_DROPPED = "member_dropped"
    MAINTENANCE_DUE = "maintenance_due"
    ELECTION_STARTED = "election_started"
    FORM_SUBMITTED = "form_submitted"
    ACTION_ITEM_ASSIGNED = "action_item_assigned"
    MEETING_SCHEDULED = "meeting_scheduled"
    DOCUMENT_UPLOADED = "document_uploaded"


class NotificationCategory(str, enum.Enum):
    """Category for notification rules"""
    EVENTS = "events"
    TRAINING = "training"
    SCHEDULING = "scheduling"
    MEMBERS = "members"
    MAINTENANCE = "maintenance"
    GENERAL = "general"


class NotificationRule(Base):
    """
    Notification Rule model

    Defines automated notification rules for an organization.
    """

    __tablename__ = "notification_rules"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Rule Information
    name = Column(String(255), nullable=False)
    description = Column(Text)
    trigger = Column(Enum(NotificationTrigger, values_callable=lambda x: [e.value for e in x]), nullable=False)
    category = Column(Enum(NotificationCategory, values_callable=lambda x: [e.value for e in x]), default=NotificationCategory.GENERAL, nullable=False)
    channel = Column(Enum(NotificationChannel, values_callable=lambda x: [e.value for e in x]), default=NotificationChannel.IN_APP, nullable=False)

    # Settings
    enabled = Column(Boolean, default=True)
    config = Column(JSON)  # Trigger-specific config (e.g., days_before for reminders)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    logs = relationship("NotificationLog", back_populates="rule", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_notif_rules_org", "organization_id"),
        Index("idx_notif_rules_org_trigger", "organization_id", "trigger"),
        Index("idx_notif_rules_org_enabled", "organization_id", "enabled"),
    )

    def __repr__(self):
        return f"<NotificationRule(name={self.name}, trigger={self.trigger})>"


class NotificationLog(Base):
    """
    Notification Log model

    Records sent notifications for tracking and debugging.
    """

    __tablename__ = "notification_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    rule_id = Column(String(36), ForeignKey("notification_rules.id", ondelete="SET NULL"), index=True)

    # Notification Details
    recipient_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), index=True)
    recipient_email = Column(String(255))
    channel = Column(Enum(NotificationChannel, values_callable=lambda x: [e.value for e in x]), nullable=False)
    subject = Column(String(500))
    message = Column(Text)

    # Categorization
    category = Column(String(50), nullable=True, index=True)  # e.g., "event_reminder", "action_items"

    # Status
    sent_at = Column(DateTime(timezone=True), server_default=func.now())
    delivered = Column(Boolean, default=False)
    read = Column(Boolean, default=False)
    read_at = Column(DateTime(timezone=True))
    error = Column(Text)

    # Lifecycle
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    rule = relationship("NotificationRule", back_populates="logs")
    recipient = relationship("User", foreign_keys=[recipient_id])

    __table_args__ = (
        Index("idx_notif_logs_org", "organization_id"),
        Index("idx_notif_logs_recipient", "recipient_id"),
        Index("idx_notif_logs_org_sent", "organization_id", "sent_at"),
    )

    def __repr__(self):
        return f"<NotificationLog(subject={self.subject}, channel={self.channel})>"


# ============================================
# Department Messages (Internal Messaging)
# ============================================


class MessagePriority(str, enum.Enum):
    """Priority level for department messages"""
    NORMAL = "normal"
    IMPORTANT = "important"
    URGENT = "urgent"


class MessageTargetType(str, enum.Enum):
    """How the message is targeted"""
    ALL = "all"                    # Entire department
    ROLES = "roles"                # Specific roles (e.g., "Probationary Members")
    STATUSES = "statuses"          # Specific member statuses
    MEMBERS = "members"            # Specific individual members


class DepartmentMessage(Base):
    """
    Department Message model

    Represents an internal message/announcement sent by leadership
    to department members. Messages can target all members, specific
    roles, statuses, or individual members. They appear on the
    dashboard and remain visible until dismissed or expired.
    """

    __tablename__ = "department_messages"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Content
    title = Column(String(500), nullable=False)
    body = Column(Text, nullable=False)
    priority = Column(Enum(MessagePriority, values_callable=lambda x: [e.value for e in x]), default=MessagePriority.NORMAL, nullable=False)

    # Targeting
    target_type = Column(Enum(MessageTargetType, values_callable=lambda x: [e.value for e in x]), default=MessageTargetType.ALL, nullable=False)
    target_roles = Column(JSON, nullable=True)       # Array of role names when target_type == 'roles'
    target_statuses = Column(JSON, nullable=True)     # Array of status values when target_type == 'statuses'
    target_member_ids = Column(JSON, nullable=True)   # Array of user IDs when target_type == 'members'

    # Display
    is_pinned = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    requires_acknowledgment = Column(Boolean, default=False)

    # Lifecycle
    posted_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    author = relationship("User", foreign_keys=[posted_by])
    reads = relationship("DepartmentMessageRead", back_populates="message", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_dept_msg_org", "organization_id"),
        Index("idx_dept_msg_org_active", "organization_id", "is_active"),
        Index("idx_dept_msg_org_pinned", "organization_id", "is_pinned"),
    )

    def __repr__(self):
        return f"<DepartmentMessage(title={self.title}, priority={self.priority})>"


class DepartmentMessageRead(Base):
    """
    Tracks which users have read/acknowledged a department message.
    """

    __tablename__ = "department_message_reads"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    message_id = Column(String(36), ForeignKey("department_messages.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    read_at = Column(DateTime(timezone=True), server_default=func.now())
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    message = relationship("DepartmentMessage", back_populates="reads")
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_dept_msg_read_user"),
        Index("idx_dept_msg_read_msg", "message_id"),
        Index("idx_dept_msg_read_user", "user_id"),
    )
