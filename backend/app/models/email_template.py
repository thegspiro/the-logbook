"""
Email Template Models

Database models for configurable email templates.
Templates are managed by admins and used by the email service.
"""

import enum

from sqlalchemy import JSON, Boolean, Column, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, String, Text
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
        SQLEnum(EmailTemplateType),
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
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    updated_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

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
    uploaded_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    # Relationships
    template = relationship("EmailTemplate", backref="attachments")

    def __repr__(self):
        return f"<EmailAttachment {self.filename}>"
