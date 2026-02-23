"""
Comprehensive Tests for Training Module

Tests cover:
1. Enum definitions and values
2. SQLAlchemy model instantiation
3. Pydantic schema validation
4. Registry JSON data integrity
5. Seed data module imports
"""

import pytest
import json
from pathlib import Path
from uuid import uuid4
from datetime import date, datetime

from app.models.training import (
    TrainingCategory, TrainingCourse, TrainingRecord, TrainingRequirement,
    TrainingSession, TrainingApproval, TrainingProgram, ProgramPhase,
    ProgramRequirement, ProgramMilestone, ProgramEnrollment, RequirementProgress,
    SkillEvaluation, SkillCheckoff, ExternalTrainingProvider,
    TrainingStatus, TrainingType, RequirementType, RequirementSource,
    RequirementFrequency, DueDateType, ProgramStructureType, EnrollmentStatus,
    RequirementProgressStatus, ApprovalStatus, ExternalProviderType, SyncStatus,
)
from app.schemas.training import (
    TrainingCategoryCreate, TrainingCourseCreate, TrainingRecordCreate,
    TrainingRequirementCreate,
)
from app.schemas.training_program import (
    TrainingRequirementEnhancedCreate, TrainingProgramCreate,
    ProgramEnrollmentCreate,
)


# ============================================
# 1. Enum Tests (no database needed)
# ============================================


class TestTrainingEnums:
    """Test training enum definitions and values"""

    def test_training_status_values(self):
        """Verify all TrainingStatus enum values exist"""
        assert TrainingStatus.SCHEDULED.value == "scheduled"
        assert TrainingStatus.IN_PROGRESS.value == "in_progress"
        assert TrainingStatus.COMPLETED.value == "completed"
        assert TrainingStatus.CANCELLED.value == "cancelled"
        assert TrainingStatus.FAILED.value == "failed"
        assert len(TrainingStatus) == 5

    def test_training_type_values(self):
        """Verify all TrainingType enum values"""
        assert TrainingType.CERTIFICATION.value == "certification"
        assert TrainingType.CONTINUING_EDUCATION.value == "continuing_education"
        assert TrainingType.SKILLS_PRACTICE.value == "skills_practice"
        assert TrainingType.ORIENTATION.value == "orientation"
        assert TrainingType.REFRESHER.value == "refresher"
        assert TrainingType.SPECIALTY.value == "specialty"
        assert len(TrainingType) == 6

    def test_requirement_type_values(self):
        """Verify all RequirementType enum values"""
        assert RequirementType.HOURS.value == "hours"
        assert RequirementType.COURSES.value == "courses"
        assert RequirementType.CERTIFICATION.value == "certification"
        assert RequirementType.SHIFTS.value == "shifts"
        assert RequirementType.CALLS.value == "calls"
        assert RequirementType.SKILLS_EVALUATION.value == "skills_evaluation"
        assert RequirementType.CHECKLIST.value == "checklist"
        assert RequirementType.KNOWLEDGE_TEST.value == "knowledge_test"
        assert len(RequirementType) == 8

    def test_requirement_source_values(self):
        """Verify RequirementSource values"""
        assert RequirementSource.DEPARTMENT.value == "department"
        assert RequirementSource.STATE.value == "state"
        assert RequirementSource.NATIONAL.value == "national"
        assert len(RequirementSource) == 3

    def test_requirement_frequency_values(self):
        """Verify RequirementFrequency values"""
        assert RequirementFrequency.ANNUAL.value == "annual"
        assert RequirementFrequency.BIANNUAL.value == "biannual"
        assert RequirementFrequency.QUARTERLY.value == "quarterly"
        assert RequirementFrequency.MONTHLY.value == "monthly"
        assert RequirementFrequency.ONE_TIME.value == "one_time"
        assert len(RequirementFrequency) == 5

    def test_due_date_type_values(self):
        """Verify DueDateType values"""
        assert DueDateType.CALENDAR_PERIOD.value == "calendar_period"
        assert DueDateType.ROLLING.value == "rolling"
        assert DueDateType.CERTIFICATION_PERIOD.value == "certification_period"
        assert DueDateType.FIXED_DATE.value == "fixed_date"
        assert len(DueDateType) == 4

    def test_program_structure_type_values(self):
        """Verify ProgramStructureType values"""
        assert ProgramStructureType.SEQUENTIAL.value == "sequential"
        assert ProgramStructureType.PHASES.value == "phases"
        assert ProgramStructureType.FLEXIBLE.value == "flexible"
        assert len(ProgramStructureType) == 3

    def test_enrollment_status_values(self):
        """Verify EnrollmentStatus values"""
        assert EnrollmentStatus.ACTIVE.value == "active"
        assert EnrollmentStatus.COMPLETED.value == "completed"
        assert EnrollmentStatus.EXPIRED.value == "expired"
        assert EnrollmentStatus.ON_HOLD.value == "on_hold"
        assert EnrollmentStatus.WITHDRAWN.value == "withdrawn"
        assert EnrollmentStatus.FAILED.value == "failed"
        assert len(EnrollmentStatus) == 6

    def test_requirement_progress_status_values(self):
        """Verify RequirementProgressStatus values"""
        assert RequirementProgressStatus.NOT_STARTED.value == "not_started"
        assert RequirementProgressStatus.IN_PROGRESS.value == "in_progress"
        assert RequirementProgressStatus.COMPLETED.value == "completed"
        assert RequirementProgressStatus.VERIFIED.value == "verified"
        assert RequirementProgressStatus.WAIVED.value == "waived"
        assert len(RequirementProgressStatus) == 5

    def test_approval_status_values(self):
        """Verify ApprovalStatus values"""
        assert ApprovalStatus.PENDING.value == "pending"
        assert ApprovalStatus.APPROVED.value == "approved"
        assert ApprovalStatus.MODIFIED.value == "modified"
        assert ApprovalStatus.REJECTED.value == "rejected"
        assert len(ApprovalStatus) == 4

    def test_external_provider_type_values(self):
        """Verify ExternalProviderType values"""
        assert ExternalProviderType.VECTOR_SOLUTIONS.value == "vector_solutions"
        assert ExternalProviderType.TARGET_SOLUTIONS.value == "target_solutions"
        assert ExternalProviderType.LEXIPOL.value == "lexipol"
        assert ExternalProviderType.I_AM_RESPONDING.value == "i_am_responding"
        assert ExternalProviderType.CUSTOM_API.value == "custom_api"
        assert len(ExternalProviderType) == 5

    def test_sync_status_values(self):
        """Verify SyncStatus values"""
        assert SyncStatus.PENDING.value == "pending"
        assert SyncStatus.IN_PROGRESS.value == "in_progress"
        assert SyncStatus.COMPLETED.value == "completed"
        assert SyncStatus.FAILED.value == "failed"
        assert SyncStatus.PARTIAL.value == "partial"
        assert len(SyncStatus) == 5

    def test_all_enums_are_lowercase(self):
        """Verify all enum values are lowercase strings (convention)"""
        all_enums = [
            TrainingStatus,
            TrainingType,
            RequirementType,
            RequirementSource,
            RequirementFrequency,
            DueDateType,
            ProgramStructureType,
            EnrollmentStatus,
            RequirementProgressStatus,
            ApprovalStatus,
            ExternalProviderType,
            SyncStatus,
        ]
        for enum_class in all_enums:
            for member in enum_class:
                assert member.value == member.value.lower(), (
                    f"{enum_class.__name__}.{member.name} has non-lowercase value: "
                    f"'{member.value}'"
                )
                assert isinstance(member.value, str), (
                    f"{enum_class.__name__}.{member.name} value is not a string"
                )

    def test_all_enums_inherit_from_str(self):
        """Verify all enums inherit from str for proper SQLAlchemy serialization"""
        all_enums = [
            TrainingStatus,
            TrainingType,
            RequirementType,
            RequirementSource,
            RequirementFrequency,
            DueDateType,
            ProgramStructureType,
            EnrollmentStatus,
            RequirementProgressStatus,
            ApprovalStatus,
            ExternalProviderType,
            SyncStatus,
        ]
        for enum_class in all_enums:
            assert issubclass(enum_class, str), (
                f"{enum_class.__name__} does not inherit from str"
            )

    def test_enum_values_are_unique_within_each_enum(self):
        """Verify no duplicate values within any single enum"""
        all_enums = [
            TrainingStatus,
            TrainingType,
            RequirementType,
            RequirementSource,
            RequirementFrequency,
            DueDateType,
            ProgramStructureType,
            EnrollmentStatus,
            RequirementProgressStatus,
            ApprovalStatus,
            ExternalProviderType,
            SyncStatus,
        ]
        for enum_class in all_enums:
            values = [member.value for member in enum_class]
            assert len(values) == len(set(values)), (
                f"{enum_class.__name__} has duplicate values: {values}"
            )


