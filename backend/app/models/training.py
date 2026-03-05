"""
Training Database Models

SQLAlchemy models for training management including courses, records, and requirements.
"""

import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
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
from app.core.encrypted_types import EncryptedText
from app.core.utils import generate_uuid


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


class DueDateType(str, enum.Enum):
    """How the due date is calculated"""

    CALENDAR_PERIOD = (
        "calendar_period"  # Due by end of calendar period (e.g., Dec 31st)
    )
    ROLLING = "rolling"  # Due X months from last completion
    CERTIFICATION_PERIOD = "certification_period"  # Due when certification expires
    FIXED_DATE = "fixed_date"  # Due by a specific fixed date


class RequirementType(str, enum.Enum):
    """Type of training requirement"""

    HOURS = "hours"  # Minimum training hours
    COURSES = "courses"  # Specific courses to complete
    CERTIFICATION = "certification"  # Obtain/maintain certification
    SHIFTS = "shifts"  # Minimum number of shifts
    CALLS = "calls"  # Minimum number of calls/incidents
    SKILLS_EVALUATION = "skills_evaluation"  # Skills checkoff/evaluation
    CHECKLIST = "checklist"  # Checklist items to complete
    KNOWLEDGE_TEST = "knowledge_test"  # Written/paper-based knowledge test


class RequirementSource(str, enum.Enum):
    """Source of the requirement"""

    DEPARTMENT = "department"  # Department-defined
    STATE = "state"  # State registry requirement
    NATIONAL = "national"  # National registry requirement (NFPA, NREMT, etc.)


class ProgramStructureType(str, enum.Enum):
    """How a training program is structured"""

    SEQUENTIAL = "sequential"  # Must complete requirements in order
    PHASES = "phases"  # Organized into phases/stages
    FLEXIBLE = "flexible"  # Complete in any order


class EnrollmentStatus(str, enum.Enum):
    """Status of program enrollment"""

    ACTIVE = "active"
    COMPLETED = "completed"
    EXPIRED = "expired"
    ON_HOLD = "on_hold"
    WITHDRAWN = "withdrawn"
    FAILED = "failed"


class RequirementProgressStatus(str, enum.Enum):
    """Status of requirement progress"""

    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    VERIFIED = "verified"  # Completed and verified by officer
    WAIVED = "waived"  # Requirement waived for this member


