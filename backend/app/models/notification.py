"""
Notification Database Models

SQLAlchemy models for notification management including rules,
logs, preferences, and department messages.
"""

import enum
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid
from app.utils.member_names import format_display_name

if TYPE_CHECKING:
    from app.models.user import User


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
    SUGGESTION_SUBMITTED = "suggestion_submitted"
    EQUIPMENT_REQUEST_UPDATE = "equipment_request_update"


# Triggers whose senders actually consult the rules table. A rule for anything
# else is stored and listed but never read, so the API reports it as not
# enforced rather than showing an admin a switch that does nothing. Lives here
# rather than in the service so the response schema can read it without a
# schema-imports-service inversion; the full story is in
# app/services/notification_rules.py.
ENFORCED_TRIGGERS = frozenset(
    {
        NotificationTrigger.EVENT_REMINDER,
        NotificationTrigger.TRAINING_EXPIRY,
        NotificationTrigger.SUGGESTION_SUBMITTED,
        NotificationTrigger.EQUIPMENT_REQUEST_UPDATE,
    }
)


def is_enforced(trigger) -> bool:
    """Whether a sender consults rules for *trigger*.

    Takes the enum or its raw string: rows loaded from MySQL and values
    arriving from the API are not consistently one or the other.
    """
    try:
        return NotificationTrigger(getattr(trigger, "value", trigger)) in (
            ENFORCED_TRIGGERS
        )
    except ValueError:
        return False


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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Rule Information
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    trigger: Mapped[NotificationTrigger] = mapped_column(
        Enum(NotificationTrigger, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    category: Mapped[NotificationCategory] = mapped_column(
        Enum(NotificationCategory, values_callable=lambda x: [e.value for e in x]),
        default=NotificationCategory.GENERAL,
        nullable=False,
        server_default="general",
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel, values_callable=lambda x: [e.value for e in x]),
        default=NotificationChannel.IN_APP,
        nullable=False,
        server_default="in_app",
    )

    # Settings
    enabled: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)
    config: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON
    )  # Trigger-specific config (e.g., days_before for reminders)

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT")
    )

    # Relationships
    logs: Mapped[list["NotificationLog"]] = relationship(
        "NotificationLog", back_populates="rule", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_notif_rules_org_trigger", "organization_id", "trigger"),
        Index("idx_notif_rules_org_enabled", "organization_id", "enabled"),
    )

    def __repr__(self):
        return f"<NotificationRule(name={self.name}, trigger={self.trigger})>"


def _delivered_default(context) -> bool:
    """An in-app notification is delivered the moment its row exists.

    There is no send step for the in-app channel — the row *is* the delivery,
    and the member sees it in their inbox immediately. But `delivered`
    defaulted to False and six of the write sites that create in-app rows
    never set it, so the Send Log showed a red "Not delivered" against
    notifications the member had already opened and read. An explicitly passed
    `delivered=` still wins over this default, which is what email needs.
    """
    params = context.get_current_parameters()
    channel = params.get("channel")
    return bool(getattr(channel, "value", channel) == NotificationChannel.IN_APP.value)


