"""
Notification Database Models

SQLAlchemy models for notification management including rules,
logs, and preferences.
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

    # Status
    sent_at = Column(DateTime(timezone=True), server_default=func.now())
    delivered = Column(Boolean, default=False)
    read = Column(Boolean, default=False)
    read_at = Column(DateTime(timezone=True))
    error = Column(Text)

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
