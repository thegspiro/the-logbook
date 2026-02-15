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

from app.core.utils import generate_uuid

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
    training_type = Column(Enum(TrainingType, values_callable=lambda x: [e.value for e in x]), nullable=False)

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
    training_type = Column(Enum(TrainingType, values_callable=lambda x: [e.value for e in x]), nullable=False)

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
    status = Column(Enum(TrainingStatus, values_callable=lambda x: [e.value for e in x]), default=TrainingStatus.SCHEDULED, index=True)
    score = Column(Float)  # Percentage or points
    passing_score = Column(Float)
    passed = Column(Boolean)

    # Instructor and Location
    instructor = Column(String(255))
    location = Column(String(255))

    # Additional Information
    notes = Column(Text)
    attachments = Column(JSON)  # List of file URLs or references

    # Certification expiration alert tracking — records when each tier was sent
    alert_90_sent_at = Column(DateTime, nullable=True)
    alert_60_sent_at = Column(DateTime, nullable=True)
    alert_30_sent_at = Column(DateTime, nullable=True)
    alert_7_sent_at = Column(DateTime, nullable=True)
    escalation_sent_at = Column(DateTime, nullable=True)  # CC to training/compliance officers

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
    requirement_type = Column(Enum(RequirementType, values_callable=lambda x: [e.value for e in x]), nullable=False)  # hours, courses, certification, etc.
    training_type = Column(Enum(TrainingType, values_callable=lambda x: [e.value for e in x]))  # certification, continuing_education, etc.

    # Source Information
    source = Column(Enum(RequirementSource, values_callable=lambda x: [e.value for e in x]), nullable=False, default=RequirementSource.DEPARTMENT)
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
    frequency = Column(Enum(RequirementFrequency, values_callable=lambda x: [e.value for e in x]), nullable=False)
    year = Column(Integer)  # For annual requirements

    # Due Date Calculation Type
    due_date_type = Column(Enum(DueDateType, values_callable=lambda x: [e.value for e in x]), default=DueDateType.CALENDAR_PERIOD)
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

    # Category and Program linkage — connects this session to the training pipeline
    category_id = Column(String(36), ForeignKey("training_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    program_id = Column(String(36), ForeignKey("training_programs.id", ondelete="SET NULL"), nullable=True, index=True)
    phase_id = Column(String(36), ForeignKey("program_phases.id", ondelete="SET NULL"), nullable=True)
    requirement_id = Column(String(36), ForeignKey("training_requirements.id", ondelete="SET NULL"), nullable=True)

    # Training Details (stored here for quick access)
    course_name = Column(String(255), nullable=False)
    course_code = Column(String(50))
    training_type = Column(Enum(TrainingType, values_callable=lambda x: [e.value for e in x]), nullable=False)
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

    # Relationships
    event = relationship("Event", foreign_keys=[event_id], lazy="select")
    course = relationship("TrainingCourse", foreign_keys=[course_id], lazy="select")

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
    status = Column(Enum(ApprovalStatus, values_callable=lambda x: [e.value for e in x]), default=ApprovalStatus.PENDING, index=True)
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
    structure_type = Column(Enum(ProgramStructureType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ProgramStructureType.FLEXIBLE)

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
    status = Column(Enum(EnrollmentStatus, values_callable=lambda x: [e.value for e in x]), default=EnrollmentStatus.ACTIVE, index=True)
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
    current_phase = relationship("ProgramPhase", foreign_keys=[current_phase_id])
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
    status = Column(Enum(RequirementProgressStatus, values_callable=lambda x: [e.value for e in x]), default=RequirementProgressStatus.NOT_STARTED, index=True)
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

    # Configurable evaluator permissions — training officer/chief sets who may sign off
    # Format: {"type": "roles", "roles": ["shift_leader", "driver_trainer"]}
    #      or {"type": "specific_users", "user_ids": ["uuid1", "uuid2"]}
    #      or null → any user with training.manage permission
    allowed_evaluators = Column(JSON, nullable=True)

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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Shift context
    shift_id = Column(String(36), ForeignKey("shifts.id", ondelete="SET NULL"), nullable=True)
    shift_date = Column(Date, nullable=False)

    # People
    trainee_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    officer_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Shift details
    hours_on_shift = Column(Float, nullable=False)
    calls_responded = Column(Integer, default=0)
    call_types = Column(JSON)  # Array of incident types responded to

    # Performance observations
    performance_rating = Column(Integer)  # 1-5 scale
    areas_of_strength = Column(Text)
    areas_for_improvement = Column(Text)
    officer_narrative = Column(Text)  # Free-form description of the shift experience

    # Skills observed
    skills_observed = Column(JSON)  # Array of { skill_name, demonstrated: bool, notes }
    tasks_performed = Column(JSON)  # Array of { task, description }

    # Pipeline linkage
    enrollment_id = Column(String(36), ForeignKey("program_enrollments.id", ondelete="SET NULL"), nullable=True)
    requirements_progressed = Column(JSON)  # Array of { requirement_progress_id, value_added }

    # Trainee acknowledgment
    trainee_acknowledged = Column(Boolean, default=False)
    trainee_acknowledged_at = Column(DateTime(timezone=True))
    trainee_comments = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('idx_shift_report_trainee', 'trainee_id', 'shift_date'),
        Index('idx_shift_report_officer', 'officer_id'),
        Index('idx_shift_report_enrollment', 'enrollment_id'),
        Index('idx_shift_report_org_date', 'organization_id', 'shift_date'),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"),
                             nullable=False, unique=True, index=True)

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
    show_officer_narrative = Column(Boolean, default=False)  # Officer narrative on shift reports
    show_performance_rating = Column(Boolean, default=True)  # 1-5 star ratings
    show_areas_of_strength = Column(Boolean, default=True)
    show_areas_for_improvement = Column(Boolean, default=True)
    show_skills_observed = Column(Boolean, default=True)

    # Self-reported submissions
    show_submission_history = Column(Boolean, default=True)

    # Reports access
    allow_member_report_export = Column(Boolean, default=False)  # Can members download their own data

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)

    # Approval Settings
    require_approval = Column(Boolean, default=True)  # Require training officer approval
    auto_approve_under_hours = Column(Float, nullable=True)  # Auto-approve if under X hours (null = never auto-approve)
    approval_deadline_days = Column(Integer, default=14)  # Days officers have to review

    # Notification Settings
    notify_officer_on_submit = Column(Boolean, default=True)  # Email training officer when submission arrives
    notify_member_on_decision = Column(Boolean, default=True)  # Email member when approved/rejected

    # Field Configuration (JSON)
    # Each key is a field name, value is { "visible": bool, "required": bool, "label": str }
    # e.g. {"course_name": {"visible": true, "required": true, "label": "Course/Class Name"}, ...}
    field_config = Column(JSON, nullable=False, default=lambda: {
        "course_name": {"visible": True, "required": True, "label": "Course / Class Name"},
        "training_type": {"visible": True, "required": True, "label": "Training Type"},
        "completion_date": {"visible": True, "required": True, "label": "Date Completed"},
        "hours_completed": {"visible": True, "required": True, "label": "Hours Completed"},
        "credit_hours": {"visible": True, "required": False, "label": "Credit Hours"},
        "instructor": {"visible": True, "required": False, "label": "Instructor Name"},
        "location": {"visible": True, "required": False, "label": "Location / Facility"},
        "description": {"visible": True, "required": False, "label": "Description / Notes"},
        "category_id": {"visible": True, "required": False, "label": "Training Category"},
        "certification_number": {"visible": True, "required": False, "label": "Certificate / ID Number"},
        "issuing_agency": {"visible": True, "required": False, "label": "Issuing Agency"},
        "attachments": {"visible": True, "required": False, "label": "Supporting Documents"},
    })

    # Allowed training types for self-reporting (null = all types allowed)
    allowed_training_types = Column(JSON, nullable=True)

    # Maximum hours per submission (null = no limit)
    max_hours_per_submission = Column(Float, nullable=True)

    # Instructions displayed to members
    member_instructions = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    submitted_by = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Training Details
    course_name = Column(String(255), nullable=False)
    course_code = Column(String(50))
    training_type = Column(Enum(TrainingType, values_callable=lambda x: [e.value for e in x]), nullable=False)
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
    category_id = Column(String(36), ForeignKey("training_categories.id", ondelete="SET NULL"), nullable=True)

    # Supporting Documents
    attachments = Column(JSON)  # List of file URLs or references

    # Submission Status
    status = Column(Enum(SubmissionStatus, values_callable=lambda x: [e.value for e in x]),
                    default=SubmissionStatus.PENDING_REVIEW, nullable=False, index=True)

    # Review Details
    reviewed_by = Column(String(36), ForeignKey("users.id"))
    reviewed_at = Column(DateTime(timezone=True))
    reviewer_notes = Column(Text)  # Officer notes on approval/rejection

    # Link to created TrainingRecord (populated on approval)
    training_record_id = Column(String(36), ForeignKey("training_records.id", ondelete="SET NULL"), nullable=True)

    # Timestamps
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    training_record = relationship("TrainingRecord")

    __table_args__ = (
        Index('idx_submission_org_status', 'organization_id', 'status'),
        Index('idx_submission_user', 'submitted_by', 'status'),
        Index('idx_submission_date', 'completion_date'),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Provider Details
    name = Column(String(255), nullable=False)  # Display name: "Vector Solutions", "Target Solutions"
    provider_type = Column(Enum(ExternalProviderType, values_callable=lambda x: [e.value for e in x]), nullable=False)
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
    default_category_id = Column(String(36), ForeignKey("training_categories.id", ondelete="SET NULL"))

    # Status
    active = Column(Boolean, default=True, index=True)
    connection_verified = Column(Boolean, default=False)
    last_connection_test = Column(DateTime(timezone=True))
    connection_error = Column(Text)  # Last connection error message

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    category_mappings = relationship("ExternalCategoryMapping", back_populates="provider", cascade="all, delete-orphan")
    sync_history = relationship("ExternalTrainingSyncLog", back_populates="provider", cascade="all, delete-orphan")
    imported_records = relationship("ExternalTrainingImport", back_populates="provider", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_ext_provider_org', 'organization_id', 'active'),
        Index('idx_ext_provider_type', 'provider_type'),
    )

    def __repr__(self):
        return f"<ExternalTrainingProvider(name={self.name}, type={self.provider_type})>"


class ExternalCategoryMapping(Base):
    """
    External Category Mapping model

    Maps categories from external training platforms to internal TrainingCategories.
    """

    __tablename__ = "external_category_mappings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    provider_id = Column(String(36), ForeignKey("external_training_providers.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # External Category Info
    external_category_id = Column(String(255), nullable=False)  # ID from external system
    external_category_name = Column(String(255), nullable=False)  # Name from external system
    external_category_code = Column(String(100))  # Code from external system (if available)

    # Internal Category Mapping
    internal_category_id = Column(String(36), ForeignKey("training_categories.id", ondelete="SET NULL"))

    # Mapping Status
    is_mapped = Column(Boolean, default=False)  # Has been mapped to internal category
    auto_mapped = Column(Boolean, default=False)  # Was mapped automatically vs manually

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    mapped_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    provider = relationship("ExternalTrainingProvider", back_populates="category_mappings")
    internal_category = relationship("TrainingCategory")

    __table_args__ = (
        Index('idx_ext_mapping_provider', 'provider_id'),
        Index('idx_ext_mapping_external', 'provider_id', 'external_category_id'),
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
    provider_id = Column(String(36), ForeignKey("external_training_providers.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

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
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    mapped_by = Column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        Index('idx_ext_user_provider', 'provider_id'),
        Index('idx_ext_user_external', 'provider_id', 'external_user_id'),
        Index('idx_ext_user_internal', 'internal_user_id'),
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
    provider_id = Column(String(36), ForeignKey("external_training_providers.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Sync Details
    sync_type = Column(String(50), nullable=False)  # full, incremental, manual
    status = Column(Enum(SyncStatus, values_callable=lambda x: [e.value for e in x]), default=SyncStatus.PENDING, index=True)

    # Timing
    started_at = Column(DateTime(timezone=True), default=func.now())
    completed_at = Column(DateTime(timezone=True))

    # Results
    records_fetched = Column(Integer, default=0)  # Records retrieved from external system
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
        Index('idx_sync_log_provider', 'provider_id', 'status'),
        Index('idx_sync_log_date', 'started_at'),
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
    provider_id = Column(String(36), ForeignKey("external_training_providers.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    sync_log_id = Column(String(36), ForeignKey("external_training_sync_logs.id", ondelete="SET NULL"), index=True)

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
    training_record_id = Column(String(36), ForeignKey("training_records.id", ondelete="SET NULL"), index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), index=True)  # Mapped internal user

    # Import Status
    import_status = Column(String(50), default="pending", index=True)  # pending, imported, failed, skipped, duplicate
    import_error = Column(Text)
    imported_at = Column(DateTime(timezone=True))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    provider = relationship("ExternalTrainingProvider", back_populates="imported_records")
    training_record = relationship("TrainingRecord")

    __table_args__ = (
        Index('idx_ext_import_provider', 'provider_id', 'import_status'),
        Index('idx_ext_import_external', 'provider_id', 'external_record_id'),
        Index('idx_ext_import_user', 'user_id'),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(200), nullable=False)
    description = Column(Text)
    start_time_of_day = Column(String(5), nullable=False)  # "07:00" HH:MM format
    end_time_of_day = Column(String(5), nullable=False)    # "19:00"
    duration_hours = Column(Float, nullable=False)          # 12.0
    color = Column(String(7))                               # Hex color for calendar display

    # Staffing
    positions = Column(JSON)  # [{"position": "officer", "count": 1}, {"position": "firefighter", "count": 3}]
    min_staffing = Column(Integer, default=1)

    # Defaults
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        Index('idx_shift_template_org', 'organization_id'),
    )

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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(200), nullable=False)
    description = Column(Text)
    pattern_type = Column(Enum(PatternType), nullable=False, default=PatternType.WEEKLY)

    # Pattern definition
    template_id = Column(String(36), ForeignKey("shift_templates.id", ondelete="SET NULL"))
    rotation_days = Column(Integer)          # Days in the rotation cycle (e.g., 3 for platoon A/B/C)
    days_on = Column(Integer)                # Days on duty per cycle
    days_off = Column(Integer)               # Days off per cycle
    schedule_config = Column(JSON)           # Flexible config: {"platoons": ["A","B","C"], "weekdays": [0,1,2,3,4]}

    # Active period
    start_date = Column(Date, nullable=False)
    end_date = Column(Date)                  # Null = indefinite

    # Members assigned to this pattern
    assigned_members = Column(JSON)  # [{"user_id": "...", "platoon": "A", "position": "firefighter"}]

    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        Index('idx_shift_pattern_org', 'organization_id'),
    )

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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    shift_id = Column(String(36), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    position = Column(Enum(ShiftPosition), nullable=False, default=ShiftPosition.FIREFIGHTER)
    assignment_status = Column(Enum(AssignmentStatus), nullable=False, default=AssignmentStatus.ASSIGNED)

    # Tracking
    assigned_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    confirmed_at = Column(DateTime(timezone=True))
    notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('idx_shift_assign_shift', 'shift_id'),
        Index('idx_shift_assign_user', 'user_id'),
        Index('idx_shift_assign_org', 'organization_id'),
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
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # The member requesting the swap
    requesting_user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # The shift they want to give up
    offering_shift_id = Column(String(36), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False)
    # The shift they want to pick up (optional — can be open request)
    requesting_shift_id = Column(String(36), ForeignKey("shifts.id", ondelete="SET NULL"))
    # The member they want to swap with (optional — can be open request)
    target_user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    status = Column(Enum(SwapRequestStatus), nullable=False, default=SwapRequestStatus.PENDING)
    reason = Column(Text)

    # Review
    reviewed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at = Column(DateTime(timezone=True))
    reviewer_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('idx_swap_req_org', 'organization_id'),
        Index('idx_swap_req_user', 'requesting_user_id'),
        Index('idx_swap_req_status', 'status'),
    )

    def __repr__(self):
        return f"<ShiftSwapRequest(user={self.requesting_user_id}, status={self.status})>"


# ============================================
# Shift Time-Off Request
# ============================================

class ShiftTimeOff(Base):
    """
    Member request for time off / unavailability.
    """

    __tablename__ = "shift_time_off"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    reason = Column(Text)

    status = Column(Enum(TimeOffStatus), nullable=False, default=TimeOffStatus.PENDING)
    approved_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    approved_at = Column(DateTime(timezone=True))
    reviewer_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('idx_timeoff_org', 'organization_id'),
        Index('idx_timeoff_user', 'user_id'),
        Index('idx_timeoff_dates', 'start_date', 'end_date'),
    )

    def __repr__(self):
        return f"<ShiftTimeOff(user={self.user_id}, {self.start_date} - {self.end_date})>"
