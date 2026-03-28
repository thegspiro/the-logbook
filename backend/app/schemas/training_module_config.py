"""
Schemas for Training Module Configuration (Member Visibility Settings)
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import UTCResponseBase


class TrainingModuleConfigResponse(UTCResponseBase):
    """Response schema for training module configuration."""

    id: str
    organization_id: str

    # Training records & history
    show_training_history: bool
    show_training_hours: bool
    show_certification_status: bool

    # Pipeline / program progress
    show_pipeline_progress: bool
    show_requirement_details: bool

    # Shift completion reports
    show_shift_reports: bool
    show_shift_stats: bool

    # Officer-written content
    show_officer_narrative: bool
    show_performance_rating: bool
    show_areas_of_strength: bool
    show_areas_for_improvement: bool
    show_skills_observed: bool

    # Self-reported submissions
    show_submission_history: bool

    # Reports access
    allow_member_report_export: bool

    # Shift report review workflow
    report_review_required: bool = False
    report_review_role: str = "training_officer"

    # Rating customization
    rating_label: str = "Performance Rating"
    rating_scale_type: str = "stars"
    rating_scale_labels: Optional[dict] = None

    # Shift review defaults
    shift_review_call_types: Optional[List[str]] = None
    shift_review_default_skills: Optional[List[str]] = None
    shift_review_default_tasks: Optional[List[str]] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    updated_by: Optional[UUID] = None

    model_config = {"from_attributes": True}


class TrainingModuleConfigUpdate(BaseModel):
    """Update schema — all fields optional so departments can change one at a time."""

    show_training_history: Optional[bool] = None
    show_training_hours: Optional[bool] = None
    show_certification_status: Optional[bool] = None

    show_pipeline_progress: Optional[bool] = None
    show_requirement_details: Optional[bool] = None

    show_shift_reports: Optional[bool] = None
    show_shift_stats: Optional[bool] = None

    show_officer_narrative: Optional[bool] = None
    show_performance_rating: Optional[bool] = None
    show_areas_of_strength: Optional[bool] = None
    show_areas_for_improvement: Optional[bool] = None
    show_skills_observed: Optional[bool] = None

    show_submission_history: Optional[bool] = None

    allow_member_report_export: Optional[bool] = None

    # Shift report review workflow
    report_review_required: Optional[bool] = None
    report_review_role: Optional[str] = Field(None, max_length=50)

    # Rating customization
    rating_label: Optional[str] = Field(None, max_length=100)
    rating_scale_type: Optional[str] = Field(None, max_length=20)
    rating_scale_labels: Optional[dict] = None

    # Shift review defaults
    shift_review_call_types: Optional[List[str]] = None
    shift_review_default_skills: Optional[List[str]] = None
    shift_review_default_tasks: Optional[List[str]] = None


class MemberVisibilityResponse(BaseModel):
    """Lightweight response for members — just the boolean visibility flags."""

    show_training_history: bool
    show_training_hours: bool
    show_certification_status: bool
    show_pipeline_progress: bool
    show_requirement_details: bool
    show_shift_reports: bool
    show_shift_stats: bool
    show_officer_narrative: bool
    show_performance_rating: bool
    show_areas_of_strength: bool
    show_areas_for_improvement: bool
    show_skills_observed: bool
    show_submission_history: bool
    allow_member_report_export: bool
