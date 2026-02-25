"""
Forms Database Models

SQLAlchemy models for custom forms including form definitions,
fields, submissions, integrations, and public access.
"""

import enum
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


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

    SAFETY = "Safety"
    OPERATIONS = "Operations"
    ADMINISTRATION = "Administration"
    TRAINING = "Training"
    OTHER = "Other"


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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Form Information
    name = Column(String(255), nullable=False)
    description = Column(Text)
    category = Column(
        Enum(FormCategory, values_callable=lambda x: [e.value for e in x]),
        default=FormCategory.OPERATIONS,
        nullable=False,
    )
    status = Column(
        Enum(FormStatus, values_callable=lambda x: [e.value for e in x]),
        default=FormStatus.DRAFT,
        nullable=False,
        index=True,
    )

    # Settings
    allow_multiple_submissions = Column(Boolean, default=True)
    require_authentication = Column(Boolean, default=True)
    notify_on_submission = Column(Boolean, default=False)
    notification_emails = Column(JSON)  # List of emails to notify

    # Public access
    public_slug = Column(String(12), unique=True, index=True, default=generate_slug)
    is_public = Column(Boolean, default=False)

    # Metadata
    version = Column(Integer, default=1)
    is_template = Column(Boolean, default=False, index=True)  # System starter templates

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    published_at = Column(DateTime(timezone=True))
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    fields = relationship(
        "FormField",
        back_populates="form",
        cascade="all, delete-orphan",
        order_by="FormField.sort_order",
    )
    submissions = relationship(
        "FormSubmission", back_populates="form", cascade="all, delete-orphan"
    )
    integrations = relationship(
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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    form_id = Column(
        String(36),
        ForeignKey("forms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Field Configuration
    label = Column(String(255), nullable=False)
    field_type = Column(
        Enum(FieldType, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    placeholder = Column(String(255))
    help_text = Column(Text)
    default_value = Column(Text)

    # Validation
    required = Column(Boolean, default=False)
    min_length = Column(Integer)
    max_length = Column(Integer)
    min_value = Column(Integer)
    max_value = Column(Integer)
    validation_pattern = Column(String(500))  # Regex pattern

    # Options (for select, multiselect, radio, checkbox)
    options = Column(JSON)  # List of {value, label} objects

    # Conditional visibility
    # When set, this field is only shown if the referenced field's value matches.
    condition_field_id = Column(
        String(36), nullable=True
    )  # ID of the controlling field
    condition_operator = Column(
        String(20), nullable=True
    )  # "equals", "not_equals", "contains", "not_empty", "is_empty"
    condition_value = Column(String(500), nullable=True)  # Value to compare against

    # Layout
    sort_order = Column(Integer, default=0, nullable=False)
    width = Column(String(20), default="full")  # "full", "half", "third"

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    form = relationship("Form", back_populates="fields")

    __table_args__ = (Index("idx_form_fields_form_order", "form_id", "sort_order"),)


class FormSubmission(Base):
    """
    Form Submission model

    Represents a completed submission of a form by a user or anonymous visitor.
    """

    __tablename__ = "form_submissions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    form_id = Column(
        String(36),
        ForeignKey("forms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Submission Info
    submitted_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())

    # Data stored as JSON for flexibility
    data = Column(JSON, nullable=False)  # {field_id: value} mapping

    # Public submission metadata
    submitter_name = Column(String(255))  # For anonymous/public submissions
    submitter_email = Column(String(255))  # For anonymous/public submissions
    is_public_submission = Column(Boolean, default=False)

    # Metadata
    ip_address = Column(String(45))
    user_agent = Column(String(500))

    # Integration processing
    integration_processed = Column(Boolean, default=False)
    integration_result = Column(JSON)  # Result/errors from integration processing

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    form = relationship("Form", back_populates="submissions")
    submitter = relationship("User", foreign_keys=[submitted_by])

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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    form_id = Column(
        String(36),
        ForeignKey("forms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Integration configuration
    target_module = Column(
        Enum(IntegrationTarget, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    integration_type = Column(
        Enum(IntegrationType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Field mappings: maps form field IDs to target module field names
    # e.g., {"field-uuid-1": "first_name", "field-uuid-2": "email", "field-uuid-3": "phone"}
    field_mappings = Column(JSON, nullable=False)

    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    form = relationship("Form", back_populates="integrations")

    __table_args__ = (
        UniqueConstraint("form_id", "target_module", name="uq_form_integration_target"),
        Index("idx_form_integrations_form", "form_id"),
    )
