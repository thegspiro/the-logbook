"""
Member Supervisor Service

Reads and writes who a member reports to (``member_supervisor_assignments``).

Assignments are inclusive date ranges that never overlap. Changing a member's
supervisor to someone new from date D closes the open assignment on D - 1, so
no day has two supervisors and the outgoing supervisor's last day is the day
before the new one's first. A change dated the same day the open assignment
started is a correction rather than a handover: the open row's supervisor is
replaced in place, because a one-day-old mistake is not history worth keeping
as a zero-length stretch (the audit log keeps the before and after).
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.permissions import (
    expand_legacy_permissions,
    get_rank_default_permissions,
    permission_matches,
)
from app.models.member_supervisor import MemberSupervisorAssignment
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User
from app.utils.org_timezone import resolve_org_today

# (member_id, supervisor_id, starts_on, ends_on) -- one supervision edge, with
# ends_on None for "still in effect".
Edge = Tuple[str, str, date, Optional[date]]


class SupervisionLoopError(ValueError):
    """The assignment would make a member supervise, directly or through
    others, someone who supervises them (owner decision 2026-11-01: refuse
    loops). A ValueError so it answers 400 like the service's other refusals."""


def _overlap(
    lo: date, hi: Optional[date], start: date, end: Optional[date]
) -> Optional[Tuple[date, Optional[date]]]:
    """The intersection of two inclusive ranges (None = open-ended), if any."""
    new_lo = max(lo, start)
    if hi is None:
        new_hi = end
    elif end is None:
        new_hi = hi
    else:
        new_hi = min(hi, end)
    if new_hi is not None and new_lo > new_hi:
        return None
    return new_lo, new_hi


def find_loop(
    edges: Iterable[Edge],
    member_id: str,
    supervisor_id: str,
    starts_on: date,
    ends_on: Optional[date] = None,
) -> Optional[List[str]]:
    """The chain that would close a loop if ``supervisor_id`` supervised
    ``member_id`` from ``starts_on`` through ``ends_on``, or None.

    Walks upward from the proposed supervisor -- who supervises them, who
    supervises that person, and so on -- following only edges in effect on
    some day the proposed edge is too, and narrowing the window to the days
    every edge so far shares. Reaching ``member_id`` means that on at least
    one day the member would be above their own supervisor, which is a loop
    however long the chain. Edges that only meet on different dates are not
    a loop: a member may supervise their former supervisor.

    Returns ``[supervisor_id, ..., member_id]``: each id is supervised by the
    next one. A loop the walk meets that does not pass through the member
    (one already in the data) is stepped over rather than followed forever.
    """
    member_id, supervisor_id = str(member_id), str(supervisor_id)
    if member_id == supervisor_id:
        return [supervisor_id, member_id]
    upward: Dict[str, List[Edge]] = defaultdict(list)
    for edge in edges:
        upward[str(edge[0])].append(edge)
    stack: List[Tuple[str, date, Optional[date], List[str]]] = [
        (supervisor_id, starts_on, ends_on, [supervisor_id])
    ]
    seen: set = set()
    while stack:
        node, lo, hi, path = stack.pop()
        if node == member_id:
            return path
        if (node, lo, hi) in seen:
            continue
        seen.add((node, lo, hi))
        for _, above, start, end in upward.get(node, ()):
            window = _overlap(lo, hi, start, end)
            if window is None:
                continue
            above = str(above)
            if above in path:
                continue
            stack.append((above, window[0], window[1], path + [above]))
    return None


@dataclass
class SupervisorChange:
    """What a write did, for the endpoint's audit entry."""

    assignment: MemberSupervisorAssignment
    previous_supervisor_id: Optional[str]
    # The open assignment this write closed, if it closed one.
    closed_assignment_id: Optional[str]
    corrected_in_place: bool = False


