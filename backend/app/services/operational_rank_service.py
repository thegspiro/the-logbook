"""
Operational Rank Service

Business logic for per-organization operational rank management.
"""

from typing import Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operational_rank import OperationalRank
from app.models.user import Organization, User, UserStatus
from app.schemas.operational_rank import RankCreate, RankUpdate

# Statuses considered non-active for rank validation purposes.
# Members with these statuses are no longer interacting with the platform,
# so an outdated rank on their record should not surface as an error.
_INACTIVE_STATUSES = {
    UserStatus.RETIRED,
    UserStatus.ARCHIVED,
    UserStatus.DROPPED_VOLUNTARY,
    UserStatus.DROPPED_INVOLUNTARY,
}


# All shift position values for reference.
_ALL_POSITIONS = [
    "officer",
    "driver",
    "firefighter",
    "ems",
    "captain",
    "lieutenant",
    "probationary",
    "volunteer",
    "other",
]

# Default ranks seeded for new organizations.
# Format: (rank_code, display_name, sort_order, eligible_positions)
DEFAULT_RANKS = [
    ("fire_chief", "Fire Chief", 0, _ALL_POSITIONS),
    ("deputy_chief", "Deputy Chief", 1, _ALL_POSITIONS),
    ("assistant_chief", "Assistant Chief", 2, _ALL_POSITIONS),
    (
        "captain",
        "Captain",
        3,
        ["captain", "officer", "driver", "firefighter", "ems", "lieutenant"],
    ),
    (
        "lieutenant",
        "Lieutenant",
        4,
        ["lieutenant", "officer", "driver", "firefighter", "ems"],
    ),
    ("engineer", "Engineer", 5, ["driver", "firefighter", "ems"]),
    ("firefighter", "Firefighter", 6, ["firefighter", "ems"]),
    ("emt", "EMT", 7, ["ems", "firefighter"]),
]

#: Every code the seed knows, whatever agency type it is written for.
#:
#: A rank is accepted on write if it is a stored row for the organization *or*
#: one of these. The second half matters: the seed only fires into an empty
#: table, so a department onboarded before a code joined DEFAULT_RANKS has no
#: row for it while the eligibility fallback still honours it. Validating
#: against stored rows alone would refuse a rank the rest of the system treats
#: as valid — the shape of the EMT bug in #1833.
DEFAULT_RANK_CODES = frozenset(code for code, _l, _o, _p in DEFAULT_RANKS)


def rank_not_configured_message(rank: str) -> str:
    """The refusal every write path gives for an unknown rank.

    One wording, because a member told "not configured" by one screen and
    something else by another has no way to tell they are the same problem.
    It has to name the value — a typo is invisible until it is quoted back —
    and say where to fix it.
    """
    return (
        f"'{rank}' is not a rank this department has configured. "
        "Add it under Settings → Ranks first, or pick an existing one."
    )


# Rank codes seeded for each agency type, and the labels that differ.
#
# Firefighter and EMT are independent ranks, not two rungs of one ladder: a
# member may hold either without the other, and many departments expect both
# in time without either implying the other. So the discipline ranks are
# seeded per agency rather than assumed.
#
# An EMS-only service is the case that makes this matter. It has the same
# officer ladder as anyone else, but no firefighters at all, and its chief is
# a Chief rather than a Fire Chief. The rank *codes* are shared across agency
# types on purpose — they key the permission registry and the shift-eligibility
# fallback, so a code that exists for one agency must mean the same thing for
# every other — and only the labels and the selection vary.
_FIRE_DISCIPLINE_RANKS = ("engineer", "firefighter", "emt")
_EMS_DISCIPLINE_RANKS = ("engineer", "emt")

RANK_CODES_BY_ORG_TYPE: Dict[str, Tuple[str, ...]] = {
    "fire_department": _FIRE_DISCIPLINE_RANKS,
    "fire_ems_combined": _FIRE_DISCIPLINE_RANKS,
    "ems_only": _EMS_DISCIPLINE_RANKS,
}

# Labels an agency type renames. Anything absent keeps its DEFAULT_RANKS label.
RANK_LABELS_BY_ORG_TYPE: Dict[str, Dict[str, str]] = {
    "ems_only": {
        "fire_chief": "Chief",
        "engineer": "Driver / Operator",
    },
}

