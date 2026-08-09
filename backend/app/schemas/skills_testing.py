"""
Skills Testing Pydantic Schemas

Request and response schemas for skills testing endpoints.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import UTCResponseBase

# ============================================
# Criterion & Section Schemas (template structure)
# ============================================


class SkillCriterionSchema(BaseModel):
    """Schema for a single evaluation criterion within a template section"""

    label: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    type: str = Field(
        "pass_fail", max_length=50
    )  # pass_fail, score, checklist, time_limit, statement
    required: bool = False
    sort_order: int = 0
    passing_score: Optional[float] = Field(None, ge=0)
    max_score: Optional[float] = Field(None, ge=0)
    time_limit_seconds: Optional[int] = Field(None, ge=0)
    checklist_items: Optional[List[str]] = None
    statement_text: Optional[str] = None


class SkillTemplateSectionSchema(BaseModel):
    """Schema for a section within a skill template"""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    sort_order: int = 0
    criteria: List[SkillCriterionSchema] = Field(default_factory=list)


# ============================================
# Skill Template Schemas
# ============================================


class SkillTemplateCreate(BaseModel):
    """Schema for creating a new skill template"""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    sections: List[SkillTemplateSectionSchema] = Field(..., min_length=1)
    time_limit_seconds: Optional[int] = Field(None, ge=0)
    passing_percentage: Optional[float] = Field(None, ge=0, le=100)
    require_all_critical: bool = True
    tags: Optional[List[str]] = None
    visibility: str = "all_members"
    # Optional pipeline requirement this template's tests satisfy (hybrid link:
    # tests inherit it, overridable per test).
    requirement_id: Optional[UUID] = None
    # Result disclosure — omit to inherit the organization default. See
    # ResultDisclosure / ResultRelease.
    result_disclosure: Optional[str] = None
    result_release: Optional[str] = None
    # Corporate position slugs whose holders may view results of these tests.
    result_viewer_positions: Optional[List[str]] = None


class SkillTemplateUpdate(BaseModel):
    """Schema for updating a skill template"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    sections: Optional[List[SkillTemplateSectionSchema]] = None
    time_limit_seconds: Optional[int] = Field(None, ge=0)
    passing_percentage: Optional[float] = Field(None, ge=0, le=100)
    require_all_critical: Optional[bool] = None
    tags: Optional[List[str]] = None
    visibility: Optional[str] = None
    requirement_id: Optional[UUID] = None
    # Result disclosure — omit to inherit the organization default. See
    # ResultDisclosure / ResultRelease.
    result_disclosure: Optional[str] = None
    result_release: Optional[str] = None
    # Corporate position slugs whose holders may view results of these tests.
    result_viewer_positions: Optional[List[str]] = None


class SkillTemplateResponse(UTCResponseBase):
    """Schema for full skill template response"""

    id: UUID
    organization_id: UUID
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    version: int
    status: str
    visibility: str = "all_members"
    sections: list  # JSON — list of SkillTemplateSectionSchema dicts
    time_limit_seconds: Optional[int] = None
    passing_percentage: Optional[float] = None
    require_all_critical: bool
    requirement_id: Optional[UUID] = None
    result_disclosure: Optional[str] = None
    result_release: Optional[str] = None
    result_viewer_positions: Optional[list] = None
    tags: Optional[list] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


class SkillTemplateListResponse(UTCResponseBase):
    """Schema for skill template list items (summary view)"""

    id: UUID
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    status: str
    visibility: str = "all_members"
    version: int
    section_count: int = 0
    criteria_count: int = 0
    requirement_id: Optional[UUID] = None
    tags: Optional[list] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Criterion & Section Result Schemas (test results)
# ============================================


class CriterionResultSchema(BaseModel):
    """Schema for a single criterion evaluation result"""

    criterion_id: Optional[str] = None
    criterion_label: Optional[str] = None
    passed: Optional[bool] = None
    score: Optional[float] = None
    time_seconds: Optional[int] = None
    checklist_completed: Optional[List[bool]] = None
    notes: Optional[str] = None


class SectionResultSchema(BaseModel):
    """Schema for a section evaluation result"""

    section_id: Optional[str] = None
    section_name: Optional[str] = None
    criteria_results: List[CriterionResultSchema] = Field(default_factory=list)
    section_score: Optional[float] = None
    section_passed: Optional[bool] = None
    notes: Optional[str] = None


# ============================================
# Skill Test Schemas
# ============================================


class SkillTestCreate(BaseModel):
    """Schema for creating (starting) a new skill test session"""

    template_id: UUID
    candidate_id: UUID
    notes: Optional[str] = None
    is_practice: bool = False
    # Override the requirement this specific test satisfies; defaults to the
    # template's requirement when omitted.
    requirement_id: Optional[UUID] = None
    # Per-test disclosure overrides; omit to inherit the template's.
    result_disclosure: Optional[str] = None
    result_release: Optional[str] = None
    result_viewer_positions: Optional[List[str]] = None