class NotificationLog(Base):
    """
    Notification Log model

    Records sent notifications for tracking and debugging.
    """

    __tablename__ = "notification_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    rule_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("notification_rules.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Notification Details
    recipient_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    recipient_email: Mapped[Optional[str]] = mapped_column(String(255))
    # A first-class link (rather than JSON-only metadata) makes department
    # message deliveries queryable and lets the database reject duplicate
    # fan-out when two workers race.
    department_message_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("department_messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    subject: Mapped[Optional[str]] = mapped_column(String(500))
    message: Mapped[Optional[str]] = mapped_column(Text)

    # Categorization
    category: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )  # e.g., "event_reminder", "action_items"

    # Status
    # NOT NULL because it is half the cursor-pagination ordering key: a NULL
    # would sort last under `ORDER BY sent_at DESC` and be unreachable by any
    # cursor, absent from a list claiming to be complete. See migration
    # c8f4a1e6b309.
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    delivered: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=_delivered_default
    )
    read: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    pinned: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    error: Mapped[Optional[str]] = mapped_column(Text)

    # Navigation
    action_url: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )  # Frontend route to navigate to on click

    # "metadata" is reserved by SQLAlchemy Declarative; map via Column("metadata")
    notification_metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(
        "metadata", JSON, nullable=True
    )

    # Lifecycle
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    # `rule` is eager (lazy="joined") like `recipient` because the rule_name
    # property below reads self.rule during response serialization: for a log
    # with a rule_id whose rule wasn't eager-loaded, that access triggers a lazy
    # load in async context and raises MissingGreenlet (a 500 on the logs list).
    rule: Mapped[Optional["NotificationRule"]] = relationship(
        "NotificationRule", back_populates="logs", lazy="joined"
    )
    recipient: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[recipient_id], lazy="joined"
    )

    __table_args__ = (
        Index("idx_notif_logs_recipient", "recipient_id"),
        Index("idx_notif_logs_org_sent", "organization_id", "sent_at"),
        # Covers the caller-scoped keyset query both notification lists now
        # issue on every request. Declared here as well as in migration
        # c8f4a1e6b309 because a fresh install builds its tables from this
        # metadata and stamps Alembic at head without running the migration —
        # a migration-only index would never exist on a new deployment.
        Index(
            "idx_notif_logs_recipient_sent",
            "organization_id",
            "recipient_id",
            "sent_at",
            "id",
        ),
        UniqueConstraint(
            "department_message_id",
            "recipient_id",
            "channel",
            name="uq_notif_dept_message_recipient_channel",
        ),
    )

    @property
    def recipient_name(self) -> str | None:
        if not self.recipient:
            return None
        # The name the member goes by — this is a notification log, not a
        # record of note.
        name = format_display_name(
            getattr(self.recipient, "first_name", None),
            getattr(self.recipient, "last_name", None),
            getattr(self.recipient, "preferred_name", None),
        )
        return name or None

    @property
    def rule_name(self) -> str | None:
        if not self.rule:
            return None
        return getattr(self.rule, "name", None)

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

    ALL = "all"  # Entire department
    ROLES = "roles"  # Specific roles (e.g., "Probationary Members")
    STATUSES = "statuses"  # Specific member statuses
    MEMBERS = "members"  # Specific individual members


class DepartmentMessage(Base):
    """
    Department Message model

    Represents an internal message/announcement sent by leadership
    to department members. Messages can target all members, specific
    roles, statuses, or individual members. They appear on the
    dashboard and remain visible until dismissed or expired.
    """

    __tablename__ = "department_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Content
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[MessagePriority] = mapped_column(
        Enum(MessagePriority, values_callable=lambda x: [e.value for e in x]),
        default=MessagePriority.NORMAL,
        nullable=False,
        server_default="normal",
    )

    # Targeting
    target_type: Mapped[MessageTargetType] = mapped_column(
        Enum(MessageTargetType, values_callable=lambda x: [e.value for e in x]),
        default=MessageTargetType.ALL,
        nullable=False,
        server_default="all",
    )
    target_roles: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Array of role ids; legacy role-name entries remain supported
    target_statuses: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Array of status values when target_type == 'statuses'
    target_member_ids: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # Array of user IDs when target_type == 'members'

    # Display
    is_pinned: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)
    is_persistent: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    requires_acknowledgment: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False
    )

    # Lifecycle
    posted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Soft delete: preserves read/acknowledgment records (compliance evidence)
    # instead of cascade-removing them on a hard DELETE.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Deferred publish time. A future value means the message is not yet live
    # (hidden from inboxes, not yet escalated); the publish task clears this to
    # NULL when it goes live, so NULL == published/immediate.
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    author: Mapped[Optional["User"]] = relationship("User", foreign_keys=[posted_by])
    reads: Mapped[list["DepartmentMessageRead"]] = relationship(
        "DepartmentMessageRead", back_populates="message", cascade="all, delete-orphan"
    )
    recipients: Mapped[list["DepartmentMessageRecipient"]] = relationship(
        "DepartmentMessageRecipient",
        back_populates="message",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_dept_msg_org_pinned", "organization_id", "is_pinned"),
        # Inbox/unread queries filter on org + is_active + expires_at, so index
        # the trailing expiry to keep the active-message scan cheap.
        Index(
            "idx_dept_msg_org_active_expires",
            "organization_id",
            "is_active",
            "expires_at",
        ),
        # The publish task scans all orgs for due scheduled messages.
        Index("idx_dept_msg_scheduled_at", "scheduled_at"),
    )

    def __repr__(self):
        return f"<DepartmentMessage(title={self.title}, priority={self.priority})>"