# The officer ladder every agency gets, whatever it responds to.
#
# ``sort_order`` is a flat ranking, not a tree, and deliberately so: who
# reports to whom is the org chart's job (``OrgChartNode`` carries both a
# ``parent_id`` and a ``rank_code``), not this list's. That separation is what
# lets a large department run parallel discipline chiefs — a Fire Chief and an
# EMS Chief both reporting to a Chief of Department, as FDNY does — by giving
# the two the same ``sort_order`` and letting the chart record the branch.
# Nothing is seeded for that shape: it belongs to a handful of very large
# organizations, and seeding two chiefs to every combined agency would be
# wrong for the volunteer departments this list is sized for. Those ranks are
# added in the rank editor, where they will report no default permissions
# until a position supplies them.
_COMMAND_RANK_CODES = (
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "captain",
    "lieutenant",
)


def default_ranks_for(organization_type: Optional[str]) -> List[tuple]:
    """The DEFAULT_RANKS entries an agency of this type should be seeded.

    Falls back to the full fire-department set for an unknown or missing type:
    a department that ends up with one rank too many can delete it, whereas one
    seeded too few has no indication anything is absent.
    """
    discipline = RANK_CODES_BY_ORG_TYPE.get(
        organization_type or "", _FIRE_DISCIPLINE_RANKS
    )
    wanted = set(_COMMAND_RANK_CODES) | set(discipline)
    labels = RANK_LABELS_BY_ORG_TYPE.get(organization_type or "", {})
    return [
        (code, labels.get(code, label), order, positions)
        for code, label, order, positions in DEFAULT_RANKS
        if code in wanted
    ]


