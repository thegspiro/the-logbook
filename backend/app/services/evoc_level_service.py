"""
EVOC Level Service

Business logic for managing EVOC (Emergency Vehicle Operator Course)
certification levels and bridging training, apparatus operators, and
shift scheduling.
"""

from datetime import date
from typing import List, Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.apparatus import Apparatus, ApparatusOperator, EvocLevel
from app.models.training import TrainingProgram
from app.schemas.apparatus import EvocLevelCreate, EvocLevelUpdate
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org

# The NFPA 1451 / national EVOC tiering most departments start from. Seeded
# per-organization (rather than as org-agnostic system rows) because each level
# carries a ``training_program_id`` pointing at that department's own
# certifying program — a shared row would leak that link across tenants.
# Format: (level_number, name, code, description)
DEFAULT_EVOC_LEVELS = [
    (
        1,
        "EVOC 1 - Light Vehicle",
        "EVOC1",
        "Staff cars, utility vehicles, and other light apparatus.",
    ),
    (
        2,
        "EVOC 2 - Ambulance",
        "EVOC2",
        "Ambulances and medium-duty apparatus.",
    ),
    (
        3,
        "EVOC 3 - Engine / Pumper",
        "EVOC3",
        "Engines, pumpers, tankers, and other heavy apparatus.",
    ),
    (
        4,
        "EVOC 4 - Aerial",
        "EVOC4",
        "Aerials, ladders, tillers, and specialized heavy apparatus.",
    ),
]


