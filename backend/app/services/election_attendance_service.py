"""Meeting attendance, read against one election's voter rules.

The Elections › Meeting Attendance page shows how many meetings each member
attended in a period the secretary chooses, whether they may vote in the
election they picked, and -- one member at a time -- the meetings behind the
count.

Nothing here decides eligibility on its own: "may vote" is the election's
eligibility roster (``ElectionService.get_eligibility_roster``), the same
answer the ballot send acts on, and each meeting is classified by
``tally_attendance``, the classification the ballot check counts with
(pitfall #29). The period the secretary picks is for reading attendance; it
does not change any rule, which carries its own look-back.
"""

from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election
from app.models.meeting import Meeting, MeetingAttendee
from app.models.user import (
    ACTIVE_ACCOUNT_STATUSES,
    MemberLeaveOfAbsence,
    Organization,
    User,
)
from app.services.election_service import ElectionService
from app.services.member_service_history_service import MemberServiceHistoryService
from app.services.membership_tier_service import (
    AttendanceTally,
    current_stint_start,
    tally_attendance,
)
from app.services.voter_rules import member_row_keys, row_labels
from app.utils.membership import configured_tiers, ranks_as_from_tiers
from app.utils.org_timezone import scheduling_timezone, today_in

# The longest period one request reads: five years of meetings is far more
# than any rule looks back over, and bounds the query.
MAX_PERIOD_DAYS = 5 * 366


def _status(meeting_id: str, tally: AttendanceTally) -> str:
    """How one meeting counts for the member, as the tally decided it."""
    if meeting_id in tally.attended:
        return "present"
    if meeting_id in tally.waived:
        return "excused"
    if meeting_id in tally.on_leave:
        return "on_leave"
    return "absent"


