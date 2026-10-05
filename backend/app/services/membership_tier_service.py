"""
Membership Tier Service

Handles tier auto-advancement based on years of service and provides
meeting attendance calculation for voting eligibility.
"""

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import (
    AbstractSet,
    Any,
    Dict,
    FrozenSet,
    Iterable,
    List,
    Optional,
    Sequence,
    Tuple,
)

from dateutil.relativedelta import relativedelta
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.models.meeting import Meeting, MeetingAttendee
from app.models.user import (
    MemberLeaveOfAbsence,
    MemberServicePeriod,
    Organization,
    User,
    UserStatus,
)
from app.services.member_service_history_service import (
    MemberServiceHistoryService,
    summarize,
    whole_years,
)
from app.utils.membership import is_administrative
from app.utils.org_timezone import resolve_org_today, scheduling_timezone, today_in


def current_stint_start(
    member: Any, periods: Sequence[MemberServicePeriod]
) -> Optional[date]:
    """The day the member's current stint of membership began, if known.

    That is the start of their latest recorded stint (a NULL start being the
    hire date), or ``hire_date`` for a member who has never separated and so
    has no stints recorded. The latest stint is taken whatever its
    ``counts_toward_service`` flag: that flag decides whether earlier years
    count toward tenure, but the gap before the current stint is time the
    member was not in the department either way, and they cannot be expected
    to have attended meetings held during it.
    """
    hire_date = getattr(member, "hire_date", None) if member is not None else None
    starts = [p.start_date or hire_date for p in periods]
    known = [s for s in starts if s is not None]
    if known:
        return max(known)
    return hire_date


def attendance_window(
    member: Any,
    periods: Sequence[MemberServicePeriod],
    period_months: int,
    today: date,
) -> Tuple[date, date]:
    """Inclusive date range of the meetings a member is judged on.

    Starts at the later of the look-back cutoff and the start of the member's
    current stint, so a recent hire or a reinstated member is not charged with
    meetings held before they (re)joined. Ends at ``today`` -- the
    department's date, which the caller resolves -- so a meeting already
    scheduled for next week is not an absence before it has happened.
    """
    cutoff = today - relativedelta(months=period_months)
    stint_start = current_stint_start(member, periods)
    start = max(cutoff, stint_start) if stint_start else cutoff
    return start, today


@dataclass(frozen=True)
class AttendanceTally:
    """One member's meetings inside their attendance window, classified."""

    in_window: FrozenSet[str]
    waived: FrozenSet[str]
    on_leave: FrozenSet[str]
    eligible: FrozenSet[str]
    attended: FrozenSet[str]

    @property
    def pct(self) -> float:
        # No eligible meetings -- none held, or all waived/on leave -- must not
        # read as a failing attendance record.
        if not self.eligible:
            return 100.0
        return round((len(self.attended) / len(self.eligible)) * 100, 1)


def tally_attendance(
    meetings: Iterable[Tuple[str, date]],
    window: Tuple[date, date],
    waived_ids: AbstractSet[str],
    present_ids: AbstractSet[str],
    leaves: Sequence[Any],
) -> AttendanceTally:
    """Classify ``meetings`` for voting-eligibility attendance.

    Shared by the ballot check and the secretary's attendance dashboard so the
    two can never disagree on whether a member may vote (pitfall #29).

    Works from meeting-id sets so a meeting that is both waived and inside a
    leave is excluded exactly once -- subtracting a waived count and an
    on-leave count separately double-excluded it and could push the
    percentage above 100%. Attendance is counted only within the eligible set
    for the same reason: a member marked present at a meeting during their
    leave must not count toward the percentage.
    """
    start, end = window
    dated = [(mid, md) for mid, md in meetings if start <= md <= end]
    in_window = frozenset(mid for mid, _ in dated)

    on_leave = set()
    for mid, md in dated:
        for leave in leaves:
            # end_date is None for permanent leave — treat as open-ended.
            if leave.start_date <= md and (
                leave.end_date is None or md <= leave.end_date
            ):
                on_leave.add(mid)
                break

    waived = in_window & frozenset(waived_ids)
    eligible = in_window - waived - on_leave
    return AttendanceTally(
        in_window=in_window,
        waived=waived,
        on_leave=frozenset(on_leave),
        eligible=eligible,
        attended=eligible & frozenset(present_ids),
    )


