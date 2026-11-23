"""The department's leave calendar and its CSV export.

Both are for the officers who manage leave (``members.manage``), who already
see every leave and request. Neither ever carries a leave's reason: the
calendar is shown on a shared screen and the export leaves the system, and a
reason can be medical. The export is written with ``SafeCsvWriter``
(CLAUDE.md pitfall #15) because member names are free text.
"""

import io
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Sequence, Set

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.leave_request import (
    LeaveApproverCover,
    LeaveRequest,
    LeaveRequestStatus,
)
from app.models.user import MemberLeaveOfAbsence, Organization, User
from app.schemas.leave_of_absence import (
    LeaveCalendarCover,
    LeaveCalendarEntry,
    LeaveCalendarResponse,
)
from app.utils.csv_export import SafeCsvWriter
from app.utils.org_timezone import format_in_org_timezone, resolve_org_today

# The longest range one export may cover. A department wanting more exports
# twice; the bound keeps one request from reading the whole history at once.
MAX_EXPORT_DAYS = 366 * 5

EXPORT_COLUMNS = [
    "Member",
    "Kind",
    "Type",
    "Start",
    "End",
    "Status",
    "Decided by",
    "Decided at",
    "Requested at",
    "Cover",
]


def _name(user: Optional[User], fallback: str = "A member") -> str:
    if user is None:
        return fallback
    return user.display_name or user.username or fallback


def _label(value: object) -> str:
    text = str(getattr(value, "value", value) or "")
    return text.replace("_", " ").capitalize()


def month_bounds(year: int, month: int) -> tuple:
    first = date(year, month, 1)
    following = date(year + (month == 12), month % 12 + 1, 1)
    return first, following - timedelta(days=1)


