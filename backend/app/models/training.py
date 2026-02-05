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
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

from app.core.database import Base


def generate_uuid() -> str:
    """Generate a UUID string for MySQL compatibility"""
    return str(uuid.uuid4())


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
    CALENDAR_PERIOD = "calendar_period"  # Due by end of calendar period (e.g., Dec 31st)
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
    WITHDRAWN = "withdrawn"


class RequirementProgressStatus(str, enum.Enum):
    """Status of requirement progress"""
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    VERIFIED = "verified"  # Completed and verified by officer


class TrainingCategory(Base):
    """
    Training Category model

    Defines categories that training sessions can be applied towards.
    Examples: Fire Training, EMS Training, Driver Training, Officer Development, etc.
    Training hours can count towards multiple categories.
    """

    __tablename__ = "training_categories"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Category Details
    name = Column(String(255), nullable=False)
    code = Column(String(50))  # Short code like "FIRE", "EMS", "DRIVER"
    description = Column(Text)
    color = Column(String(7))  # Hex color for UI display, e.g., "#FF5733"

    # Parent Category (for hierarchical categories)
    parent_category_id = Column(String(36), ForeignKey("training_categories.id", ondelete="SET NULL"), nullable=True)

    # Requirements can link to this category
    # When training is completed in this category, it counts towards requirements linked to it

    # Display Settings
    sort_order = Column(Integer, default=0)
    icon = Column(String(50))  # Icon name for UI

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    subcategories = relationship("TrainingCategory", backref="parent_category", remote_side=[id])

    __table_args__ = (
        Index('idx_category_org_code', 'organization_id', 'code'),
        Index('idx_category_parent', 'parent_category_id'),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Course Information
    name = Column(String(255), nullable=False)
    code = Column(String(50))  # Course code like "FF1", "EMT-B", etc.
    description = Column(Text)
    training_type = Column(Enum(TrainingType), nullable=False)

    # Duration and Credits
    duration_hours = Column(Float)  # How long the course takes
    credit_hours = Column(Float)  # How many training hours it's worth

    # Requirements
    prerequisites = Column(JSON)  # List of prerequisite course IDs
    expiration_months = Column(Integer)  # How long before recertification needed (null = doesn't expire)

    # Course Details
    instructor = Column(String(255))
    max_participants = Column(Integer)
    materials_required = Column(JSON)  # List of required materials

    # Categories - training can count towards multiple categories
    category_ids = Column(JSON)  # List of TrainingCategory IDs this course counts towards

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(String(36), ForeignKey("training_courses.id", ondelete="SET NULL"))

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
    attachments = Column(JSON)  # List of file URLs or references

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

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

    Defines training requirements for the organization or specific roles.
    Can be sourced from department, state, or national registries.
    """

    __tablename__ = "training_requirements"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Requirement Details
    name = Column(String(255), nullable=False)
    description = Column(Text)
    requirement_type = Column(Enum(RequirementType), nullable=False)  # hours, courses, certification, etc.
    training_type = Column(Enum(TrainingType))  # certification, continuing_education, etc.

    # Source Information
    source = Column(Enum(RequirementSource), nullable=False, default=RequirementSource.DEPARTMENT)
    registry_name = Column(String(100))  # e.g., "NFPA", "NREMT", "Pro Board", state name
    registry_code = Column(String(50))  # e.g., "NFPA 1001", "EMR"
    is_editable = Column(Boolean, default=True)  # Department can override registry requirements

    # Requirement Quantities (based on requirement_type)
    required_hours = Column(Float)  # For HOURS type
    required_courses = Column(JSON)  # For COURSES type - list of course IDs
    required_shifts = Column(Integer)  # For SHIFTS type
    required_calls = Column(Integer)  # For CALLS type
    required_call_types = Column(JSON)  # Specific incident types required
    required_skills = Column(JSON)  # For SKILLS_EVALUATION type - skill IDs
    checklist_items = Column(JSON)  # For CHECKLIST type - list of items

    # Frequency
    frequency = Column(Enum(RequirementFrequency), nullable=False)
    year = Column(Integer)  # For annual requirements

    # Due Date Calculation Type
    due_date_type = Column(Enum(DueDateType), default=DueDateType.CALENDAR_PERIOD)
    # - CALENDAR_PERIOD: Due by end of calendar period (e.g., Dec 31st for annual)
    # - ROLLING: Due X months from last completion
    # - CERTIFICATION_PERIOD: Due when certification expires
    # - FIXED_DATE: Due by a specific fixed date

    # Rolling Period (for ROLLING due_date_type)
    rolling_period_months = Column(Integer)  # Number of months between required completions

    # Calendar Period Settings (for CALENDAR_PERIOD)
    period_start_month = Column(Integer, default=1)  # Month the period starts (1=January)
    period_start_day = Column(Integer, default=1)  # Day the period starts

    # Categories - which training categories count towards this requirement
    category_ids = Column(JSON)  # List of TrainingCategory IDs that satisfy this requirement

    # Applicability
    applies_to_all = Column(Boolean, default=True)
    required_roles = Column(JSON)  # List of role slugs this applies to (if not all)
    required_positions = Column(JSON)  # Positions: probationary, driver_candidate, officer, aic, etc.

    # Deadlines
    start_date = Column(Date)
    due_date = Column(Date)
    time_limit_days = Column(Integer)  # Days to complete from enrollment/assignment

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index('idx_requirement_org_source', 'organization_id', 'source'),
        Index('idx_requirement_type', 'requirement_type'),
        Index('idx_requirement_due', 'due_date'),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Links to Event and Course
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    course_id = Column(String(36), ForeignKey("training_courses.id", ondelete="SET NULL"), nullable=True)

    # Training Details (stored here for quick access)
    course_name = Column(String(255), nullable=False)
    course_code = Column(String(50))
    training_type = Column(Enum(TrainingType), nullable=False)
    credit_hours = Column(Float, nullable=False)
    instructor = Column(String(255))

    # Certification Details
    issues_certification = Column(Boolean, default=False)
    certification_number_prefix = Column(String(50))  # Prefix for auto-generated cert numbers
    issuing_agency = Column(String(255))
    expiration_months = Column(Integer)

    # Auto-completion Settings
    auto_create_records = Column(Boolean, default=True)  # Create TrainingRecord on check-in
    require_completion_confirmation = Column(Boolean, default=False)  # Instructor must confirm completion

    # Approval Settings
    approval_required = Column(Boolean, default=True)  # Require training officer approval
    approval_deadline_days = Column(Integer, default=7)  # Days to approve after event ends

    # Status
    is_finalized = Column(Boolean, default=False)  # Event ended, approval workflow triggered
    finalized_at = Column(DateTime(timezone=True))
    finalized_by = Column(String(36), ForeignKey("users.id"))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index('idx_training_session_event', 'event_id'),
        Index('idx_training_session_org', 'organization_id'),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Links
    training_session_id = Column(String(36), ForeignKey("training_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)

    # Approval Token (for email link)
    approval_token = Column(String(64), unique=True, nullable=False, index=True)  # Random token for secure access
    token_expires_at = Column(DateTime(timezone=True), nullable=False)  # Token expiration

    # Approval Details
    status = Column(Enum(ApprovalStatus), default=ApprovalStatus.PENDING, index=True)
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
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('idx_approval_session', 'training_session_id'),
        Index('idx_approval_status', 'status'),
        Index('idx_approval_token', 'approval_token'),
        Index('idx_approval_deadline', 'approval_deadline'),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Program Details
    name = Column(String(255), nullable=False)
    description = Column(Text)
    code = Column(String(50))  # e.g., "PROB-2024", "DRIVER-CERT"
    version = Column(Integer, default=1)  # Version number for template duplication

    # Target Audience
    target_position = Column(String(100))  # probationary, driver_candidate, officer, aic, etc.
    target_roles = Column(JSON)  # Role slugs this program applies to

    # Structure
    structure_type = Column(Enum(ProgramStructureType), nullable=False, default=ProgramStructureType.FLEXIBLE)

    # Prerequisites
    prerequisite_program_ids = Column(JSON)  # Programs that must be completed before enrollment

    # Enrollment Settings
    allows_concurrent_enrollment = Column(Boolean, default=True)  # Can member be in multiple programs

    # Time Limits
    time_limit_days = Column(Integer)  # Overall program completion deadline
    warning_days_before = Column(Integer, default=30)  # Send warning X days before deadline

    # Reminder Settings
    reminder_conditions = Column(JSON)  # Conditional reminder rules
    # Example: {"milestone_threshold": 50, "days_before_deadline": 90, "send_if_below_percentage": 40}

    # Status
    active = Column(Boolean, default=True, index=True)
    is_template = Column(Boolean, default=False)  # Can be used as template for new programs

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    phases = relationship("ProgramPhase", back_populates="program", cascade="all, delete-orphan", order_by="ProgramPhase.phase_number")
    enrollments = relationship("ProgramEnrollment", back_populates="program", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_program_org_active', 'organization_id', 'active'),
        Index('idx_program_position', 'target_position'),
    )

    def __repr__(self):
        return f"<TrainingProgram(name={self.name}, structure={self.structure_type})>"


class ProgramPhase(Base):
    """
    Program Phase model

    Represents a phase/stage within a training program.
    """

    __tablename__ = "program_phases"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    program_id = Column(String(36), ForeignKey("training_programs.id", ondelete="CASCADE"), nullable=False, index=True)

    # Phase Details
    phase_number = Column(Integer, nullable=False)  # Order in program
    name = Column(String(255), nullable=False)
    description = Column(Text)

    # Prerequisites
    prerequisite_phase_ids = Column(JSON)  # Phases that must be completed first

    # Advancement Settings
    requires_manual_advancement = Column(Boolean, default=False)  # Officer must approve advancement to next phase

    # Time Limits
    time_limit_days = Column(Integer)  # Deadline from phase start

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    program = relationship("TrainingProgram", back_populates="phases")
    requirements = relationship("ProgramRequirement", back_populates="phase", cascade="all, delete-orphan")
    milestones = relationship("ProgramMilestone", back_populates="phase", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_phase_program', 'program_id', 'phase_number'),
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
    program_id = Column(String(36), ForeignKey("training_programs.id", ondelete="CASCADE"), nullable=False, index=True)
    phase_id = Column(String(36), ForeignKey("program_phases.id", ondelete="CASCADE"), nullable=True, index=True)  # Null if not phase-based
    requirement_id = Column(String(36), ForeignKey("training_requirements.id", ondelete="CASCADE"), nullable=False, index=True)

    # Requirement Settings
    is_required = Column(Boolean, default=True)  # Required vs optional
    is_prerequisite = Column(Boolean, default=False)  # Must complete before other requirements
    sort_order = Column(Integer, default=0)  # Display order within program/phase

    # Program-Specific Customization
    program_specific_description = Column(Text)  # Override/supplement the requirement description
    custom_deadline_days = Column(Integer)  # Override requirement's default time_limit_days

    # Notification Message
    notification_message = Column(Text)  # Custom message when assigned this requirement

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    phase = relationship("ProgramPhase", back_populates="requirements")
    requirement = relationship("TrainingRequirement")

    __table_args__ = (
        Index('idx_prog_req_program', 'program_id'),
        Index('idx_prog_req_phase', 'phase_id'),
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
    program_id = Column(String(36), ForeignKey("training_programs.id", ondelete="CASCADE"), nullable=False, index=True)
    phase_id = Column(String(36), ForeignKey("program_phases.id", ondelete="CASCADE"), nullable=True, index=True)

    # Milestone Details
    name = Column(String(255), nullable=False)
    description = Column(Text)

    # Trigger
    completion_percentage_threshold = Column(Float)  # Trigger at X% complete (e.g., 50.0)

    # Notification
    notification_message = Column(Text)  # Message to display/send when milestone reached

    # Verification
    requires_verification = Column(Boolean, default=False)  # Officer must verify
    verification_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    phase = relationship("ProgramPhase", back_populates="milestones")

    __table_args__ = (
        Index('idx_milestone_program', 'program_id'),
    )

    def __repr__(self):
        return f"<ProgramMilestone(name={self.name}, threshold={self.completion_percentage_threshold})>"


class ProgramEnrollment(Base):
    """
    Program Enrollment model

    Tracks member enrollment in training programs.
    """

    __tablename__ = "program_enrollments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    program_id = Column(String(36), ForeignKey("training_programs.id", ondelete="CASCADE"), nullable=False, index=True)

    # Enrollment Details
    enrolled_at = Column(DateTime(timezone=True), nullable=False, default=func.now())
    target_completion_date = Column(Date)  # Calculated from time_limit_days

    # Current Progress
    current_phase_id = Column(String(36), ForeignKey("program_phases.id", ondelete="SET NULL"), nullable=True)
    progress_percentage = Column(Float, default=0.0)  # Overall program completion percentage

    # Status
    status = Column(Enum(EnrollmentStatus), default=EnrollmentStatus.ACTIVE, index=True)
    completed_at = Column(DateTime(timezone=True))
    withdrawn_at = Column(DateTime(timezone=True))
    withdrawal_reason = Column(Text)

    # Deadline Tracking
    deadline_warning_sent = Column(Boolean, default=False)
    deadline_warning_sent_at = Column(DateTime(timezone=True))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    enrolled_by = Column(String(36), ForeignKey("users.id"))  # Who enrolled the member

    # Relationships
    program = relationship("TrainingProgram", back_populates="enrollments")
    requirement_progress = relationship("RequirementProgress", back_populates="enrollment", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_enrollment_user', 'user_id', 'status'),
        Index('idx_enrollment_program', 'program_id', 'status'),
        Index('idx_enrollment_deadline', 'target_completion_date'),
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
    enrollment_id = Column(String(36), ForeignKey("program_enrollments.id", ondelete="CASCADE"), nullable=False, index=True)
    requirement_id = Column(String(36), ForeignKey("training_requirements.id", ondelete="CASCADE"), nullable=False, index=True)

    # Progress Tracking
    status = Column(Enum(RequirementProgressStatus), default=RequirementProgressStatus.NOT_STARTED, index=True)
    progress_value = Column(Float, default=0.0)  # Hours completed, calls responded, etc.
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
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    enrollment = relationship("ProgramEnrollment", back_populates="requirement_progress")

    __table_args__ = (
        Index('idx_progress_enrollment', 'enrollment_id', 'status'),
        Index('idx_progress_requirement', 'requirement_id'),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Skill Details
    name = Column(String(255), nullable=False)
    description = Column(Text)
    category = Column(String(100))  # e.g., "Firefighting", "EMS", "Driver", "Officer"

    # Evaluation Criteria
    evaluation_criteria = Column(JSON)  # List of criteria to evaluate
    passing_requirements = Column(Text)  # What constitutes passing

    # Linked Programs
    required_for_programs = Column(JSON)  # Program IDs that require this skill

    # Status
    active = Column(Boolean, default=True, index=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index('idx_skill_org_category', 'organization_id', 'category'),
    )

    def __repr__(self):
        return f"<SkillEvaluation(name={self.name}, category={self.category})>"


class SkillCheckoff(Base):
    """
    Skill Checkoff model

    Records individual skill evaluations.
    """

    __tablename__ = "skill_checkoffs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    skill_evaluation_id = Column(String(36), ForeignKey("skill_evaluations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Evaluation Details
    evaluator_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    status = Column(String(20), nullable=False)  # pending, passed, failed

    # Results
    evaluation_results = Column(JSON)  # Detailed results for each criterion
    score = Column(Float)  # Overall score if applicable
    notes = Column(Text)

    # Timestamps
    evaluated_at = Column(DateTime(timezone=True), default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index('idx_checkoff_user', 'user_id'),
        Index('idx_checkoff_skill', 'skill_evaluation_id'),
    )

    def __repr__(self):
        return f"<SkillCheckoff(user_id={self.user_id}, skill_id={self.skill_evaluation_id}, status={self.status})>"


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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Shift Details
    shift_date = Column(Date, nullable=False, index=True)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True))

    # Assignment
    apparatus_id = Column(String(36))  # Link to apparatus (future)
    station_id = Column(String(36))  # Link to station (future)

    # Leadership
    shift_officer_id = Column(String(36), ForeignKey("users.id"))

    # Notes
    notes = Column(Text)
    activities = Column(JSON)  # Training, station duties, etc.

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index('idx_shift_date', 'organization_id', 'shift_date'),
    )

    def __repr__(self):
        return f"<Shift(date={self.shift_date}, officer={self.shift_officer_id})>"


class ShiftAttendance(Base):
    """
    Shift Attendance model (Framework)

    Tracks individual member attendance on shifts.
    """

    __tablename__ = "shift_attendance"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    shift_id = Column(String(36), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Timing
    checked_in_at = Column(DateTime(timezone=True))
    checked_out_at = Column(DateTime(timezone=True))
    duration_minutes = Column(Integer)  # Calculated

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index('idx_shift_att_shift', 'shift_id'),
        Index('idx_shift_att_user', 'user_id'),
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
    shift_id = Column(String(36), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Incident Details
    incident_number = Column(String(100))
    incident_type = Column(String(100), index=True)  # Structure fire, medical, MVA, etc.

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
        Index('idx_call_shift', 'shift_id'),
        Index('idx_call_type', 'incident_type'),
    )

    def __repr__(self):
        return f"<ShiftCall(incident={self.incident_number}, type={self.incident_type})>"
