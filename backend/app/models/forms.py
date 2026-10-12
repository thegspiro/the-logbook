"""
Forms Database Models

SQLAlchemy models for custom forms including form definitions,
fields, submissions, integrations, and public access.
"""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.user import User


def generate_slug() -> str:
    """Generate a short URL-safe slug for public form access"""
    return uuid.uuid4().hex[:12]


class FormStatus(str, enum.Enum):
    """Status of a form"""

    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class FormCategory(str, enum.Enum):
    """Category of form"""

    SAFETY = "safety"
    OPERATIONS = "operations"
    ADMINISTRATION = "administration"
    TRAINING = "training"
    OTHER = "other"


class FieldType(str, enum.Enum):
    """Type of form field"""

    TEXT = "text"
    TEXTAREA = "textarea"
    NUMBER = "number"
    EMAIL = "email"
    PHONE = "phone"
    DATE = "date"
    TIME = "time"
    DATETIME = "datetime"
    SELECT = "select"
    MULTISELECT = "multiselect"
    CHECKBOX = "checkbox"
    RADIO = "radio"
    FILE = "file"
    SIGNATURE = "signature"
    SECTION_HEADER = "section_header"
    MEMBER_LOOKUP = "member_lookup"


class IntegrationTarget(str, enum.Enum):
    """Target module for form integrations"""

    MEMBERSHIP = "membership"
    INVENTORY = "inventory"
    EVENTS = "events"


class IntegrationType(str, enum.Enum):
    """Type of integration action"""

    MEMBERSHIP_INTEREST = "membership_interest"
    EQUIPMENT_ASSIGNMENT = "equipment_assignment"
    EVENT_REGISTRATION = "event_registration"
    EVENT_REQUEST = "event_request"


class Form(Base):
    """
    Form model

    Represents a form definition/template that can be filled out by members
    or the public (if public access is enabled).
    """

    __tablename__ = "forms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Form Information
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    category: Mapped[FormCategory] = mapped_column(
        Enum(FormCategory, values_callable=lambda x: [e.value for e in x]),
        default=FormCategory.OPERATIONS,
        nullable=False,
        server_default="operations",
    )
    status: Mapped[FormStatus] = mapped_column(
        Enum(FormStatus, values_callable=lambda x: [e.value for e in x]),
        default=FormStatus.DRAFT,
        nullable=False,
        index=True,
        server_default="draft",
    )

    # Settings
    allow_multiple_submissions: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=True
    )
    require_authentication: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=True
    )
    notify_on_submission: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    notification_emails: Mapped[Optional[list[str]]] = mapped_column(
        JSON
    )  # List of emails to notify

    # Public access
    public_slug: Mapped[Optional[str]] = mapped_column(
        String(12), unique=True, index=True, default=generate_slug
    )
    is_public: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)

    # Cross-module integration — when set, submission processing uses
    # label-based mapping directly instead of requiring a FormIntegration
    # record with field_mappings.  Values come from IntegrationType.
    integration_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )

    # Metadata
    version: Mapped[Optional[int]] = mapped_column(Integer, default=1)
    is_template: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False, index=True
    )  # System starter templates

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT")
    )

    # Relationships
    fields: Mapped[list["FormField"]] = relationship(
        "FormField",
        back_populates="form",
        cascade="all, delete-orphan",
        order_by="FormField.sort_order",
    )
    submissions: Mapped[list["FormSubmission"]] = relationship(
        "FormSubmission", back_populates="form", cascade="all, delete-orphan"
    )
    integrations: Mapped[list["FormIntegration"]] = relationship(
        "FormIntegration", back_populates="form", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_forms_org_status", "organization_id", "status"),
        Index("idx_forms_org_category", "organization_id", "category"),
        Index("idx_forms_org_template", "organization_id", "is_template"),
    )


class FormField(Base):
    """
    Form Field model

    Represents a single field within a form definition.
    """

    __tablename__ = "form_fields"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    form_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("forms.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Field Configuration
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    field_type: Mapped[FieldType] = mapped_column(
        Enum(FieldType, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    placeholder: Mapped[Optional[str]] = mapped_column(String(255))
    help_text: Mapped[Optional[str]] = mapped_column(Text)
    default_value: Mapped[Optional[str]] = mapped_column(Text)

    # Validation
    required: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    min_length: Mapped[Optional[int]] = mapped_column(Integer)
    max_length: Mapped[Optional[int]] = mapped_column(Integer)
    min_value: Mapped[Optional[int]] = mapped_column(Integer)
    max_value: Mapped[Optional[int]] = mapped_column(Integer)
    validation_pattern: Mapped[Optional[str]] = mapped_column(
        String(500)
    )  # Regex pattern

    # Options (for select, multiselect, radio, checkbox)
    options: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON
    )  # List of {value, label} objects

    # Conditional visibility
    # When set, this field is only shown if the referenced field's value matches.
    condition_field_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True
    )  # ID of the controlling field
    condition_operator: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # "equals", "not_equals", "contains", "not_empty", "is_empty"
    condition_value: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )  # Value to compare against

    # Layout
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False, server_default="0"
    )
    width: Mapped[Optional[str]] = mapped_column(
        String(20), default="full"
    )  # "full", "half", "third"

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    form: Mapped["Form"] = relationship("Form", back_populates="fields")

    __table_args__ = (Index("idx_form_fields_form_order", "form_id", "sort_order"),)


class FormSubmission(Base):
    """
    Form Submission model

    Represents a completed submission of a form by a user or anonymous visitor.
    """

    __tablename__ = "form_submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    form_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("forms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Submission Info
    submitted_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Data stored as JSON for flexibility
    data: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False
    )  # {field_id: value} mapping

    # Public submission metadata
    submitter_name: Mapped[Optional[str]] = mapped_column(
        String(255)
    )  # For anonymous/public submissions
    submitter_email: Mapped[Optional[str]] = mapped_column(
        String(255)
    )  # For anonymous/public submissions
    is_public_submission: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)

    # Metadata
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    user_agent: Mapped[Optional[str]] = mapped_column(String(500))

    # Integration processing
    integration_processed: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False
    )
    integration_result: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON
    )  # Result/errors from integration processing

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    form: Mapped["Form"] = relationship("Form", back_populates="submissions")
    submitter: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[submitted_by]
    )

    __table_args__ = (
        Index("idx_form_submissions_org_form", "organization_id", "form_id"),
        Index("idx_form_submissions_org_user", "organization_id", "submitted_by"),
    )


class FormIntegration(Base):
    """
    Form Integration model

    Defines how a form submission feeds data into other modules
    (e.g., membership interest form -> membership module,
    equipment assignment form -> inventory module).
    """

    __tablename__ = "form_integrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    form_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("forms.id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Integration configuration
    target_module: Mapped[IntegrationTarget] = mapped_column(
        Enum(IntegrationTarget, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    integration_type: Mapped[IntegrationType] = mapped_column(
        Enum(IntegrationType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Field mappings: maps form field IDs to target module field names
    # e.g., {"field-uuid-1": "first_name", "field-uuid-2": "email", "field-uuid-3": "phone"}
    field_mappings: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)

    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    form: Mapped["Form"] = relationship("Form", back_populates="integrations")

    __table_args__ = (
        UniqueConstraint("form_id", "target_module", name="uq_form_integration_target"),
    )
