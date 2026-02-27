"""
Skills Testing Pydantic Schemas

Request and response schemas for skills testing endpoints.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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


class SkillTemplateResponse(BaseModel):
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
    tags: Optional[list] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


class SkillTemplateListResponse(BaseModel):
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


class SkillTestUpdate(BaseModel):
    """Schema for updating a skill test (saving progress or results)"""

    status: Optional[str] = None
    section_results: Optional[List[SectionResultSchema]] = None
    overall_score: Optional[float] = Field(None, ge=0, le=100)
    elapsed_seconds: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None
    result: Optional[str] = None


class SkillTestResponse(BaseModel):
    """Schema for full skill test response"""

    id: UUID
    organization_id: UUID
    template_id: UUID
    candidate_id: UUID
    examiner_id: UUID
    status: str
    result: str
    is_practice: bool = False
    section_results: Optional[list] = None
    overall_score: Optional[float] = None
    elapsed_seconds: Optional[int] = None
    notes: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    # Denormalized display names (populated in endpoint)
    template_name: Optional[str] = None
    candidate_name: Optional[str] = None
    examiner_name: Optional[str] = None

    # Template structure for active test rendering
    template_sections: Optional[list] = None
    template_time_limit_seconds: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class SkillTestListResponse(BaseModel):
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
