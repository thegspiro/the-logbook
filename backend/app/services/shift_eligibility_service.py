"""
Shift Position Eligibility Service

Determines which shift positions a member is eligible to sign up for
based on their rank, completed training programs, org-wide open
positions, membership type, and EVOC certification levels.
"""

import copy
from datetime import date
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.apparatus import Apparatus, ApparatusOperator
from app.models.call_tracking import (
    DEFAULT_CALL_TYPES,
    CallTrackingMode,
)
from app.models.operational_rank import OperationalRank
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    Shift,
    TrainingProgram,
)
from app.models.user import Organization, User
from app.services.driver_exception_service import DriverExceptionService
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

    async def get_platoon_overview(self, organization_id: str) -> List[Dict[str, Any]]:
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
    # Department-wide position roster
    # ------------------------------------------------------------------

    async def get_position_roster(
        self,
        organization_id: str,
        position: str,
    ) -> Dict[str, Any]:
        """List every active member eligible for ``position``, and why.

        Answers "who is cleared to drive?" in one query set rather than making
        an officer open each apparatus in turn. For each member it reports the
        *sources* of their eligibility (rank, completed training, or the org's
        open-position list), their current EVOC standing, and the apparatus
        they hold an operator record on.

        Eligibility mirrors ``get_eligible_positions`` exactly — same union of
        rank / training / open positions behind the same membership-type gate —
        so the roster can never disagree with what self-signup enforces. The
        per-shift narrowing is deliberately not applied: this is the
        department-wide roster, not a roster for one shift.
        """
        org = await self._get_org(organization_id)
        if not org:
            return {
                "position": position,
                "members": [],
                "excluded_membership_types": [],
                "is_open_position": False,
            }

        excluded = self.get_excluded_membership_types(org)
        open_positions = self.get_open_positions(org)
        is_open = position in open_positions

        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.deleted_at.is_(None))
            .where(User.is_active)
            .order_by(User.last_name, User.first_name)
        )
        users = list(users_result.scalars().all())

        rank_map = await self._get_rank_map(organization_id)
        training_map = await self._get_training_program_map(organization_id, position)
        operator_map = await self._get_operator_map(organization_id)

        members: List[Dict[str, Any]] = []
        for user in users:
            member_type = getattr(user, "membership_type", None) or "active"
            if member_type in excluded:
                continue

            sources: List[Dict[str, Any]] = []

            rank_entry = rank_map.get(user.rank or "")
            if rank_entry and position in rank_entry["positions"]:
                sources.append(
                    {
                        "type": "rank",
                        "label": rank_entry["display_name"],
                    }
                )

            for program_name in training_map.get(str(user.id), []):
                sources.append({"type": "training", "label": program_name})

            if is_open:
                sources.append({"type": "open", "label": "Open to all members"})

            if not sources:
                continue

            operator_records = operator_map.get(str(user.id), [])
            evoc_level = self._highest_evoc(operator_records)

            members.append(
                {
                    "user_id": str(user.id),
                    "user_name": user.full_name,
                    "rank": user.rank,
                    "rank_display_name": (
                        rank_entry["display_name"] if rank_entry else None
                    ),
                    "membership_type": member_type,
                    "platoon": user.platoon,
                    "sources": sources,
                    "evoc_level_number": (
                        evoc_level.level_number if evoc_level else None
                    ),
                    "evoc_level_name": evoc_level.name if evoc_level else None,
                    "apparatus_cleared": [
                        {
                            "apparatus_id": rec["apparatus_id"],
                            "unit_number": rec["unit_number"],
                            "certification_expiration": rec["certification_expiration"],
                        }
                        for rec in operator_records
                    ],
                }
            )

        return {
            "position": position,
            "members": members,
            "excluded_membership_types": excluded,
            "is_open_position": is_open,
        }

    async def _get_rank_map(self, organization_id: str) -> Dict[str, Dict[str, Any]]:
        """rank_code -> {display_name, positions} for the org's active ranks."""
        result = await self.db.execute(
            select(
                OperationalRank.rank_code,
                OperationalRank.display_name,
                OperationalRank.eligible_positions,
            ).where(
                OperationalRank.organization_id == organization_id,
                OperationalRank.is_active.is_(True),
            )
        )
        return {
            rank_code: {
                "display_name": display_name,
                "positions": positions or [],
            }
            for rank_code, display_name, positions in result.all()
        }

    async def _get_training_program_map(
        self, organization_id: str, position: str
    ) -> Dict[str, List[str]]:
        """user_id -> names of completed programs that unlock ``position``.

        Uses the same ``TRAINING_POSITION_MAP`` translation as
        ``_get_training_positions`` so a ``driver_candidate`` program shows up
        on the driver roster.
        """
        result = await self.db.execute(
            select(
                ProgramEnrollment.user_id,
                TrainingProgram.name,
                TrainingProgram.target_position,
            )
            .join(TrainingProgram, ProgramEnrollment.program_id == TrainingProgram.id)
            .where(
                TrainingProgram.organization_id == organization_id,
                ProgramEnrollment.status == EnrollmentStatus.COMPLETED,
                TrainingProgram.target_position.isnot(None),
            )
        )

        by_user: Dict[str, List[str]] = {}
        for user_id, program_name, target_position in result.all():
            mapped = TRAINING_POSITION_MAP.get(target_position, target_position)
            if mapped == position:
                by_user.setdefault(str(user_id), []).append(program_name)
        return by_user

    async def _get_operator_map(
        self, organization_id: str
    ) -> Dict[str, List[Dict[str, Any]]]:
        """user_id -> current apparatus operator records, newest cert first.

        Only *current* certifications count, matching
        ``EvocLevelService.check_driver_evoc_eligibility``: active, certified,
        and not past expiration. An expired card must not read as cleared.
        """
        today = date.today()
        result = await self.db.execute(
            select(ApparatusOperator, Apparatus.unit_number)
            .join(Apparatus, ApparatusOperator.apparatus_id == Apparatus.id)
            .options(selectinload(ApparatusOperator.evoc_level))
            .where(
                ApparatusOperator.organization_id == organization_id,
                ApparatusOperator.is_active.is_(True),
                ApparatusOperator.is_certified.is_(True),
                Apparatus.is_archived.is_(False),
                or_(
                    ApparatusOperator.certification_expiration.is_(None),
                    ApparatusOperator.certification_expiration >= today,
                ),
            )
            .order_by(Apparatus.unit_number)
        )

        by_user: Dict[str, List[Dict[str, Any]]] = {}
        for operator, unit_number in result.all():
            by_user.setdefault(str(operator.user_id), []).append(
                {
                    "apparatus_id": str(operator.apparatus_id),
                    "unit_number": unit_number,
                    "certification_expiration": operator.certification_expiration,
                    "evoc_level": operator.evoc_level,
                }
            )
        return by_user

    @staticmethod
    def _highest_evoc(operator_records: List[Dict[str, Any]]):
        """The highest-numbered EVOC level across a member's operator records."""
        best = None
        for record in operator_records:
            level = record.get("evoc_level")
            if level is None:
                continue
            if best is None or level.level_number > best.level_number:
                best = level
        return best

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
            "auto_generate_enabled": bool(sched.get("auto_generate_enabled", False)),
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

    def get_call_tracking_settings(self, org: Organization) -> Dict[str, Any]:
        """Return the org's call-volume tracking config.

        Absence means ``detailed`` — the behaviour every existing org already
        has — never ``off``. Defaulting a missing setting to disabled would
        silently stop call logging for every installation on upgrade, and
        nobody connects a missing year of call volume back to a deploy
        (pitfall #19).

        ``call_types`` degrades to the built-in list rather than raising: this
        is unvalidated JSON an admin can edit, and an exception here would take
        out shift close-out for the whole department over one malformed entry.
        """
        sched = self._get_scheduling_settings(org)
        raw = sched.get("call_tracking")
        if not isinstance(raw, dict):
            raw = {}

        mode = raw.get("mode")
        if mode not in CallTrackingMode.ALL:
            mode = CallTrackingMode.DETAILED

        types = raw.get("call_types")
        clean_types = []
        if isinstance(types, list):
            for entry in types:
                if not isinstance(entry, dict):
                    continue
                slug = str(entry.get("slug") or "").strip()
                if not slug:
                    continue
                clean_types.append(
                    {"slug": slug, "label": str(entry.get("label") or slug).strip()}
                )
        if not clean_types:
            clean_types = [dict(t) for t in DEFAULT_CALL_TYPES]

        return {"mode": mode, "call_types": clean_types}

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
        enforce_evoc: Optional[bool] = None,
        call_tracking: Optional[Dict[str, Any]] = None,
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
        if enforce_evoc is not None:
            scheduling["enforce_evoc"] = enforce_evoc
        if call_tracking is not None:
            scheduling["call_tracking"] = call_tracking

        settings["scheduling"] = scheduling
        org.settings = settings

        await self.db.commit()
        await self.db.refresh(org)

        return (org.settings or {}).get("scheduling", {})

    # ------------------------------------------------------------------
    # EVOC-aware driver eligibility (enforcement + soft warnings)
    # ------------------------------------------------------------------

    def get_evoc_enforcement(self, org: Organization) -> bool:
        """Whether an EVOC shortfall blocks a driver assignment outright.

        Defaults to **True**. That is safe to switch on for existing orgs
        because the check is inert until someone deliberately sets
        ``required_evoc_level_id`` on an apparatus — an admin act. An org that
        genuinely wants advisory-only behavior turns it off explicitly.
        """
        sched = self._get_scheduling_settings(org)
        return bool(sched.get("enforce_evoc", True))

    async def evaluate_driver_assignment(
        self,
        user_id: str,
        shift_id: str,
        organization_id: str,
        on_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Decide whether a member may take the driver seat on a shift.

        Returns ``allowed``, a ``blocked_reason`` when it is not, any soft
        ``warnings``, and the ``exception`` that permitted an otherwise-blocked
        assignment so the caller can surface its operating restrictions.

        The single source of truth for driver enforcement. Both the member
        self-signup path and the officer assignment path route through it, so
        there is one place where the rule can be read and no second
        implementation to drift.
        """
        outcome: Dict[str, Any] = {
            "allowed": True,
            "blocked_reason": None,
            "warnings": [],
            "exception": None,
        }

        shift = await self._get_shift(shift_id, organization_id)
        if not shift:
            return outcome

        apparatus_id = getattr(shift, "apparatus_id", None)
        if not apparatus_id:
            # No apparatus on the shift means no EVOC requirement to check
            # against — the position is a label, not a seat behind a wheel.
            return outcome

        # The date the driving would happen, not today. A certification that
        # is current now but lapses before the shift does not qualify anyone to
        # drive it, and the exception lookup below already reasons about the
        # shift date — the two must agree or one of them is wrong.
        as_of = on_date or getattr(shift, "shift_date", None)

        evoc_service = EvocLevelService(self.db)
        result = await evoc_service.check_driver_evoc_eligibility(
            user_id=user_id,
            apparatus_id=apparatus_id,
            organization_id=organization_id,
            on_date=as_of,
        )
        if result["eligible"]:
            return outcome

        warning_text = result["warning"] or "EVOC requirement not met."
        outcome["warnings"] = [
            {
                "type": "evoc_mismatch",
                "message": warning_text,
                "severity": "warning",
            }
        ]

        org = await self._get_org(organization_id)
        if not org or not self.get_evoc_enforcement(org):
            return outcome

        # Blocked on certification — unless a chief has approved an exception
        # covering this member, this unit, and this date.
        exception = await DriverExceptionService(self.db).find_active_exception(
            user_id=user_id,
            organization_id=organization_id,
            apparatus_id=str(apparatus_id),
            on_date=as_of,
        )
        if exception:
            outcome["exception"] = exception
            outcome["warnings"] = [
                {
                    "type": "evoc_exception",
                    "message": (
                        f"{warning_text} Driving under a chief-approved "
                        f"exception valid through "
                        f"{exception.valid_until.isoformat()}."
                        + (
                            f" Restrictions: {exception.restrictions}"
                            if exception.restrictions
                            else ""
                        )
                    ),
                    "severity": "warning",
                }
            ]
            return outcome

        outcome["allowed"] = False
        outcome["blocked_reason"] = (
            f"{warning_text} Driver assignment is blocked until the "
            "certification is on file, or a chief approves a driver "
            "qualification exception for this member."
        )
        return outcome

    async def get_driver_assignment_warnings(
        self,
        user_id: str,
        shift_id: str,
        organization_id: str,
    ) -> List[Dict[str, Any]]:
        """Advisory EVOC warnings for a driver assignment that already passed.

        Thin wrapper over ``evaluate_driver_assignment`` — the decision lives
        there so enforcement and display cannot describe the same assignment
        differently. Reaching this method means the assignment was permitted,
        so any warning here is informational: either enforcement is off, or a
        chief-approved exception carried it.
        """
        outcome = await self.evaluate_driver_assignment(
            user_id=user_id,
            shift_id=shift_id,
            organization_id=organization_id,
        )
        return outcome["warnings"]
