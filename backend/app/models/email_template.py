"""
Email Template Models

Database models for configurable email templates.
Templates are managed by admins and used by the email service.
"""

import enum

from sqlalchemy import JSON, Boolean, Column, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class EmailTemplateType(str, enum.Enum):
    """Types of email templates"""

    WELCOME = "welcome"
    PASSWORD_RESET = "password_reset"
    EVENT_CANCELLATION = "event_cancellation"
    EVENT_REMINDER = "event_reminder"
    TRAINING_APPROVAL = "training_approval"
    BALLOT_NOTIFICATION = "ballot_notification"
    MEMBER_DROPPED = "member_dropped"
    INVENTORY_CHANGE = "inventory_change"
    CERT_EXPIRATION = "cert_expiration"
    POST_EVENT_VALIDATION = "post_event_validation"
    POST_SHIFT_VALIDATION = "post_shift_validation"
    PROPERTY_RETURN_REMINDER = "property_return_reminder"
    INACTIVITY_WARNING = "inactivity_warning"
    ELECTION_REPORT = "election_report"
    BALLOT_ELIGIBILITY_SUMMARY = "ballot_eligibility_summary"
    ELECTION_ROLLBACK = "election_rollback"
    ELECTION_DELETED = "election_deleted"
    MEMBER_ARCHIVED = "member_archived"
    EVENT_REQUEST_STATUS = "event_request_status"
    IT_PASSWORD_NOTIFICATION = "it_password_notification"
    DUPLICATE_APPLICATION = "duplicate_application"
    SERIES_END_REMINDER = "series_end_reminder"
    SHIFT_DECLINE = "shift_decline"
    SHIFT_ASSIGNMENT = "shift_assignment"
    SHIFT_REMINDER = "shift_reminder"
    CUSTOM = "custom"


class EmailTemplate(Base):
    """
    Configurable email template stored in the database.

    Admins can edit subject, body (HTML), and CSS styles.
    Templates support variable interpolation using {{variable_name}} syntax.
    """

    __tablename__ = "email_templates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Template identification
    template_type = Column(
        SQLEnum(EmailTemplateType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    name = Column(String(255), nullable=False)
    description = Column(Text)

    # Content
    subject = Column(String(500), nullable=False)
    html_body = Column(Text, nullable=False)
    text_body = Column(Text)
    css_styles = Column(Text)

    # Configuration
    is_active = Column(Boolean, default=True, nullable=False)
    allow_attachments = Column(Boolean, default=False, nullable=False)

    # Default recipients (JSON list of email addresses)
    default_cc = Column(JSON, nullable=True)  # Optional List[str]
    default_bcc = Column(JSON, nullable=True)  # Optional List[str]

    # Available template variables (JSON list of {name, description} objects)
    # e.g. [{"name": "first_name", "description": "Recipient's first name"}]
    available_variables = Column(JSON, default=list)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization = relationship("Organization", backref="email_templates")

    __table_args__ = (
        Index("idx_email_template_org_type", "organization_id", "template_type"),
    )

    def __repr__(self):
        return f"<EmailTemplate {self.template_type.value}: {self.name}>"


class EmailAttachment(Base):
    """
    Stored attachment that can be included with email templates.
    Files are stored in the configured file storage (MinIO/S3).
    """

    __tablename__ = "email_attachments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    template_id = Column(
        String(36),
        ForeignKey("email_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # File metadata
    filename = Column(String(255), nullable=False)
    content_type = Column(String(100), nullable=False)
    file_size = Column(String(20))  # Human-readable size
    storage_path = Column(String(500), nullable=False)  # Path in MinIO/S3

    # Timestamps
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    uploaded_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    template = relationship("EmailTemplate", backref="attachments")

    def __repr__(self):
        return f"<EmailAttachment {self.filename}>"


class ScheduledEmailStatus(str, enum.Enum):
    """Status of a scheduled email"""

    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ScheduledEmail(Base):
    """
    An email scheduled to be sent at a future date/time.

    Processed by the ``process_scheduled_emails`` scheduled task which
    runs every 5 minutes.
    """

    __tablename__ = "scheduled_emails"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Which template to use (nullable — caller may supply raw context)
    template_id = Column(
        String(36),
        ForeignKey("email_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    template_type = Column(
        SQLEnum(EmailTemplateType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Recipients
    to_emails = Column(JSON, nullable=False)  # List[str]
    cc_emails = Column(JSON, nullable=True)  # Optional List[str]
    bcc_emails = Column(JSON, nullable=True)  # Optional List[str]

    # Template variables to render with
    context = Column(JSON, nullable=False, default=dict)

    # When to send (timezone-aware, UTC)
    scheduled_at = Column(DateTime(timezone=True), nullable=False)

    # Delivery tracking
    status = Column(
        SQLEnum(
            ScheduledEmailStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ScheduledEmailStatus.PENDING,
    )
    sent_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)

    # Audit
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    organization = relationship("Organization")
    template = relationship("EmailTemplate")

    __table_args__ = (
        Index("idx_scheduled_email_status", "status", "scheduled_at"),
        Index("idx_scheduled_email_org", "organization_id", "status"),
    )

    def __repr__(self):
        return f"<ScheduledEmail {self.id} status={self.status.value}>"


class MessageHistoryStatus(str, enum.Enum):
    """Delivery status of a sent message"""

    SENT = "sent"
    FAILED = "failed"


class MessageHistory(Base):
    """
    Log of every email sent by the application.

    Each row represents a single send attempt (one per recipient).
    Populated automatically by ``EmailService.send_email()``.
    """

    __tablename__ = "message_history"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Recipient info
    to_email = Column(String(320), nullable=False)
    cc_emails = Column(JSON, nullable=True)
    bcc_emails = Column(JSON, nullable=True)

    # Content snapshot
    subject = Column(String(500), nullable=False)
    template_type = Column(String(50), nullable=True)

    # Delivery tracking
    status = Column(
        SQLEnum(
            MessageHistoryStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=MessageHistoryStatus.SENT,
    )
    error_message = Column(Text, nullable=True)
    recipient_count = Column(Integer, nullable=False, default=1)

    # Audit
    sent_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization = relationship("Organization")

    __table_args__ = (
        Index("idx_message_history_org", "organization_id", "sent_at"),
        Index("idx_message_history_status", "status", "sent_at"),
    )

    def __repr__(self):
        return (
            f"<MessageHistory {self.id} to={self.to_email} status={self.status.value}>"
        )
