"""
Tests for Training Enhancement Models and Schemas

Tests for recertification pathways, competency tracking, instructor qualifications,
training effectiveness, multi-agency training, and xAPI support.
"""

import pytest
from datetime import date, datetime, timedelta, timezone

from app.models.training import (
    CompetencyLevel,
    CompetencyMatrix,
    EvaluationLevel,
    InstructorQualification,
    MemberCompetency,
    MultiAgencyTraining,
    RecertificationPathway,
    RenewalTask,
    RenewalTaskStatus,
    TrainingEffectivenessEvaluation,
    XAPIStatement,
)
from app.schemas.training_enhancements import (
    CompetencyLevelEnum,
    CompetencyMatrixCreate,
    CompetencyMatrixResponse,
    CompetencyMatrixUpdate,
    EvaluationLevelEnum,
    InstructorQualificationCreate,
    InstructorQualificationResponse,
    InstructorQualificationUpdate,
    MemberCompetencyResponse,
    MultiAgencyTrainingCreate,
    MultiAgencyTrainingResponse,
    MultiAgencyTrainingUpdate,
    ParticipatingOrganization,
    RecertificationPathwayCreate,
    RecertificationPathwayResponse,
    RecertificationPathwayUpdate,
    RenewalTaskResponse,
    ReportExportRequest,
    TrainingEffectivenessCreate,
    TrainingEffectivenessResponse,
    XAPIBatchCreate,
    XAPIStatementCreate,
    XAPIStatementResponse,
)


# ============================================
# Enum Tests
# ============================================


class TestEnums:
    """Test new enum values"""

    def test_competency_level_values(self):
        assert CompetencyLevel.NOVICE.value == "novice"
        assert CompetencyLevel.ADVANCED_BEGINNER.value == "advanced_beginner"
        assert CompetencyLevel.COMPETENT.value == "competent"
        assert CompetencyLevel.PROFICIENT.value == "proficient"
        assert CompetencyLevel.EXPERT.value == "expert"

    def test_competency_level_is_string(self):
        for level in CompetencyLevel:
            assert isinstance(level.value, str)
            assert level.value == level.value.lower()

    def test_renewal_task_status_values(self):
        assert RenewalTaskStatus.PENDING.value == "pending"
        assert RenewalTaskStatus.IN_PROGRESS.value == "in_progress"
        assert RenewalTaskStatus.COMPLETED.value == "completed"
        assert RenewalTaskStatus.EXPIRED.value == "expired"
        assert RenewalTaskStatus.LAPSED.value == "lapsed"

    def test_evaluation_level_values(self):
        assert EvaluationLevel.REACTION.value == "reaction"
        assert EvaluationLevel.LEARNING.value == "learning"
        assert EvaluationLevel.BEHAVIOR.value == "behavior"
        assert EvaluationLevel.RESULTS.value == "results"

    def test_evaluation_level_count(self):
        """Kirkpatrick model has exactly 4 levels"""
        assert len(EvaluationLevel) == 4

    def test_competency_level_count(self):
        """Dreyfus model has exactly 5 levels"""
        assert len(CompetencyLevel) == 5

    def test_renewal_task_status_count(self):
        assert len(RenewalTaskStatus) == 5


# ============================================
# Model Instantiation Tests
# ============================================