class MemberSupervisorService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def list_assignments(
        self, organization_id: str, member_id: str, *, for_update: bool = False
    ) -> List[MemberSupervisorAssignment]:
        """Every assignment for the member, newest first."""
        query = (
            select(MemberSupervisorAssignment)
            .where(
                MemberSupervisorAssignment.organization_id == str(organization_id),
                MemberSupervisorAssignment.member_id == str(member_id),
            )
            .order_by(
                MemberSupervisorAssignment.starts_on.desc(),
                MemberSupervisorAssignment.created_at.desc(),
            )
        )
        if for_update:
            # A locking read, not a snapshot one: under REPEATABLE READ a plain
            # SELECT answers from the snapshot taken at the transaction's first
            # read, which predates the member-row lock (CLAUDE.md pitfall #27).
            query = query.with_for_update().execution_options(populate_existing=True)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def current_assignment(
        self, organization_id: str, member_id: str
    ) -> Optional[MemberSupervisorAssignment]:
        """The open assignment, if any. It may name no supervisor once the
        supervisor's account was removed; callers decide what that means."""
        result = await self.db.execute(
            select(MemberSupervisorAssignment).where(
                MemberSupervisorAssignment.organization_id == str(organization_id),
                MemberSupervisorAssignment.member_id == str(member_id),
                MemberSupervisorAssignment.ends_on.is_(None),
            )
        )
        return result.scalar_one_or_none()

    # ------------------------------------------------------------------
    # The relationship as of today -- what crew access and approvals read
    # ------------------------------------------------------------------

    @staticmethod
    def _in_effect_on(day: date):
        """Rows covering ``day``: dates are inclusive at both ends."""
        return (
            MemberSupervisorAssignment.starts_on <= day,
            or_(
                MemberSupervisorAssignment.ends_on.is_(None),
                MemberSupervisorAssignment.ends_on >= day,
            ),
        )

    async def is_current_supervisor(
        self, organization_id: str, supervisor_id: str, member_id: str
    ) -> bool:
        """Whether ``supervisor_id`` supervises ``member_id`` today.

        Today on the department's calendar, from the dated assignments: an
        assignment ended yesterday, or one whose supervisor is no longer a
        current member, grants nothing. Both people must be in
        ``organization_id``; a member never supervises themselves. This is
        the check every relationship-granted read and approval makes at the
        moment it acts (CLAUDE.md pitfall #14b), never a cached answer.
        """
        if not supervisor_id or not member_id or str(supervisor_id) == str(member_id):
            return False
        today = await resolve_org_today(self.db, organization_id)
        found = await self.db.scalar(
            select(MemberSupervisorAssignment.id)
            .join(User, User.id == MemberSupervisorAssignment.member_id)
            .where(
                MemberSupervisorAssignment.organization_id == str(organization_id),
                MemberSupervisorAssignment.member_id == str(member_id),
                MemberSupervisorAssignment.supervisor_id == str(supervisor_id),
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
                *self._in_effect_on(today),
            )
            .limit(1)
        )
        if found is None:
            return False
        return await self._is_current_member(organization_id, str(supervisor_id))

    async def _is_current_member(self, organization_id: str, user_id: str) -> bool:
        return (
            await self.db.scalar(
                select(User.id).where(
                    User.id == str(user_id),
                    User.organization_id == str(organization_id),
                    User.deleted_at.is_(None),
                    User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                )
            )
            is not None
        )

    async def current_supervisor_id(
        self, organization_id: str, member_id: str
    ) -> Optional[str]:
        """Who supervises the member today, if they are a current member.

        None means no supervisor on record today, so a caller routing an
        approval to the supervisor behaves exactly as it did before the
        relationship existed.
        """
        today = await resolve_org_today(self.db, organization_id)
        supervisor_id = await self.db.scalar(
            select(MemberSupervisorAssignment.supervisor_id).where(
                MemberSupervisorAssignment.organization_id == str(organization_id),
                MemberSupervisorAssignment.member_id == str(member_id),
                MemberSupervisorAssignment.supervisor_id.isnot(None),
                *self._in_effect_on(today),
            )
        )
        if supervisor_id is None:
            return None
        if not await self._is_current_member(organization_id, supervisor_id):
            return None
        return str(supervisor_id)

    async def current_crew(
        self, organization_id: str, supervisor_id: str
    ) -> List[Tuple[User, MemberSupervisorAssignment]]:
        """The current members ``supervisor_id`` supervises today, by name.

        Empty when the supervisor is not themselves a current member: a
        dropped officer's open assignments grant nothing until a manager
        reassigns the crew.
        """
        if not await self._is_current_member(organization_id, str(supervisor_id)):
            return []
        today = await resolve_org_today(self.db, organization_id)
        result = await self.db.execute(
            select(User, MemberSupervisorAssignment)
            .join(
                MemberSupervisorAssignment,
                MemberSupervisorAssignment.member_id == User.id,
            )
            .where(
                MemberSupervisorAssignment.organization_id == str(organization_id),
                MemberSupervisorAssignment.supervisor_id == str(supervisor_id),
                User.organization_id == str(organization_id),
                User.id != str(supervisor_id),
                User.deleted_at.is_(None),
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                *self._in_effect_on(today),
            )
            .order_by(User.last_name.asc(), User.first_name.asc())
        )
        return [(user, row) for user, row in result.all()]

    async def current_crew_ids(
        self, organization_id: str, supervisor_id: str
    ) -> List[str]:
        return [
            str(u.id)
            for u, _ in await self.current_crew(organization_id, supervisor_id)
        ]

    async def find_existing_loops(self, organization_id: str) -> List[List[str]]:
        """Loops already in the department's assignments, one chain each.

        For reporting only: loops are refused on every new or changed
        assignment, so these can only be rows written before that rule
        (2026-11-04). Nothing is deleted or ended -- which assignment is wrong
        is a manager's call, and the history is the member's record.
        """
        rows = (
            (
                await self.db.execute(
                    select(MemberSupervisorAssignment).where(
                        MemberSupervisorAssignment.organization_id
                        == str(organization_id),
                        MemberSupervisorAssignment.supervisor_id.isnot(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        edges = self._edges(rows)
        loops: List[List[str]] = []
        found: set = set()
        for member_id, supervisor_id, start, end in edges:
            chain = find_loop(edges, member_id, supervisor_id, start, end)
            if chain is None:
                continue
            key = frozenset(chain)
            if key in found:
                continue
            found.add(key)
            loops.append(chain)
        return loops

    @staticmethod
    def _edges(rows: Sequence[MemberSupervisorAssignment]) -> List[Edge]:
        return [
            (str(r.member_id), str(r.supervisor_id), r.starts_on, r.ends_on)
            for r in rows
            if r.supervisor_id
        ]

    async def names_by_id(self, organization_id: str, user_ids: set[str]) -> dict:
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(User).where(
                User.organization_id == str(organization_id),
                User.id.in_(sorted(user_ids)),
            )
        )
        return {str(u.id): u.display_name for u in result.scalars().all()}

    async def list_candidates(self, organization_id: str, member_id: str) -> List[User]:
        """Who may be named as the member's supervisor: every current member of
        the department except the member themselves."""
        result = await self.db.execute(
            select(User)
            .where(
                User.organization_id == str(organization_id),
                User.id != str(member_id),
                User.deleted_at.is_(None),
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
            )
            .order_by(User.last_name.asc(), User.first_name.asc())
        )
        return list(result.scalars().all())

    async def default_evaluator_id(
        self, organization_id: str, member_id: str, evaluator_permission: str
    ) -> Optional[str]:
        """The member's current supervisor, if they may act as an evaluator.

        For drafting an evaluation with no evaluator chosen. None means "leave
        it as before": no current supervisor, a supervisor no longer a current
        member, or one who does not hold ``evaluator_permission``. The
        permission is the caller's to name because the evaluator grant belongs
        to the evaluations feature, not to this one.
        """
        current = await self.current_assignment(organization_id, member_id)
        if current is None or current.supervisor_id is None:
            return None
        result = await self.db.execute(
            select(User)
            .where(
                User.id == current.supervisor_id,
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
            )
            .options(selectinload(User.positions))
        )
        supervisor = result.scalar_one_or_none()
        if supervisor is None:
            return None
        granted: set[str] = set()
        for position in supervisor.positions:
            granted.update(position.permissions or [])
        if supervisor.rank:
            granted.update(get_rank_default_permissions(supervisor.rank))
        if not permission_matches(
            evaluator_permission, expand_legacy_permissions(granted)
        ):
            return None
        return str(supervisor.id)

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def _lock_member(self, organization_id: str, member_id: str) -> User:
        # The parent row is what serializes two changes to one member: the
        # assignment rows the second request would conflict with may not
        # exist yet, so locking them alone would not (pitfall #27).
        result = await self.db.execute(
            select(User)
            .where(
                User.id == str(member_id),
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
            .with_for_update()
        )
        member = result.scalar_one_or_none()
        if member is None:
            raise ValueError("Member not found")
        return member

    async def _lock_organization(self, organization_id: str) -> None:
        # Two changes to *different* members can each pass the loop check and
        # together make a loop (A under B in one request, B under A in the
        # other), so the member-row lock is not enough: the decision has to be
        # serialized across the department. The organization row is the one
        # parent every assignment shares (pitfall #27).
        await self.db.execute(
            select(Organization.id)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )

    async def _refuse_loop(
        self,
        organization_id: str,
        member_id: str,
        supervisor_id: str,
        starts_on: date,
    ) -> None:
        """Refuse an assignment that would close a supervision loop.

        Reads every assignment in the department with a locking read, under
        the organization lock: a plain SELECT would answer from the snapshot
        taken at the transaction's first read, which predates the lock, and
        miss an assignment a concurrent request has just committed.
        """
        rows = (
            (
                await self.db.execute(
                    select(MemberSupervisorAssignment)
                    .where(
                        MemberSupervisorAssignment.organization_id
                        == str(organization_id),
                        MemberSupervisorAssignment.supervisor_id.isnot(None),
                    )
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        chain = find_loop(self._edges(rows), member_id, supervisor_id, starts_on)
        if chain is None:
            return
        names = await self.names_by_id(organization_id, set(chain))
        member_name = names.get(str(member_id), "this member")
        # "A would report to B, who reports to C, who reports to A".
        described = f"{member_name} would report to " + ", who reports to ".join(
            names.get(i, "a former member") for i in chain
        )
        raise SupervisionLoopError(
            f"This would create a supervision loop: {described}. "
            f"{member_name} cannot report to someone they supervise, directly "
            "or through others."
        )

    async def _require_supervisor(
        self, organization_id: str, member_id: str, supervisor_id: str
    ) -> User:
        if str(supervisor_id) == str(member_id):
            raise ValueError("A member cannot be their own supervisor")
        result = await self.db.execute(
            select(User).where(
                User.id == str(supervisor_id),
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
        )
        supervisor = result.scalar_one_or_none()
        # One message for "not in this department" and "not a current member",
        # so the answer does not reveal whether an id exists elsewhere.
        if supervisor is None or supervisor.status not in ACTIVE_ACCOUNT_STATUSES:
            raise ValueError(
                "The supervisor must be a current member of the department"
            )
        return supervisor

    async def set_supervisor(
        self,
        organization_id: str,
        member_id: str,
        supervisor_id: str,
        *,
        starts_on: Optional[date],
        actor_id: Optional[str],
    ) -> SupervisorChange:
        """Make ``supervisor_id`` the member's supervisor from ``starts_on``."""
        # Organization first, then member: every writer that takes both takes
        # them in this order, so two cannot deadlock on each other.
        await self._lock_organization(organization_id)
        await self._lock_member(organization_id, member_id)
        await self._require_supervisor(organization_id, member_id, supervisor_id)

        today = await resolve_org_today(self.db, organization_id)
        starts_on = starts_on or today
        if starts_on > today:
            raise ValueError("The start date cannot be in the future")

        assignments = await self.list_assignments(
            organization_id, member_id, for_update=True
        )
        open_row = next((a for a in assignments if a.ends_on is None), None)
        last_end = max(
            (a.ends_on for a in assignments if a.ends_on is not None), default=None
        )
        if last_end is not None and starts_on <= last_end:
            raise ValueError(
                f"The start date must be after {last_end.isoformat()}, "
                "when the previous assignment ended"
            )

        previous = open_row.supervisor_id if open_row is not None else None
        if open_row is not None:
            if previous == str(supervisor_id):
                raise ValueError("The member already reports to this supervisor")
            if starts_on < open_row.starts_on:
                raise ValueError(
                    f"The start date must be on or after "
                    f"{open_row.starts_on.isoformat()}, when the current "
                    "assignment began"
                )

        # After the date rules, so a request that is wrong for a simpler
        # reason is told that reason first. Only new and changed assignments
        # are checked; a loop already in the data is reported, not undone
        # (see ``find_existing_loops``).
        await self._refuse_loop(organization_id, member_id, supervisor_id, starts_on)

        if open_row is not None:
            if starts_on == open_row.starts_on:
                open_row.supervisor_id = str(supervisor_id)
                await self.db.flush()
                return SupervisorChange(
                    assignment=open_row,
                    previous_supervisor_id=previous,
                    closed_assignment_id=None,
                    corrected_in_place=True,
                )
            open_row.ends_on = starts_on - timedelta(days=1)
            # Flushed on its own so the open-row key is free before the insert.
            await self.db.flush()

        assignment = MemberSupervisorAssignment(
            organization_id=str(organization_id),
            member_id=str(member_id),
            supervisor_id=str(supervisor_id),
            starts_on=starts_on,
            ends_on=None,
            created_by=str(actor_id) if actor_id else None,
        )
        self.db.add(assignment)
        await self.db.flush()
        return SupervisorChange(
            assignment=assignment,
            previous_supervisor_id=open_row.supervisor_id if open_row else None,
            closed_assignment_id=str(open_row.id) if open_row else None,
        )

    async def end_current(
        self,
        organization_id: str,
        member_id: str,
        *,
        ends_on: Optional[date],
    ) -> MemberSupervisorAssignment:
        """Close the open assignment on ``ends_on`` (inclusive)."""
        await self._lock_member(organization_id, member_id)
        assignments = await self.list_assignments(
            organization_id, member_id, for_update=True
        )
        open_row = next((a for a in assignments if a.ends_on is None), None)
        if open_row is None:
            raise ValueError("The member has no current supervisor")

        today = await resolve_org_today(self.db, organization_id)
        ends_on = ends_on or today
        if ends_on > today:
            raise ValueError("The end date cannot be in the future")
        if ends_on < open_row.starts_on:
            raise ValueError(
                f"The end date cannot be before {open_row.starts_on.isoformat()}, "
                "when the assignment began"
            )
        open_row.ends_on = ends_on
        await self.db.flush()
        return open_row