# ============================================
# 2. Model Instantiation Tests (no database needed)
# ============================================


class TestTrainingModelInstantiation:
    """Test that training models can be instantiated with valid data"""

    def test_create_training_category(self):
        """Create TrainingCategory instance, verify fields"""
        cat = TrainingCategory(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Fire Training",
            code="FIRE",
            description="All fire-related training",
            color="#FF5733",
            sort_order=1,
            icon="fire",
            active=True,
        )
        assert cat.name == "Fire Training"
        assert cat.code == "FIRE"
        assert cat.color == "#FF5733"
        assert cat.sort_order == 1
        assert cat.icon == "fire"
        assert cat.active is True

    def test_create_training_course(self):
        """Create TrainingCourse instance with all field types"""
        course = TrainingCourse(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Firefighter I",
            code="FF1",
            description="Basic firefighter training",
            training_type=TrainingType.CERTIFICATION,
            duration_hours=120.0,
            credit_hours=120.0,
            prerequisites=None,
            expiration_months=24,
            instructor="John Smith",
            max_participants=30,
            materials_required=["Turnout gear", "SCBA"],
            category_ids=[str(uuid4())],
            active=True,
        )
        assert course.name == "Firefighter I"
        assert course.code == "FF1"
        assert course.training_type == TrainingType.CERTIFICATION
        assert course.duration_hours == 120.0
        assert course.credit_hours == 120.0
        assert course.expiration_months == 24
        assert course.max_participants == 30
        assert course.materials_required == ["Turnout gear", "SCBA"]
        assert course.active is True

    def test_create_training_record(self):
        """Create TrainingRecord with status, scores, etc."""
        user_id = str(uuid4())
        record = TrainingRecord(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            user_id=user_id,
            course_id=str(uuid4()),
            course_name="CPR Certification",
            course_code="CPR",
            training_type=TrainingType.CERTIFICATION,
            scheduled_date=date(2025, 1, 15),
            completion_date=date(2025, 1, 15),
            expiration_date=date(2027, 1, 15),
            hours_completed=8.0,
            credit_hours=8.0,
            certification_number="CPR-2025-001",
            issuing_agency="AHA",
            status=TrainingStatus.COMPLETED,
            score=95.0,
            passing_score=80.0,
            passed=True,
            instructor="Jane Doe",
            location="Station 1",
            notes="Passed on first attempt",
            attachments=["cert.pdf"],
        )
        assert record.user_id == user_id
        assert record.course_name == "CPR Certification"
        assert record.training_type == TrainingType.CERTIFICATION
        assert record.status == TrainingStatus.COMPLETED
        assert record.score == 95.0
        assert record.passing_score == 80.0
        assert record.passed is True
        assert record.hours_completed == 8.0

    def test_create_training_requirement(self):
        """Create TrainingRequirement with various types"""
        req = TrainingRequirement(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Annual Fire Training Hours",
            description="Required annual fire training",
            requirement_type=RequirementType.HOURS,
            training_type=TrainingType.CONTINUING_EDUCATION,
            source=RequirementSource.NATIONAL,
            registry_name="NFPA",
            registry_code="NFPA 1001",
            is_editable=True,
            required_hours=36.0,
            frequency=RequirementFrequency.ANNUAL,
            year=2025,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            period_start_month=1,
            period_start_day=1,
            applies_to_all=False,
            required_positions=["firefighter", "driver"],
            active=True,
        )
        assert req.name == "Annual Fire Training Hours"
        assert req.requirement_type == RequirementType.HOURS
        assert req.source == RequirementSource.NATIONAL
        assert req.registry_name == "NFPA"
        assert req.required_hours == 36.0
        assert req.frequency == RequirementFrequency.ANNUAL
        assert req.due_date_type == DueDateType.CALENDAR_PERIOD
        assert req.applies_to_all is False

    def test_create_training_requirement_shifts_type(self):
        """Create TrainingRequirement with SHIFTS requirement type"""
        req = TrainingRequirement(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Minimum Shift Attendance",
            requirement_type=RequirementType.SHIFTS,
            source=RequirementSource.DEPARTMENT,
            required_shifts=12,
            frequency=RequirementFrequency.ANNUAL,
            applies_to_all=True,
            active=True,
        )
        assert req.requirement_type == RequirementType.SHIFTS
        assert req.required_shifts == 12

    def test_create_training_requirement_calls_type(self):
        """Create TrainingRequirement with CALLS requirement type"""
        req = TrainingRequirement(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Minimum Call Response",
            requirement_type=RequirementType.CALLS,
            source=RequirementSource.DEPARTMENT,
            required_calls=24,
            required_call_types=["structure_fire", "medical"],
            frequency=RequirementFrequency.ANNUAL,
            applies_to_all=True,
            active=True,
        )
        assert req.requirement_type == RequirementType.CALLS
        assert req.required_calls == 24
        assert req.required_call_types == ["structure_fire", "medical"]

    def test_create_training_requirement_checklist_type(self):
        """Create TrainingRequirement with CHECKLIST requirement type"""
        checklist = ["Medical exam", "Physical fitness test", "Vision test"]
        req = TrainingRequirement(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Annual Medical Fitness",
            requirement_type=RequirementType.CHECKLIST,
            source=RequirementSource.NATIONAL,
            checklist_items=checklist,
            frequency=RequirementFrequency.ANNUAL,
            applies_to_all=True,
            active=True,
        )
        assert req.requirement_type == RequirementType.CHECKLIST
        assert req.checklist_items == checklist

    def test_create_training_program(self):
        """Create TrainingProgram with structure type"""
        program = TrainingProgram(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Probationary Firefighter Program",
            description="12-month probationary program",
            code="PROB-2025",
            version=1,
            target_position="probationary",
            target_roles=None,
            structure_type=ProgramStructureType.PHASES,
            allows_concurrent_enrollment=False,
            time_limit_days=365,
            warning_days_before=30,
            active=True,
            is_template=False,
        )
        assert program.name == "Probationary Firefighter Program"
        assert program.code == "PROB-2025"
        assert program.structure_type == ProgramStructureType.PHASES
        assert program.time_limit_days == 365
        assert program.allows_concurrent_enrollment is False

    def test_create_program_phase(self):
        """Create ProgramPhase"""
        program_id = str(uuid4())
        phase = ProgramPhase(
            id=str(uuid4()),
            program_id=program_id,
            phase_number=1,
            name="Phase 1: Orientation",
            description="Initial orientation and onboarding",
            prerequisite_phase_ids=None,
            requires_manual_advancement=True,
            time_limit_days=30,
        )
        assert phase.program_id == program_id
        assert phase.phase_number == 1
        assert phase.name == "Phase 1: Orientation"
        assert phase.requires_manual_advancement is True
        assert phase.time_limit_days == 30

    def test_create_program_enrollment(self):
        """Create ProgramEnrollment"""
        user_id = str(uuid4())
        program_id = str(uuid4())
        enrollment = ProgramEnrollment(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            user_id=user_id,
            program_id=program_id,
            target_completion_date=date(2026, 1, 1),
            current_phase_id=None,
            progress_percentage=25.0,
            status=EnrollmentStatus.ACTIVE,
            deadline_warning_sent=False,
        )
        assert enrollment.user_id == user_id
        assert enrollment.program_id == program_id
        assert enrollment.progress_percentage == 25.0
        assert enrollment.status == EnrollmentStatus.ACTIVE
        assert enrollment.deadline_warning_sent is False

    def test_create_requirement_progress(self):
        """Create RequirementProgress"""
        enrollment_id = str(uuid4())
        requirement_id = str(uuid4())
        progress = RequirementProgress(
            id=str(uuid4()),
            enrollment_id=enrollment_id,
            requirement_id=requirement_id,
            status=RequirementProgressStatus.IN_PROGRESS,
            progress_value=18.0,
            progress_percentage=50.0,
            progress_notes={"items_completed": ["item1", "item2"]},
        )
        assert progress.enrollment_id == enrollment_id
        assert progress.requirement_id == requirement_id
        assert progress.status == RequirementProgressStatus.IN_PROGRESS
        assert progress.progress_value == 18.0
        assert progress.progress_percentage == 50.0
        assert progress.progress_notes == {"items_completed": ["item1", "item2"]}

    def test_create_skill_evaluation(self):
        """Create SkillEvaluation"""
        skill = SkillEvaluation(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="SCBA Operations",
            description="Self-Contained Breathing Apparatus proficiency",
            category="Firefighting",
            evaluation_criteria={"criteria": ["donning", "doffing", "emergency procedures"]},
            passing_requirements="Must complete all criteria within time limit",
            required_for_programs=[str(uuid4())],
            active=True,
        )
        assert skill.name == "SCBA Operations"
        assert skill.category == "Firefighting"
        assert skill.evaluation_criteria is not None
        assert skill.active is True

    def test_create_external_provider(self):
        """Create ExternalTrainingProvider"""
        provider = ExternalTrainingProvider(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Vector Solutions",
            provider_type=ExternalProviderType.VECTOR_SOLUTIONS,
            description="Online training platform",
            api_base_url="https://api.vectorsolutions.com",
            auth_type="api_key",
            auto_sync_enabled=True,
            sync_interval_hours=24,
            active=True,
            connection_verified=False,
        )
        assert provider.name == "Vector Solutions"
        assert provider.provider_type == ExternalProviderType.VECTOR_SOLUTIONS
        assert provider.api_base_url == "https://api.vectorsolutions.com"
        assert provider.auto_sync_enabled is True
        assert provider.sync_interval_hours == 24

    def test_create_training_session(self):
        """Create TrainingSession"""
        session = TrainingSession(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            event_id=str(uuid4()),
            course_id=str(uuid4()),
            course_name="Hose Operations",
            course_code="HOSE-101",
            training_type=TrainingType.SKILLS_PRACTICE,
            credit_hours=4.0,
            instructor="Captain Jones",
            issues_certification=False,
            auto_create_records=True,
            require_completion_confirmation=False,
            approval_required=True,
            approval_deadline_days=7,
            is_finalized=False,
        )
        assert session.course_name == "Hose Operations"
        assert session.training_type == TrainingType.SKILLS_PRACTICE
        assert session.credit_hours == 4.0
        assert session.approval_required is True

    def test_create_training_approval(self):
        """Create TrainingApproval"""
        approval = TrainingApproval(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            training_session_id=str(uuid4()),
            event_id=str(uuid4()),
            approval_token="abc123def456",
            token_expires_at=datetime(2025, 12, 31, 23, 59, 59),
            status=ApprovalStatus.PENDING,
            approval_deadline=datetime(2025, 2, 1, 0, 0, 0),
            attendee_data=[
                {"user_id": str(uuid4()), "check_in": "2025-01-15T09:00:00", "duration": 120}
            ],
        )
        assert approval.status == ApprovalStatus.PENDING
        assert approval.approval_token == "abc123def456"
        assert len(approval.attendee_data) == 1

    def test_create_program_requirement(self):
        """Create ProgramRequirement linking requirement to program"""
        prog_req = ProgramRequirement(
            id=str(uuid4()),
            program_id=str(uuid4()),
            phase_id=str(uuid4()),
            requirement_id=str(uuid4()),
            is_required=True,
            is_prerequisite=False,
            sort_order=1,
            program_specific_description="Must complete during orientation phase",
            custom_deadline_days=30,
            notification_message="Please complete this requirement",
        )
        assert prog_req.is_required is True
        assert prog_req.is_prerequisite is False
        assert prog_req.sort_order == 1
        assert prog_req.custom_deadline_days == 30

    def test_create_program_milestone(self):
        """Create ProgramMilestone"""
        milestone = ProgramMilestone(
            id=str(uuid4()),
            program_id=str(uuid4()),
            phase_id=str(uuid4()),
            name="Halfway Point",
            description="50% of requirements completed",
            completion_percentage_threshold=50.0,
            notification_message="Congratulations on reaching the halfway point!",
            requires_verification=True,
            verification_notes="Officer must verify progress",
        )
        assert milestone.name == "Halfway Point"
        assert milestone.completion_percentage_threshold == 50.0
        assert milestone.requires_verification is True

    def test_create_skill_checkoff(self):
        """Create SkillCheckoff"""
        checkoff = SkillCheckoff(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            user_id=str(uuid4()),
            skill_evaluation_id=str(uuid4()),
            evaluator_id=str(uuid4()),
            status="passed",
            evaluation_results={"donning": "pass", "doffing": "pass"},
            score=92.5,
            notes="Demonstrated proficiency",
        )
        assert checkoff.status == "passed"
        assert checkoff.score == 92.5
        assert checkoff.evaluation_results == {"donning": "pass", "doffing": "pass"}


