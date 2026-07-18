"""
Shift Position Eligibility Service

Determines which shift positions a member is eligible to sign up for
based on their rank, completed training programs, org-wide open
positions, membership type, and EVOC certification levels.
"""

import copy
from typing import Any, Dict, List, Optional, Set

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
from app.services.evoc_level_service import EvocLevelService

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

    def get_platoons_enabled(self, org: Organization) -> bool:
        """Whether platoon scheduling features are enabled for the org."""
        sched = self._get_scheduling_settings(org)
        return bool(sched.get("platoons_enabled", False))

    async def get_platoon_overview(
        self, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Group active members by platoon for the department-wide overview.

        Returns one group per named platoon (alphabetical) followed by the
        unassigned bucket (``platoon=None``). Members with no platoon are only
        included in the unassigned group.
        """
        result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.deleted_at.is_(None))
            .where(User.is_active)
            .order_by(User.last_name, User.first_name)
        )
        users = result.scalars().all()

        by_platoon: Dict[Optional[str], List[User]] = {}
        for u in users:
            key = (u.platoon or "").strip() or None
            by_platoon.setdefault(key, []).append(u)

        named = sorted(
            (k for k in by_platoon if k is not None), key=lambda s: s.upper()
        )
        ordered_keys: List[Optional[str]] = list(named)
        if None in by_platoon:
            ordered_keys.append(None)

        groups: List[Dict[str, Any]] = []
        for key in ordered_keys:
            members = by_platoon[key]
            groups.append(
                {
                    "platoon": key,
                    "member_count": len(members),
                    "members": [
                        {
                            "user_id": u.id,
                            "user_name": u.full_name,
                            "rank": u.rank,
                        }
                        for u in members
                    ],
                }
            )
        return groups

    async def bulk_assign_platoon(
        self,
        organization_id: str,
        user_ids: List[str],
        platoon: Optional[str],
    ) -> int:
        """Set (or clear) the platoon for many members at once.

        Only members belonging to ``organization_id`` are updated, so a caller
        cannot reassign users in another org (IDOR-safe). Returns the number of
        members actually updated.
        """
        normalized = (platoon or "").strip() or None
        result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.id.in_([str(uid) for uid in user_ids]))
            .where(User.deleted_at.is_(None))
        )
        members = result.scalars().all()
        for member in members:
            member.platoon = normalized
        await self.db.commit()
        return len(members)

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
        # A shift that defines positions narrows eligibility to those
        # positions. A shift with NO positions defined is intentionally
        # treated as "any position" — the member's full eligible set is
        # returned rather than an empty list (product decision: an unscoped
        # shift does not further restrict who may sign up).
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

    def get_overtime_settings(self, org: Organization) -> Dict[str, Any]:
        """Return the org's overtime advisory config.

        ``max_hours_per_window`` (0/absent disables the check) and
        ``hours_window_days`` (default 7).
        """
        sched = self._get_scheduling_settings(org)
        return {
            "max_hours_per_window": sched.get("max_hours_per_window"),
            "hours_window_days": sched.get("hours_window_days", 7),
        }

    def get_auto_generate_settings(self, org: Organization) -> Dict[str, Any]:
        """Return the org's auto shift-generation config."""
        sched = self._get_scheduling_settings(org)
        return {
            "auto_generate_enabled": bool(
                sched.get("auto_generate_enabled", False)
            ),
            "auto_generate_weeks": sched.get("auto_generate_weeks", 4),
        }

    def get_lifecycle_settings(self, org: Organization) -> Dict[str, Any]:
        """Return the org's shift-lifecycle enforcement toggles."""
        sched = self._get_scheduling_settings(org)
        return {
            "require_end_of_shift_checks": bool(
                sched.get("require_end_of_shift_checks", False)
            ),
            "restrict_checkin_to_assigned": bool(
                sched.get("restrict_checkin_to_assigned", False)
            ),
        }

    async def update_scheduling_settings(
        self,
        organization_id: str,
        excluded_membership_types: Optional[List[str]] = None,
        open_positions: Optional[List[str]] = None,
        platoons_enabled: Optional[bool] = None,
        max_hours_per_window: Optional[float] = None,
        hours_window_days: Optional[int] = None,
        auto_generate_enabled: Optional[bool] = None,
        auto_generate_weeks: Optional[int] = None,
        require_end_of_shift_checks: Optional[bool] = None,
        restrict_checkin_to_assigned: Optional[bool] = None,
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
        if platoons_enabled is not None:
            scheduling["platoons_enabled"] = platoons_enabled
        if max_hours_per_window is not None:
            # 0 clears the cap (disables the advisory).
            scheduling["max_hours_per_window"] = (
                max_hours_per_window if max_hours_per_window > 0 else None
            )
        if hours_window_days is not None:
            scheduling["hours_window_days"] = hours_window_days
        if auto_generate_enabled is not None:
            scheduling["auto_generate_enabled"] = auto_generate_enabled
        if auto_generate_weeks is not None:
            scheduling["auto_generate_weeks"] = auto_generate_weeks
        if require_end_of_shift_checks is not None:
            scheduling["require_end_of_shift_checks"] = require_end_of_shift_checks
        if restrict_checkin_to_assigned is not None:
            scheduling["restrict_checkin_to_assigned"] = restrict_checkin_to_assigned

        settings["scheduling"] = scheduling
        org.settings = settings

        await self.db.commit()
        await self.db.refresh(org)

        return (org.settings or {}).get("scheduling", {})

    # ------------------------------------------------------------------
    # EVOC-aware driver eligibility (soft warnings)
    # ------------------------------------------------------------------

    async def get_driver_assignment_warnings(
        self,
        user_id: str,
        shift_id: str,
        organization_id: str,
    ) -> List[Dict[str, Any]]:
        """Check EVOC eligibility for a driver assignment on a shift.

        If the shift has an apparatus_id and the user is being assigned
        as a driver, checks whether the user holds the required EVOC
        level. Returns a list of warning dicts (empty if no issues).

        This is a soft check — warnings do not block assignment.
        """
        shift = await self._get_shift(shift_id, organization_id)
        if not shift:
            return []

        apparatus_id = getattr(shift, "apparatus_id", None)
        if not apparatus_id:
            return []

        evoc_service = EvocLevelService(self.db)
        result = await evoc_service.check_driver_evoc_eligibility(
            user_id=user_id,
            apparatus_id=apparatus_id,
            organization_id=organization_id,
        )

        warnings: List[Dict[str, Any]] = []
        if not result["eligible"] and result["warning"]:
            warnings.append(
                {
                    "type": "evoc_mismatch",
                    "message": result["warning"],
                    "severity": "warning",
                }
            )

        return warnings