class ElectionAttendanceService:
    """Attendance counts and meeting lists for the Meeting Attendance page."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _org(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        return result.scalar_one_or_none()

    async def _meetings(
        self,
        organization_id: str,
        start: date,
        end: date,
        meeting_types: Optional[Sequence[str]],
    ) -> List[Meeting]:
        query = select(Meeting).where(
            Meeting.organization_id == organization_id,
            Meeting.meeting_date >= start,
            Meeting.meeting_date <= end,
        )
        if meeting_types:
            query = query.where(Meeting.meeting_type.in_(list(meeting_types)))
        result = await self.db.execute(
            query.order_by(Meeting.meeting_date.desc(), Meeting.title)
        )
        return list(result.scalars().all())

    async def _records(
        self, organization_id: str, meeting_ids: List[str], user_ids: List[str]
    ) -> List[MeetingAttendee]:
        if not meeting_ids or not user_ids:
            return []
        result = await self.db.execute(
            select(MeetingAttendee).where(
                MeetingAttendee.organization_id == organization_id,
                MeetingAttendee.meeting_id.in_(meeting_ids),
                MeetingAttendee.user_id.in_(user_ids),
            )
        )
        return list(result.scalars().all())

    async def _leaves(
        self, organization_id: str, user_ids: List[str]
    ) -> Dict[str, List[Any]]:
        # Active leaves only, as the ballot check and the minutes dashboard
        # load them, so a member's count here is the count they are judged by.
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(MemberLeaveOfAbsence).where(
                MemberLeaveOfAbsence.organization_id == organization_id,
                MemberLeaveOfAbsence.user_id.in_(user_ids),
                MemberLeaveOfAbsence.active.is_(True),
            )
        )
        by_user: Dict[str, List[Any]] = {}
        for leave in result.scalars().all():
            by_user.setdefault(str(leave.user_id), []).append(leave)
        return by_user

    def _window(
        self, member: User, periods: Sequence[Any], start: date, end: date
    ) -> Tuple[date, date]:
        # Never before the member's current stint: they cannot have attended
        # a meeting held before they (re)joined, and the ballot check does not
        # count one against them either.
        stint = current_stint_start(member, periods)
        return (max(start, stint) if stint else start, end)

    async def members_attendance(
        self,
        election: Election,
        organization_id: str,
        start: date,
        end: date,
        meeting_types: Optional[Sequence[str]],
    ) -> Dict[str, Any]:
        """Each active member's attendance over ``start``-``end`` and whether
        they may vote in ``election``."""
        org = await self._org(organization_id)
        today = today_in(scheduling_timezone(org))
        # A meeting scheduled for later is not an absence before it happens.
        end = min(end, today)

        members_result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.status.in_(ACTIVE_ACCOUNT_STATUSES))
            .where(User.deleted_at.is_(None))
            .order_by(User.last_name, User.first_name)
        )
        members = list(members_result.scalars().all())
        user_ids = [str(m.id) for m in members]

        meetings = await self._meetings(organization_id, start, end, meeting_types)
        meeting_dates = [(str(m.id), m.meeting_date) for m in meetings]
        records = await self._records(
            organization_id, [str(m.id) for m in meetings], user_ids
        )
        records_by_user: Dict[str, List[MeetingAttendee]] = {}
        for record in records:
            records_by_user.setdefault(str(record.user_id), []).append(record)
        leaves = await self._leaves(organization_id, user_ids)
        periods = await MemberServiceHistoryService(self.db).periods_by_user(
            organization_id, user_ids
        )

        roster = await ElectionService(self.db).get_eligibility_roster(
            UUID(str(election.id)), organization_id
        )
        decisions = {str(m["user_id"]): m for m in roster.get("roster", [])}

        tiers = configured_tiers(org.settings if org else None)
        labels = row_labels(tiers)
        ranks_as = ranks_as_from_tiers(tiers)

        rows = []
        for member in members:
            uid = str(member.id)
            member_periods = periods.get(uid, [])
            own = records_by_user.get(uid, [])
            tally = tally_attendance(
                meeting_dates,
                self._window(member, member_periods, start, end),
                waived_ids={str(r.meeting_id) for r in own if r.waiver_reason},
                present_ids={str(r.meeting_id) for r in own if r.present},
                leaves=leaves.get(uid, []),
            )
            decision = decisions.get(uid)
            stint = current_stint_start(member, member_periods)
            rows.append(
                {
                    "user_id": uid,
                    "name": member.display_name,
                    "member_type": " · ".join(
                        labels[key] for key in member_row_keys(member, labels, ranks_as)
                    )
                    or None,
                    "member_since": stint.isoformat() if stint else None,
                    "meetings_in_period": len(tally.in_window),
                    "attended": len(tally.attended),
                    "absent": len(tally.eligible - tally.attended),
                    "excused": len(tally.waived),
                    "on_leave": len(tally.on_leave),
                    "attendance_pct": tally.pct,
                    "may_vote": (
                        bool(decision.get("will_receive_ballot")) if decision else None
                    ),
                    "reason": (
                        decision.get("ineligibility_reason") if decision else None
                    ),
                }
            )

        return {
            "election_id": str(election.id),
            "election_title": election.title,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "meeting_types": list(meeting_types) if meeting_types else None,
            "total_meetings": len(meetings),
            "members": rows,
        }

    async def member_meetings(
        self,
        member: User,
        organization_id: str,
        start: date,
        end: date,
        meeting_types: Optional[Sequence[str]],
    ) -> Dict[str, Any]:
        """One member's meetings over ``start``-``end``, newest first, each
        with how it counts and where its record came from."""
        org = await self._org(organization_id)
        today = today_in(scheduling_timezone(org))
        end = min(end, today)
        uid = str(member.id)

        meetings = await self._meetings(organization_id, start, end, meeting_types)
        records = {
            str(r.meeting_id): r
            for r in await self._records(
                organization_id, [str(m.id) for m in meetings], [uid]
            )
        }
        leaves = (await self._leaves(organization_id, [uid])).get(uid, [])
        periods = (
            await MemberServiceHistoryService(self.db).periods_by_user(
                organization_id, [uid]
            )
        ).get(uid, [])
        tally = tally_attendance(
            [(str(m.id), m.meeting_date) for m in meetings],
            self._window(member, periods, start, end),
            waived_ids={mid for mid, r in records.items() if r.waiver_reason},
            present_ids={mid for mid, r in records.items() if r.present},
            leaves=leaves,
        )

        recorder_ids = {r.recorded_by for r in records.values() if r.recorded_by}
        names: Dict[str, str] = {}
        if recorder_ids:
            result = await self.db.execute(
                select(User).where(
                    User.organization_id == organization_id,
                    User.id.in_(list(recorder_ids)),
                )
            )
            names = {str(u.id): u.display_name for u in result.scalars().all()}

        rows = []
        for meeting in meetings:
            mid = str(meeting.id)
            # Meetings before the member's current stint are outside their
            # record altogether, as the count leaves them out.
            if mid not in tally.in_window:
                continue
            record = records.get(mid)
            leave = next(
                (
                    lv
                    for lv in leaves
                    if lv.start_date <= meeting.meeting_date
                    and (lv.end_date is None or meeting.meeting_date <= lv.end_date)
                ),
                None,
            )
            rows.append(
                {
                    "meeting_id": mid,
                    "title": meeting.title,
                    "meeting_type": getattr(
                        meeting.meeting_type, "value", meeting.meeting_type
                    ),
                    "meeting_date": meeting.meeting_date.isoformat(),
                    "status": _status(mid, tally),
                    "checked_in_at": (
                        record.checked_in_at.isoformat()
                        if record and record.checked_in_at
                        else None
                    ),
                    "recorded_by_name": (
                        names.get(str(record.recorded_by))
                        if record and record.recorded_by
                        else None
                    ),
                    "recorded_via": record.recorded_via if record else None,
                    "waiver_reason": record.waiver_reason if record else None,
                    "leave_start": leave.start_date.isoformat() if leave else None,
                    "leave_end": (
                        leave.end_date.isoformat() if leave and leave.end_date else None
                    ),
                }
            )
        return {
            "user_id": uid,
            "name": member.display_name,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "meetings": rows,
        }