class TestModelInstantiation:
    """Test that new models can be instantiated"""

    def test_recertification_pathway_creation(self):
        pathway = RecertificationPathway(
            organization_id="org-1",
            name="EMT-B Recertification",
            renewal_type="hours",
            required_hours=50,
            renewal_window_days=90,
            grace_period_days=30,
        )
        assert pathway.name == "EMT-B Recertification"
        assert pathway.renewal_type == "hours"
        assert pathway.required_hours == 50
        assert pathway.renewal_window_days == 90
        assert pathway.grace_period_days == 30

    def test_renewal_task_creation(self):
        task = RenewalTask(
            organization_id="org-1",
            user_id="user-1",
            pathway_id="pathway-1",
            certification_expiration_date=date(2026, 12, 31),
            renewal_window_opens=date(2026, 10, 1),
        )
        assert task.user_id == "user-1"
        assert task.status is None or task.status == RenewalTaskStatus.PENDING
        assert task.progress_percentage == 0.0 or task.progress_percentage is None

    def test_competency_matrix_creation(self):
        matrix = CompetencyMatrix(
            organization_id="org-1",
            name="Firefighter I Competencies",
            position="firefighter",
            skill_requirements=[
                {"skill_evaluation_id": "skill-1", "required_level": "competent", "priority": "required"},
            ],
        )
        assert matrix.name == "Firefighter I Competencies"
        assert matrix.position == "firefighter"
        assert len(matrix.skill_requirements) == 1

    def test_member_competency_creation(self):
        comp = MemberCompetency(
            organization_id="org-1",
            user_id="user-1",
            skill_evaluation_id="skill-1",
            current_level=CompetencyLevel.NOVICE,
        )
        assert comp.current_level == CompetencyLevel.NOVICE
        assert comp.evaluation_count == 0 or comp.evaluation_count is None

    def test_instructor_qualification_creation(self):
        qual = InstructorQualification(
            organization_id="org-1",
            user_id="user-1",
            qualification_type="instructor",
            certification_number="FI-12345",
            certification_level="Fire Instructor I",
        )
        assert qual.qualification_type == "instructor"
        assert qual.certification_level == "Fire Instructor I"

    def test_training_effectiveness_creation(self):
        evaluation = TrainingEffectivenessEvaluation(
            organization_id="org-1",
            user_id="user-1",
            evaluation_level=EvaluationLevel.REACTION,
            overall_rating=4.5,
            survey_responses={"relevance": 5, "instructor_quality": 4},
        )
        assert evaluation.evaluation_level == EvaluationLevel.REACTION
        assert evaluation.overall_rating == 4.5

    def test_multi_agency_training_creation(self):
        exercise = MultiAgencyTraining(
            organization_id="org-1",
            exercise_name="Regional Hazmat Drill",
            exercise_type="joint_training",
            exercise_date=date(2026, 6, 15),
            participating_organizations=[
                {"name": "Engine Co. 1", "role": "host"},
                {"name": "Engine Co. 2", "role": "participant"},
            ],
        )
        assert exercise.exercise_name == "Regional Hazmat Drill"
        assert len(exercise.participating_organizations) == 2

    def test_xapi_statement_creation(self):
        stmt = XAPIStatement(
            organization_id="org-1",
            actor_email="john@example.com",
            verb_id="http://adlnet.gov/expapi/verbs/completed",
            verb_display="completed",
            object_id="http://example.com/courses/101",
            object_name="Fire Safety 101",
            raw_statement={"actor": {}, "verb": {}, "object": {}},
            statement_timestamp=datetime.now(timezone.utc),
        )
        assert stmt.verb_display == "completed"
        assert stmt.actor_email == "john@example.com"


# ============================================
# Schema Validation Tests
# ============================================