class EvocLevelService:
    """Service for EVOC level management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Seed
    # ------------------------------------------------------------------

    async def seed_defaults(self, organization_id: str) -> List[EvocLevel]:
        """Insert the standard EVOC 1-4 ladder for an org that has none.

        Called lazily from the list endpoint, mirroring
        ``OperationalRankService.seed_defaults``. The guard counts *all* rows
        (not just active ones), so deactivating a level the department does not
        use will not cause it to reappear. Deleting every level does re-seed on
        the next read — the same trade-off the rank list makes, and the reason
        the UI offers deactivation alongside deletion.
        """
        result = await self.db.execute(
            select(func.count(EvocLevel.id)).where(
                EvocLevel.organization_id == organization_id,
            )
        )
        if result.scalar() > 0:
            return []

        levels = []
        for level_number, name, code, description in DEFAULT_EVOC_LEVELS:
            level = EvocLevel(
                organization_id=organization_id,
                level_number=level_number,
                name=name,
                code=code,
                description=description,
                is_cumulative=True,
                # Deliberately not is_system: a department with a two-tier
                # ladder must be able to remove the levels it does not use.
                is_system=False,
                sort_order=level_number,
                is_active=True,
            )
            self.db.add(level)
            levels.append(level)

        await self.db.flush()
        # Refresh server-computed timestamps to prevent MissingGreenlet when the
        # response schema serializes created_at/updated_at.
        for level in levels:
            await self.db.refresh(level, attribute_names=["created_at", "updated_at"])
        return levels

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def _assert_program_in_org(
        self, training_program_id: Optional[str], organization_id: str
    ) -> None:
        """Reject a certifying-program id belonging to another org (XC-1).

        The link is what ``_handle_evoc_completion`` matches enrollments
        against, so a foreign id would let one org's program completion mint
        operator records under this org's apparatus.
        """
        await assert_in_org(
            self.db,
            TrainingProgram,
            training_program_id,
            organization_id,
            allow_none=True,
            label="training program",
        )

    async def create_level(
        self,
        data: EvocLevelCreate,
        organization_id: str,
    ) -> EvocLevel:
        """Create an EVOC level for the organization."""
        await self._assert_program_in_org(data.training_program_id, organization_id)

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
            select(EvocLevel).where(and_(*conditions)).order_by(EvocLevel.level_number)
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

        if "training_program_id" in update_data:
            await self._assert_program_in_org(
                update_data["training_program_id"], organization_id
            )

        # Renumbering or recoding a level must not collide with a sibling —
        # the (organization_id, level_number) and (organization_id, code)
        # indexes are unique, and an IntegrityError here surfaces as a 500.
        new_number = update_data.get("level_number")
        if new_number is not None and new_number != level.level_number:
            clash = await self.db.execute(
                select(EvocLevel.id).where(
                    EvocLevel.organization_id == organization_id,
                    EvocLevel.level_number == new_number,
                    EvocLevel.id != level_id,
                )
            )
            if clash.scalar_one_or_none():
                raise ValueError(
                    f"EVOC level {new_number} already exists for this organization"
                )

        new_code = update_data.get("code")
        if new_code is not None and new_code != level.code:
            clash = await self.db.execute(
                select(EvocLevel.id).where(
                    EvocLevel.organization_id == organization_id,
                    EvocLevel.code == new_code,
                    EvocLevel.id != level_id,
                )
            )
            if clash.scalar_one_or_none():
                raise ValueError(f"EVOC level code '{new_code}' already exists")

        apply_updates(level, update_data, skip={"organization_id", "id"})

        await self.db.commit()
        await self.db.refresh(level)
        return level

    async def delete_level(self, level_id: str, organization_id: str) -> bool:
        """Delete an EVOC level (only if not in use)."""
        level = await self.get_level(level_id, organization_id)
        if not level:
            return False

        if level.is_system:
            raise ValueError("Cannot delete system EVOC levels")

        apparatus_using = await self.db.execute(
            select(Apparatus.id)
            .where(
                Apparatus.required_evoc_level_id == level_id,
                Apparatus.organization_id == organization_id,
            )
            .limit(1)
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
        on_date: Optional[date] = None,
    ) -> dict:
        """Check if a user meets the EVOC requirement for an apparatus.

        ``on_date`` is the date the driving would happen — the shift's date,
        not today. Scheduling is a forward-looking act: a certification that
        is current now but lapses before the shift does not qualify anyone to
        drive it, and defaulting to today silently seated members on shifts
        their card would not cover.

        Returns a dict with:
          - eligible: bool
          - warning: optional warning message
          - required_level: the required EvocLevel (or None)
          - user_level: the qualifying EvocLevel (or the highest held)
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
            return {
                "eligible": True,
                "warning": None,
                "required_level": None,
                "user_level": None,
            }

        required_level = apparatus.required_evoc_level

        # A driver only qualifies on a certification current *on the day they
        # would drive*: active, certified, and not past its expiration as of
        # that date. Without the is_certified / expiration filters an expired
        # EVOC certification still counted as valid (nothing flips is_active
        # off on expiry), letting an out-of-cert member drive without a
        # warning.
        as_of = on_date or date.today()
        current_cert = (
            ApparatusOperator.is_active.is_(True),
            ApparatusOperator.is_certified.is_(True),
            or_(
                ApparatusOperator.certification_expiration.is_(None),
                ApparatusOperator.certification_expiration >= as_of,
            ),
        )

        operator_result = await self.db.execute(
            select(ApparatusOperator)
            .options(selectinload(ApparatusOperator.evoc_level))
            .where(
                ApparatusOperator.user_id == user_id,
                ApparatusOperator.organization_id == organization_id,
                *current_cert,
                ApparatusOperator.evoc_level_id.isnot(None),
            )
        )
        operators = list(operator_result.scalars().all())

        held_levels = [op.evoc_level for op in operators if op.evoc_level]

        if not held_levels:
            return {
                "eligible": False,
                "warning": (
                    f"This apparatus requires EVOC Level {required_level.level_number} "
                    f"({required_level.name}). This member has no EVOC certification."
                ),
                "required_level": required_level,
                "user_level": None,
            }

        user_max_level = max(held_levels, key=lambda level: level.level_number)

        # Every certification the member holds is considered, not just the
        # highest-numbered one. Judging on the maximum alone rejected a member
        # holding cumulative Level 3 *and* non-cumulative Level 4 for a Level 2
        # apparatus: the max (4) is not cumulative and is not an exact match,
        # so the cumulative 3 that plainly covers it never got a look. That was
        # a spurious warning before enforcement; it is now a refusal to let
        # somebody drive, which makes it worth getting right.
        def _covers(level) -> bool:
            if level.level_number == required_level.level_number:
                return True
            return level.is_cumulative and level.level_number > (
                required_level.level_number
            )

        qualifying = [level for level in held_levels if _covers(level)]
        meets_requirement = bool(qualifying)
        if meets_requirement:
            # Report the lowest level that actually satisfies the requirement —
            # that is the one being relied on.
            user_max_level = min(qualifying, key=lambda level: level.level_number)

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
        completion_credit_id: Optional[str] = None,
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
                completion_credit_id=completion_credit_id,
            )
            self.db.add(operator)
            new_operators.append(operator)

        if new_operators:
            await self.db.commit()
            for op in new_operators:
                await self.db.refresh(op)

        return new_operators
