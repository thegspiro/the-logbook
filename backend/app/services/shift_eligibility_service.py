"""
Shift Position Eligibility Service

Determines which shift positions a member is eligible to sign up for
based on their rank, completed training programs, org-wide open
positions, and membership type.
"""

import copy
from typing import List, Optional, Set

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operational_rank import OperationalRank
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    Shift,
    TrainingProgram,
)
from app.models.user import Organization, User

# Mapping from training program target_position values to the shift
# position they unlock upon completion.
TRAINING_POSITION_MAP = {
    "driver_candidate": "driver",
    "officer": "officer",
    "probationary": "probationary",
    "firefighter": "firefighter",
    "ems": "ems",
    "aic": "officer",
}

# Default membership types excluded from self-service shift signup.
DEFAULT_EXCLUDED_MEMBERSHIP_TYPES = [
    "administrative",
    "retired",
    "honorary",
    "prospective",
]


class ShiftEligibilityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Org settings helpers
    # ------------------------------------------------------------------

    async def _get_org(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        return result.scalar_one_or_none()

    def _get_scheduling_settings(self, org: Organization) -> dict:
        """Return the scheduling sub-dict from org.settings, or defaults."""
        return (org.settings or {}).get("scheduling", {})

    def get_excluded_membership_types(self, org: Organization) -> List[str]:
        """Return the list of membership types excluded from self-signup."""
        sched = self._get_scheduling_settings(org)
        return sched.get(
            "excluded_membership_types",
            DEFAULT_EXCLUDED_MEMBERSHIP_TYPES,
        )

    def get_open_positions(self, org: Organization) -> List[str]:
        """Return positions available to all eligible members."""
        sched = self._get_scheduling_settings(org)
        return sched.get("open_positions", [])

    # ------------------------------------------------------------------
    # Eligibility resolution
    # ------------------------------------------------------------------

    async def get_eligible_positions(
        self,
        user: User,
        organization_id: str,
        shift_id: Optional[str] = None,
    ) -> List[str]:
        """Compute the set of shift positions the user may sign up for.

        Resolution order:
        1. If a shift_id is provided and the shift is marked
           ``open_to_all_members``, return all positions defined on
           that shift (bypasses membership type and rank checks).
        2. Check membership type — if excluded, return empty list.
        3. Union of:
           a) Rank-based eligible_positions
           b) Training-completion-unlocked positions
           c) Org-wide open positions
        4. If a shift_id is provided, intersect with the shift's
           defined positions (only return positions that are actually
           on the shift).
        """
        org = await self._get_org(organization_id)
        if not org:
            return []

        # ----- Step 1: Check for open-to-all shift -----
        shift = None
        if shift_id:
            shift = await self._get_shift(shift_id, organization_id)
            if shift and shift.open_to_all_members:
                return self._shift_position_list(shift)

        # ----- Step 2: Membership type gate -----
        excluded = self.get_excluded_membership_types(org)
        member_type = getattr(user, "membership_type", None) or "active"
        if member_type in excluded:
            return []

        # ----- Step 3: Compute eligible positions -----
        eligible: Set[str] = set()

        # 3a: Rank-based
        rank_positions = await self._get_rank_positions(user.rank, organization_id)
        eligible.update(rank_positions)

        # 3b: Training-completion-based
        training_positions = await self._get_training_positions(
            str(user.id), organization_id
        )
        eligible.update(training_positions)

        # 3c: Org-wide open positions
        eligible.update(self.get_open_positions(org))

        # ----- Step 4: Intersect with shift positions if given -----
        if shift:
            shift_positions = set(self._shift_position_list(shift))
            if shift_positions:
                eligible = eligible & shift_positions

        return sorted(eligible)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_shift(self, shift_id: str, organization_id: str) -> Optional[Shift]:
        result = await self.db.execute(
            select(Shift).where(
                Shift.id == shift_id,
                Shift.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    def _shift_position_list(self, shift: Shift) -> List[str]:
        """Extract a flat list of position strings from a shift's positions JSON."""
        positions = shift.positions or []
        result = []
        for p in positions:
            if isinstance(p, str):
                result.append(p)
            elif isinstance(p, dict):
                pos = p.get("position", "")
                if pos:
                    result.append(pos)
        return result

    async def _get_rank_positions(
        self, rank_code: Optional[str], organization_id: str
    ) -> List[str]:
        """Look up eligible positions for the user's rank."""
        if not rank_code:
            return []
        result = await self.db.execute(
            select(OperationalRank.eligible_positions).where(
                OperationalRank.organization_id == organization_id,
                OperationalRank.rank_code == rank_code,
                OperationalRank.is_active.is_(True),
            )
        )
        row = result.scalar_one_or_none()
        return row if row else []

    async def _get_training_positions(
        self, user_id: str, organization_id: str
    ) -> List[str]:
        """Find shift positions unlocked by completed training programs."""
        result = await self.db.execute(
            select(TrainingProgram.target_position)
            .join(ProgramEnrollment)
            .where(
                ProgramEnrollment.user_id == user_id,
                TrainingProgram.organization_id == organization_id,
                ProgramEnrollment.status == EnrollmentStatus.COMPLETED,
                TrainingProgram.target_position.isnot(None),
            )
        )
        positions = []
        for (target_pos,) in result.all():
            mapped = TRAINING_POSITION_MAP.get(target_pos, target_pos)
            if mapped:
                positions.append(mapped)
        return positions

    # ------------------------------------------------------------------
    # Org settings management
    # ------------------------------------------------------------------

    async def update_scheduling_settings(
        self,
        organization_id: str,
        excluded_membership_types: Optional[List[str]] = None,
        open_positions: Optional[List[str]] = None,
    ) -> dict:
        """Update scheduling eligibility settings on the organization."""
        org = await self._get_org(organization_id)
        if not org:
            raise ValueError("Organization not found")

        settings = copy.deepcopy(org.settings or {})
        scheduling = settings.get("scheduling", {})

        if excluded_membership_types is not None:
            scheduling["excluded_membership_types"] = excluded_membership_types
        if open_positions is not None:
            scheduling["open_positions"] = open_positions

        settings["scheduling"] = scheduling
        org.settings = settings

        await self.db.commit()
        await self.db.refresh(org)

        return (org.settings or {}).get("scheduling", {})