class LeaveCalendarService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _users(self, org_id: str, ids: Set[str]) -> Dict[str, User]:
        if not ids:
            return {}
        rows = (
            await self.db.execute(
                select(User).where(
                    User.id.in_(list(ids)), User.organization_id == org_id
                )
            )
        ).scalars()
        return {str(u.id): u for u in rows}

    async def _leaves(self, org_id: str, first: date, last: date):
        return list(
            (
                await self.db.execute(
                    select(MemberLeaveOfAbsence)
                    .where(
                        MemberLeaveOfAbsence.organization_id == org_id,
                        MemberLeaveOfAbsence.active.is_(True),
                        MemberLeaveOfAbsence.start_date <= last,
                        or_(
                            MemberLeaveOfAbsence.end_date.is_(None),
                            MemberLeaveOfAbsence.end_date >= first,
                        ),
                    )
                    .order_by(MemberLeaveOfAbsence.start_date, MemberLeaveOfAbsence.id)
                )
            ).scalars()
        )

    async def _requests(
        self,
        org_id: str,
        first: date,
        last: date,
        statuses: Optional[Sequence[LeaveRequestStatus]] = None,
    ):
        query = select(LeaveRequest).where(
            LeaveRequest.organization_id == org_id,
            LeaveRequest.start_date <= last,
            or_(LeaveRequest.end_date.is_(None), LeaveRequest.end_date >= first),
        )
        if statuses is not None:
            query = query.where(LeaveRequest.status.in_(list(statuses)))
        return list(
            (
                await self.db.execute(
                    query.order_by(LeaveRequest.start_date, LeaveRequest.created_at)
                )
            ).scalars()
        )

    async def _covers(self, org_id: str, first: date, last: date):
        return list(
            (
                await self.db.execute(
                    select(LeaveApproverCover)
                    .where(
                        LeaveApproverCover.organization_id == org_id,
                        LeaveApproverCover.start_date <= last,
                        LeaveApproverCover.end_date >= first,
                    )
                    .order_by(LeaveApproverCover.start_date, LeaveApproverCover.id)
                )
            ).scalars()
        )

    async def calendar(
        self, organization_id: str, year: int, month: int
    ) -> LeaveCalendarResponse:
        """Recorded leaves, requests still waiting, and covers in one month."""
        org_id = str(organization_id)
        first, last = month_bounds(year, month)
        leaves = await self._leaves(org_id, first, last)
        requests = await self._requests(
            org_id, first, last, [LeaveRequestStatus.PENDING]
        )
        covers = await self._covers(org_id, first, last)
        users = await self._users(
            org_id,
            {str(x.user_id) for x in leaves}
            | {str(r.user_id) for r in requests}
            | {str(c.approver_id) for c in covers}
            | {str(c.stand_in_id) for c in covers},
        )
        entries = [
            LeaveCalendarEntry(
                id=str(x.id),
                kind="leave",
                member_id=str(x.user_id),
                member_name=_name(users.get(str(x.user_id))),
                leave_type=x.leave_type,
                start_date=x.start_date,
                end_date=x.end_date,
            )
            for x in leaves
        ] + [
            LeaveCalendarEntry(
                id=str(r.id),
                kind="request",
                member_id=str(r.user_id),
                member_name=_name(users.get(str(r.user_id))),
                leave_type=r.leave_type,
                start_date=r.start_date,
                end_date=r.end_date,
            )
            for r in requests
        ]
        entries.sort(key=lambda e: (e.start_date, e.member_name.lower(), e.id))
        return LeaveCalendarResponse(
            month_start=first,
            month_end=last,
            today=await resolve_org_today(self.db, org_id),
            entries=entries,
            covers=[
                LeaveCalendarCover(
                    id=str(c.id),
                    approver_id=str(c.approver_id),
                    approver_name=_name(users.get(str(c.approver_id))),
                    stand_in_id=str(c.stand_in_id),
                    stand_in_name=_name(users.get(str(c.stand_in_id))),
                    start_date=c.start_date,
                    end_date=c.end_date,
                )
                for c in covers
            ],
        )

    async def export_csv(self, organization_id: str, start: date, end: date) -> tuple:
        """Every request, of any status, and every recorded leave that touches
        ``start``..``end``, as CSV text. Returns ``(text, row_count)``."""
        org_id = str(organization_id)
        if end < start:
            raise ValueError("The end of the range is before its start.")
        if (end - start).days >= MAX_EXPORT_DAYS:
            raise ValueError(
                f"An export can cover at most {MAX_EXPORT_DAYS} days; export "
                "the rest separately."
            )
        org = await self.db.get(Organization, org_id)
        leaves = await self._leaves(org_id, start, end)
        requests = await self._requests(org_id, start, end)
        covers = await self._covers(
            org_id,
            min(
                [start]
                + [x.start_date for x in leaves]
                + [r.start_date for r in requests]
            ),
            date.max,
        )
        users = await self._users(
            org_id,
            {str(x.user_id) for x in leaves}
            | {str(x.granted_by) for x in leaves if x.granted_by}
            | {str(r.user_id) for r in requests}
            | {str(r.decided_by) for r in requests if r.decided_by}
            | {str(c.stand_in_id) for c in covers},
        )

        def when(value: Optional[datetime]) -> str:
            return format_in_org_timezone(value, org, "%Y-%m-%d %H:%M") if value else ""

        def cover_for(member_id: str, first: date, last: Optional[date]) -> str:
            spans = [
                f"{_name(users.get(str(c.stand_in_id)))} "
                f"({c.start_date.isoformat()} to {c.end_date.isoformat()})"
                for c in covers
                if str(c.approver_id) == member_id
                and c.start_date <= (last or date.max)
                and c.end_date >= first
            ]
            return "; ".join(spans)

        rows: List[List[str]] = []
        for r in requests:
            rows.append(
                [
                    _name(users.get(str(r.user_id))),
                    "Request",
                    _label(r.leave_type),
                    r.start_date.isoformat(),
                    r.end_date.isoformat() if r.end_date else "",
                    _label(r.status),
                    _name(users.get(str(r.decided_by)), "") if r.decided_by else "",
                    when(r.decided_at),
                    when(r.created_at),
                    cover_for(str(r.user_id), r.start_date, r.end_date),
                ]
            )
        for x in leaves:
            rows.append(
                [
                    _name(users.get(str(x.user_id))),
                    "Recorded leave",
                    _label(x.leave_type),
                    x.start_date.isoformat(),
                    x.end_date.isoformat() if x.end_date else "",
                    "Recorded",
                    _name(users.get(str(x.granted_by)), "") if x.granted_by else "",
                    when(x.granted_at),
                    "",
                    cover_for(str(x.user_id), x.start_date, x.end_date),
                ]
            )
        rows.sort(key=lambda row: (row[3], row[0].lower()))
        buffer = io.StringIO()
        writer = SafeCsvWriter(buffer)
        writer.writerow(EXPORT_COLUMNS)
        for row in rows:
            writer.writerow(row)
        return buffer.getvalue(), len(rows)
