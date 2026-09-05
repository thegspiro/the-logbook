"""
Shift Position Eligibility Service

Determines which shift positions a member is eligible to sign up for
based on their rank, qualifications, completed training programs,
org-wide open positions, membership type, and EVOC certification levels.
"""

import copy
import re
from datetime import date
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.apparatus import Apparatus, ApparatusOperator
from app.models.call_tracking import (
    DEFAULT_CALL_TYPES,
    UNCLASSIFIED_CALL_TYPE,
    CallTrackingMode,
)
from app.models.operational_rank import OperationalRank
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    Shift,
    TrainingProgram,
)
from app.models.user import (
    Organization,
    Position,
    User,
    UserStatus,
    user_positions,
)
from app.services.driver_exception_service import DriverExceptionService
from app.services.evoc_level_service import EvocLevelService
from app.services.operational_rank_service import DEFAULT_RANKS
from app.services.qualification_service import (
    QualificationService,
    positions_for_qualifications,
    qualification_label,
)
from app.utils.membership import (
    effective_member_class,
    is_administrative,
    is_operational,
)

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

# Signup-window defaults.
#
# Zero minutes before start: self-signup stays open right up to the start
# instant, which is the behaviour every existing department already has.
# Sixty after: an officer arriving to a short crew has the hour that actually
# matters operationally, and past it a scheduling administrator — or a
# per-shift reopening — is still the way in.
DEFAULT_SIGNUP_CLOSES_MINUTES_BEFORE = 0
DEFAULT_LATE_SIGNUP_GRACE_MINUTES = 60

# Default membership types excluded from self-service shift signup.
DEFAULT_EXCLUDED_MEMBERSHIP_TYPES = [
    "administrative",
    "retired",
    "honorary",
    "prospective",
]

# rank_code -> the shift positions that rank may fill, and rank_code -> label,
# both derived from the seed set so there is one source of truth.
#
# These are the *fallback* for a code the organization has no
# ``operational_ranks`` row for. ``seed_defaults`` only inserts when the table
# is empty for the org, so a department onboarded before a code was added to
# DEFAULT_RANKS never receives it — and without a fallback every member
# carrying that code resolves to zero eligible positions and is refused
# self-signup with no way to tell why.
DEFAULT_RANK_ELIGIBILITY: Dict[str, List[str]] = {
    code: list(positions) for code, _label, _order, positions in DEFAULT_RANKS
}
DEFAULT_RANK_LABELS: Dict[str, str] = {
    code: label for code, label, _order, _positions in DEFAULT_RANKS
}


# Mirrors the pattern and length bound on CallTypeOption. Kept beside the
# sanitizer so the two cannot drift into rejecting different things.
_CALL_TYPE_SLUG = re.compile(r"[a-z0-9_]{1,50}")

# Matches CallTypeOption.label's own ceiling.
_CALL_TYPE_LABEL_MAX = 100


def _label_key(label: str) -> str:
    """How two call-type labels are compared for sameness on screen."""
    return " ".join(label.split()).casefold()


