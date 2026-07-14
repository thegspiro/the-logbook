"""
Regression: the program-requirement and requirement-progress response schemas
must serialize the nested ``requirement`` (name/type), not just ``requirement_id``.

The endpoints eager-load the relationship, but ``from_attributes`` only emits
declared fields — before the nested field was declared, the requirement name was
silently dropped and every UI row fell back to "Requirement" or a truncated ID.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from app.schemas.training_program import (
    ProgramRequirementResponse,
    RequirementProgressResponse,
)

_NOW = datetime(2026, 7, 14, tzinfo=timezone.utc)


def _requirement(name="SCBA donning & doffing", req_type="skills_evaluation"):
    return SimpleNamespace(
        id=uuid4(),
        organization_id=uuid4(),
        name=name,
        description="A recruit skills checkoff.",
        requirement_type=req_type,
        source="department",
        registry_name=None,
        registry_code=None,
        is_editable=True,
        training_type=None,
        required_hours=None,
        required_courses=None,
        required_shifts=None,
        required_calls=None,
        required_call_types=None,
        required_skills=None,
        checklist_items=None,
        passing_score=None,
        max_attempts=None,
        frequency="one_time",
        time_limit_days=None,
        applies_to_all=False,
        required_positions=None,
        required_roles=None,
        active=True,
        created_at=_NOW,
        updated_at=_NOW,
    )


def test_program_requirement_response_carries_requirement_name():
    req = _requirement()
    link = SimpleNamespace(
        id=uuid4(),
        program_id=uuid4(),
        phase_id=uuid4(),
        requirement_id=req.id,
        is_required=True,
        is_prerequisite=False,
        sort_order=0,
        created_at=_NOW,
        requirement=req,
    )

    dumped = ProgramRequirementResponse.model_validate(link).model_dump()

    assert dumped["requirement"] is not None
    assert dumped["requirement"]["name"] == "SCBA donning & doffing"
    assert dumped["requirement"]["requirement_type"] == "skills_evaluation"


def test_program_requirement_response_allows_missing_requirement():
    # A link with no eager-loaded requirement must still validate (nullable).
    link = SimpleNamespace(
        id=uuid4(),
        program_id=uuid4(),
        phase_id=None,
        requirement_id=uuid4(),
        is_required=True,
        is_prerequisite=False,
        sort_order=0,
        created_at=_NOW,
        requirement=None,
    )

    dumped = ProgramRequirementResponse.model_validate(link).model_dump()
    assert dumped["requirement"] is None


def test_requirement_progress_response_carries_requirement_name():
    req = _requirement(name="Written Exam", req_type="knowledge_test")
    progress = SimpleNamespace(
        id=uuid4(),
        enrollment_id=uuid4(),
        requirement_id=req.id,
        status="in_progress",
        progress_value=1.0,
        progress_percentage=50.0,
        progress_notes=None,
        started_at=_NOW,
        completed_at=None,
        verified_by=None,
        verified_at=None,
        created_at=_NOW,
        updated_at=_NOW,
        requirement=req,
    )

    dumped = RequirementProgressResponse.model_validate(progress).model_dump()

    assert dumped["requirement"]["name"] == "Written Exam"
    assert dumped["requirement"]["requirement_type"] == "knowledge_test"