class TestSchemaValidation:
    """Test Pydantic schema validation"""

    def test_recertification_pathway_create_valid(self):
        data = RecertificationPathwayCreate(
            name="ACLS Recertification",
            renewal_type="combination",
            required_hours=40,
            renewal_window_days=90,
            grace_period_days=30,
        )
        assert data.name == "ACLS Recertification"
        assert data.renewal_type == "combination"

    def test_recertification_pathway_create_defaults(self):
        data = RecertificationPathwayCreate(
            name="Basic Recert",
            renewal_type="hours",
        )
        assert data.renewal_window_days == 90
        assert data.grace_period_days == 0
        assert data.requires_assessment is False
        assert data.auto_create_record is True

    def test_competency_matrix_create_valid(self):
        data = CompetencyMatrixCreate(
            name="Driver/Operator Skills",
            position="driver",
            skill_requirements=[
                {"skill_evaluation_id": "s1", "required_level": "competent", "priority": "required"},
            ],
        )
        assert data.position == "driver"
        assert len(data.skill_requirements) == 1

    def test_instructor_qualification_create_valid(self):
        data = InstructorQualificationCreate(
            user_id="550e8400-e29b-41d4-a716-446655440000",
            qualification_type="instructor",
            certification_number="FI-2024-001",
            issuing_agency="State Fire Academy",
            certification_level="Fire Instructor I",
            issued_date=date(2024, 1, 1),
            expiration_date=date(2027, 1, 1),
        )
        assert data.qualification_type == "instructor"
        assert data.certification_level == "Fire Instructor I"

    def test_training_effectiveness_create_reaction(self):
        data = TrainingEffectivenessCreate(
            user_id="550e8400-e29b-41d4-a716-446655440000",
            evaluation_level="reaction",
            overall_rating=4.5,
            survey_responses={
                "relevance": 5,
                "instructor_quality": 4,
                "would_recommend": True,
                "comments": "Great training session",
            },
        )
        assert data.evaluation_level == EvaluationLevelEnum.REACTION
        assert data.overall_rating == 4.5

    def test_training_effectiveness_create_learning(self):
        data = TrainingEffectivenessCreate(
            user_id="550e8400-e29b-41d4-a716-446655440000",
            evaluation_level="learning",
            pre_assessment_score=65.0,
            post_assessment_score=88.0,
        )
        assert data.pre_assessment_score == 65.0
        assert data.post_assessment_score == 88.0

    def test_multi_agency_create_valid(self):
        data = MultiAgencyTrainingCreate(
            exercise_name="Regional Mass Casualty Drill",
            exercise_type="full_scale",
            exercise_date=date(2026, 9, 15),
            participating_organizations=[
                ParticipatingOrganization(name="Fire Dept A", role="host", participant_count=20),
                ParticipatingOrganization(name="Fire Dept B", role="participant", participant_count=15),
                ParticipatingOrganization(name="EMS Agency", role="participant", participant_count=10),
            ],
            lead_agency="Fire Dept A",
            total_participants=45,
            nims_compliant=True,
        )
        assert len(data.participating_organizations) == 3
        assert data.nims_compliant is True

    def test_xapi_statement_create_valid(self):
        data = XAPIStatementCreate(
            raw_statement={
                "actor": {"mbox": "mailto:john@example.com", "name": "John Smith"},
                "verb": {"id": "http://adlnet.gov/expapi/verbs/completed", "display": {"en-US": "completed"}},
                "object": {
                    "id": "http://example.com/activities/fire-safety-101",
                    "definition": {"name": {"en-US": "Fire Safety 101"}},
                },
                "result": {"score": {"raw": 92, "min": 0, "max": 100}, "success": True, "completion": True},
                "timestamp": "2026-01-15T10:30:00Z",
            }
        )
        assert "actor" in data.raw_statement
        assert "verb" in data.raw_statement

    def test_xapi_batch_create_valid(self):
        data = XAPIBatchCreate(
            statements=[
                {"actor": {"mbox": "mailto:a@b.com"}, "verb": {"id": "completed"}, "object": {"id": "course-1"}},
                {"actor": {"mbox": "mailto:c@d.com"}, "verb": {"id": "completed"}, "object": {"id": "course-2"}},
            ]
        )
        assert len(data.statements) == 2

    def test_report_export_request_valid(self):
        data = ReportExportRequest(
            report_type="compliance",
            format="csv",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
        assert data.report_type == "compliance"
        assert data.format == "csv"

    def test_report_export_individual_requires_format(self):
        data = ReportExportRequest(
            report_type="individual",
            format="pdf",
            user_id="550e8400-e29b-41d4-a716-446655440000",
        )
        assert data.format == "pdf"

    def test_participating_organization_schema(self):
        org = ParticipatingOrganization(
            name="Metro Fire District",
            role="host",
            contact_name="Chief Smith",
            contact_email="chief@metrofire.gov",
            participant_count=25,
        )
        assert org.role == "host"
        assert org.participant_count == 25


# ============================================
# Schema Update Tests
# ============================================


class TestSchemaUpdates:
    """Test update schemas allow partial updates"""

    def test_pathway_update_partial(self):
        data = RecertificationPathwayUpdate(name="Updated Name")
        dump = data.model_dump(exclude_unset=True)
        assert dump == {"name": "Updated Name"}

    def test_matrix_update_partial(self):
        data = CompetencyMatrixUpdate(active=False)
        dump = data.model_dump(exclude_unset=True)
        assert dump == {"active": False}

    def test_qualification_update_partial(self):
        data = InstructorQualificationUpdate(
            verified=True,
            expiration_date=date(2028, 1, 1),
        )
        dump = data.model_dump(exclude_unset=True)
        assert "verified" in dump
        assert "expiration_date" in dump
        assert "qualification_type" not in dump

    def test_multi_agency_update_partial(self):
        data = MultiAgencyTrainingUpdate(
            after_action_report="Completed successfully",
            nims_compliant=True,
        )
        dump = data.model_dump(exclude_unset=True)
        assert "after_action_report" in dump
        assert "exercise_name" not in dump


# ============================================
# Model repr Tests
# ============================================


class TestModelRepr:
    """Test model __repr__ methods"""

    def test_recertification_pathway_repr(self):
        p = RecertificationPathway(name="Test")
        assert "Test" in repr(p)

    def test_renewal_task_repr(self):
        t = RenewalTask(user_id="u1")
        assert "u1" in repr(t)

    def test_competency_matrix_repr(self):
        m = CompetencyMatrix(name="Matrix", position="ff")
        assert "Matrix" in repr(m)

    def test_member_competency_repr(self):
        c = MemberCompetency(user_id="u1", current_level=CompetencyLevel.COMPETENT)
        assert "u1" in repr(c)

    def test_instructor_qualification_repr(self):
        q = InstructorQualification(user_id="u1", qualification_type="instructor")
        assert "u1" in repr(q)

    def test_effectiveness_repr(self):
        e = TrainingEffectivenessEvaluation(
            evaluation_level=EvaluationLevel.REACTION, overall_rating=4.5
        )
        assert "reaction" in repr(e).lower()

    def test_multi_agency_repr(self):
        m = MultiAgencyTraining(
            exercise_name="Drill", exercise_type="joint_training"
        )
        assert "Drill" in repr(m)

    def test_xapi_statement_repr(self):
        s = XAPIStatement(actor_email="a@b.com", verb_display="completed")
        assert "a@b.com" in repr(s)


# ============================================
# Service Logic Tests
# ============================================


class TestXAPIServiceHelpers:
    """Test xAPI service helper methods"""

    def test_parse_iso_duration_hours(self):
        from app.services.training_enhancement_service import XAPIService

        result = XAPIService._parse_iso_duration("PT1H30M")
        assert result == 5400  # 1.5 hours

    def test_parse_iso_duration_minutes(self):
        from app.services.training_enhancement_service import XAPIService

        result = XAPIService._parse_iso_duration("PT45M")
        assert result == 2700  # 45 minutes

    def test_parse_iso_duration_seconds(self):
        from app.services.training_enhancement_service import XAPIService

        result = XAPIService._parse_iso_duration("PT3600S")
        assert result == 3600

    def test_parse_iso_duration_invalid(self):
        from app.services.training_enhancement_service import XAPIService

        result = XAPIService._parse_iso_duration("invalid")
        assert result is None

    def test_parse_iso_duration_empty(self):
        from app.services.training_enhancement_service import XAPIService

        result = XAPIService._parse_iso_duration("")
        assert result is None

    def test_parse_iso_duration_none(self):
        from app.services.training_enhancement_service import XAPIService

        result = XAPIService._parse_iso_duration(None)
        assert result is None

    def test_parse_iso_duration_combined(self):
        from app.services.training_enhancement_service import XAPIService

        result = XAPIService._parse_iso_duration("PT2H15M30S")
        assert result == 8130  # 2h 15m 30s


class TestCompetencyLevelOrdering:
    """Test that competency levels have correct ordering"""

    def test_level_ordering(self):
        levels = list(CompetencyLevel)
        assert levels[0] == CompetencyLevel.NOVICE
        assert levels[-1] == CompetencyLevel.EXPERT

    def test_all_levels_are_strings(self):
        for level in CompetencyLevel:
            assert isinstance(level, str)

    def test_level_enum_inherits_str(self):
        """CompetencyLevel should inherit from str for clean serialization"""
        assert issubclass(CompetencyLevel, str)

    def test_evaluation_level_inherits_str(self):
        assert issubclass(EvaluationLevel, str)

    def test_renewal_task_status_inherits_str(self):
        assert issubclass(RenewalTaskStatus, str)
