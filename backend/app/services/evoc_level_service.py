"""
EVOC Level Service

Business logic for managing EVOC (Emergency Vehicle Operator Course)
certification levels and bridging training, apparatus operators, and
shift scheduling.
"""

from typing import List, Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.apparatus import Apparatus, ApparatusOperator, EvocLevel
from app.schemas.apparatus import EvocLevelCreate, EvocLevelUpdate


class EvocLevelService:
    """Service for EVOC level management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def create_level(
        self,
        data: EvocLevelCreate,
        organization_id: str,
    ) -> EvocLevel:
        """Create an EVOC level for the organization."""
        existing = await self.db.execute(
            select(EvocLevel).where(
                EvocLevel.organization_id == organization_id,
                EvocLevel.level_number == data.level_number,
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError(
                f"EVOC level {data.level_number} already exists for this organization"
            )

        code_check = await self.db.execute(
            select(EvocLevel).where(
                EvocLevel.organization_id == organization_id,
                EvocLevel.code == data.code,
            )
        )
        if code_check.scalar_one_or_none():
            raise ValueError(f"EVOC level code '{data.code}' already exists")

        level = EvocLevel(
            organization_id=organization_id,
            **data.model_dump(),
        )
        self.db.add(level)
        await self.db.commit()
        await self.db.refresh(level)
        return level

    async def list_levels(
        self,
        organization_id: str,
        active_only: bool = True,
    ) -> List[EvocLevel]:
        """List EVOC levels for an organization, ordered by level_number."""
        conditions = [
            EvocLevel.organization_id == organization_id,
        ]
        if active_only:
            conditions.append(EvocLevel.is_active.is_(True))

        result = await self.db.execute(
            select(EvocLevel)
            .where(and_(*conditions))
            .order_by(EvocLevel.level_number)
        )
        return list(result.scalars().all())

    async def get_level(
        self, level_id: str, organization_id: str
    ) -> Optional[EvocLevel]:
        """Get a single EVOC level."""
        result = await self.db.execute(
            select(EvocLevel).where(
                EvocLevel.id == level_id,
                EvocLevel.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_level(
        self,
        level_id: str,
        data: EvocLevelUpdate,
        organization_id: str,
    ) -> Optional[EvocLevel]:
        """Update an EVOC level."""
        level = await self.get_level(level_id, organization_id)
        if not level:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(level, field, value)

        await self.db.commit()
        await self.db.refresh(level)
        return level

    async def delete_level(
        self, level_id: str, organization_id: str
    ) -> bool:
        """Delete an EVOC level (only if not in use)."""
        level = await self.get_level(level_id, organization_id)
        if not level:
            return False

        if level.is_system:
            raise ValueError("Cannot delete system EVOC levels")

        apparatus_using = await self.db.execute(
            select(Apparatus.id).where(
                Apparatus.required_evoc_level_id == level_id,
                Apparatus.organization_id == organization_id,
            ).limit(1)
        )
        if apparatus_using.scalar_one_or_none():
            raise ValueError(
                "Cannot delete EVOC level that is assigned to apparatus. "
                "Remove the EVOC requirement from those apparatus first."
            )

        await self.db.delete(level)
        await self.db.commit()
        return True

    # ------------------------------------------------------------------
    # EVOC eligibility check (used by shift scheduling)
    # ------------------------------------------------------------------

    async def check_driver_evoc_eligibility(
        self,
        user_id: str,
        apparatus_id: str,
        organization_id: str,
    ) -> dict:
        """Check if a user meets the EVOC requirement for an apparatus.

        Returns a dict with:
          - eligible: bool
          - warning: optional warning message
          - required_level: the required EvocLevel (or None)
          - user_level: the user's highest qualifying EvocLevel (or None)
        """
        apparatus_result = await self.db.execute(
            select(Apparatus)
            .options(selectinload(Apparatus.required_evoc_level))
            .where(
                Apparatus.id == apparatus_id,
                Apparatus.organization_id == organization_id,
            )
        )
        apparatus = apparatus_result.scalar_one_or_none()
        if not apparatus or not apparatus.required_evoc_level_id:
            return {"eligible": True, "warning": None,
                    "required_level": None, "user_level": None}

        required_level = apparatus.required_evoc_level

        operator_result = await self.db.execute(
            select(ApparatusOperator)
            .options(selectinload(ApparatusOperator.evoc_level))
            .where(
                ApparatusOperator.user_id == user_id,
                ApparatusOperator.organization_id == organization_id,
                ApparatusOperator.is_active.is_(True),
                ApparatusOperator.evoc_level_id.isnot(None),
            )
        )
        operators = list(operator_result.scalars().all())

        user_max_level = None
        for op in operators:
            if op.evoc_level:
                if user_max_level is None or op.evoc_level.level_number > user_max_level.level_number:
                    user_max_level = op.evoc_level

        if not user_max_level:
            return {
                "eligible": False,
                "warning": (
                    f"This apparatus requires EVOC Level {required_level.level_number} "
                    f"({required_level.name}). This member has no EVOC certification."
                ),
                "required_level": required_level,
                "user_level": None,
            }

        meets_requirement = False
        if user_max_level.level_number >= required_level.level_number:
            if user_max_level.is_cumulative:
                meets_requirement = True
            elif user_max_level.level_number == required_level.level_number:
                meets_requirement = True

        if not meets_requirement:
            specific_match = await self.db.execute(
                select(ApparatusOperator)
                .where(
                    ApparatusOperator.user_id == user_id,
                    ApparatusOperator.organization_id == organization_id,
                    ApparatusOperator.is_active.is_(True),
                    ApparatusOperator.evoc_level_id == required_level.id,
                )
            )
            if specific_match.scalar_one_or_none():
                meets_requirement = True

        if meets_requirement:
            return {
                "eligible": True,
                "warning": None,
                "required_level": required_level,
                "user_level": user_max_level,
            }

        return {
            "eligible": False,
            "warning": (
                f"This apparatus requires EVOC Level {required_level.level_number} "
                f"({required_level.name}). This member has EVOC Level "
                f"{user_max_level.level_number} ({user_max_level.name})."
            ),
            "required_level": required_level,
            "user_level": user_max_level,
        }

    # ------------------------------------------------------------------
    # Auto-add operators when EVOC training completes
    # ------------------------------------------------------------------

    async def auto_add_operators_for_evoc_completion(
        self,
        user_id: str,
        evoc_level_id: str,
        organization_id: str,
        created_by: Optional[str] = None,
    ) -> List[ApparatusOperator]:
        """When a member completes an EVOC training program, automatically
        add them as a potential operator on all apparatus that require
        that EVOC level (or lower, if cumulative).

        Returns the list of newly created operator records.
        """
        level = await self.get_level(evoc_level_id, organization_id)
        if not level:
            return []

        all_levels = await self.list_levels(organization_id, active_only=True)

        qualifying_level_ids = {level.id}
        if level.is_cumulative:
            for lvl in all_levels:
                if lvl.level_number <= level.level_number:
                    qualifying_level_ids.add(lvl.id)

        apparatus_result = await self.db.execute(
            select(Apparatus).where(
                Apparatus.organization_id == organization_id,
                Apparatus.required_evoc_level_id.in_(qualifying_level_ids),
                Apparatus.is_archived.is_(False),
            )
        )
        target_apparatus = list(apparatus_result.scalars().all())

        new_operators = []
        for app in target_apparatus:
            existing = await self.db.execute(
                select(ApparatusOperator).where(
                    ApparatusOperator.apparatus_id == app.id,
                    ApparatusOperator.user_id == user_id,
                    ApparatusOperator.organization_id == organization_id,
                )
            )
            if existing.scalar_one_or_none():
                continue

            operator = ApparatusOperator(
                organization_id=organization_id,
                apparatus_id=app.id,
                user_id=user_id,
                evoc_level_id=evoc_level_id,
                is_certified=True,
                is_active=True,
                created_by=created_by,
            )
            self.db.add(operator)
            new_operators.append(operator)

        if new_operators:
            await self.db.commit()
            for op in new_operators:
                await self.db.refresh(op)

        return new_operators