# ============================================
# 3. Schema Validation Tests (no database needed)
# ============================================


class TestTrainingSchemas:
    """Test Pydantic schema validation"""

    def test_training_category_create_valid(self):
        """Valid TrainingCategoryCreate schema"""
        schema = TrainingCategoryCreate(
            name="Fire Training",
            code="FIRE",
            description="Fire suppression training",
            color="#FF5733",
            sort_order=1,
            icon="fire",
        )
        assert schema.name == "Fire Training"
        assert schema.code == "FIRE"
        assert schema.color == "#FF5733"
        assert schema.sort_order == 1

    def test_training_category_create_minimal(self):
        """TrainingCategoryCreate with only required fields"""
        schema = TrainingCategoryCreate(name="Basic Training")
        assert schema.name == "Basic Training"
        assert schema.code is None
        assert schema.description is None
        assert schema.color is None
        assert schema.sort_order == 0

    def test_training_category_create_missing_name(self):
        """Should fail validation without name"""
        with pytest.raises(Exception):
            TrainingCategoryCreate()

    def test_training_category_create_empty_name(self):
        """Should fail validation with empty name"""
        with pytest.raises(Exception):
            TrainingCategoryCreate(name="")

    def test_training_category_create_invalid_color(self):
        """Should fail validation with invalid color format"""
        with pytest.raises(Exception):
            TrainingCategoryCreate(name="Test", color="not-a-color")

    def test_training_category_create_valid_color_formats(self):
        """Test valid hex color patterns"""
        # Uppercase hex
        schema = TrainingCategoryCreate(name="Test", color="#AABBCC")
        assert schema.color == "#AABBCC"
        # Lowercase hex
        schema = TrainingCategoryCreate(name="Test", color="#aabbcc")
        assert schema.color == "#aabbcc"
        # Mixed case
        schema = TrainingCategoryCreate(name="Test", color="#AaBbCc")
        assert schema.color == "#AaBbCc"

    def test_training_course_create_valid(self):
        """Valid TrainingCourseCreate schema"""
        schema = TrainingCourseCreate(
            name="Firefighter I",
            code="FF1",
            description="Basic firefighter certification",
            training_type="certification",
            duration_hours=120.0,
            credit_hours=120.0,
            expiration_months=24,
            instructor="John Smith",
            max_participants=30,
            materials_required=["Turnout gear", "SCBA"],
            category_ids=[str(uuid4())],
        )
        assert schema.name == "Firefighter I"
        assert schema.training_type == "certification"
        assert schema.duration_hours == 120.0
        assert schema.max_participants == 30

    def test_training_course_create_minimal(self):
        """TrainingCourseCreate with only required fields"""
        schema = TrainingCourseCreate(
            name="Basic Course",
            training_type="certification",
        )
        assert schema.name == "Basic Course"
        assert schema.training_type == "certification"
        assert schema.code is None
        assert schema.duration_hours is None
        assert schema.max_participants is None

    def test_training_course_create_missing_name(self):
        """Should fail without name"""
        with pytest.raises(Exception):
            TrainingCourseCreate(training_type="certification")

    def test_training_course_create_missing_training_type(self):
        """Should fail without training_type"""
        with pytest.raises(Exception):
            TrainingCourseCreate(name="Course")

    def test_training_course_create_negative_duration(self):
        """Should fail with negative duration_hours"""
        with pytest.raises(Exception):
            TrainingCourseCreate(
                name="Test",
                training_type="certification",
                duration_hours=-1.0,
            )

    def test_training_course_create_zero_max_participants(self):
        """Should fail with max_participants < 1"""
        with pytest.raises(Exception):
            TrainingCourseCreate(
                name="Test",
                training_type="certification",
                max_participants=0,
            )

    def test_training_record_create_valid(self):
        """Valid TrainingRecordCreate schema"""
        user_id = uuid4()
        schema = TrainingRecordCreate(
            user_id=user_id,
            course_name="CPR Certification",
            course_code="CPR",
            training_type="certification",
            hours_completed=8.0,
            credit_hours=8.0,
            status="completed",
            score=95.0,
            passing_score=80.0,
            passed=True,
            completion_date=date(2025, 1, 15),
            expiration_date=date(2027, 1, 15),
            certification_number="CPR-2025-001",
            issuing_agency="AHA",
            instructor="Jane Doe",
            location="Station 1",
        )
        assert schema.user_id == user_id
        assert schema.course_name == "CPR Certification"
        assert schema.hours_completed == 8.0
        assert schema.passed is True

    def test_training_record_create_minimal(self):
        """TrainingRecordCreate with only required fields"""
        schema = TrainingRecordCreate(
            user_id=uuid4(),
            course_name="Basic Training",
            training_type="orientation",
            hours_completed=2.0,
        )
        assert schema.course_name == "Basic Training"
        assert schema.hours_completed == 2.0
        assert schema.status == "scheduled"  # default value
        assert schema.score is None
        assert schema.passed is None

    def test_training_record_create_missing_user_id(self):
        """Should fail without user_id"""
        with pytest.raises(Exception):
            TrainingRecordCreate(
                course_name="Test",
                training_type="certification",
                hours_completed=1.0,
            )

    def test_training_record_create_negative_hours(self):
        """Should fail with negative hours_completed"""
        with pytest.raises(Exception):
            TrainingRecordCreate(
                user_id=uuid4(),
                course_name="Test",
                training_type="certification",
                hours_completed=-1.0,
            )

    def test_training_record_create_score_out_of_range(self):
        """Should fail with score > 100"""
        with pytest.raises(Exception):
            TrainingRecordCreate(
                user_id=uuid4(),
                course_name="Test",
                training_type="certification",
                hours_completed=1.0,
                score=150.0,
            )

    def test_training_requirement_create_valid(self):
        """Valid TrainingRequirementCreate schema"""
        schema = TrainingRequirementCreate(
            name="Annual Fire Training",
            description="Required annual hours",
            requirement_type="hours",
            training_type="continuing_education",
            required_hours=36.0,
            frequency="annual",
            year=2025,
            applies_to_all=False,
            due_date_type="calendar_period",
            period_start_month=1,
            period_start_day=1,
            category_ids=[str(uuid4())],
        )
        assert schema.name == "Annual Fire Training"
        assert schema.required_hours == 36.0
        assert schema.frequency == "annual"
        assert schema.year == 2025

    def test_training_requirement_create_minimal(self):
        """TrainingRequirementCreate with only required fields"""
        schema = TrainingRequirementCreate(
            name="Basic Requirement",
            requirement_type="hours",
            frequency="annual",
        )
        assert schema.name == "Basic Requirement"
        assert schema.frequency == "annual"
        assert schema.applies_to_all is True  # default
        assert schema.period_start_month == 1  # default
        assert schema.period_start_day == 1  # default

    def test_training_requirement_enhanced_create_valid(self):
        """Valid TrainingRequirementEnhancedCreate schema"""
        schema = TrainingRequirementEnhancedCreate(
            name="NFPA 1001 Training",
            description="Annual firefighter training requirement",
            requirement_type="hours",
            source="national",
            registry_name="NFPA",
            registry_code="NFPA 1001",
            is_editable=True,
            training_type="continuing_education",
            required_hours=36.0,
            frequency="annual",
            applies_to_all=False,
            required_positions=["firefighter", "driver", "officer"],
        )
        assert schema.name == "NFPA 1001 Training"
        assert schema.requirement_type == "hours"
        assert schema.source == "national"
        assert schema.registry_name == "NFPA"
        assert schema.required_hours == 36.0
        assert schema.required_positions == ["firefighter", "driver", "officer"]

    def test_training_requirement_enhanced_create_shifts_type(self):
        """TrainingRequirementEnhancedCreate with shifts requirement"""
        schema = TrainingRequirementEnhancedCreate(
            name="Minimum Shifts",
            requirement_type="shifts",
            source="department",
            required_shifts=12,
            frequency="annual",
        )
        assert schema.requirement_type == "shifts"
        assert schema.required_shifts == 12

    def test_training_requirement_enhanced_create_calls_type(self):
        """TrainingRequirementEnhancedCreate with calls requirement"""
        schema = TrainingRequirementEnhancedCreate(
            name="Minimum Calls",
            requirement_type="calls",
            source="department",
            required_calls=24,
            required_call_types=["structure_fire", "medical"],
            frequency="annual",
        )
        assert schema.requirement_type == "calls"
        assert schema.required_calls == 24
        assert schema.required_call_types == ["structure_fire", "medical"]

    def test_training_requirement_enhanced_create_checklist_type(self):
        """TrainingRequirementEnhancedCreate with checklist requirement"""
        items = ["Medical exam", "Fitness test", "Vision test"]
        schema = TrainingRequirementEnhancedCreate(
            name="Annual Medical",
            requirement_type="checklist",
            source="national",
            checklist_items=items,
            frequency="annual",
        )
        assert schema.requirement_type == "checklist"
        assert schema.checklist_items == items

    def test_training_requirement_enhanced_create_skills_type(self):
        """TrainingRequirementEnhancedCreate with skills_evaluation requirement"""
        skills = [{"skill_id": str(uuid4()), "name": "SCBA Operations"}]
        schema = TrainingRequirementEnhancedCreate(
            name="Skills Evaluation",
            requirement_type="skills_evaluation",
            source="department",
            required_skills=skills,
            frequency="annual",
        )
        assert schema.requirement_type == "skills_evaluation"
        assert schema.required_skills == skills

    def test_training_program_create_valid(self):
        """Valid TrainingProgramCreate schema"""
        schema = TrainingProgramCreate(
            name="Probationary Firefighter Program",
            description="12-month probationary program",
            target_position="probationary",
            structure_type="phases",
            time_limit_days=365,
            warning_days_before=30,
            is_template=False,
        )
        assert schema.name == "Probationary Firefighter Program"
        assert schema.structure_type == "phases"
        assert schema.time_limit_days == 365
        assert schema.warning_days_before == 30

    def test_training_program_create_minimal(self):
        """TrainingProgramCreate with only required fields"""
        schema = TrainingProgramCreate(name="Basic Program")
        assert schema.name == "Basic Program"
        assert schema.structure_type == "flexible"  # default
        assert schema.warning_days_before == 30  # default
        assert schema.is_template is False  # default

    def test_training_program_create_missing_name(self):
        """Should fail without name"""
        with pytest.raises(Exception):
            TrainingProgramCreate()

    def test_program_enrollment_create_valid(self):
        """Valid ProgramEnrollmentCreate schema"""
        user_id = uuid4()
        program_id = uuid4()
        schema = ProgramEnrollmentCreate(
            user_id=user_id,
            program_id=program_id,
            target_completion_date=date(2026, 1, 1),
            notes="Enrolled as new probationary member",
        )
        assert schema.user_id == user_id
        assert schema.program_id == program_id
        assert schema.target_completion_date == date(2026, 1, 1)
        assert schema.notes == "Enrolled as new probationary member"

    def test_program_enrollment_create_minimal(self):
        """ProgramEnrollmentCreate with only required fields"""
        schema = ProgramEnrollmentCreate(
            user_id=uuid4(),
            program_id=uuid4(),
        )
        assert schema.target_completion_date is None
        assert schema.notes is None

    def test_program_enrollment_create_missing_user_id(self):
        """Should fail without user_id"""
        with pytest.raises(Exception):
            ProgramEnrollmentCreate(program_id=uuid4())

    def test_program_enrollment_create_missing_program_id(self):
        """Should fail without program_id"""
        with pytest.raises(Exception):
            ProgramEnrollmentCreate(user_id=uuid4())


