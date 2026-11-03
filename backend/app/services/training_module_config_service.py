"""
Training Module Configuration Service

Handles get/create/update of per-organization training visibility settings.
"""

from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    DEFAULT_PRACTICAL_SKILLS_METHOD,
    PRACTICAL_SKILLS_METHODS,
    TrainingModuleConfig,
)
from app.utils.model_updates import apply_updates

DEFAULT_VISIBILITY: Dict[str, Any] = {
    "show_training_history": True,
    "show_training_hours": True,
    "show_certification_status": True,
    "show_pipeline_progress": True,
    "show_requirement_details": True,
    "show_shift_reports": True,
    "show_shift_stats": True,
    "show_officer_narrative": False,
    "show_performance_rating": True,
    "show_areas_of_strength": True,
    "show_areas_for_improvement": True,
    "show_skills_observed": True,
    "show_submission_history": True,
    "allow_member_report_export": False,
    "report_review_required": False,
    "report_review_role": "training_officer",
    "rating_label": "Performance Rating",
    "rating_scale_type": "stars",
    "rating_scale_labels": None,
}


async def get_practical_skills_method(db: AsyncSession, organization_id: Any) -> str:
    """The practical-skills system this department runs.

    The one reader every backend caller goes through, so "which system is on"
    has a single answer. Reads the column without creating a config row, and
    treats a missing row, a NULL and an unrecognised value alike as the
    default — a scheduled task or a shift-report approval must not fail
    because somebody stored a value this code does not know.
    """
    stored = (
        await db.execute(
            select(TrainingModuleConfig.practical_skills_method).where(
                TrainingModuleConfig.organization_id == str(organization_id)
            )
        )
    ).scalar_one_or_none()
    if stored in PRACTICAL_SKILLS_METHODS:
        return str(stored)
    return DEFAULT_PRACTICAL_SKILLS_METHOD


class TrainingModuleConfigService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_config(self, organization_id: UUID | str) -> TrainingModuleConfig:
        """Get or create the config for an organization."""
        result = await self.db.execute(
            select(TrainingModuleConfig).where(
                TrainingModuleConfig.organization_id == str(organization_id)
            )
        )
        config: Optional[TrainingModuleConfig] = result.scalars().first()

        if not config:
            config = TrainingModuleConfig(organization_id=str(organization_id))
            self.db.add(config)
            await self.db.flush()
            await self.db.commit()
            await self.db.refresh(config)

        return config

    async def update_config(
        self,
        organization_id: UUID | str,
        updated_by: Optional[str] = None,
        **kwargs: Any,
    ) -> TrainingModuleConfig:
        """Update configuration fields. Only supplied fields are changed."""
        config = await self.get_config(organization_id)
        review_was_required = bool(config.report_review_required)

        apply_updates(config, kwargs)

        if updated_by:
            config.updated_by = str(updated_by)

        await self.db.commit()
        await self.db.refresh(config)

        if bool(config.report_review_required) != review_was_required:
            # Report review decides whether a shift evaluation is visible to
            # its member, and program credit follows visibility. Imported here
            # because the evaluation service reads this one's config.
            from app.services.shift_evaluation_service import ShiftEvaluationService

            await ShiftEvaluationService(self.db).sync_credit_for_organization(
                organization_id
            )
            await self.db.refresh(config)
        return config

    async def get_member_visibility(
        self, organization_id: UUID | str
    ) -> Dict[str, bool]:
        """Return the visibility dict for a member (lightweight)."""
        config = await self.get_config(organization_id)
        visibility: Dict[str, bool] = config.to_visibility_dict()
        return visibility