class OperationalRankService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Seed
    # ------------------------------------------------------------------

    async def seed_defaults(self, organization_id: str) -> List[OperationalRank]:
        """Insert the default rank set for an organization if none exist.

        The set depends on what kind of agency this is. An EMS-only service
        has lieutenants and captains like anyone else, but it has no
        firefighters and no engine, so seeding it "Firefighter", "Engineer"
        and "Fire Chief" hands it a ladder its members can never be on — and
        because the seed only ever fires into an empty table, whatever it
        writes on day one is what the department lives with.
        """
        result = await self.db.execute(
            select(func.count(OperationalRank.id)).where(
                OperationalRank.organization_id == organization_id,
            )
        )
        if result.scalar() > 0:
            return []

        ranks = []
        for code, label, order, positions in await self._seed_set(organization_id):
            rank = OperationalRank(
                organization_id=organization_id,
                rank_code=code,
                display_name=label,
                sort_order=order,
                # Copy: the three chief ranks share the _ALL_POSITIONS list
                # object, so persisting the reference directly would alias them
                # (and the module constant) to one mutable list.
                eligible_positions=list(positions),
            )
            ranks.append(rank)

        try:
            # A brand-new org's very first load can race: two concurrent
            # requests both see count == 0 and both attempt to seed. The
            # `(organization_id, rank_code)` unique constraint stops the
            # second insert from duplicating rows, but a plain session
            # rollback() here would expire every object in the request's
            # identity map — including `current_user`, loaded earlier by
            # get_current_user on this same request-scoped session — and the
            # endpoint's next synchronous access to current_user.organization_id
            # would then need an implicit refresh outside the async greenlet
            # context, raising MissingGreenlet (the same class of bug as the
            # reopen-attendance 500, see CHANGELOG 2026-08-25). A SAVEPOINT
            # (begin_nested) rollback only expires objects modified within it,
            # leaving current_user untouched.
            async with self.db.begin_nested():
                for rank in ranks:
                    self.db.add(rank)
                await self.db.flush()
        except IntegrityError:
            # Someone else already seeded it — treat the same as
            # skip-when-ranks-exist.
            return []

        # Refresh server-computed timestamps to prevent MissingGreenlet
        for rank in ranks:
            await self.db.refresh(rank, attribute_names=["created_at", "updated_at"])
        return ranks

    async def _seed_set(self, organization_id: str) -> List[tuple]:
        """The rank entries to seed, chosen by the organization's agency type.

        Read here rather than taken as an argument so the two existing callers
        (the ranks endpoint and the apparatus bootstrap) need no change and
        cannot disagree about it. A missing organization falls back to the full
        set via ``default_ranks_for``.
        """
        result = await self.db.execute(
            select(Organization.organization_type).where(
                Organization.id == organization_id
            )
        )
        org_type = result.scalar_one_or_none()
        # The column is an Enum, so unwrap to the stored string value.
        return default_ranks_for(getattr(org_type, "value", org_type))

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def list_ranks(
        self,
        organization_id: str,
        is_active: Optional[bool] = None,
    ) -> List[OperationalRank]:
        query = select(OperationalRank).where(
            OperationalRank.organization_id == organization_id
        )
        if is_active is not None:
            query = query.where(OperationalRank.is_active == is_active)
        query = query.order_by(OperationalRank.sort_order, OperationalRank.display_name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_rank(
        self,
        rank_id: UUID,
        organization_id: str,
    ) -> Optional[OperationalRank]:
        result = await self.db.execute(
            select(OperationalRank).where(
                OperationalRank.id == str(rank_id),
                OperationalRank.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_rank(
        self,
        data: RankCreate,
        organization_id: str,
    ) -> OperationalRank:
        # Duplicate check on rank_code
        existing = await self.db.execute(
            select(OperationalRank).where(
                OperationalRank.organization_id == organization_id,
                OperationalRank.rank_code == data.rank_code,
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError(f"Rank code '{data.rank_code}' already exists")

        rank = OperationalRank(
            organization_id=organization_id,
            **data.model_dump(),
        )
        self.db.add(rank)
        await self.db.commit()
        await self.db.refresh(rank)
        return rank

    async def update_rank(
        self,
        rank_id: UUID,
        data: RankUpdate,
        organization_id: str,
    ) -> Optional[OperationalRank]:
        rank = await self.get_rank(rank_id, organization_id)
        if not rank:
            return None

        update_data = data.model_dump(exclude_unset=True)

        # If rank_code is being changed, check for duplicates
        if "rank_code" in update_data and update_data["rank_code"] != rank.rank_code:
            dup = await self.db.execute(
                select(OperationalRank).where(
                    OperationalRank.organization_id == organization_id,
                    OperationalRank.rank_code == update_data["rank_code"],
                    OperationalRank.id != str(rank_id),
                )
            )
            if dup.scalar_one_or_none():
                raise ValueError(
                    f"Rank code '{update_data['rank_code']}' already exists"
                )

        for field, value in update_data.items():
            setattr(rank, field, value)

        await self.db.commit()
        await self.db.refresh(rank)
        return rank

    async def delete_rank(
        self,
        rank_id: UUID,
        organization_id: str,
    ) -> bool:
        rank = await self.get_rank(rank_id, organization_id)
        if not rank:
            return False
        await self.db.delete(rank)
        await self.db.commit()
        return True

    async def reorder_ranks(
        self,
        organization_id: str,
        items: List[dict],
    ) -> List[OperationalRank]:
        """Batch-update sort_order for multiple ranks."""
        for item in items:
            rank = await self.get_rank(item["id"], organization_id)
            if rank:
                rank.sort_order = item["sort_order"]
        await self.db.commit()
        return await self.list_ranks(organization_id)

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    async def is_known_rank(self, organization_id: str, rank_code: str) -> bool:
        """Whether ``rank_code`` is a rank this organization actually has.

        Accepts a code two ways, and the second matters: a stored
        ``operational_ranks`` row, **or** one of the built-in seed codes. The
        seed only ever fires into an empty table, so a department onboarded
        before a code joined ``DEFAULT_RANKS`` has no row for it while the
        eligibility fallback still honours it. Rejecting those here would
        refuse a rank the rest of the system treats as valid — the exact shape
        of the EMT bug in #1833.

        ``validate_ranks`` reports mismatches that are already stored; this is
        the same question asked before one can be.
        """
        code = (rank_code or "").strip()
        if not code:
            return False
        if code in DEFAULT_RANK_CODES:
            return True
        result = await self.db.execute(
            select(OperationalRank.id).where(
                OperationalRank.organization_id == organization_id,
                OperationalRank.rank_code == code,
            )
        )
        return result.scalar_one_or_none() is not None

    async def validate_ranks(
        self,
        organization_id: str,
    ) -> List[Dict]:
        """Return active members whose rank code does not match any
        configured rank for the organization.

        Only members with statuses that indicate they are still actively
        interacting with the platform are checked.  Archived, retired,
        and dropped members are intentionally excluded so that outdated
        rank values on historical records do not surface as errors.

        Returns a list of dicts:
            [{ "member_id", "member_name", "rank_code" }, ...]
        """
        # Collect all configured rank codes for the org.
        result = await self.db.execute(
            select(OperationalRank.rank_code).where(
                OperationalRank.organization_id == organization_id,
            )
        )
        valid_codes = {row[0] for row in result.all()}

        # Find active-status members whose rank is set but unrecognised.
        members_q = select(User.id, User.first_name, User.last_name, User.rank).where(
            User.organization_id == organization_id,
            User.rank.isnot(None),
            User.rank != "",
            User.status.notin_([s.value for s in _INACTIVE_STATUSES]),
            User.deleted_at.is_(None),
        )
        members_result = await self.db.execute(members_q)
        issues: List[Dict] = []
        for row in members_result.all():
            if row.rank not in valid_codes:
                issues.append(
                    {
                        "member_id": row.id,
                        "member_name": f"{row.first_name or ''} {row.last_name or ''}".strip(),
                        "rank_code": row.rank,
                    }
                )
        return issues
