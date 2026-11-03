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

from dataclasses import dataclass
from datetime import date, timedelta
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.permissions import (
    expand_legacy_permissions,
    get_rank_default_permissions,
    permission_matches,
)
from app.models.member_supervisor import MemberSupervisorAssignment
from app.models.user import ACTIVE_ACCOUNT_STATUSES, User
from app.utils.org_timezone import resolve_org_today


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

        if open_row is not None:
            previous = open_row.supervisor_id
            if previous == str(supervisor_id):
                raise ValueError("The member already reports to this supervisor")
            if starts_on < open_row.starts_on:
                raise ValueError(
                    f"The start date must be on or after "
                    f"{open_row.starts_on.isoformat()}, when the current "
                    "assignment began"
                )
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