def _disambiguate_label(label: str, slug: str, taken: set) -> str:
    """Make ``label`` unique among ``taken``, without exceeding the cap.

    Naively appending the slug and slicing back to the cap is a no-op on a
    label that already fills it, which leaves the duplicate in place and makes
    the schema reject the very output this reader exists to keep valid — a 500
    on the one endpoint that could fix the stored data.
    """
    if _label_key(label) not in taken:
        return label
    attempt = 0
    while True:
        suffix = f" ({slug})" if attempt == 0 else f" ({slug} {attempt + 1})"
        base = label[: max(1, _CALL_TYPE_LABEL_MAX - len(suffix))]
        candidate = f"{base}{suffix}"[:_CALL_TYPE_LABEL_MAX]
        # Terminates: the slug is unique within the list, so at worst the
        # counter walks to a spelling nothing else holds.
        if _label_key(candidate) not in taken:
            return candidate
        attempt += 1


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

    @staticmethod
    def _account_is_active(user) -> bool:
        """Whether this member's account is in a state that can work a shift.

        ``User.status`` and the member's *standing* are two different axes that
        share three spellings, and nothing reconciles them: retiring somebody
        through ``POST /member-status/{id}/status`` sets ``status`` and never
        touches ``membership_type``, so a retired member reads as a regular
        operational one to every rule that consults membership.

        ``get_position_roster`` already filters ``User.is_active`` and so gets
        this right; self-signup did not, which made the roster stricter than the
        endpoint it exists to mirror.

        This is not closing a stale-session gap: ``get_current_user`` calls
        ``AuthService.get_user_from_token``, which reloads the user on every
        request and returns ``None`` unless ``is_active`` holds, so a member's
        own session is already rejected the request after their status
        changes. The gap this closes is narrower and does not run through
        that check at all — ``_validate_assignment_candidate``'s
        ``enforce_position_eligibility`` branch loads the *candidate* by a
        client-supplied ``user_id`` with no status filter, and that candidate
        is not always the caller: an officer's own session is perfectly valid
        while they assign a *different*, now-retired or suspended member to a
        shift (``create_assignment`` with ``self_signup=False``). Without this
        check, that target's inactive status was never consulted by anything.

        Absent status means "not a real User row" — a stub, or a caller passing
        a lighter object — and is left alone rather than guessed at. The gate is
        for the values that explicitly say the account is no longer active.
        """
        status_value = getattr(user, "status", None)
        if status_value is None:
            return True
        raw = getattr(status_value, "value", status_value)
        return str(raw) == UserStatus.ACTIVE.value

    async def get_eligible_positions(
        self,
        user: User,
        organization_id: str,
        shift_id: Optional[str] = None,
    ) -> List[str]:
        """Compute the set of shift positions the user may sign up for.

        Resolution order:
        0. Check account status — a member whose account is no longer active
           is eligible for nothing, including an open-to-all shift.
        1. If a shift_id is provided and the shift is marked
           ``open_to_all_members``, return all positions defined on
           that shift (bypasses membership type and rank checks).
        2. Check membership type — if excluded, return empty list.
        3. Union of:
           a) Rank-based eligible_positions
           b) Qualification-based positions (what the member is *certified*
              to do, as of the shift date)
           c) Training-completion-unlocked positions
           d) Org-wide open positions
        4. If a shift_id is provided, intersect with the shift's
           defined positions (only return positions that are actually
           on the shift).
        """
        org = await self._get_org(organization_id)
        if not org:
            return []

        # ----- Step 0: Account status -----
        # Ahead of the open-to-all bypass, deliberately. "Open to all members"
        # waives the membership-type and rank checks; it does not make a
        # dropped, suspended or archived account a member again.
        if not self._account_is_active(user):
            return []

        administrative = is_administrative(
            getattr(user, "member_class", None),
            getattr(user, "membership_type", None),
        )
        # Affirmative, not "is not one of the two non-riding classes". The
        # bypass below waives the membership-type, rank, training and
        # qualification checks in one step, so it has to be granted on a class
        # that is actually established. A member whose class cannot be
        # resolved — a legacy row carrying a custom tier, written before the
        # reconciler stopped erasing the class — falls through to the normal
        # eligibility path instead, which is the safe direction: they are
        # judged on rank and training rather than handed every seat.
        can_ride = is_operational(
            effective_member_class(
                getattr(user, "member_class", None),
                getattr(user, "membership_type", None),
            )
        )

        # ----- Step 1: Check for open-to-all shift -----
        shift = None
        if shift_id:
            shift = await self._get_shift(shift_id, organization_id)
            if shift and administrative:
                return self._administrative_shift_positions(shift)
            if shift and shift.open_to_all_members and can_ride:
                return self._shift_position_list(shift)

        # ----- Step 2: Membership type gate -----
        excluded = self.get_excluded_membership_types(org)
        member_type = getattr(user, "membership_type", None) or "active"
        if member_type in excluded:
            return []

        # ----- Step 3: Compute eligible positions -----
        eligible: Set[str] = set()
        slug_map = await self._get_slug_eligibility_map(organization_id)

        # 3a: Rank-based
        eligible.update(self._positions_for_slugs([user.rank], slug_map))

        # Keep consuming the existing query result for compatibility with
        # lightweight session adapters, but never turn RBAC position names into
        # operational qualifications.
        await self._get_held_position_slugs(str(user.id), organization_id)

        # 3b: Qualification-based.
        #
        # Rank says where a member sits in the chain of command; a
        # qualification says what they are trained to do, and the two are
        # independent. A Captain may also be a Paramedic, and until
        # qualifications existed there was nowhere to record the second half
        # of that. Asked as of the shift date rather than today: a
        # certification that is current now and lapses before the shift
        # qualifies nobody to work it.
        eligible.update(
            await self._get_qualification_positions(
                str(user.id), organization_id, self._shift_date(shift)
            )
        )

        # 3c: Training-completion-based
        training_positions = await self._get_training_positions(
            str(user.id), organization_id
        )
        eligible.update(training_positions)

        # 3d: Org-wide open positions
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

    async def get_eligible_positions_bulk(
        self,
        user: User,
        organization_id: str,
        shift_ids: List[str],
    ) -> Dict[str, List[str]]:
        """The same answer as ``get_eligible_positions``, for many shifts at once.

        Steps 0–3 above are about the *member* — their account status,
        membership type, rank,
        qualifications, completed training, and the org's open positions — and
        do not vary by shift. Asking per shift re-ran all of it and reloaded the same maps
        each time; a day panel showing two shifts paid for it twice, and a
        station running six apparatus paid six times for one answer.

        Only the open-to-all check and the intersection with the shift's own
        positions are per shift, and both are pure work over rows this loads in
        a single query.
        """
        if not shift_ids:
            return {}

        org = await self._get_org(organization_id)
        if not org:
            return {shift_id: [] for shift_id in shift_ids}

        # Ahead of everything else, matching get_eligible_positions: an
        # account that is no longer active is not eligible for an open-to-all
        # shift either, and there is nothing left to look up once that is true.
        if not self._account_is_active(user):
            return {shift_id: [] for shift_id in shift_ids}

        result = await self.db.execute(
            select(Shift).where(
                Shift.id.in_(sorted(set(shift_ids))),
                Shift.organization_id == organization_id,
            )
        )
        shifts = {str(shift.id): shift for shift in result.scalars().all()}

        excluded = self.get_excluded_membership_types(org)
        member_type = getattr(user, "membership_type", None) or "active"
        blocked = member_type in excluded
        administrative = is_administrative(
            getattr(user, "member_class", None), member_type
        )
        # Affirmative, for the reason given in get_eligible_positions.
        can_ride = is_operational(
            effective_member_class(getattr(user, "member_class", None), member_type)
        )

        base: Set[str] = set()
        if not blocked:
            slug_map = await self._get_slug_eligibility_map(organization_id)
            base.update(self._positions_for_slugs([user.rank], slug_map))
            await self._get_held_position_slugs(str(user.id), organization_id)
            base.update(
                await self._get_training_positions(str(user.id), organization_id)
            )
            base.update(self.get_open_positions(org))

        # Qualifications are the one source that is *not* shift-independent:
        # a certification current today may have lapsed by a shift three months
        # out, and that shift must not offer the seat. Still resolved per
        # distinct shift date — but off one statement rather than one per date.
        # A member listing a year of generated shifts has ~365 distinct dates
        # on the page, and a query each made the list request that many
        # sequential round trips.
        quals_by_date: Dict[date, Set[str]] = {}
        if not blocked:
            windows = await QualificationService(self.db).get_member_code_windows(
                str(user.id), organization_id
            )
            for shift in shifts.values():
                as_of = self._shift_date(shift)
                if as_of not in quals_by_date:
                    quals_by_date[as_of] = positions_for_qualifications(
                        QualificationService.codes_in_force(windows, as_of)
                    )

        answers: Dict[str, List[str]] = {}
        for shift_id in shift_ids:
            shift = shifts.get(str(shift_id))
            if not shift:
                # An id from another org, or one that has since been deleted.
                # Empty rather than absent: the caller asked about it, and a
                # missing key would read as "not answered yet".
                answers[str(shift_id)] = []
                continue
            if administrative:
                answers[str(shift_id)] = self._administrative_shift_positions(shift)
                continue
            if shift.open_to_all_members and can_ride:
                answers[str(shift_id)] = sorted(set(self._shift_position_list(shift)))
                continue
            if blocked:
                answers[str(shift_id)] = []
                continue
            eligible = set(base)
            eligible.update(quals_by_date.get(self._shift_date(shift), set()))
            shift_positions = set(self._shift_position_list(shift))
            if shift_positions:
                eligible &= shift_positions
            answers[str(shift_id)] = sorted(eligible)
        return answers

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
        *sources* of their eligibility (rank, qualification,
        completed training, or the org's open-position list), their current
        EVOC standing, and the apparatus they hold an operator record on.

        Eligibility mirrors ``get_eligible_positions`` exactly — the same union
        behind the same membership-type gate — so the roster can never disagree
        with what self-signup enforces. Every source there has to appear here
        too: a member the roster omits is also missing from
        ``SchedulingService.get_trade_candidates``, so an officer looking for
        cover would not be offered somebody the signup endpoint would happily
        accept. Qualifications are resolved as of **today**, since a
        department-wide roster is not asked about any particular shift; the
        per-shift narrowing is deliberately not applied for the same reason.
        Each one carries its expiry, because resolving as of today would
        otherwise show a card that lapses next week as an unqualified grant.
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
        slug_map = await self._get_slug_eligibility_map(organization_id)
        await self._get_held_position_map(organization_id)
        training_map = await self._get_training_program_map(organization_id, position)
        operator_map = await self._get_operator_map(organization_id)
        qualification_map = await QualificationService(self.db).get_current_by_member(
            organization_id
        )

        members: List[Dict[str, Any]] = []
        for user in users:
            member_type = getattr(user, "membership_type", None) or "active"
            if member_type in excluded:
                continue

            sources: List[Dict[str, Any]] = []

            rank_code = user.rank or ""
            rank_entry = rank_map.get(rank_code)
            if position in slug_map.get(rank_code, []):
                sources.append(
                    {
                        "type": "rank",
                        "label": (
                            rank_entry["display_name"]
                            if rank_entry
                            else DEFAULT_RANK_LABELS.get(rank_code, rank_code)
                        ),
                    }
                )

            for qualification in qualification_map.get(str(user.id), []):
                code = qualification["code"]
                if position in positions_for_qualifications([code]):
                    sources.append(
                        {
                            "type": "qualification",
                            "label": qualification_label(code),
                            "expires_on": qualification["expires_on"],
                        }
                    )

            seen_programs: Set[str] = set()
            for program_name in training_map.get(str(user.id), []):
                if program_name in seen_programs:
                    continue
                seen_programs.add(program_name)
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

    def _administrative_shift_positions(self, shift: Shift) -> List[str]:
        """Return only positions explicitly opened to administrative members."""
        return sorted(
            [
                str(entry.get("position"))
                for entry in (shift.positions or [])
                if isinstance(entry, dict)
                and entry.get("position")
                and entry.get("allow_administrative_members") is True
            ]
        )

    async def _get_slug_eligibility_map(
        self, organization_id: str
    ) -> Dict[str, List[str]]:
        """slug -> the shift positions it grants, for this organization.

        Position slugs are deliberately not resolved through this map. Positions
        are RBAC/organizational roles and can be created or assigned by role
        managers; treating their names as qualifications would let those
        managers grant themselves operational shift eligibility.

        Precedence is deliberate: a stored row always wins, so an admin who
        edits ``eligible_positions`` — or clears it, or deactivates the rank —
        gets exactly what they configured, including the empty answer. The
        built-in defaults fill in only for a code with no row at all.
        """
        result = await self.db.execute(
            select(
                OperationalRank.rank_code,
                OperationalRank.eligible_positions,
                OperationalRank.is_active,
            ).where(OperationalRank.organization_id == organization_id)
        )
        stored = {
            rank_code: (list(positions or []) if is_active else [])
            for rank_code, positions, is_active in result.all()
        }
        mapping = {
            code: list(positions)
            for code, positions in DEFAULT_RANK_ELIGIBILITY.items()
            if code not in stored
        }
        mapping.update(stored)
        return mapping

    @staticmethod
    def _positions_for_slugs(
        slugs: List[Optional[str]], slug_map: Dict[str, List[str]]
    ) -> Set[str]:
        """Union the shift positions granted by every slug in ``slugs``."""
        granted: Set[str] = set()
        for slug in slugs:
            if slug:
                granted.update(slug_map.get(slug, []))
        return granted

    @staticmethod
    def _shift_date(shift) -> date:
        """The day the member would actually work, for currency checks.

        Falls back to today when a shift carries no date, and when eligibility
        is asked without a shift at all — a qualification list has to be
        resolved as of *some* day, and today is the only defensible one when
        no shift is in hand.
        """
        if shift is None:
            return date.today()
        value = getattr(shift, "shift_date", None) or getattr(shift, "start_time", None)
        if value is None:
            return date.today()
        return value.date() if hasattr(value, "date") else value

    async def _get_qualification_positions(
        self, user_id: str, organization_id: str, as_of: date
    ) -> Set[str]:
        """Shift seats the member's current certifications clear them for."""
        codes = await QualificationService(self.db).get_member_codes(
            user_id, organization_id, as_of
        )
        return positions_for_qualifications(codes)

    async def _get_held_position_slugs(
        self, user_id: str, organization_id: str
    ) -> List[str]:
        """Return held RBAC position slugs without treating them as credentials."""
        result = await self.db.execute(
            select(Position.slug)
            .join(user_positions, Position.id == user_positions.c.position_id)
            .where(
                user_positions.c.user_id == user_id,
                Position.organization_id == organization_id,
            )
        )
        return [slug for (slug,) in result.all() if slug]

    async def _get_held_position_map(
        self, organization_id: str
    ) -> Dict[str, List[Dict[str, str]]]:
        """Return held RBAC positions for callers that display role metadata."""
        result = await self.db.execute(
            select(user_positions.c.user_id, Position.slug, Position.name)
            .join(Position, Position.id == user_positions.c.position_id)
            .where(Position.organization_id == organization_id)
        )
        by_user: Dict[str, List[Dict[str, str]]] = {}
        for user_id, slug, name in result.all():
            if slug:
                by_user.setdefault(str(user_id), []).append(
                    {"slug": slug, "name": name}
                )
        return by_user

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

    def get_signup_window_settings(self, org: Organization) -> Dict[str, int]:
        """How long before/after a shift's start it accepts signups.

        ``signup_closes_minutes_before`` shuts self-signup that many minutes
        ahead of the start (0 — the default — keeps it open to the start
        instant, which is what every department has today).
        ``late_signup_grace_minutes`` is how long past the start an officer
        holding ``scheduling.assign`` may still seat somebody.

        Read defensively, like ``get_call_tracking_settings``: this is
        unvalidated JSON an admin can hand-edit, and raising here would refuse
        every signup in the department over one mistyped value rather than
        falling back to the built-in window (pitfall #19).
        """
        sched = self._get_scheduling_settings(org)

        def minutes(key: str, default: int, ceiling: int) -> int:
            raw = sched.get(key, default)
            try:
                value = int(raw)
            except (TypeError, ValueError):
                return default
            return min(max(value, 0), ceiling)

        return {
            "signup_closes_minutes_before": minutes(
                "signup_closes_minutes_before",
                DEFAULT_SIGNUP_CLOSES_MINUTES_BEFORE,
                10080,
            ),
            "late_signup_grace_minutes": minutes(
                "late_signup_grace_minutes", DEFAULT_LATE_SIGNUP_GRACE_MINUTES, 1440
            ),
        }

    def effective_call_type_slugs(self, org: Organization) -> set:
        """Every slug currently in force, before any normalization.

        Two things the defensive reader does not give a caller that needs to
        know what a save would drop:

        * It drops and truncates. A slug it hid is still the value its calls
          are filed under, so the deletion guard compares against what is
          *stored*, not against the shortened list the editor was handed.
        * An organization that has never materialized a list is not running
          without call types — it is running on the built-in nine, and its
          calls are filed under those slugs. Returning an empty set for it
          made the guard skip its check entirely and the editor offer to
          delete a default type with a decade of calls behind it, which is
          the normal state of every existing installation.
        """
        sched = self._get_scheduling_settings(org)
        raw = sched.get("call_tracking")
        types = raw.get("call_types") if isinstance(raw, dict) else None
        stored = (
            {
                str(entry.get("slug") or "").strip()
                for entry in types
                if isinstance(entry, dict) and str(entry.get("slug") or "").strip()
            }
            if isinstance(types, list)
            else set()
        )
        return stored or {t["slug"] for t in DEFAULT_CALL_TYPES}

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

        Every entry is returned, retired ones included, with ``active`` saying
        which are still offered at close-out. Filtering here instead would
        leave a caller that needs to *label* a historical call unable to
        resolve the slug it was filed under.
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
        seen = set()
        labels_seen = set()
        if isinstance(types, list):
            for entry in types:
                if not isinstance(entry, dict):
                    continue
                slug = str(entry.get("slug") or "").strip()
                # Match what CallTypeOption accepts, not merely "non-blank".
                # A hand-edited or legacy entry with an uppercase slug, a
                # duplicate, or an over-long value passed this filter and then
                # failed schema construction — turning the promised safe
                # degradation into a 500 for the whole organization, on both
                # the settings endpoint and every close-out.
                # The reserved bucket slug is dropped for the same reason the
                # schema refuses it: kept, it would fail the schema
                # construction this function exists to make safe.
                if (
                    not _CALL_TYPE_SLUG.fullmatch(slug)
                    or slug in seen
                    or slug == UNCLASSIFIED_CALL_TYPE
                ):
                    continue
                label = str(entry.get("label") or "").strip()[:100] or slug
                # The schema now requires labels to be distinct, and this
                # column predates that. Disambiguated rather than dropped: the
                # entry may be the only thing that can label a type with years
                # of calls behind it, so losing it is worse than a clumsy
                # name an admin can correct on the settings screen.
                label = _disambiguate_label(label, slug, labels_seen)
                labels_seen.add(_label_key(label))
                seen.add(slug)
                # Missing means active: entries stored before retirement
                # existed predate the key, and reading their absence as
                # "retired" would empty every department's close-out list on
                # upgrade (pitfall #19). Only an explicit false retires one.
                active = entry.get("active", True) is not False
                clean_types.append({"slug": slug, "label": label, "active": active})
        if not clean_types:
            clean_types = [
                {"slug": t["slug"], "label": t["label"], "active": True}
                for t in DEFAULT_CALL_TYPES
            ]
        # Deliberately not truncated. The cap is enforced on writes, where it
        # belongs; hiding stored entries here made a used type past the cap
        # unrepresentable in any payload the editor could produce, and the
        # deletion guard then rejected every one of those payloads — leaving
        # the organization unable to edit its call types at all.

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
        signup_closes_minutes_before: Optional[int] = None,
        late_signup_grace_minutes: Optional[int] = None,
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
        if signup_closes_minutes_before is not None:
            scheduling["signup_closes_minutes_before"] = signup_closes_minutes_before
        if late_signup_grace_minutes is not None:
            scheduling["late_signup_grace_minutes"] = late_signup_grace_minutes
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