# ============================================
# 4. Registry Data Tests (no database needed)
# ============================================


class TestRegistryData:
    """Test registry JSON data files are valid"""

    REGISTRY_DIR = Path(__file__).parent.parent / "app" / "data" / "registries"

    def _load_registry(self, filename: str) -> dict:
        """Helper to load a registry JSON file"""
        filepath = self.REGISTRY_DIR / filename
        assert filepath.exists(), f"Registry file not found: {filepath}"
        with open(filepath, "r") as f:
            return json.load(f)

    def test_nfpa_registry_loads(self):
        """Load and validate nfpa_requirements.json"""
        data = self._load_registry("nfpa_requirements.json")
        assert "registry_name" in data
        assert data["registry_name"] == "NFPA"
        assert "registry_description" in data
        assert "requirements" in data
        assert isinstance(data["requirements"], list)
        assert len(data["requirements"]) > 0

    def test_nremt_registry_loads(self):
        """Load and validate nremt_requirements.json"""
        data = self._load_registry("nremt_requirements.json")
        assert "registry_name" in data
        assert data["registry_name"] == "NREMT"
        assert "registry_description" in data
        assert "requirements" in data
        assert isinstance(data["requirements"], list)
        assert len(data["requirements"]) > 0

    def test_proboard_registry_loads(self):
        """Load and validate proboard_requirements.json"""
        data = self._load_registry("proboard_requirements.json")
        assert "registry_name" in data
        assert data["registry_name"] == "Pro Board"
        assert "registry_description" in data
        assert "requirements" in data
        assert isinstance(data["requirements"], list)
        assert len(data["requirements"]) > 0

    def test_registry_requirement_fields(self):
        """Verify each requirement in all registries has required fields"""
        required_fields = {"name", "requirement_type", "frequency", "is_editable"}
        registry_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in registry_files:
            data = self._load_registry(filename)
            for i, req in enumerate(data["requirements"]):
                for field in required_fields:
                    assert field in req, (
                        f"Missing field '{field}' in requirement #{i} "
                        f"('{req.get('name', 'unknown')}') of {filename}"
                    )

    def test_registry_requirement_names_non_empty(self):
        """Verify all requirement names are non-empty strings"""
        registry_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in registry_files:
            data = self._load_registry(filename)
            for req in data["requirements"]:
                assert isinstance(req["name"], str), (
                    f"Requirement name is not a string in {filename}"
                )
                assert len(req["name"]) > 0, (
                    f"Empty requirement name found in {filename}"
                )

    def test_registry_requirement_types_valid(self):
        """Verify all requirement_types in registry data match RequirementType enum"""
        valid_types = {member.value for member in RequirementType}
        registry_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in registry_files:
            data = self._load_registry(filename)
            for req in data["requirements"]:
                req_type = req["requirement_type"]
                assert req_type in valid_types, (
                    f"Invalid requirement_type '{req_type}' in requirement "
                    f"'{req['name']}' of {filename}. "
                    f"Valid types: {valid_types}"
                )

    def test_registry_frequencies_valid(self):
        """Verify all frequencies in registry data match RequirementFrequency enum"""
        valid_frequencies = {member.value for member in RequirementFrequency}
        registry_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in registry_files:
            data = self._load_registry(filename)
            for req in data["requirements"]:
                freq = req["frequency"]
                assert freq in valid_frequencies, (
                    f"Invalid frequency '{freq}' in requirement "
                    f"'{req['name']}' of {filename}. "
                    f"Valid frequencies: {valid_frequencies}"
                )

    def test_registry_training_types_valid(self):
        """Verify all training_types in registry data match TrainingType enum"""
        valid_types = {member.value for member in TrainingType}
        registry_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in registry_files:
            data = self._load_registry(filename)
            for req in data["requirements"]:
                if "training_type" in req:
                    training_type = req["training_type"]
                    assert training_type in valid_types, (
                        f"Invalid training_type '{training_type}' in requirement "
                        f"'{req['name']}' of {filename}. "
                        f"Valid types: {valid_types}"
                    )

    def test_registry_hours_requirements_have_hours(self):
        """Verify requirements of type 'hours' have required_hours field"""
        registry_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in registry_files:
            data = self._load_registry(filename)
            for req in data["requirements"]:
                if req["requirement_type"] == "hours":
                    assert "required_hours" in req, (
                        f"Requirement '{req['name']}' in {filename} is type 'hours' "
                        f"but missing 'required_hours' field"
                    )
                    assert isinstance(req["required_hours"], (int, float)), (
                        f"required_hours for '{req['name']}' in {filename} "
                        f"is not a number"
                    )
                    assert req["required_hours"] > 0, (
                        f"required_hours for '{req['name']}' in {filename} "
                        f"must be positive"
                    )

    def test_registry_checklist_requirements_have_items(self):
        """Verify requirements of type 'checklist' have checklist_items"""
        registry_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in registry_files:
            data = self._load_registry(filename)
            for req in data["requirements"]:
                if req["requirement_type"] == "checklist":
                    assert "checklist_items" in req, (
                        f"Requirement '{req['name']}' in {filename} is type 'checklist' "
                        f"but missing 'checklist_items' field"
                    )
                    assert isinstance(req["checklist_items"], list), (
                        f"checklist_items for '{req['name']}' in {filename} "
                        f"is not a list"
                    )
                    assert len(req["checklist_items"]) > 0, (
                        f"checklist_items for '{req['name']}' in {filename} "
                        f"is empty"
                    )

    def test_registry_data_no_duplicate_names(self):
        """Verify no duplicate requirement names within each registry"""
        registry_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in registry_files:
            data = self._load_registry(filename)
            names = [req["name"] for req in data["requirements"]]
            assert len(names) == len(set(names)), (
                f"Duplicate requirement names found in {filename}: "
                f"{[n for n in names if names.count(n) > 1]}"
            )

    def test_registry_data_no_duplicate_codes(self):
        """Verify no duplicate registry_code values within each registry"""
        registry_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in registry_files:
            data = self._load_registry(filename)
            codes = [req["registry_code"] for req in data["requirements"] if "registry_code" in req]
            assert len(codes) == len(set(codes)), (
                f"Duplicate registry_codes found in {filename}: "
                f"{[c for c in codes if codes.count(c) > 1]}"
            )


