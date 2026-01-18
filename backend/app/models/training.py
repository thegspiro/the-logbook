"""
Training Database Models

SQLAlchemy models for training management including courses, records, and requirements.
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Date,
    Integer,
    Float,
    Text,
    Enum,
    ForeignKey,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

from app.core.database import Base


class TrainingStatus(str, enum.Enum):
    """Training record status"""
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class TrainingType(str, enum.Enum):
    """Type of training"""
    CERTIFICATION = "certification"
    CONTINUING_EDUCATION = "continuing_education"
    SKILLS_PRACTICE = "skills_practice"
    ORIENTATION = "orientation"
    REFRESHER = "refresher"
    SPECIALTY = "specialty"


class RequirementFrequency(str, enum.Enum):
    """How often a requirement must be met"""
    ANNUAL = "annual"
    BIANNUAL = "biannual"
    QUARTERLY = "quarterly"
    MONTHLY = "monthly"
    ONE_TIME = "one_time"


class TrainingCourse(Base):
    """
    Training Course model

    Represents a specific training course or class that can be assigned to members.
    """

    __tablename__ = "training_courses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Course Information
    name = Column(String(255), nullable=False)
    code = Column(String(50))  # Course code like "FF1", "EMT-B", etc.
    description = Column(Text)
    training_type = Column(Enum(TrainingType), nullable=False)

    # Duration and Credits
    duration_hours = Column(Float)  # How long the course takes
    credit_hours = Column(Float)  # How many training hours it's worth

    # Requirements
    prerequisites = Column(JSONB)  # List of prerequisite course IDs
    expiration_months = Column(Integer)  # How long before recertification needed (null = doesn't expire)

    # Course Details
    instructor = Column(String(255))
    max_participants = Column(Integer)
    materials_required = Column(JSONB)  # List of required materials

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))

    # Relationships
    training_records = relationship("TrainingRecord", back_populates="course", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_course_org_code', 'organization_id', 'code'),
    )

    def __repr__(self):
        return f"<TrainingCourse(name={self.name}, code={self.code})>"


class TrainingRecord(Base):
    """
    Training Record model

    Tracks individual training completions for members.
    """

    __tablename__ = "training_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(UUID(as_uuid=True), ForeignKey("training_courses.id", ondelete="SET NULL"))

    # Training Details
    course_name = Column(String(255), nullable=False)  # Stored in case course is deleted
    course_code = Column(String(50))
    training_type = Column(Enum(TrainingType), nullable=False)

    # Dates
    scheduled_date = Column(Date)
    completion_date = Column(Date)
    expiration_date = Column(Date)

    # Hours and Credits
    hours_completed = Column(Float, nullable=False)
    credit_hours = Column(Float)

    # Certification
    certification_number = Column(String(100))
    issuing_agency = Column(String(255))

    # Status and Scores
    status = Column(Enum(TrainingStatus), default=TrainingStatus.SCHEDULED, index=True)
    score = Column(Float)  # Percentage or points
    passing_score = Column(Float)
    passed = Column(Boolean)

    # Instructor and Location
    instructor = Column(String(255))
    location = Column(String(255))

    # Additional Information
    notes = Column(Text)
    attachments = Column(JSONB)  # List of file URLs or references

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))

    # Relationships
    course = relationship("TrainingCourse", back_populates="training_records")

    __table_args__ = (
        Index('idx_record_user_status', 'user_id', 'status'),
        Index('idx_record_completion', 'completion_date'),
        Index('idx_record_expiration', 'expiration_date'),
    )

    def __repr__(self):
        return f"<TrainingRecord(user_id={self.user_id}, course={self.course_name}, status={self.status})>"


class TrainingRequirement(Base):
    """
    Training Requirement model

    Defines yearly or recurring training requirements for the organization or specific roles.
    """

    __tablename__ = "training_requirements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Requirement Details
    name = Column(String(255), nullable=False)
    description = Column(Text)
    training_type = Column(Enum(TrainingType))

    # Requirements
    required_hours = Column(Float)  # Minimum hours required
    required_courses = Column(JSONB)  # List of course IDs that fulfill this requirement

    # Frequency
    frequency = Column(Enum(RequirementFrequency), nullable=False)
    year = Column(Integer)  # For annual requirements

    # Applicability
    applies_to_all = Column(Boolean, default=True)
    required_roles = Column(JSONB)  # List of role IDs this applies to (if not all)

    # Deadlines
    start_date = Column(Date)
    due_date = Column(Date)

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))

    __table_args__ = (
        Index('idx_requirement_year', 'organization_id', 'year'),
        Index('idx_requirement_due', 'due_date'),
    )

    def __repr__(self):
        return f"<TrainingRequirement(name={self.name}, year={self.year})>"