class TrainingCategory(Base):
    """
    Training Category model

    Defines categories that training sessions can be applied towards.
    Examples: Fire Training, EMS Training, Driver Training, Officer Development, etc.
    Training hours can count towards multiple categories.
    """

    __tablename__ = "training_categories"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Category Details
    name = Column(String(255), nullable=False)
    code = Column(String(50))  # Short code like "FIRE", "EMS", "DRIVER"
    description = Column(Text)
    color = Column(String(7))  # Hex color for UI display, e.g., "#FF5733"

    # Parent Category (for hierarchical categories)
    parent_category_id = Column(
        String(36),
        ForeignKey("training_categories.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Requirements can link to this category
    # When training is completed in this category, it counts towards requirements linked to it

    # Display Settings
    sort_order = Column(Integer, default=0)
    icon = Column(String(50))  # Icon name for UI

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    subcategories = relationship(
        "TrainingCategory", backref="parent_category", remote_side=[id]
    )

    __table_args__ = (
        Index("idx_category_org_code", "organization_id", "code"),
        Index("idx_category_parent", "parent_category_id"),
    )

    def __repr__(self):
        return f"<TrainingCategory(name={self.name}, code={self.code})>"


class TrainingCourse(Base):
    """
    Training Course model

    Represents a specific training course or class that can be assigned to members.
    """

    __tablename__ = "training_courses"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Course Information
    name = Column(String(255), nullable=False)
    code = Column(String(50))  # Course code like "FF1", "EMT-B", etc.
    description = Column(Text)
    training_type = Column(
        Enum(TrainingType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Duration and Credits
    duration_hours = Column(Float)  # How long the course takes
    credit_hours = Column(Float)  # How many training hours it's worth

    # Requirements
    prerequisites = Column(JSON)  # List of prerequisite course IDs
    expiration_months = Column(
        Integer
    )  # How long before recertification needed (null = doesn't expire)

    # Course Details
    instructor = Column(String(255))
    max_participants = Column(Integer)
    materials_required = Column(JSON)  # List of required materials

    # Categories - training can count towards multiple categories
    category_ids = Column(
        JSON
    )  # List of TrainingCategory IDs this course counts towards

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    training_records = relationship(
        "TrainingRecord", back_populates="course", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("idx_course_org_code", "organization_id", "code"),)

    def __repr__(self):
        return f"<TrainingCourse(name={self.name}, code={self.code})>"


class TrainingRecord(Base):
    """
    Training Record model

    Tracks individual training completions for members.
    """

    __tablename__ = "training_records"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    course_id = Column(
        String(36), ForeignKey("training_courses.id", ondelete="SET NULL"), index=True
    )

    # Training Details
    course_name = Column(
        String(255), nullable=False
    )  # Stored in case course is deleted
    course_code = Column(String(50))
    training_type = Column(
        Enum(TrainingType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

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
    status = Column(
        Enum(TrainingStatus, values_callable=lambda x: [e.value for e in x]),
        default=TrainingStatus.SCHEDULED,
        index=True,
    )
    score = Column(Float)  # Percentage or points
    passing_score = Column(Float)
    passed = Column(Boolean)

    # Instructor and Location
    instructor = Column(String(255))
    location_id = Column(
        String(36),
        ForeignKey("locations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    location = Column(
        String(255)
    )  # Free-text fallback for "Other Location" or legacy records

    # Cross-module link: which apparatus was used for this training
    apparatus_id = Column(
        String(36), nullable=True, index=True
    )  # FK to apparatus table (added conditionally)

    # Snapshot of member's rank and station at time of training completion
    rank_at_completion = Column(String(100), nullable=True)
    station_at_completion = Column(String(100), nullable=True)

    # Additional Information
    notes = Column(Text)
    attachments = Column(JSON)  # List of file URLs or references

    # Certification expiration alert tracking — records when each tier was sent
    alert_90_sent_at = Column(DateTime(timezone=True), nullable=True)
    alert_60_sent_at = Column(DateTime(timezone=True), nullable=True)
    alert_30_sent_at = Column(DateTime(timezone=True), nullable=True)
    alert_7_sent_at = Column(DateTime(timezone=True), nullable=True)
    escalation_sent_at = Column(
        DateTime(timezone=True), nullable=True
    )  # CC to training/compliance officers

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    course = relationship("TrainingCourse", back_populates="training_records")
    location_obj = relationship("Location", foreign_keys=[location_id])

    __table_args__ = (
        Index("idx_record_user_status", "user_id", "status"),
        Index("idx_record_completion", "completion_date"),
        Index("idx_record_expiration", "expiration_date"),
        Index("idx_record_location", "location_id"),
    )

    def __repr__(self):
        return f"<TrainingRecord(user_id={self.user_id}, course={self.course_name}, status={self.status})>"


class TrainingRequirement(Base):
    """
    Training Requirement model

    Defines training requirements for the organization or specific roles.
    Can be sourced from department, state, or national registries.
    """

    __tablename__ = "training_requirements"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Requirement Details
    name = Column(String(255), nullable=False)
    description = Column(Text)
    requirement_type = Column(
        Enum(RequirementType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )  # hours, courses, certification, etc.
    training_type = Column(
        Enum(TrainingType, values_callable=lambda x: [e.value for e in x])
    )  # certification, continuing_education, etc.

    # Source Information
    source = Column(
        Enum(RequirementSource, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=RequirementSource.DEPARTMENT,
    )
    registry_name = Column(
        String(100)
    )  # e.g., "NFPA", "NREMT", "Pro Board", state name
    registry_code = Column(String(50))  # e.g., "NFPA 1001", "EMR"
    is_editable = Column(
        Boolean, default=True
    )  # Department can override registry requirements

    # Requirement Quantities (based on requirement_type)
    required_hours = Column(Float)  # For HOURS type
    required_courses = Column(JSON)  # For COURSES type - list of course IDs
    required_shifts = Column(Integer)  # For SHIFTS type
    required_calls = Column(Integer)  # For CALLS type
    required_call_types = Column(JSON)  # Specific incident types required
    required_skills = Column(JSON)  # For SKILLS_EVALUATION type - skill IDs
    checklist_items = Column(JSON)  # For CHECKLIST type - list of items
    passing_score = Column(
        Float
    )  # For KNOWLEDGE_TEST type - minimum passing percentage
    max_attempts = Column(Integer)  # For KNOWLEDGE_TEST type - max number of attempts

    # Frequency
    frequency = Column(
        Enum(RequirementFrequency, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    year = Column(Integer)  # For annual requirements

    # Due Date Calculation Type
    due_date_type = Column(
        Enum(DueDateType, values_callable=lambda x: [e.value for e in x]),
        default=DueDateType.CALENDAR_PERIOD,
    )
    # - CALENDAR_PERIOD: Due by end of calendar period (e.g., Dec 31st for annual)
    # - ROLLING: Due X months from last completion
    # - CERTIFICATION_PERIOD: Due when certification expires
    # - FIXED_DATE: Due by a specific fixed date

    # Rolling Period (for ROLLING due_date_type)
    rolling_period_months = Column(
        Integer
    )  # Number of months between required completions

    # Calendar Period Settings (for CALENDAR_PERIOD)
    period_start_month = Column(
        Integer, default=1
    )  # Month the period starts (1=January)
    period_start_day = Column(Integer, default=1)  # Day the period starts

    # Categories - which training categories count towards this requirement
    category_ids = Column(
        JSON
    )  # List of TrainingCategory IDs that satisfy this requirement

    # Applicability
    applies_to_all = Column(Boolean, default=True)
    required_roles = Column(JSON)  # List of role slugs this applies to (if not all)
    required_positions = Column(
        JSON
    )  # Positions: probationary, driver_candidate, officer, aic, etc.
    required_membership_types = Column(
        JSON
    )  # List of MembershipType values this applies to (e.g. ["active", "administrative"])

    # Deadlines
    start_date = Column(Date)
    due_date = Column(Date)
    time_limit_days = Column(Integer)  # Days to complete from enrollment/assignment

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index("idx_requirement_org_source", "organization_id", "source"),
        Index("idx_requirement_type", "requirement_type"),
        Index("idx_requirement_due", "due_date"),
    )

    def __repr__(self):
        return f"<TrainingRequirement(name={self.name}, source={self.source})>"


class TrainingSession(Base):
    """
    Training Session model

    Links an Event to a TrainingCourse to create a scheduled training session.
    When members check in to the event, TrainingRecords are automatically created.
    """

    __tablename__ = "training_sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Links to Event and Course
    event_id = Column(
        String(36),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    course_id = Column(
        String(36),
        ForeignKey("training_courses.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Category and Program linkage — connects this session to the training pipeline
    category_id = Column(
        String(36),
        ForeignKey("training_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    program_id = Column(
        String(36),
        ForeignKey("training_programs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    phase_id = Column(
        String(36), ForeignKey("program_phases.id", ondelete="SET NULL"), nullable=True
    )
    requirement_id = Column(
        String(36),
        ForeignKey("training_requirements.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Training Details (stored here for quick access)
    course_name = Column(String(255), nullable=False)
    course_code = Column(String(50))
    training_type = Column(
        Enum(TrainingType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    credit_hours = Column(Float, nullable=False)
    instructor = Column(String(255))  # Legacy free-text instructor name

    # Cross-module links for richer tracking
    instructor_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    co_instructors = Column(
        JSON, nullable=True
    )  # List of user IDs for additional instructors
    apparatus_id = Column(
        String(36), nullable=True, index=True
    )  # FK to apparatus table (added conditionally)

    # Certification Details
    issues_certification = Column(Boolean, default=False)
    certification_number_prefix = Column(
        String(50)
    )  # Prefix for auto-generated cert numbers
    issuing_agency = Column(String(255))
    expiration_months = Column(Integer)

    # Auto-completion Settings
    auto_create_records = Column(
        Boolean, default=True
    )  # Create TrainingRecord on check-in
    require_completion_confirmation = Column(
        Boolean, default=False
    )  # Instructor must confirm completion

    # Approval Settings
    approval_required = Column(
        Boolean, default=True
    )  # Require training officer approval
    approval_deadline_days = Column(
        Integer, default=7
    )  # Days to approve after event ends

    # Status
    is_finalized = Column(
        Boolean, default=False
    )  # Event ended, approval workflow triggered
    finalized_at = Column(DateTime(timezone=True))
    finalized_by = Column(String(36), ForeignKey("users.id"))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    event = relationship("Event", foreign_keys=[event_id], lazy="select")
    course = relationship("TrainingCourse", foreign_keys=[course_id], lazy="select")

    __table_args__ = (
        Index("idx_training_session_event", "event_id"),
        Index("idx_training_session_org", "organization_id"),
    )

    def __repr__(self):
        return f"<TrainingSession(course_name={self.course_name}, event_id={self.event_id})>"


class ApprovalStatus(str, enum.Enum):
    """Training approval status"""

    PENDING = "pending"
    APPROVED = "approved"
    MODIFIED = "modified"
    REJECTED = "rejected"


class TrainingApproval(Base):
    """
    Training Approval model

    Tracks pending training time approvals for training officers.
    Created when a training session is finalized.
    """

    __tablename__ = "training_approvals"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Links
    training_session_id = Column(
        String(36),
        ForeignKey("training_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_id = Column(
        String(36),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Approval Token (for email link)
    approval_token = Column(
        String(64), unique=True, nullable=False, index=True
    )  # Random token for secure access
    token_expires_at = Column(
        DateTime(timezone=True), nullable=False
    )  # Token expiration

    # Approval Details
    status = Column(
        Enum(ApprovalStatus, values_callable=lambda x: [e.value for e in x]),
        default=ApprovalStatus.PENDING,
        index=True,
    )
    approved_by = Column(String(36), ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))
    approval_notes = Column(Text)

    # Deadline
    approval_deadline = Column(DateTime(timezone=True), nullable=False)
    reminder_sent_at = Column(DateTime(timezone=True))  # Track when reminder was sent

    # Attendee Data (JSONB for flexibility)
    # Format: [{"user_id": "...", "check_in": "...", "check_out": "...", "duration": 120, ...}]
    attendee_data = Column(JSON, nullable=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_approval_session", "training_session_id"),
        Index("idx_approval_status", "status"),
        Index("idx_approval_token", "approval_token"),
        Index("idx_approval_deadline", "approval_deadline"),
    )

    def __repr__(self):
        return f"<TrainingApproval(session_id={self.training_session_id}, status={self.status})>"


class TrainingProgram(Base):
    """
    Training Program model

    Defines custom training programs (probationary, driver candidate, officer development, etc.)
    with phases, requirements, and milestones.
    """

    __tablename__ = "training_programs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Program Details
    name = Column(String(255), nullable=False)
    description = Column(Text)
    code = Column(String(50))  # e.g., "PROB-2024", "DRIVER-CERT"
    version = Column(Integer, default=1)  # Version number for template duplication

    # Target Audience
    target_position = Column(
        String(100)
    )  # probationary, driver_candidate, officer, aic, etc.
    target_roles = Column(JSON)  # Role slugs this program applies to

    # Structure
    structure_type = Column(
        Enum(ProgramStructureType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ProgramStructureType.FLEXIBLE,
    )

    # Prerequisites
    prerequisite_program_ids = Column(
        JSON
    )  # Programs that must be completed before enrollment

    # Enrollment Settings
    allows_concurrent_enrollment = Column(
        Boolean, default=True
    )  # Can member be in multiple programs

    # Time Limits
    time_limit_days = Column(Integer)  # Overall program completion deadline
    warning_days_before = Column(
        Integer, default=30
    )  # Send warning X days before deadline

    # Reminder Settings
    reminder_conditions = Column(JSON)  # Conditional reminder rules
    # Example: {"milestone_threshold": 50, "days_before_deadline": 90, "send_if_below_percentage": 40}

    # Status
    active = Column(Boolean, default=True, index=True)
    is_template = Column(
        Boolean, default=False
    )  # Can be used as template for new programs

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    phases = relationship(
        "ProgramPhase",
        back_populates="program",
        cascade="all, delete-orphan",
        order_by="ProgramPhase.phase_number",
    )
    enrollments = relationship(
        "ProgramEnrollment", back_populates="program", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_program_org_active", "organization_id", "active"),
        Index("idx_program_position", "target_position"),
    )

    def __repr__(self):
        return f"<TrainingProgram(name={self.name}, structure={self.structure_type})>"


class ProgramPhase(Base):
    """
    Program Phase model

    Represents a phase/stage within a training program.
    """

    __tablename__ = "program_phases"
    __table_args__ = (
        UniqueConstraint(
            "program_id",
            "phase_number",
            name="uq_program_phases_program_id_phase_number",
        ),
        Index("idx_phase_program", "program_id", "phase_number"),
    )

    id = Column(String(36), primary_key=True, default=generate_uuid)
    program_id = Column(
        String(36),
        ForeignKey("training_programs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Phase Details
    phase_number = Column(Integer, nullable=False)  # Order in program
    name = Column(String(255), nullable=False)
    description = Column(Text)

    # Prerequisites
    prerequisite_phase_ids = Column(JSON)  # Phases that must be completed first

    # Advancement Settings
    requires_manual_advancement = Column(
        Boolean, default=False
    )  # Officer must approve advancement to next phase

    # Time Limits
    time_limit_days = Column(Integer)  # Deadline from phase start

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    program = relationship("TrainingProgram", back_populates="phases")
    requirements = relationship(
        "ProgramRequirement", back_populates="phase", cascade="all, delete-orphan"
    )
    milestones = relationship(
        "ProgramMilestone", back_populates="phase", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<ProgramPhase(program_id={self.program_id}, number={self.phase_number}, name={self.name})>"


class ProgramRequirement(Base):
    """
    Program Requirement model

    Links training requirements to programs/phases.
    """

    __tablename__ = "program_requirements"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    program_id = Column(
        String(36),
        ForeignKey("training_programs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    phase_id = Column(
        String(36),
        ForeignKey("program_phases.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )  # Null if not phase-based
    requirement_id = Column(
        String(36),
        ForeignKey("training_requirements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Requirement Settings
    is_required = Column(Boolean, default=True)  # Required vs optional
    is_prerequisite = Column(
        Boolean, default=False
    )  # Must complete before other requirements
    sort_order = Column(Integer, default=0)  # Display order within program/phase

    # Program-Specific Customization
    program_specific_description = Column(
        Text
    )  # Override/supplement the requirement description
    custom_deadline_days = Column(
        Integer
    )  # Override requirement's default time_limit_days

    # Notification Message
    notification_message = Column(Text)  # Custom message when assigned this requirement

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    phase = relationship("ProgramPhase", back_populates="requirements")
    requirement = relationship("TrainingRequirement")

    __table_args__ = (
        Index("idx_prog_req_program", "program_id"),
        Index("idx_prog_req_phase", "phase_id"),
    )

    def __repr__(self):
        return f"<ProgramRequirement(program_id={self.program_id}, requirement_id={self.requirement_id})>"


class ProgramMilestone(Base):
    """
    Program Milestone model

    Defines milestones/checkpoints within a program or phase.
    """

    __tablename__ = "program_milestones"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    program_id = Column(
        String(36),
        ForeignKey("training_programs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    phase_id = Column(
        String(36),
        ForeignKey("program_phases.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Milestone Details
    name = Column(String(255), nullable=False)
    description = Column(Text)

    # Trigger
    completion_percentage_threshold = Column(
        Float
    )  # Trigger at X% complete (e.g., 50.0)

    # Notification
    notification_message = Column(
        Text
    )  # Message to display/send when milestone reached

    # Verification
    requires_verification = Column(Boolean, default=False)  # Officer must verify
    verification_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    phase = relationship("ProgramPhase", back_populates="milestones")

    __table_args__ = (Index("idx_milestone_program", "program_id"),)

    def __repr__(self):
        return f"<ProgramMilestone(name={self.name}, threshold={self.completion_percentage_threshold})>"


class ProgramEnrollment(Base):
    """
    Program Enrollment model

    Tracks member enrollment in training programs.
    """

    __tablename__ = "program_enrollments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    program_id = Column(
        String(36),
        ForeignKey("training_programs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Enrollment Details
    enrolled_at = Column(DateTime(timezone=True), nullable=False, default=func.now())
    target_completion_date = Column(Date)  # Calculated from time_limit_days

    # Current Progress
    current_phase_id = Column(
        String(36), ForeignKey("program_phases.id", ondelete="SET NULL"), nullable=True
    )
    progress_percentage = Column(
        Float, default=0.0
    )  # Overall program completion percentage

    # Status
    status = Column(
        Enum(EnrollmentStatus, values_callable=lambda x: [e.value for e in x]),
        default=EnrollmentStatus.ACTIVE,
        index=True,
    )
    completed_at = Column(DateTime(timezone=True))
    withdrawn_at = Column(DateTime(timezone=True))
    withdrawal_reason = Column(Text)

    # Deadline Tracking
    deadline_warning_sent = Column(Boolean, default=False)
    deadline_warning_sent_at = Column(DateTime(timezone=True))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    enrolled_by = Column(String(36), ForeignKey("users.id"))  # Who enrolled the member

    # Relationships
    program = relationship("TrainingProgram", back_populates="enrollments")
    current_phase = relationship("ProgramPhase", foreign_keys=[current_phase_id])
    requirement_progress = relationship(
        "RequirementProgress", back_populates="enrollment", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_enrollment_user", "user_id", "status"),
        Index("idx_enrollment_program", "program_id", "status"),
        Index("idx_enrollment_deadline", "target_completion_date"),
    )

    def __repr__(self):
        return f"<ProgramEnrollment(user_id={self.user_id}, program_id={self.program_id}, status={self.status})>"


class RequirementProgress(Base):
    """
    Requirement Progress model

    Tracks individual requirement progress within a program enrollment.
    """

    __tablename__ = "requirement_progress"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    enrollment_id = Column(
        String(36),
        ForeignKey("program_enrollments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    requirement_id = Column(
        String(36),
        ForeignKey("training_requirements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Progress Tracking
    status = Column(
        Enum(RequirementProgressStatus, values_callable=lambda x: [e.value for e in x]),
        default=RequirementProgressStatus.NOT_STARTED,
        index=True,
    )
    progress_value = Column(
        Float, default=0.0
    )  # Hours completed, calls responded, etc.
    progress_percentage = Column(Float, default=0.0)  # Calculated percentage

    # Details
    progress_notes = Column(JSON)  # Track specific items completed, timestamps, etc.

    # Completion
    completed_at = Column(DateTime(timezone=True))
    verified_at = Column(DateTime(timezone=True))
    verified_by = Column(String(36), ForeignKey("users.id"))  # Officer who verified
    verification_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    enrollment = relationship(
        "ProgramEnrollment", back_populates="requirement_progress"
    )

    __table_args__ = (
        Index("idx_progress_enrollment", "enrollment_id", "status"),
        Index("idx_progress_requirement", "requirement_id"),
    )

    def __repr__(self):
        return f"<RequirementProgress(enrollment_id={self.enrollment_id}, status={self.status}, progress={self.progress_percentage}%)>"


class SkillEvaluation(Base):
    """
    Skill Evaluation model

    Defines skills that require evaluation/checkoff.
    """

    __tablename__ = "skill_evaluations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Skill Details
    name = Column(String(255), nullable=False)
    description = Column(Text)
    category = Column(String(100))  # e.g., "Firefighting", "EMS", "Driver", "Officer"

    # Evaluation Criteria
    evaluation_criteria = Column(JSON)  # List of criteria to evaluate
    passing_requirements = Column(Text)  # What constitutes passing

    # Linked Programs
    required_for_programs = Column(JSON)  # Program IDs that require this skill

    # Configurable evaluator permissions — training officer/chief sets who may sign off
    # Format: {"type": "roles", "roles": ["shift_leader", "driver_trainer"]}
    #      or {"type": "specific_users", "user_ids": ["uuid1", "uuid2"]}
    #      or null → any user with training.manage permission
    allowed_evaluators = Column(JSON, nullable=True)

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (Index("idx_skill_org_category", "organization_id", "category"),)

    def __repr__(self):
        return f"<SkillEvaluation(name={self.name}, category={self.category})>"


class SkillCheckoff(Base):
    """
    Skill Checkoff model

    Records individual skill evaluations.
    """

    __tablename__ = "skill_checkoffs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    skill_evaluation_id = Column(
        String(36),
        ForeignKey("skill_evaluations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Evaluation Details
    evaluator_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    status = Column(String(20), nullable=False)  # pending, passed, failed

    # Training context — links checkoff to the session and apparatus used
    session_id = Column(
        String(36),
        ForeignKey("training_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    apparatus_id = Column(
        String(36), nullable=True, index=True
    )  # FK to apparatus table (added conditionally)
    conditions = Column(
        JSON, nullable=True
    )  # Environmental context: {"time_of_day", "weather", "road_conditions", etc.}

    # Results
    evaluation_results = Column(JSON)  # Detailed results for each criterion
    score = Column(Float)  # Overall score if applicable
    notes = Column(Text)

    # Timestamps
    evaluated_at = Column(DateTime(timezone=True), default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_checkoff_user", "user_id"),
        Index("idx_checkoff_skill", "skill_evaluation_id"),
    )

    def __repr__(self):
        return f"<SkillCheckoff(user_id={self.user_id}, skill_id={self.skill_evaluation_id}, status={self.status})>"


# ============================================
# Shift Completion Reports
# ============================================


class ShiftCompletionReport(Base):
    """
    Shift Completion Report model

    Allows shift officers to report on a trainee's experience during a shift.
    Feeds into pipeline requirement progress for shift-based and call-based requirements.
    """

    __tablename__ = "shift_completion_reports"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Shift context
    shift_id = Column(
        String(36), ForeignKey("shifts.id", ondelete="SET NULL"), nullable=True
    )
    shift_date = Column(Date, nullable=False)

    # People
    trainee_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    officer_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Shift details
    hours_on_shift = Column(Float, nullable=False)
    calls_responded = Column(Integer, default=0)
    call_types = Column(JSON)  # Array of incident types responded to

    # Performance observations (narratives encrypted at rest via AES-256)
    performance_rating = Column(Integer)  # 1-5 scale
    areas_of_strength = Column(EncryptedText)
    areas_for_improvement = Column(EncryptedText)
    officer_narrative = Column(
        EncryptedText
    )  # Free-form description of the shift experience

    # Skills observed
    skills_observed = Column(JSON)  # Array of { skill_name, demonstrated: bool, notes }
    tasks_performed = Column(JSON)  # Array of { task, description }

    # Pipeline linkage
    enrollment_id = Column(
        String(36),
        ForeignKey("program_enrollments.id", ondelete="SET NULL"),
        nullable=True,
    )
    requirements_progressed = Column(
        JSON
    )  # Array of { requirement_progress_id, value_added }

    # Review workflow — reports can require approval before trainee visibility
    review_status = Column(
        String(20), default="approved"
    )  # draft, pending_review, approved, flagged
    reviewed_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    reviewer_notes = Column(
        EncryptedText, nullable=True
    )  # Internal notes from reviewer, never shown to trainee

    # Trainee acknowledgment
    trainee_acknowledged = Column(Boolean, default=False)
    trainee_acknowledged_at = Column(DateTime(timezone=True))
    trainee_comments = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_shift_report_trainee", "trainee_id", "shift_date"),
        Index("idx_shift_report_officer", "officer_id"),
        Index("idx_shift_report_enrollment", "enrollment_id"),
        Index("idx_shift_report_org_date", "organization_id", "shift_date"),
        Index("idx_shift_report_review", "organization_id", "review_status"),
    )

    def __repr__(self):
        return f"<ShiftCompletionReport(trainee={self.trainee_id}, date={self.shift_date}, officer={self.officer_id})>"


# ============================================
# Training Module Configuration (Member Visibility)
# ============================================


class TrainingModuleConfig(Base):
    """
    Training Module Configuration model

    Organization-level configuration controlling what training data members
    can see about themselves. Each field group can be toggled on/off.
    Training officers and chiefs always see everything regardless of settings.
    """

    __tablename__ = "training_module_configs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # -- Member visibility: what members see on their own training page --

    # Training records & history
    show_training_history = Column(Boolean, default=True)
    show_training_hours = Column(Boolean, default=True)
    show_certification_status = Column(Boolean, default=True)

    # Pipeline / program progress
    show_pipeline_progress = Column(Boolean, default=True)
    show_requirement_details = Column(Boolean, default=True)

    # Shift completion reports
    show_shift_reports = Column(Boolean, default=True)
    show_shift_stats = Column(Boolean, default=True)

    # Officer-written content visibility to members
    show_officer_narrative = Column(
        Boolean, default=False
    )  # Officer narrative on shift reports
    show_performance_rating = Column(Boolean, default=True)  # 1-5 star ratings
    show_areas_of_strength = Column(Boolean, default=True)
    show_areas_for_improvement = Column(Boolean, default=True)
    show_skills_observed = Column(Boolean, default=True)

    # Self-reported submissions
    show_submission_history = Column(Boolean, default=True)

    # Reports access
    allow_member_report_export = Column(
        Boolean, default=False
    )  # Can members download their own data

    # Shift report review workflow
    report_review_required = Column(
        Boolean, default=False
    )  # Must reports be approved before trainee can see?
    report_review_role = Column(
        String(50), default="training_officer"
    )  # Who reviews: training_officer, captain, chief

    # Rating customization
    rating_label = Column(
        String(100), default="Performance Rating"
    )  # Custom label for the rating field
    rating_scale_type = Column(String(20), default="stars")  # stars, competency, custom
    rating_scale_labels = Column(
        JSON, nullable=True
    )  # {"1":"Unsatisfactory","2":"Developing","3":"Competent","4":"Proficient","5":"Exemplary"}

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by = Column(String(36), ForeignKey("users.id"))

    def __repr__(self):
        return f"<TrainingModuleConfig(org_id={self.organization_id})>"

    def to_visibility_dict(self):
        """Return a dictionary of all visibility settings for frontend consumption."""
        return {
            "show_training_history": self.show_training_history,
            "show_training_hours": self.show_training_hours,
            "show_certification_status": self.show_certification_status,
            "show_pipeline_progress": self.show_pipeline_progress,
            "show_requirement_details": self.show_requirement_details,
            "show_shift_reports": self.show_shift_reports,
            "show_shift_stats": self.show_shift_stats,
            "show_officer_narrative": self.show_officer_narrative,
            "show_performance_rating": self.show_performance_rating,
            "show_areas_of_strength": self.show_areas_of_strength,
            "show_areas_for_improvement": self.show_areas_for_improvement,
            "show_skills_observed": self.show_skills_observed,
            "show_submission_history": self.show_submission_history,
            "allow_member_report_export": self.allow_member_report_export,
            "report_review_required": self.report_review_required,
            "report_review_role": self.report_review_role,
            "rating_label": self.rating_label,
            "rating_scale_type": self.rating_scale_type,
            "rating_scale_labels": self.rating_scale_labels,
        }


# ============================================
# Self-Reported Training
# ============================================


class SubmissionStatus(str, enum.Enum):
    """Status of a self-reported training submission"""

    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVISION_REQUESTED = "revision_requested"


class SelfReportConfig(Base):
    """
    Self-Report Configuration model

    Organization-level configuration for what fields are required when
    members self-report training, and whether officer approval is needed.
    """

    __tablename__ = "self_report_configs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Approval Settings
    require_approval = Column(
        Boolean, default=True
    )  # Require training officer approval
    auto_approve_under_hours = Column(
        Float, nullable=True
    )  # Auto-approve if under X hours (null = never auto-approve)
    approval_deadline_days = Column(Integer, default=14)  # Days officers have to review

    # Notification Settings
    notify_officer_on_submit = Column(
        Boolean, default=True
    )  # Email training officer when submission arrives
    notify_member_on_decision = Column(
        Boolean, default=True
    )  # Email member when approved/rejected

    # Field Configuration (JSON)
    # Each key is a field name, value is { "visible": bool, "required": bool, "label": str }
    # e.g. {"course_name": {"visible": true, "required": true, "label": "Course/Class Name"}, ...}
    field_config = Column(
        JSON,
        nullable=False,
        default=lambda: {
            "course_name": {
                "visible": True,
                "required": True,
                "label": "Course / Class Name",
            },
            "training_type": {
                "visible": True,
                "required": True,
                "label": "Training Type",
            },
            "completion_date": {
                "visible": True,
                "required": True,
                "label": "Date Completed",
            },
            "hours_completed": {
                "visible": True,
                "required": True,
                "label": "Hours Completed",
            },
            "credit_hours": {
                "visible": True,
                "required": False,
                "label": "Credit Hours",
            },
            "instructor": {
                "visible": True,
                "required": False,
                "label": "Instructor Name",
            },
            "location": {
                "visible": True,
                "required": False,
                "label": "Location / Facility",
            },
            "description": {
                "visible": True,
                "required": False,
                "label": "Description / Notes",
            },
            "category_id": {
                "visible": True,
                "required": False,
                "label": "Training Category",
            },
            "certification_number": {
                "visible": True,
                "required": False,
                "label": "Certificate / ID Number",
            },
            "issuing_agency": {
                "visible": True,
                "required": False,
                "label": "Issuing Agency",
            },
            "attachments": {
                "visible": True,
                "required": False,
                "label": "Supporting Documents",
            },
        },
    )

    # Allowed training types for self-reporting (null = all types allowed)
    allowed_training_types = Column(JSON, nullable=True)

    # Maximum hours per submission (null = no limit)
    max_hours_per_submission = Column(Float, nullable=True)

    # Instructions displayed to members
    member_instructions = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by = Column(String(36), ForeignKey("users.id"))

    def __repr__(self):
        return f"<SelfReportConfig(org_id={self.organization_id}, require_approval={self.require_approval})>"


class TrainingSubmission(Base):
    """
    Training Submission model

    Tracks self-reported training from members. Once approved, a
    TrainingRecord is created from the submission data.
    """

    __tablename__ = "training_submissions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    submitted_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Training Details
    course_name = Column(String(255), nullable=False)
    course_code = Column(String(50))
    training_type = Column(
        Enum(TrainingType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    description = Column(Text)

    # Dates and Hours
    completion_date = Column(Date, nullable=False)
    hours_completed = Column(Float, nullable=False)
    credit_hours = Column(Float)

    # Instructor and Location
    instructor = Column(String(255))
    location = Column(String(255))

    # Certification Details
    certification_number = Column(String(100))
    issuing_agency = Column(String(255))
    expiration_date = Column(Date)

    # Category Linkage
    category_id = Column(
        String(36),
        ForeignKey("training_categories.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Supporting Documents
    attachments = Column(JSON)  # List of file URLs or references

    # Submission Status
    status = Column(
        Enum(SubmissionStatus, values_callable=lambda x: [e.value for e in x]),
        default=SubmissionStatus.PENDING_REVIEW,
        nullable=False,
        index=True,
    )

    # Review Details
    reviewed_by = Column(String(36), ForeignKey("users.id"))
    reviewed_at = Column(DateTime(timezone=True))
    reviewer_notes = Column(Text)  # Officer notes on approval/rejection

    # Link to created TrainingRecord (populated on approval)
    training_record_id = Column(
        String(36),
        ForeignKey("training_records.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Timestamps
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    training_record = relationship("TrainingRecord")

    __table_args__ = (
        Index("idx_submission_org_status", "organization_id", "status"),
        Index("idx_submission_user", "submitted_by", "status"),
        Index("idx_submission_date", "completion_date"),
    )

    def __repr__(self):
        return f"<TrainingSubmission(course={self.course_name}, status={self.status}, by={self.submitted_by})>"


# ============================================
# External Training Integration
# ============================================


class ExternalProviderType(str, enum.Enum):
    """Supported external training providers"""

    VECTOR_SOLUTIONS = "vector_solutions"
    TARGET_SOLUTIONS = "target_solutions"
    LEXIPOL = "lexipol"
    I_AM_RESPONDING = "i_am_responding"
    CUSTOM_API = "custom_api"


class SyncStatus(str, enum.Enum):
    """Status of sync operations"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"  # Some records synced, some failed


class ExternalTrainingProvider(Base):
    """
    External Training Provider model

    Configuration for connecting to external training platforms like
    Vector Solutions, Target Solutions, Lexipol, etc.
    """

    __tablename__ = "external_training_providers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Provider Details
    name = Column(
        String(255), nullable=False
    )  # Display name: "Vector Solutions", "Target Solutions"
    provider_type = Column(
        Enum(ExternalProviderType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    description = Column(Text)

    # API Configuration (encrypted)
    api_base_url = Column(String(500))  # Base URL for API calls
    api_key = Column(Text)  # Encrypted API key
    api_secret = Column(Text)  # Encrypted API secret (if needed)
    client_id = Column(String(255))  # OAuth client ID (if needed)
    client_secret = Column(Text)  # Encrypted OAuth client secret (if needed)

    # Authentication Type
    auth_type = Column(String(50), default="api_key")  # api_key, oauth2, basic

    # Additional Configuration (JSON)
    config = Column(JSON)  # Provider-specific config like endpoints, headers, etc.
    # Example: {"records_endpoint": "/api/v1/records", "users_endpoint": "/api/v1/users"}

    # Sync Settings
    auto_sync_enabled = Column(Boolean, default=False)
    sync_interval_hours = Column(Integer, default=24)  # How often to auto-sync
    last_sync_at = Column(DateTime(timezone=True))
    next_sync_at = Column(DateTime(timezone=True))

    # Default Category Mapping
    default_category_id = Column(
        String(36), ForeignKey("training_categories.id", ondelete="SET NULL")
    )

    # Status
    active = Column(Boolean, default=True, index=True)
    connection_verified = Column(Boolean, default=False)
    last_connection_test = Column(DateTime(timezone=True))
    connection_error = Column(Text)  # Last connection error message

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    category_mappings = relationship(
        "ExternalCategoryMapping",
        back_populates="provider",
        cascade="all, delete-orphan",
    )
    sync_history = relationship(
        "ExternalTrainingSyncLog",
        back_populates="provider",
        cascade="all, delete-orphan",
    )
    imported_records = relationship(
        "ExternalTrainingImport",
        back_populates="provider",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_ext_provider_org", "organization_id", "active"),
        Index("idx_ext_provider_type", "provider_type"),
    )

    def __repr__(self):
        return (
            f"<ExternalTrainingProvider(name={self.name}, type={self.provider_type})>"
        )


class ExternalCategoryMapping(Base):
    """
    External Category Mapping model

    Maps categories from external training platforms to internal TrainingCategories.
    """

    __tablename__ = "external_category_mappings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    provider_id = Column(
        String(36),
        ForeignKey("external_training_providers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # External Category Info
    external_category_id = Column(
        String(255), nullable=False
    )  # ID from external system
    external_category_name = Column(
        String(255), nullable=False
    )  # Name from external system
    external_category_code = Column(
        String(100)
    )  # Code from external system (if available)

    # Internal Category Mapping
    internal_category_id = Column(
        String(36), ForeignKey("training_categories.id", ondelete="SET NULL")
    )

    # Mapping Status
    is_mapped = Column(Boolean, default=False)  # Has been mapped to internal category
    auto_mapped = Column(Boolean, default=False)  # Was mapped automatically vs manually

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    mapped_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    provider = relationship(
        "ExternalTrainingProvider", back_populates="category_mappings"
    )
    internal_category = relationship("TrainingCategory")

    __table_args__ = (
        Index("idx_ext_mapping_provider", "provider_id"),
        Index("idx_ext_mapping_external", "provider_id", "external_category_id"),
    )

    def __repr__(self):
        return f"<ExternalCategoryMapping(external={self.external_category_name}, internal_id={self.internal_category_id})>"


class ExternalUserMapping(Base):
    """
    External User Mapping model

    Maps users from external training platforms to internal Users.
    """

    __tablename__ = "external_user_mappings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    provider_id = Column(
        String(36),
        ForeignKey("external_training_providers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # External User Info
    external_user_id = Column(String(255), nullable=False)  # ID from external system
    external_username = Column(String(255))  # Username from external system
    external_email = Column(String(255))  # Email from external system
    external_name = Column(String(255))  # Full name from external system

    # Internal User Mapping
    internal_user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    # Mapping Status
    is_mapped = Column(Boolean, default=False)
    auto_mapped = Column(Boolean, default=False)  # Mapped automatically by email match

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    mapped_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index("idx_ext_user_provider", "provider_id"),
        Index("idx_ext_user_external", "provider_id", "external_user_id"),
        Index("idx_ext_user_internal", "internal_user_id"),
    )

    def __repr__(self):
        return f"<ExternalUserMapping(external={self.external_username}, internal_id={self.internal_user_id})>"


class ExternalTrainingSyncLog(Base):
    """
    External Training Sync Log model

    Tracks sync operations with external training providers.
    """

    __tablename__ = "external_training_sync_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    provider_id = Column(
        String(36),
        ForeignKey("external_training_providers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Sync Details
    sync_type = Column(String(50), nullable=False)  # full, incremental, manual
    status = Column(
        Enum(SyncStatus, values_callable=lambda x: [e.value for e in x]),
        default=SyncStatus.PENDING,
        index=True,
    )

    # Timing
    started_at = Column(DateTime(timezone=True), default=func.now())
    completed_at = Column(DateTime(timezone=True))

    # Results
    records_fetched = Column(
        Integer, default=0
    )  # Records retrieved from external system
    records_imported = Column(Integer, default=0)  # Records successfully imported
    records_updated = Column(Integer, default=0)  # Existing records updated
    records_skipped = Column(Integer, default=0)  # Records skipped (duplicates, etc.)
    records_failed = Column(Integer, default=0)  # Records that failed to import

    # Error Information
    error_message = Column(Text)
    error_details = Column(JSON)  # Detailed error info for debugging

    # Date Range Synced
    sync_from_date = Column(Date)  # Records from this date
    sync_to_date = Column(Date)  # Records to this date

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    initiated_by = Column(String(36), ForeignKey("users.id"))  # Null for auto-sync

    # Relationships
    provider = relationship("ExternalTrainingProvider", back_populates="sync_history")

    __table_args__ = (
        Index("idx_sync_log_provider", "provider_id", "status"),
        Index("idx_sync_log_date", "started_at"),
    )

    def __repr__(self):
        return f"<ExternalTrainingSyncLog(provider_id={self.provider_id}, status={self.status})>"


class ExternalTrainingImport(Base):
    """
    External Training Import model

    Stores imported training records from external providers.
    Links external records to internal TrainingRecords.
    """

    __tablename__ = "external_training_imports"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    provider_id = Column(
        String(36),
        ForeignKey("external_training_providers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sync_log_id = Column(
        String(36),
        ForeignKey("external_training_sync_logs.id", ondelete="SET NULL"),
        index=True,
    )

    # External Record Data
    external_record_id = Column(String(255), nullable=False)  # ID from external system
    external_user_id = Column(String(255))  # User ID from external system
    external_course_id = Column(String(255))  # Course ID from external system
    external_category_id = Column(String(255))  # Category ID from external system

    # Training Details (from external system)
    course_title = Column(String(500), nullable=False)  # Title/name of the training
    course_code = Column(String(100))
    description = Column(Text)
    duration_minutes = Column(Integer)  # Duration in minutes
    completion_date = Column(DateTime(timezone=True))  # When completed
    score = Column(Float)  # Score if applicable
    passed = Column(Boolean)

    # External Category Info
    external_category_name = Column(String(255))

    # Raw Data (JSON) - Store complete response for reference
    raw_data = Column(JSON)

    # Internal Record Link
    training_record_id = Column(
        String(36), ForeignKey("training_records.id", ondelete="SET NULL"), index=True
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )  # Mapped internal user

    # Import Status
    import_status = Column(
        String(50), default="pending", index=True
    )  # pending, imported, failed, skipped, duplicate
    import_error = Column(Text)
    imported_at = Column(DateTime(timezone=True))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    provider = relationship(
        "ExternalTrainingProvider", back_populates="imported_records"
    )
    training_record = relationship("TrainingRecord")

    __table_args__ = (
        Index("idx_ext_import_provider", "provider_id", "import_status"),
        Index("idx_ext_import_external", "provider_id", "external_record_id"),
        Index("idx_ext_import_user", "user_id"),
    )

    def __repr__(self):
        return f"<ExternalTrainingImport(title={self.course_title}, status={self.import_status})>"


# ============================================
# Shift Module (Framework Only)
# ============================================


class Shift(Base):
    """
    Shift model (Framework)

    Records shift information for tracking member participation and activities.
    """

    __tablename__ = "shifts"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Shift Details
    shift_date = Column(Date, nullable=False, index=True)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True))

    # Assignment
    apparatus_id = Column(String(36))  # Link to apparatus (future)
    station_id = Column(String(36))  # Link to station (future)

    # Leadership
    shift_officer_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Display
    color = Column(String(7))  # Hex color from shift template, e.g. "#4f46e5"

    # Notes
    notes = Column(Text)
    activities = Column(JSON)  # Training, station duties, etc.

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (Index("idx_shift_date", "organization_id", "shift_date"),)

    def __repr__(self):
        return f"<Shift(date={self.shift_date}, officer={self.shift_officer_id})>"


class ShiftAttendance(Base):
    """
    Shift Attendance model (Framework)

    Tracks individual member attendance on shifts.
    """

    __tablename__ = "shift_attendance"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    shift_id = Column(
        String(36),
        ForeignKey("shifts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Timing
    checked_in_at = Column(DateTime(timezone=True))
    checked_out_at = Column(DateTime(timezone=True))
    duration_minutes = Column(Integer)  # Calculated

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_shift_att_shift", "shift_id"),
        Index("idx_shift_att_user", "user_id"),
    )

    def __repr__(self):
        return f"<ShiftAttendance(shift_id={self.shift_id}, user_id={self.user_id})>"


class ShiftCall(Base):
    """
    Shift Call model (Framework)

    Records calls/incidents responded to during a shift.
    """

    __tablename__ = "shift_calls"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    shift_id = Column(
        String(36),
        ForeignKey("shifts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Incident Details
    incident_number = Column(String(100))
    incident_type = Column(
        String(100), index=True
    )  # Structure fire, medical, MVA, etc.

    # Timing
    dispatched_at = Column(DateTime(timezone=True))
    on_scene_at = Column(DateTime(timezone=True))
    cleared_at = Column(DateTime(timezone=True))

    # Outcome
    cancelled_en_route = Column(Boolean, default=False)
    medical_refusal = Column(Boolean, default=False)

    # Responding Members
    responding_members = Column(JSON)  # Array of user IDs

    # Notes
    notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_call_shift", "shift_id"),
        Index("idx_call_type", "incident_type"),
    )

    def __repr__(self):
        return (
            f"<ShiftCall(incident={self.incident_number}, type={self.incident_type})>"
        )


# ============================================
# Shift Scheduling Enums
# ============================================


class ShiftPosition(str, enum.Enum):
    """Position/role within a shift"""

    OFFICER = "officer"
    DRIVER = "driver"
    FIREFIGHTER = "firefighter"
    EMS = "ems"
    CAPTAIN = "captain"
    LIEUTENANT = "lieutenant"
    PROBATIONARY = "probationary"
    VOLUNTEER = "volunteer"
    OTHER = "other"


class AssignmentStatus(str, enum.Enum):
    """Status of a shift assignment"""

    ASSIGNED = "assigned"
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    PENDING = "pending"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class SwapRequestStatus(str, enum.Enum):
    """Status of a shift swap request"""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CANCELLED = "cancelled"


class TimeOffStatus(str, enum.Enum):
    """Status of a time-off request"""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CANCELLED = "cancelled"


class PatternType(str, enum.Enum):
    """Type of shift pattern/rotation"""

    DAILY = "daily"
    WEEKLY = "weekly"
    PLATOON = "platoon"
    CUSTOM = "custom"


# ============================================
# Shift Template
# ============================================


class ShiftTemplate(Base):
    """
    Reusable shift template for quick shift creation.
    E.g., "Day Shift", "Night Shift", "Weekend Duty"
    """

    __tablename__ = "shift_templates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(200), nullable=False)
    description = Column(Text)
    start_time_of_day = Column(String(5), nullable=False)  # "07:00" HH:MM format
    end_time_of_day = Column(String(5), nullable=False)  # "19:00"
    duration_hours = Column(Float, nullable=False)  # 12.0
    color = Column(String(7))  # Hex color for calendar display

    # Staffing
    positions = Column(
        JSON
    )  # [{"position": "officer", "count": 1}, {"position": "firefighter", "count": 3}]
    min_staffing = Column(Integer, default=1)

    # Categorization
    category = Column(
        String(20), default="standard"
    )  # "standard", "specialty", "event"
    apparatus_type = Column(
        String(50)
    )  # Links template to a vehicle type (e.g., "engine", "ambulance")
    apparatus_id = Column(
        String(36)
    )  # Links template to a specific vehicle (BasicApparatus or full Apparatus)

    # Defaults
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (Index("idx_shift_template_org", "organization_id"),)

    def __repr__(self):
        return f"<ShiftTemplate(name={self.name}, duration={self.duration_hours}h)>"


# ============================================
# Shift Pattern (Recurring Schedules)
# ============================================


class ShiftPattern(Base):
    """
    Recurring shift pattern for automatic schedule generation.
    Supports platoon rotations, weekly schedules, etc.
    """

    __tablename__ = "shift_patterns"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(200), nullable=False)
    description = Column(Text)
    pattern_type = Column(Enum(PatternType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=PatternType.WEEKLY)

    # Pattern definition
    template_id = Column(
        String(36), ForeignKey("shift_templates.id", ondelete="SET NULL")
    )
    rotation_days = Column(
        Integer
    )  # Days in the rotation cycle (e.g., 3 for platoon A/B/C)
    days_on = Column(Integer)  # Days on duty per cycle
    days_off = Column(Integer)  # Days off per cycle
    schedule_config = Column(
        JSON
    )  # Flexible config: {"platoons": ["A","B","C"], "weekdays": [0,1,2,3,4]}

    # Active period
    start_date = Column(Date, nullable=False)
    end_date = Column(Date)  # Null = indefinite

    # Members assigned to this pattern
    assigned_members = Column(
        JSON
    )  # [{"user_id": "...", "platoon": "A", "position": "firefighter"}]

    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (Index("idx_shift_pattern_org", "organization_id"),)

    def __repr__(self):
        return f"<ShiftPattern(name={self.name}, type={self.pattern_type})>"


# ============================================
# Shift Assignment (Duty Roster)
# ============================================


class ShiftAssignment(Base):
    """
    Assigns a specific member to a specific shift with a designated position.
    """

    __tablename__ = "shift_assignments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    shift_id = Column(
        String(36),
        ForeignKey("shifts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    position = Column(
        Enum(ShiftPosition), nullable=False, default=ShiftPosition.FIREFIGHTER
    )
    assignment_status = Column(
        Enum(AssignmentStatus), nullable=False, default=AssignmentStatus.ASSIGNED
    )

    # Tracking
    assigned_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    confirmed_at = Column(DateTime(timezone=True))
    notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("shift_id", "user_id", name="uq_shift_assignment_shift_user"),
        Index("idx_shift_assign_shift", "shift_id"),
        Index("idx_shift_assign_user", "user_id"),
        Index("idx_shift_assign_org", "organization_id"),
    )

    def __repr__(self):
        return f"<ShiftAssignment(shift={self.shift_id}, user={self.user_id}, position={self.position})>"


# ============================================
# Shift Swap Request
# ============================================


class ShiftSwapRequest(Base):
    """
    Request to swap shifts between two members.
    """

    __tablename__ = "shift_swap_requests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The member requesting the swap
    requesting_user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # The shift they want to give up
    offering_shift_id = Column(
        String(36), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False
    )
    # The shift they want to pick up (optional — can be open request)
    requesting_shift_id = Column(
        String(36), ForeignKey("shifts.id", ondelete="SET NULL")
    )
    # The member they want to swap with (optional — can be open request)
    target_user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    status = Column(
        Enum(SwapRequestStatus), nullable=False, default=SwapRequestStatus.PENDING
    )
    reason = Column(Text)

    # Review
    reviewed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at = Column(DateTime(timezone=True))
    reviewer_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_swap_req_org", "organization_id"),
        Index("idx_swap_req_user", "requesting_user_id"),
        Index("idx_swap_req_status", "status"),
    )

    def __repr__(self):
        return (
            f"<ShiftSwapRequest(user={self.requesting_user_id}, status={self.status})>"
        )


# ============================================
# Shift Time-Off Request
# ============================================


class ShiftTimeOff(Base):
    """
    Member request for time off / unavailability.
    """

    __tablename__ = "shift_time_off"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    reason = Column(Text)

    status = Column(Enum(TimeOffStatus), nullable=False, default=TimeOffStatus.PENDING)
    approved_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    approved_at = Column(DateTime(timezone=True))
    reviewer_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_timeoff_org", "organization_id"),
        Index("idx_timeoff_user", "user_id"),
        Index("idx_timeoff_dates", "start_date", "end_date"),
    )

    def __repr__(self):
        return (
            f"<ShiftTimeOff(user={self.user_id}, {self.start_date} - {self.end_date})>"
        )


# ============================================
# Basic Apparatus (Lightweight, for non-module departments)
# ============================================


class BasicApparatus(Base):
    """
    Lightweight apparatus/vehicle definition for shift scheduling.

    Used when the full Apparatus module is not enabled. Provides basic
    vehicle/unit definitions with crew positions for shift staffing.
    """

    __tablename__ = "basic_apparatus"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    unit_number = Column(String(20), nullable=False)
    name = Column(String(100), nullable=False)
    apparatus_type = Column(String(50), nullable=False, default="engine")
    min_staffing = Column(Integer, default=1)
    positions = Column(
        JSON
    )  # List of position strings e.g. ["officer", "driver", "firefighter"]
    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (Index("idx_basic_apparatus_org", "organization_id"),)

    def __repr__(self):
        return f"<BasicApparatus(unit={self.unit_number}, name={self.name})>"


class TrainingWaiverType(str, enum.Enum):
    LEAVE_OF_ABSENCE = "leave_of_absence"
    MEDICAL = "medical"
    MILITARY = "military"
    PERSONAL = "personal"
    ADMINISTRATIVE = "administrative"
    NEW_MEMBER = "new_member"
    OTHER = "other"


class TrainingWaiver(Base):
    """
    Training Waiver / Leave of Absence

    Records periods where a member is excused from training requirements.
    When a rolling-period requirement is calculated (e.g., average 6 hours
    over 12 months), waived months are excluded from the denominator so the
    member's required average is computed only over months they were active.
    """

    __tablename__ = "training_waivers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    waiver_type = Column(
        Enum(TrainingWaiverType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=TrainingWaiverType.LEAVE_OF_ABSENCE,
    )
    reason = Column(Text, nullable=True)

    # The period the member is excused (inclusive)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)  # None = permanent waiver

    # Which requirements this waiver applies to (null = all requirements)
    requirement_ids = Column(JSON, nullable=True)

    # Approval
    granted_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    granted_at = Column(DateTime(timezone=True), nullable=True)

    active = Column(Boolean, default=True, nullable=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    grantor = relationship("User", foreign_keys=[granted_by])

    __table_args__ = (
        Index("idx_training_waivers_org_user", "organization_id", "user_id"),
        Index("idx_training_waivers_dates", "start_date", "end_date"),
    )


# ============================================
# Recertification Pathways
# ============================================


class RecertificationPathway(Base):
    """
    Recertification Pathway model

    Defines how to renew an expiring certification. Maps expiring
    certifications to the courses/hours needed for renewal, with
    support for grace periods and prerequisite chains.

    Industry standard: NREMT recertification requires specific
    category-hours (e.g., 50 CE hours distributed across topics for EMT).
    """

    __tablename__ = "recertification_pathways"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Which certification this pathway renews
    name = Column(String(255), nullable=False)
    description = Column(Text)
    source_requirement_id = Column(
        String(36),
        ForeignKey("training_requirements.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )  # The certification requirement this renews

    # Renewal requirements
    renewal_type = Column(
        String(50), nullable=False, default="hours"
    )  # hours, courses, assessment, combination
    required_hours = Column(Float)  # Total renewal hours needed
    required_courses = Column(JSON)  # Specific course IDs needed for renewal
    category_hour_requirements = Column(
        JSON
    )  # Category-specific hours: [{"category_id": "...", "hours": 10, "label": "Trauma"}]
    requires_assessment = Column(Boolean, default=False)
    assessment_course_id = Column(
        String(36),
        ForeignKey("training_courses.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Timing
    renewal_window_days = Column(
        Integer, default=90
    )  # Days before expiration that renewal opens
    grace_period_days = Column(
        Integer, default=0
    )  # Days after expiration where renewal is still possible
    max_lapse_days = Column(
        Integer
    )  # Days after which full recertification is needed (null = no limit)

    # Prerequisite pathways (must complete these renewals first)
    prerequisite_pathway_ids = Column(JSON)  # e.g., CPR must be current before ACLS

    # What happens on successful renewal
    new_expiration_months = Column(
        Integer
    )  # Months from renewal completion to new expiration
    auto_create_record = Column(
        Boolean, default=True
    )  # Auto-create a new TrainingRecord on completion

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index("idx_recert_pathway_org", "organization_id", "active"),
        Index("idx_recert_pathway_source", "source_requirement_id"),
    )

    def __repr__(self):
        return f"<RecertificationPathway(name={self.name})>"


class RenewalTaskStatus(str, enum.Enum):
    """Status of a renewal task"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    EXPIRED = "expired"  # Grace period passed
    LAPSED = "lapsed"  # Full recert needed


class RenewalTask(Base):
    """
    Renewal Task model

    Auto-generated when a certification enters its renewal window.
    Guides the member through the renewal process.
    """

    __tablename__ = "renewal_tasks"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Links
    pathway_id = Column(
        String(36),
        ForeignKey("recertification_pathways.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    training_record_id = Column(
        String(36),
        ForeignKey("training_records.id", ondelete="SET NULL"),
        nullable=True,
    )  # The expiring record

    # Status
    status = Column(
        Enum(RenewalTaskStatus, values_callable=lambda x: [e.value for e in x]),
        default=RenewalTaskStatus.PENDING,
        index=True,
    )

    # Certification dates
    certification_expiration_date = Column(Date, nullable=False)
    renewal_window_opens = Column(Date, nullable=False)
    grace_period_ends = Column(Date)

    # Progress
    hours_completed = Column(Float, default=0)
    courses_completed = Column(JSON)  # List of completed course IDs
    category_hours_completed = Column(
        JSON
    )  # {"category_id": hours_completed} tracking
    assessment_passed = Column(Boolean, default=False)
    progress_percentage = Column(Float, default=0.0)

    # Completion
    completed_at = Column(DateTime(timezone=True))
    new_record_id = Column(
        String(36),
        ForeignKey("training_records.id", ondelete="SET NULL"),
        nullable=True,
    )  # The new certification record created

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_renewal_task_user", "user_id", "status"),
        Index("idx_renewal_task_pathway", "pathway_id"),
        Index("idx_renewal_task_expiration", "certification_expiration_date"),
    )

    def __repr__(self):
        return f"<RenewalTask(user_id={self.user_id}, status={self.status})>"


# ============================================
# Competency Levels & Progression
# ============================================


class CompetencyLevel(str, enum.Enum):
    """Dreyfus model of skill acquisition"""

    NOVICE = "novice"
    ADVANCED_BEGINNER = "advanced_beginner"
    COMPETENT = "competent"
    PROFICIENT = "proficient"
    EXPERT = "expert"


class CompetencyMatrix(Base):
    """
    Competency Matrix model

    Maps positions/roles to required skills at specific competency levels.
    Based on NFPA 1021 (Fire Officer) and NFPA 1041 (Instructor) frameworks.
    """

    __tablename__ = "competency_matrices"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Target
    name = Column(String(255), nullable=False)
    description = Column(Text)
    position = Column(
        String(100), nullable=False, index=True
    )  # firefighter, driver, officer, etc.
    role_id = Column(
        String(36), nullable=True, index=True
    )  # Optional link to role

    # Requirements: list of skill/competency pairs
    # Format: [{"skill_evaluation_id": "...", "required_level": "competent", "priority": "required"}]
    skill_requirements = Column(JSON, nullable=False, default=list)

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index("idx_competency_matrix_org", "organization_id", "position"),
    )

    def __repr__(self):
        return f"<CompetencyMatrix(name={self.name}, position={self.position})>"


class MemberCompetency(Base):
    """
    Member Competency model

    Tracks a member's current competency level for a specific skill.
    Updated when skill evaluations are completed.
    Supports skill decay tracking (requires re-validation after N months).
    """

    __tablename__ = "member_competencies"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    skill_evaluation_id = Column(
        String(36),
        ForeignKey("skill_evaluations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Current level
    current_level = Column(
        Enum(CompetencyLevel, values_callable=lambda x: [e.value for e in x]),
        default=CompetencyLevel.NOVICE,
        nullable=False,
    )
    previous_level = Column(
        Enum(CompetencyLevel, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )

    # Evaluation history
    last_evaluated_at = Column(DateTime(timezone=True))
    last_evaluator_id = Column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    evaluation_count = Column(Integer, default=0)
    last_score = Column(Float)

    # Skill decay tracking
    decay_months = Column(
        Integer
    )  # After this many months without evaluation, level decays
    decay_warning_sent = Column(Boolean, default=False)
    next_evaluation_due = Column(Date)  # When re-evaluation is needed

    # Score trend (last 5 scores for trend analysis)
    score_history = Column(JSON)  # [{"date": "...", "score": 85, "level": "competent"}]

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_member_comp_user", "user_id", "skill_evaluation_id"),
        Index("idx_member_comp_org", "organization_id"),
        Index("idx_member_comp_decay", "next_evaluation_due"),
    )

    def __repr__(self):
        return f"<MemberCompetency(user_id={self.user_id}, level={self.current_level})>"


# ============================================
# Instructor Qualifications
# ============================================


class InstructorQualification(Base):
    """
    Instructor Qualification model

    Tracks which users are qualified to instruct or evaluate specific
    courses and skills. Based on NFPA 1041 requirements.
    """

    __tablename__ = "instructor_qualifications"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # What they're qualified for
    qualification_type = Column(
        String(50), nullable=False
    )  # instructor, evaluator, lead_instructor, mentor
    course_id = Column(
        String(36),
        ForeignKey("training_courses.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )  # Specific course authorization
    skill_evaluation_id = Column(
        String(36),
        ForeignKey("skill_evaluations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )  # Specific skill they can evaluate
    category_id = Column(
        String(36),
        ForeignKey("training_categories.id", ondelete="CASCADE"),
        nullable=True,
    )  # Broad category authorization

    # Certification details
    certification_number = Column(String(100))
    issuing_agency = Column(String(255))
    certification_level = Column(
        String(50)
    )  # e.g., "Fire Instructor I", "Fire Instructor II"
    issued_date = Column(Date)
    expiration_date = Column(Date, index=True)

    # Status
    active = Column(Boolean, default=True, index=True)
    verified = Column(Boolean, default=False)
    verified_by = Column(String(36), ForeignKey("users.id"))
    verified_at = Column(DateTime(timezone=True))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index("idx_instructor_qual_user", "user_id", "active"),
        Index("idx_instructor_qual_course", "course_id"),
        Index("idx_instructor_qual_skill", "skill_evaluation_id"),
        Index("idx_instructor_qual_expiration", "expiration_date"),
    )

    def __repr__(self):
        return f"<InstructorQualification(user_id={self.user_id}, type={self.qualification_type})>"


# ============================================
# Training Effectiveness (Kirkpatrick Model)
# ============================================


class EvaluationLevel(str, enum.Enum):
    """Kirkpatrick Model evaluation levels"""

    REACTION = "reaction"  # Level 1: Participant satisfaction
    LEARNING = "learning"  # Level 2: Knowledge/skill gained (pre/post test)
    BEHAVIOR = "behavior"  # Level 3: On-the-job application
    RESULTS = "results"  # Level 4: Organizational impact


class TrainingEffectivenessEvaluation(Base):
    """
    Training Effectiveness Evaluation model

    Implements the Kirkpatrick Model for measuring training effectiveness.
    Level 1 (Reaction): Post-training survey
    Level 2 (Learning): Pre/post assessment scores
    Level 3 (Behavior): On-the-job observation
    Level 4 (Results): Incident performance correlation
    """

    __tablename__ = "training_effectiveness_evaluations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # What was evaluated
    training_record_id = Column(
        String(36),
        ForeignKey("training_records.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    training_session_id = Column(
        String(36),
        ForeignKey("training_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    course_id = Column(
        String(36),
        ForeignKey("training_courses.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Evaluation details
    evaluation_level = Column(
        Enum(EvaluationLevel, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Level 1: Reaction (survey responses)
    # Format: {"overall_rating": 4, "relevance": 5, "instructor_quality": 4, "would_recommend": true, "comments": "..."}
    survey_responses = Column(JSON)
    overall_rating = Column(Float)  # 1-5 scale

    # Level 2: Learning (pre/post scores)
    pre_assessment_score = Column(Float)
    post_assessment_score = Column(Float)
    knowledge_gain_percentage = Column(Float)  # Calculated: (post - pre) / pre * 100

    # Level 3: Behavior (observed application)
    behavior_observations = Column(JSON)  # From shift reports, skill checkoffs
    behavior_rating = Column(Float)  # 1-5 scale

    # Level 4: Results (organizational metrics)
    results_metrics = Column(
        JSON
    )  # {"response_time_improvement": -5, "incident_outcome_score": 4.2}
    results_notes = Column(Text)

    # Evaluator
    evaluated_by = Column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    evaluated_at = Column(DateTime(timezone=True), server_default=func.now())

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_effectiveness_org", "organization_id"),
        Index("idx_effectiveness_record", "training_record_id"),
        Index("idx_effectiveness_level", "evaluation_level"),
        Index("idx_effectiveness_user", "user_id"),
    )

    def __repr__(self):
        return f"<TrainingEffectivenessEvaluation(level={self.evaluation_level}, rating={self.overall_rating})>"


# ============================================
# Multi-Agency Training
# ============================================


class MultiAgencyTraining(Base):
    """
    Multi-Agency Training model

    Tags training records and sessions as multi-agency exercises,
    records participating organizations, and supports cross-org
    credential verification.

    Industry standard: NFPA 1500 Chapter 5 and FEMA NIMS require
    documented joint training.
    """

    __tablename__ = "multi_agency_trainings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Training link
    training_session_id = Column(
        String(36),
        ForeignKey("training_sessions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    training_record_id = Column(
        String(36),
        ForeignKey("training_records.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Exercise details
    exercise_name = Column(String(255), nullable=False)
    exercise_type = Column(
        String(50), nullable=False
    )  # joint_training, mutual_aid_drill, regional_exercise, tabletop
    description = Column(Text)

    # Participating organizations
    participating_organizations = Column(
        JSON, nullable=False
    )  # [{"name": "...", "role": "host/participant", "contact": "..."}]
    lead_agency = Column(String(255))
    total_participants = Column(Integer)

    # NIMS/ICS compliance
    ics_position_assignments = Column(
        JSON
    )  # [{"position": "IC", "user_id": "...", "agency": "..."}]
    nims_compliant = Column(Boolean, default=False)
    after_action_report = Column(Text)
    lessons_learned = Column(JSON)  # [{"area": "communication", "finding": "...", "recommendation": "..."}]

    # Agreement tracking
    mutual_aid_agreement_id = Column(String(100))

    # Timestamps
    exercise_date = Column(Date, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index("idx_multi_agency_org", "organization_id"),
        Index("idx_multi_agency_date", "exercise_date"),
        Index("idx_multi_agency_session", "training_session_id"),
    )

    def __repr__(self):
        return f"<MultiAgencyTraining(name={self.exercise_name}, type={self.exercise_type})>"


# ============================================
# SCORM/xAPI Learning Record Store
# ============================================


class XAPIStatement(Base):
    """
    xAPI (Experience API / Tin Can) Statement model

    Stores learning activity statements in xAPI format.
    Enables ingestion from any xAPI-compliant learning platform
    without building provider-specific connectors.
    """

    __tablename__ = "xapi_statements"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Actor (who did it)
    actor_email = Column(String(255), index=True)
    actor_name = Column(String(255))
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )  # Mapped internal user

    # Verb (what they did)
    verb_id = Column(
        String(500), nullable=False
    )  # IRI like "http://adlnet.gov/expapi/verbs/completed"
    verb_display = Column(String(100))  # Human-readable: "completed", "passed", etc.

    # Object (what they did it to)
    object_id = Column(String(500), nullable=False)  # IRI for the activity
    object_name = Column(String(500))
    object_type = Column(String(100))  # Activity, Agent, etc.

    # Result
    score_scaled = Column(Float)  # -1 to 1
    score_raw = Column(Float)
    score_min = Column(Float)
    score_max = Column(Float)
    success = Column(Boolean)
    completion = Column(Boolean)
    duration_seconds = Column(Integer)  # ISO 8601 duration converted to seconds

    # Context
    context_registration = Column(String(36))  # Registration UUID
    context_platform = Column(String(255))  # LMS name
    context_extensions = Column(JSON)

    # Full statement (raw JSON for reference)
    raw_statement = Column(JSON, nullable=False)

    # Processing
    processed = Column(Boolean, default=False, index=True)
    training_record_id = Column(
        String(36),
        ForeignKey("training_records.id", ondelete="SET NULL"),
        nullable=True,
    )  # Created training record

    # Source
    source_provider_id = Column(
        String(36),
        ForeignKey("external_training_providers.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Timestamp from xAPI statement
    statement_timestamp = Column(DateTime(timezone=True), nullable=False)
    stored_at = Column(DateTime(timezone=True), server_default=func.now())

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_xapi_org", "organization_id"),
        Index("idx_xapi_actor", "actor_email"),
        Index("idx_xapi_verb", "verb_id"),
        Index("idx_xapi_timestamp", "statement_timestamp"),
        Index("idx_xapi_processed", "processed"),
    )

    def __repr__(self):
        return f"<XAPIStatement(actor={self.actor_email}, verb={self.verb_display})>"