class SkillTestUpdate(BaseModel):
    """Schema for updating a skill test (saving progress or results)"""

    status: Optional[str] = None
    section_results: Optional[List[SectionResultSchema]] = None
    overall_score: Optional[float] = Field(None, ge=0, le=100)
    elapsed_seconds: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None
    result: Optional[str] = None
    requirement_id: Optional[UUID] = None
    result_disclosure: Optional[str] = None
    result_release: Optional[str] = None
    result_viewer_positions: Optional[List[str]] = None
    # Optimistic concurrency: the version the client last saw. Omit to keep the
    # previous last-write-wins behavior; send it to be refused with 409 rather
    # than silently overwriting a concurrent edit.
    expected_version: Optional[int] = None


class SkillTestCandidateResponse(BaseModel):
    """One selectable candidate for the start-test picker.

    Deliberately just an id and a display name. Every member can call the
    endpoint that returns these, so it carries none of the contact information
    the member admin payload governs behind organization visibility settings.
    """

    id: UUID
    name: str


class SkillTestViewerCreate(BaseModel):
    """Grant one member sight of a single test's result."""

    user_id: UUID


class SkillTestViewerResponse(UTCResponseBase):
    """A standing grant on one test."""

    id: UUID
    test_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    granted_by: Optional[UUID] = None
    granted_by_name: Optional[str] = None
    granted_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class SkillTestCancelRequest(BaseModel):
    """Schema for cancelling a test abandoned before it was scored.

    The reason is optional — unlike a void, a cancellation withdraws no result
    and makes no claim about the candidate, so there is nothing a reader needs
    explained. It is appended to the test's notes when given.
    """

    reason: Optional[str] = Field(None, max_length=1000)


class SkillTestVoidRequest(BaseModel):
    """Schema for voiding an official test result.

    The reason is mandatory and non-trivial: a voided result stays visible in
    the candidate's history, so the record has to say why it was withdrawn.
    """

    reason: str = Field(..., min_length=10, max_length=1000)


class SkillTestResponse(UTCResponseBase):
    """Schema for full skill test response"""

    id: UUID
    organization_id: UUID
    template_id: UUID
    candidate_id: UUID
    examiner_id: UUID
    requirement_id: Optional[UUID] = None
    status: str
    result: str
    is_practice: bool = False
    # Optimistic-concurrency counter; send it back as expected_version on write.
    version: int = 1
    section_results: Optional[list] = None
    overall_score: Optional[float] = None
    elapsed_seconds: Optional[int] = None
    notes: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    # Overrides set on this test itself. Usually null — the setting normally
    # lives on the template or the department default — so a UI that wants to
    # tell an officer what the candidate will see must read the effective_*
    # fields below, not these.
    result_disclosure: Optional[str] = None
    result_release: Optional[str] = None
    result_viewer_positions: Optional[list] = None
    released_at: Optional[datetime] = None
    released_by: Optional[UUID] = None

    # The policy actually in force, resolved down the test → template →
    # department chain. Sent so the officer-facing UI can state, before they
    # accept or void a result, exactly what the member will end up seeing —
    # without reimplementing the inheritance rules in TypeScript.
    effective_result_disclosure: Optional[str] = None
    effective_result_release: Optional[str] = None

    # Void trail — populated only when an official result has been withdrawn.
    voided_at: Optional[datetime] = None
    voided_by: Optional[UUID] = None
    void_reason: Optional[str] = None

    # Validation trail — an official result counts only once a training officer
    # signs it off. Unset while a member-run test awaits review; set in the same
    # step when an officer completes the test themselves.
    validated_at: Optional[datetime] = None
    validated_by: Optional[UUID] = None
    # Derived: a completed official test with no sign-off yet. Sent so the UI
    # does not have to re-derive the rule from three separate fields.
    pending_validation: bool = False

    # Denormalized display names (populated in endpoint)
    template_name: Optional[str] = None
    candidate_name: Optional[str] = None
    examiner_name: Optional[str] = None
    voided_by_name: Optional[str] = None
    validated_by_name: Optional[str] = None

    # Template structure for active test rendering
    template_sections: Optional[list] = None
    template_time_limit_seconds: Optional[int] = None
    # Scoring rule the examiner screen has to state out loud: when this is on,
    # a critical criterion left unscored counts as a failure (see
    # calculate_test_result), so the UI warns before the test is submitted.
    template_require_all_critical: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)


class SkillTestListResponse(UTCResponseBase):
    """Schema for skill test list items (summary view)"""

    id: UUID
    template_id: UUID
    template_name: Optional[str] = None
    candidate_id: UUID
    candidate_name: Optional[str] = None
    examiner_id: UUID
    examiner_name: Optional[str] = None
    status: str
    result: str
    is_practice: bool = False
    overall_score: Optional[float] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    voided_at: Optional[datetime] = None
    validated_at: Optional[datetime] = None
    pending_validation: bool = False

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Summary / Stats
# ============================================


class SkillTestingSummaryResponse(BaseModel):
    """Overall skills testing summary statistics"""

    total_templates: int = 0
    published_templates: int = 0
    total_tests: int = 0
    tests_this_month: int = 0
    pass_rate: Optional[float] = None
    average_score: Optional[float] = None
    # Member-run official results waiting on an officer's sign-off. Drives the
    # review queue badge; 0 for readers who cannot validate.
    pending_validation: int = 0