class MembershipTierService:
    """Manages membership tier progression and meeting attendance queries."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Meeting attendance
    # ------------------------------------------------------------------

    async def get_meeting_attendance_pct(
        self,
        user_id: str,
        organization_id: str,
        period_months: int = 12,
    ) -> float:
        """
        Calculate a member's meeting attendance percentage over a look-back
        period.  Attendance = (meetings marked present / eligible meetings) * 100.
        Only meetings inside ``attendance_window`` count -- none from before the
        member's current stint began, and none that have not happened yet.
        Waived meetings and meetings that fall within an active Leave of Absence
        are excluded from both numerator and denominator so they don't penalise
        the member's percentage.
        Returns 100.0 if no eligible meetings occurred.
        """
        today = await resolve_org_today(self.db, organization_id)
        member_result = await self.db.execute(
            select(User).where(
                User.id == str(user_id),
                User.organization_id == str(organization_id),
            )
        )
        member = member_result.scalar_one_or_none()
        periods = (
            await MemberServiceHistoryService(self.db).list_periods(
                organization_id, user_id
            )
            if member is not None
            else []
        )
        window_start, window_end = attendance_window(
            member, periods, period_months, today
        )

        window_meetings_subq = select(Meeting.id).where(
            Meeting.organization_id == organization_id,
            Meeting.meeting_date >= window_start,
            Meeting.meeting_date <= window_end,
        )
        meetings_result = await self.db.execute(
            select(Meeting.id, Meeting.meeting_date).where(
                Meeting.organization_id == organization_id,
                Meeting.meeting_date >= window_start,
                Meeting.meeting_date <= window_end,
            )
        )
        meetings = [(row[0], row[1]) for row in meetings_result.all()]
        if not meetings:
            return 100.0  # No meetings held — don't penalise

        waived_result = await self.db.execute(
            select(MeetingAttendee.meeting_id).where(
                MeetingAttendee.user_id == user_id,
                MeetingAttendee.waiver_reason.isnot(None),
                MeetingAttendee.meeting_id.in_(window_meetings_subq),
            )
        )
        waived_ids = {row[0] for row in waived_result.all()}

        leave_result = await self.db.execute(
            select(MemberLeaveOfAbsence).where(
                MemberLeaveOfAbsence.organization_id == organization_id,
                MemberLeaveOfAbsence.user_id == user_id,
                MemberLeaveOfAbsence.active.is_(True),
            )
        )
        leaves = list(leave_result.scalars().all())

        attended_result = await self.db.execute(
            select(MeetingAttendee.meeting_id).where(
                MeetingAttendee.user_id == user_id,
                MeetingAttendee.present.is_(True),
                MeetingAttendee.waiver_reason.is_(None),
                MeetingAttendee.meeting_id.in_(window_meetings_subq),
            )
        )
        present_ids = {row[0] for row in attended_result.all()}

        return tally_attendance(
            meetings, (window_start, window_end), waived_ids, present_ids, leaves
        ).pct

    # ------------------------------------------------------------------
    # Tier resolution helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_tiers(organization: Organization) -> List[Dict[str, Any]]:
        """Load and sort the tier list from org settings."""
        settings = organization.settings or {}
        tier_config = settings.get("membership_tiers", {})
        tiers = tier_config.get("tiers", [])
        return sorted(tiers, key=lambda t: t.get("sort_order", 0))

    @staticmethod
    def years_of_service(hire_date: Optional[date], today: date) -> int:
        """Completed years from hire_date to ``today``, ignoring any time away.

        Tier advancement uses credited service (``summarize``) instead; this
        is the same anniversary arithmetic for a single unbroken stint.
        """
        return whole_years(hire_date, today)

    def resolve_tier(
        self, tiers: List[Dict[str, Any]], yos: int
    ) -> Optional[Dict[str, Any]]:
        """Return the highest tier the member qualifies for by years of service."""
        best = None
        for tier in tiers:
            if yos >= tier.get("years_required", 0):
                if best is None or tier.get("sort_order", 0) > best.get(
                    "sort_order", 0
                ):
                    best = tier
        return best

    def get_tier_by_id(
        self, tiers: List[Dict[str, Any]], tier_id: str
    ) -> Optional[Dict[str, Any]]:
        """Look up a tier definition by its id."""
        for tier in tiers:
            if tier.get("id") == tier_id:
                return tier
        return None

    # ------------------------------------------------------------------
    # Batch auto-advance
    # ------------------------------------------------------------------

    async def advance_all(
        self,
        organization_id: str,
        performed_by: str,
    ) -> Dict[str, Any]:
        """
        Scan every active/probationary member and promote them to the
        highest tier they qualify for.  Returns a summary of changes.

        **A member is only advanced along a ladder they are already on.** A
        ``membership_type`` that is not one of this organization's configured
        tiers used to be treated as sort_order 0 — the bottom rung — so this
        unattended monthly job promoted the four legacy types that are not
        tiers in the shipped defaults (``administrative``, ``honorary``,
        ``retired``, ``prospective``) into an operational tier. Setting
        ``membership_type`` fires ``_reconcile_membership``, which rewrote
        ``member_class`` to ``operational`` with it: an administrative member
        became an operational one overnight, could self-sign up for shifts,
        matched operational ballots, and slipped past the rank-clearing guard
        below, which asks ``is_administrative`` of the *new* type.

        Skipping is the conservative direction. An organization whose ladder
        uses ids none of its members hold yet advances nobody until an admin
        sets a starting tier, rather than sorting its whole roster onto rung
        zero and climbing from there.
        """
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()
        if not organization:
            return {"advanced": 0, "members": []}

        tier_config = (organization.settings or {}).get("membership_tiers", {})
        if not tier_config.get("auto_advance", True):
            return {"advanced": 0, "members": [], "message": "Auto-advance is disabled"}

        tiers = self._load_tiers(organization)
        if not tiers:
            return {
                "advanced": 0,
                "members": [],
                "message": "No membership tiers configured",
            }

        # Load all active / probationary members
        result = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.status.in_([UserStatus.ACTIVE, UserStatus.PROBATIONARY]),
                User.deleted_at.is_(None),
            )
        )
        members = result.scalars().all()

        # Credited service, not time since hire: a member who left and came
        # back does not advance on the years they were away. One query for
        # every candidate's stints; a member with none is one unbroken stint
        # from hire_date, so their years are exactly what they always were.
        history = MemberServiceHistoryService(self.db)
        stints_by_member = await history.periods_by_user(
            organization_id, [m.id for m in members]
        )
        org_tz = scheduling_timezone(organization)
        today = today_in(org_tz)

        advanced = []
        # Members whose current membership_type is not one of this
        # organization's tiers. Counted rather than silently dropped: an
        # unattended job that quietly declines to touch part of the roster
        # should say how much of it.
        off_ladder = 0
        now = datetime.now(timezone.utc)

        for candidate in members:
            yos = summarize(
                candidate, stints_by_member.get(str(candidate.id), []), today, org_tz
            ).credited_years
            target_tier = self.resolve_tier(tiers, yos)
            if not target_tier:
                continue

            current_type = candidate.membership_type or "active"
            if current_type == target_tier["id"]:
                continue

            # Only advance (don't demote), and only along this ladder
            current_tier_def = self.get_tier_by_id(tiers, current_type)
            if current_tier_def is None:
                off_ladder += 1
                continue
            if target_tier.get("sort_order", 0) <= current_tier_def.get(
                "sort_order", 0
            ):
                continue

            # Lock this member's row before mutating it: this is another
            # writer of the class/rank invariant update_user_profile and
            # change_membership_type already serialize against via their own
            # locks, and the batch SELECT above is unlocked -- without
            # re-selecting under a lock here, a concurrent profile update
            # racing this scan could land the same administrative-member-
            # holding-a-rank contradiction those two close. populate_existing
            # because this request's session may already hold the row (e.g.
            # this scan running back-to-back with another write in the same
            # transaction).
            locked_result = await self.db.execute(
                select(User)
                .where(User.id == candidate.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            member = locked_result.scalar_one_or_none()
            if not member or member.deleted_at is not None:
                continue
            # Re-check eligibility under the lock: the batch read above may
            # now be stale (another transaction already advanced or changed
            # this member's type since).
            current_type = member.membership_type or "active"
            if current_type == target_tier["id"]:
                continue
            current_tier_def = self.get_tier_by_id(tiers, current_type)
            if current_tier_def is None:
                off_ladder += 1
                continue
            if target_tier.get("sort_order", 0) <= current_tier_def.get(
                "sort_order", 0
            ):
                continue

            previous_type = current_type
            member.membership_type = target_tier["id"]
            member.membership_type_changed_at = now

            # An administrative member holds no operational rank, and this is a
            # writer of the membership class like any other — an unattended one,
            # which is what makes it the dangerous one. Tier ids are
            # organization-configurable, so a department that names a tier
            # `administrative` moves ranked operational members into that class
            # on a schedule, and without this they would keep every permission
            # their rank confers while nobody is watching the change happen.
            cleared_rank = member.rank
            if cleared_rank and is_administrative(None, target_tier["id"]):
                member.rank = None
            else:
                cleared_rank = None

            advanced.append(
                {
                    "user_id": str(member.id),
                    "name": member.display_name,
                    "previous_tier": previous_type,
                    "new_tier": target_tier["id"],
                    "years_of_service": yos,
                    "cleared_rank": cleared_rank,
                }
            )

        if advanced:
            await self.db.commit()

            # Audit each advancement
            for entry in advanced:
                await log_audit_event(
                    db=self.db,
                    event_type="membership_tier_auto_advanced",
                    event_category="user_management",
                    severity="info",
                    event_data=entry,
                    user_id=performed_by,
                )

        logger.info(
            f"Membership tier advance: {len(advanced)} members advanced, "
            f"{off_ladder} not on the tier ladder, in org {organization_id}"
        )

        return {
            "organization_id": organization_id,
            "advanced": len(advanced),
            "members": advanced,
            "off_ladder": off_ladder,
        }
