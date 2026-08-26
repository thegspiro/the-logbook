"""
Operational Rank Service

Business logic for per-organization operational rank management.
"""

from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import is_seeded_for, label_for
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


# Every shift position value in the vocabulary. Kept in step with
# ``ShiftPosition`` in app/schemas/scheduling.py.
_ALL_POSITIONS = [
    "officer",
    "driver",
    "firefighter",
    "ems",
    "paramedic",
    "captain",
    "lieutenant",
    "probationary",
    "volunteer",
    "other",
]

# What the three chief ranks are seeded with -- everything a rank can confer.
#
# Deliberately NOT _ALL_POSITIONS. ``paramedic`` is a licence a member holds,
# not something a chief's stripes confer: promoting an officer does not make
# them a paramedic, and seeding it here would have put every chief on the
# paramedic roster with no card behind it -- the exact "cleared on paper"
# problem the credential path exists to close. Paramedic is earned only by a
# current certification (TrainingCourse.target_position), so it appears in the
# vocabulary above and in no rank's default grant.
_CHIEF_POSITIONS = [p for p in _ALL_POSITIONS if p != "paramedic"]

# Default ranks seeded for new organizations.
# Format: (rank_code, display_name, sort_order, eligible_positions)
DEFAULT_RANKS = [
    ("fire_chief", "Fire Chief", 0, _CHIEF_POSITIONS),
    ("deputy_chief", "Deputy Chief", 1, _CHIEF_POSITIONS),
    ("assistant_chief", "Assistant Chief", 2, _CHIEF_POSITIONS),
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
#:
#: Note it spans every agency type on purpose, unlike ``default_ranks_for``
#: below: what a department may *hold* is broader than what it is seeded.
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


# Which ranks an agency of each type is seeded, and what it calls them, are one
# decision shared with the position registry — ``app/core/permissions`` owns it
# (``is_seeded_for`` / ``label_for``). Two copies is how ``chief`` and
# ``fire_chief`` came to name the same thing in two files.
#
# The rank *codes* are shared across agency types on purpose: they key the
# permission registry and the shift-eligibility fallback, so a code that exists
# for one agency must mean the same thing for every other. Only the selection
# and the labels vary.
#
# ``sort_order`` is a flat ranking, not a tree, and deliberately so: who reports
# to whom is the org chart's job (``OrgChartNode`` carries both a ``parent_id``
# and a ``rank_code``), not this list's. That separation is what lets a large
# department run parallel discipline chiefs — a Fire Chief and an EMS Chief both
# reporting to a Chief of Department, as FDNY does — by giving the two the same
# ``sort_order`` and letting the chart record the branch. Nothing is seeded for
# that shape: it belongs to a handful of very large organizations, and seeding
# two chiefs to every combined agency would be wrong for the volunteer
# departments this list is sized for. Those ranks are added in the rank editor,
# where they will report no default permissions until a position supplies them.


def default_ranks_for(organization_type: Optional[str]) -> List[tuple]:
    """The DEFAULT_RANKS entries an agency of this type should be seeded.

    Officer ranks are universal and are not enumerated anywhere: ``is_seeded_for``
    keeps any code that is not a discipline, so a rung added to DEFAULT_RANKS is
    seeded to every agency until somebody says otherwise. Unknown or missing
    types fall back to the full fire set for the same reason — a department that
    ends up with one rank too many can delete it, whereas one seeded too few has
    no indication anything is absent.
    """
    return [
        (code, label_for(code, organization_type, label), order, positions)
        for code, label, order, positions in DEFAULT_RANKS
        if is_seeded_for(code, organization_type)
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
                # Copy: the three chief ranks share the _CHIEF_POSITIONS list
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

        Read here rather than taken as an argument because the caller is the
        ranks endpoint, which holds a ``current_user`` and not the organization
        row. (Positions go the other way: ``create_organization`` already has
        the org in memory, so ``_create_default_roles`` takes the type as an
        argument.) A missing organization falls back to the full set via
        ``default_ranks_for``.
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

    async def resolve_rank_code(
        self, organization_id: str, rank_code: str
    ) -> Optional[str]:
        """The canonical code for ``rank_code``, or ``None`` if it is not a rank.

        Resolves two ways, and the second matters: a stored
        ``operational_ranks`` row, **or** one of the built-in seed codes. The
        seed only ever fires into an empty table, so a department onboarded
        before a code joined ``DEFAULT_RANKS`` has no row for it while the
        eligibility fallback still honours it. Rejecting those would refuse a
        rank the rest of the system treats as valid — the exact shape of the
        EMT bug in #1833.

        **It returns the canonical spelling rather than a yes/no, and callers
        must persist what it returns.** Every downstream consumer of
        ``User.rank`` is an exact dictionary lookup —
        ``OPERATIONAL_RANKS.get(rank)`` for default permissions, the slug map
        keyed by ``rank_code`` for eligible seats — so a value that differs by
        case or surrounding whitespace resolves to no permissions and no seats.
        Validating a normalized string and storing the caller's original would
        therefore wave through the very failure this check exists to prevent:
        ``" firefighter "`` passes, stores with its spaces, and grants nothing.

        Matching is deliberately case-insensitive on both paths. The prospect
        conversion UI suggests display-cased values like ``Firefighter``, and
        MySQL's default collation would have matched a stored row that way
        regardless — so the choice is between accepting those and canonicalizing
        them, or accepting them and storing something inert. ``lower()`` is
        applied in SQL rather than relying on the server's collation, so the
        answer does not change with database configuration. The per-org rank
        table holds a dozen rows behind an ``organization_id`` filter, so
        losing the index on that column costs nothing.
        """
        code = (rank_code or "").strip()
        if not code:
            return None
        folded = code.lower()
        for seeded in DEFAULT_RANK_CODES:
            if seeded == folded:
                return seeded
        result = await self.db.execute(
            select(OperationalRank.rank_code).where(
                OperationalRank.organization_id == organization_id,
                func.lower(OperationalRank.rank_code) == folded,
            )
        )
        return result.scalar_one_or_none()

    async def is_known_rank(self, organization_id: str, rank_code: str) -> bool:
        """Whether ``rank_code`` names a rank this organization has.

        The predicate form of :meth:`resolve_rank_code`. Prefer that one on any
        path that goes on to *store* the rank — this answers whether the value
        is acceptable, not what should be written.
        """
        return await self.resolve_rank_code(organization_id, rank_code) is not None

    async def validate_ranks(
        self,
        organization_id: str,
    ) -> List[Dict]:
        """Return active members whose rank is unknown or noncanonical.

        A rank may be supplied by either the organization's stored rows or the
        built-in defaults, matching :meth:`resolve_rank_code`. Recognizable
        legacy spellings with different case or surrounding whitespace remain
        issues because downstream permission and eligibility lookups require
        the canonical value stored in ``User.rank``.

        Only members with statuses that indicate they are still actively
        interacting with the platform are checked.  Archived, retired,
        and dropped members are intentionally excluded so that outdated
        rank values on historical records do not surface as errors.

        Returns a list of dicts:
            [{ "member_id", "member_name", "rank_code" }, ...]
        """
        # Load the small organization-specific vocabulary once.  Do not call
        # resolve_rank_code for each member: besides producing an N+1 query,
        # that would make this audit needlessly dependent on database
        # collation.  The map mirrors resolve_rank_code's precedence (built-in
        # codes first) and its strip/lower matching while retaining the
        # canonical spelling that downstream exact lookups require.
        result = await self.db.execute(
            select(OperationalRank.rank_code).where(
                OperationalRank.organization_id == organization_id,
            )
        )
        canonical_codes = {code: code for code in DEFAULT_RANK_CODES}
        for row in result.all():
            stored_code = row[0]
            normalized = (stored_code or "").strip().lower()
            if normalized:
                canonical_codes.setdefault(normalized, stored_code)

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
            normalized = (row.rank or "").strip().lower()
            canonical = canonical_codes.get(normalized)
            # A recognizable but noncanonical legacy spelling still needs
            # repair. User.rank feeds exact dictionary lookups, so accepting
            # " Captain " here would hide a member receiving no permissions.
            if canonical is None or row.rank != canonical:
                issues.append(
                    {
                        "member_id": row.id,
                        "member_name": f"{row.first_name or ''} {row.last_name or ''}".strip(),
                        "rank_code": row.rank,
                    }
                )
        return issues