# ============================================
# 5. Seed Data Tests (no database needed)
# ============================================


class TestSeedTrainingData:
    """Test seed data module imports and configuration"""

    def test_seed_module_imports(self):
        """Verify seed module (app.core.seed) can be imported"""
        from app.core import seed
        assert seed is not None

    def test_seed_functions_exist(self):
        """Verify all seed functions exist in seed module"""
        from app.core import seed
        assert hasattr(seed, "seed_organization")
        assert callable(seed.seed_organization)
        assert hasattr(seed, "seed_roles")
        assert callable(seed.seed_roles)
        assert hasattr(seed, "seed_database")
        assert callable(seed.seed_database)

    def test_training_models_importable(self):
        """Verify all training model classes can be imported"""
        from app.models.training import (
            TrainingCategory,
            TrainingCourse,
            TrainingRecord,
            TrainingRequirement,
            TrainingSession,
            TrainingApproval,
            TrainingProgram,
            ProgramPhase,
            ProgramRequirement,
            ProgramMilestone,
            ProgramEnrollment,
            RequirementProgress,
            SkillEvaluation,
            SkillCheckoff,
            ExternalTrainingProvider,
        )
        # Verify they are actual classes, not None
        assert TrainingCategory is not None
        assert TrainingCourse is not None
        assert TrainingRecord is not None
        assert TrainingRequirement is not None
        assert TrainingSession is not None
        assert TrainingApproval is not None
        assert TrainingProgram is not None
        assert ProgramPhase is not None
        assert ProgramRequirement is not None
        assert ProgramMilestone is not None
        assert ProgramEnrollment is not None
        assert RequirementProgress is not None
        assert SkillEvaluation is not None
        assert SkillCheckoff is not None
        assert ExternalTrainingProvider is not None

    def test_training_schemas_importable(self):
        """Verify all training schema classes can be imported"""
        from app.schemas.training import (
            TrainingCategoryCreate,
            TrainingCategoryUpdate,
            TrainingCategoryResponse,
            TrainingCourseCreate,
            TrainingCourseUpdate,
            TrainingCourseResponse,
            TrainingRecordCreate,
            TrainingRecordUpdate,
            TrainingRecordResponse,
            TrainingRequirementCreate,
            TrainingRequirementUpdate,
            TrainingRequirementResponse,
        )
        assert TrainingCategoryCreate is not None
        assert TrainingCategoryUpdate is not None
        assert TrainingCategoryResponse is not None
        assert TrainingCourseCreate is not None
        assert TrainingCourseUpdate is not None
        assert TrainingCourseResponse is not None
        assert TrainingRecordCreate is not None
        assert TrainingRecordUpdate is not None
        assert TrainingRecordResponse is not None
        assert TrainingRequirementCreate is not None
        assert TrainingRequirementUpdate is not None
        assert TrainingRequirementResponse is not None

    def test_training_program_schemas_importable(self):
        """Verify all training program schema classes can be imported"""
        from app.schemas.training_program import (
            TrainingRequirementEnhancedCreate,
            TrainingRequirementEnhancedUpdate,
            TrainingRequirementEnhancedResponse,
            TrainingProgramCreate,
            TrainingProgramUpdate,
            TrainingProgramResponse,
            ProgramPhaseCreate,
            ProgramPhaseUpdate,
            ProgramPhaseResponse,
            ProgramRequirementCreate,
            ProgramRequirementUpdate,
            ProgramRequirementResponse,
            ProgramMilestoneCreate,
            ProgramMilestoneUpdate,
            ProgramMilestoneResponse,
            ProgramEnrollmentCreate,
            ProgramEnrollmentUpdate,
            ProgramEnrollmentResponse,
        )
        assert TrainingRequirementEnhancedCreate is not None
        assert TrainingRequirementEnhancedUpdate is not None
        assert TrainingRequirementEnhancedResponse is not None
        assert TrainingProgramCreate is not None
        assert TrainingProgramUpdate is not None
        assert TrainingProgramResponse is not None
        assert ProgramPhaseCreate is not None
        assert ProgramPhaseUpdate is not None
        assert ProgramPhaseResponse is not None
        assert ProgramRequirementCreate is not None
        assert ProgramRequirementUpdate is not None
        assert ProgramRequirementResponse is not None
        assert ProgramMilestoneCreate is not None
        assert ProgramMilestoneUpdate is not None
        assert ProgramMilestoneResponse is not None
        assert ProgramEnrollmentCreate is not None
        assert ProgramEnrollmentUpdate is not None
        assert ProgramEnrollmentResponse is not None

    def test_registry_data_files_exist(self):
        """Verify all expected registry data files exist"""
        registry_dir = Path(__file__).parent.parent / "app" / "data" / "registries"
        assert registry_dir.exists(), f"Registry directory not found: {registry_dir}"

        expected_files = [
            "nfpa_requirements.json",
            "nremt_requirements.json",
            "proboard_requirements.json",
        ]
        for filename in expected_files:
            filepath = registry_dir / filename
            assert filepath.exists(), f"Registry file not found: {filepath}"
            assert filepath.stat().st_size > 0, f"Registry file is empty: {filepath}"

    def test_model_tablenames(self):
        """Verify SQLAlchemy model __tablename__ attributes are set correctly"""
        assert TrainingCategory.__tablename__ == "training_categories"
        assert TrainingCourse.__tablename__ == "training_courses"
        assert TrainingRecord.__tablename__ == "training_records"
        assert TrainingRequirement.__tablename__ == "training_requirements"
        assert TrainingSession.__tablename__ == "training_sessions"
        assert TrainingApproval.__tablename__ == "training_approvals"
        assert TrainingProgram.__tablename__ == "training_programs"
        assert ProgramPhase.__tablename__ == "program_phases"
        assert ProgramRequirement.__tablename__ == "program_requirements"
        assert ProgramMilestone.__tablename__ == "program_milestones"
        assert ProgramEnrollment.__tablename__ == "program_enrollments"
        assert RequirementProgress.__tablename__ == "requirement_progress"
        assert SkillEvaluation.__tablename__ == "skill_evaluations"
        assert SkillCheckoff.__tablename__ == "skill_checkoffs"
        assert ExternalTrainingProvider.__tablename__ == "external_training_providers"
