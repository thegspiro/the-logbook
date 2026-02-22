"""
Training Module Configuration Service

Handles get/create/update of per-organization training visibility settings.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional, Dict, Any

from app.models.training import TrainingModuleConfig


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


class TrainingModuleConfigService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_config(self, organization_id: UUID) -> TrainingModuleConfig:
        """Get or create the config for an organization."""
        result = await self.db.execute(
            select(TrainingModuleConfig).where(
                TrainingModuleConfig.organization_id == str(organization_id)
            )
        )
        config = result.scalars().first()

        if not config:
            config = TrainingModuleConfig(organization_id=str(organization_id))
            self.db.add(config)
            await self.db.flush()
            await self.db.commit()
            await self.db.refresh(config)

        return config

    async def update_config(
        self,
        organization_id: UUID,
        updated_by: Optional[str] = None,
        **kwargs: Any,
    ) -> TrainingModuleConfig:
        """Update configuration fields. Only supplied fields are changed."""
        config = await self.get_config(organization_id)

        for key, value in kwargs.items():
            if value is not None and hasattr(config, key):
                setattr(config, key, value)

        if updated_by:
            config.updated_by = str(updated_by)

        await self.db.commit()
        await self.db.refresh(config)
        return config

    async def get_member_visibility(self, organization_id: UUID) -> Dict[str, bool]:
        """Return the visibility dict for a member (lightweight)."""
        config = await self.get_config(organization_id)
        return config.to_visibility_dict()