class DepartmentMessageRead(Base):
    """
    Tracks which users have read/acknowledged a department message.
    """

    __tablename__ = "department_message_reads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    message_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("department_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    read_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    message: Mapped["DepartmentMessage"] = relationship(
        "DepartmentMessage", back_populates="reads"
    )
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_dept_msg_read_user"),
        Index("idx_dept_msg_read_user", "user_id"),
    )


class DepartmentMessageDelivery(Base):
    """Durable, per-recipient claim and result for an external delivery."""

    __tablename__ = "department_message_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    message_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("department_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="pending"
    )
    idempotency_key: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True
    )
    attempted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    delivered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "message_id",
            "recipient_id",
            "channel",
            name="uq_dept_msg_delivery_recipient_channel",
        ),
        Index("idx_dept_msg_delivery_message", "message_id"),
    )


class DepartmentMessageRecipient(Base):
    """Durable, queryable delivery and resolution state for one recipient."""

    __tablename__ = "department_message_recipients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    message_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("department_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # When this member entered the message's audience. The audience is
    # mutable after publication — a widened targeting rule adds rows, a
    # narrowed one revokes them — so this diverges from the message's own
    # created_at, which is the case the delivery path has to tell apart, and
    # every other stamp here is a state change against a row already present.
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    read_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set when a published message's audience was narrowed and this member
    # fell out of it, but the row carries a receipt worth keeping. The row is
    # evidence from then on, not access: every visibility query filters on
    # this, because they authorize on the row's existence alone and an author
    # who removes somebody from an audience means to remove their access too.
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    message: Mapped["DepartmentMessage"] = relationship(
        "DepartmentMessage", back_populates="recipients"
    )
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_dept_msg_recipient_user"),
        Index(
            "idx_dept_msg_recipient_org_user_message",
            "organization_id",
            "user_id",
            "message_id",
        ),
        Index(
            "idx_dept_msg_recipient_unread",
            "organization_id",
            "user_id",
            "read_at",
        ),
        Index(
            "idx_dept_msg_recipient_unacknowledged",
            "organization_id",
            "user_id",
            "acknowledged_at",
        ),
    )


class PushSubscription(Base):
    """A single browser/device Web Push endpoint belonging to a user.

    One row per device, not per user: a member may install the PWA on a phone
    and a station tablet and expects both to ring. Endpoints are issued by the
    browser's push service and are opaque; `p256dh` and `auth` are the client's
    public key and shared secret, required to encrypt the payload so the push
    service (Apple/Google/Mozilla) cannot read it.

    Rows are removed when the push service reports the endpoint is gone (HTTP
    404/410), which happens when the user uninstalls the PWA or clears site
    data — there is no unsubscribe callback to rely on.
    """

    __tablename__ = "push_subscriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Push endpoints are URLs with no documented length bound; observed values
    # from FCM already exceed 200 chars, so this is stored as TEXT. It cannot
    # be indexed directly at full width in MySQL, hence endpoint_hash below.
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    # SHA-256 of the endpoint, so uniqueness can be enforced and lookups done
    # without a prefix index on an unbounded column.
    endpoint_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("endpoint_hash", name="uq_push_sub_endpoint"),
        Index("idx_push_sub_org_user", "organization_id", "user_id"),
    )
