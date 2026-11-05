"""A Chief's override of a session-attendance requirement for one member.

Waiving a missed drill is routine and goes through a training waiver, which
excuses the day. An override is the rare exception: it counts a member as
meeting the requirement over a period the Chief chooses, however short their
attendance. The rules that keep it rare live here:

- only a requirement of type SESSION_ATTENDANCE with ``allows_chief_override``
  accepts one;
- only a member holding a Chief position (CHIEF_POSITION_SLUGS) may record or
  revoke one. It is a position, not a permission, on purpose: no role and no
  wildcard grant reaches it, the IT Manager's included;
- a reason is required, and an override is revoked rather than deleted, so
  who granted it stays on record.

Grading reads overrides through the waiver loaders (SOURCE_OVERRIDE in
training_waiver_service); nothing here touches a grader.
"""

from datetime import date, datetime, timezone
from typing import Dict, List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import CHIEF_POSITION_SLUGS
from app.models.training import (
    RequirementType,
    TrainingRequirement,
    TrainingRequirementOverride,
)
from app.models.user import User
from app.services.training_compliance import member_position_slugs
from app.utils.org_scoping import is_in_org


def holds_chief_position(user: User) -> bool:
    """Whether ``user`` holds a Chief position. ``user.positions`` must be loaded."""
    return any(slug in CHIEF_POSITION_SLUGS for slug in member_position_slugs(user))


def accepts_override(requirement: TrainingRequirement) -> bool:
    req_type = getattr(
        requirement.requirement_type, "value", requirement.requirement_type
    )
    return (
        req_type == RequirementType.SESSION_ATTENDANCE.value
        and requirement.allows_chief_override is True
    )


class RequirementOverrideService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_requirement(
        self, organization_id: str, requirement_id: str
    ) -> Optional[TrainingRequirement]:
        result = await self.db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.id == str(requirement_id),
                TrainingRequirement.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def list_overrides(
        self, organization_id: str, requirement_id: str
    ) -> List[TrainingRequirementOverride]:
        result = await self.db.execute(
            select(TrainingRequirementOverride)
            .where(
                TrainingRequirementOverride.organization_id == str(organization_id),
                TrainingRequirementOverride.requirement_id == str(requirement_id),
            )
            .order_by(TrainingRequirementOverride.granted_at.desc())
        )
        return list(result.scalars().all())

    async def names(self, user_ids: Sequence[Optional[str]]) -> Dict[str, str]:
        ids = {str(u) for u in user_ids if u}
        if not ids:
            return {}
        result = await self.db.execute(select(User).where(User.id.in_(ids)))
        return {str(u.id): u.display_name for u in result.scalars().all()}

    async def grant(
        self,
        organization_id: str,
        requirement: TrainingRequirement,
        user_id: str,
        start_date: date,
        end_date: date,
        reason: str,
        granted_by: str,
    ) -> TrainingRequirementOverride:
        """Record an override. Raises ValueError for a request the rules refuse."""
        if not accepts_override(requirement):
            raise ValueError("This requirement does not accept a Chief's override")
        if end_date < start_date:
            raise ValueError("The end date must be on or after the start date")
        if not await is_in_org(self.db, User, user_id, organization_id):
            raise ValueError("Member not found")
        for existing in await self.list_overrides(organization_id, requirement.id):
            if (
                existing.revoked_at is None
                and str(existing.user_id) == str(user_id)
                and existing.start_date <= end_date
                and start_date <= existing.end_date
            ):
                # Two live overrides over one day would make revoking either
                # one look as though it did nothing.
                raise ValueError(
                    "This member already has an override covering part of "
                    "those dates; revoke it first"
                )
        override = TrainingRequirementOverride(
            organization_id=str(organization_id),
            requirement_id=str(requirement.id),
            user_id=str(user_id),
            start_date=start_date,
            end_date=end_date,
            reason=reason,
            granted_by=str(granted_by),
        )
        self.db.add(override)
        await self.db.flush()
        return override

    async def revoke(
        self,
        organization_id: str,
        requirement_id: str,
        override_id: str,
        revoked_by: str,
    ) -> Optional[TrainingRequirementOverride]:
        """Revoke an override; None when there is no such override in the org."""
        result = await self.db.execute(
            select(TrainingRequirementOverride).where(
                TrainingRequirementOverride.id == str(override_id),
                TrainingRequirementOverride.requirement_id == str(requirement_id),
                TrainingRequirementOverride.organization_id == str(organization_id),
            )
        )
        override = result.scalar_one_or_none()
        if override is None:
            return None
        if override.revoked_at is None:
            override.revoked_at = datetime.now(timezone.utc)
            override.revoked_by = str(revoked_by)
            await self.db.flush()
        return override
