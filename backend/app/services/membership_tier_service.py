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
    Callable,
    Dict,
    FrozenSet,
    Iterable,
    List,
    Optional,
    Sequence,
    Tuple,
)
from zoneinfo import ZoneInfo

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
    sync_account_status_with_membership,
)
from app.services.member_service_history_service import (
    MemberServiceHistoryService,
    summarize,
    whole_years,
)
from app.utils.membership import (
    LEGACY_MEMBERSHIP_TYPES,
    VOTER_TYPE_LABELS,
    canonical_member_status,
    derive_membership_type,
    is_administrative,
    split_membership_type,
    voter_type_decided_by_class,
    voter_type_key,
)
from app.utils.org_timezone import (
    local_date,
    resolve_org_today,
    resolve_scheduling_timezone,
    scheduling_timezone,
    today_in,
)


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
        latest: date = max(known)
        return latest
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


def stint_window(
    member: Any, periods: Sequence[MemberServicePeriod], today: date
) -> Tuple[date, date]:
    """Every meeting since the member's current stint began, up to ``today``.

    A member with no known start is judged on every meeting to date; the
    count rule then looks only at the most recent of them.
    """
    stint_start = current_stint_start(member, periods)
    return (stint_start or date.min), today


def whole_months_between(start: date, end: date) -> int:
    """Completed calendar months from ``start`` to ``end`` (0 if end <= start)."""
    if end <= start:
        return 0
    delta = relativedelta(end, start)
    return delta.years * 12 + delta.months


@dataclass(frozen=True)
class RecentAttendance:
    """Attendance at a member's most recent eligible meetings."""

    attended: int
    # How many eligible meetings were looked at: the requested look-back, or
    # fewer when the member has not had that many since their stint began.
    considered: int


def tally_recent_attendance(
    meetings: Iterable[Tuple[str, date]],
    window: Tuple[date, date],
    waived_ids: AbstractSet[str],
    present_ids: AbstractSet[str],
    leaves: Sequence[Any],
    last_meetings: int,
) -> RecentAttendance:
    """Attendance at the ``last_meetings`` most recent eligible meetings.

    Eligibility (window, waivers, leave) comes from ``tally_attendance``, so
    the count rule excludes exactly the meetings the percentage rule does.
    Ties on a date are broken by meeting id so the result is stable.
    """
    meetings = list(meetings)
    tally = tally_attendance(meetings, window, waived_ids, present_ids, leaves)
    dated = sorted(
        ((md, mid) for mid, md in meetings if mid in tally.eligible),
        reverse=True,
    )
    recent = {mid for _, mid in dated[:last_meetings]}
    return RecentAttendance(
        attended=len(recent & tally.attended), considered=len(recent)
    )


def required_recent_meetings(
    min_meetings: int, of_last_meetings: int, considered: int
) -> int:
    """Meetings a member must have attended among the ``considered`` ones.

    A member who has had fewer eligible meetings than the look-back -- a
    recent joiner, or a department that has not met that often -- is held to
    the same proportion rather than to a count they could not reach:
    6 of 12 becomes 2 of 4. Rounded up, so the proportion is never relaxed.
    """
    if considered >= of_last_meetings:
        return min_meetings
    return -(-min_meetings * considered // of_last_meetings)


def type_wait_start(
    member: Any, periods: Sequence[MemberServicePeriod], tz: ZoneInfo
) -> Optional[date]:
    """The date a member's voting waiting period counts from, or None.

    A secretary's ``voting_wait_from`` wins outright: it is a deliberate
    correction, and clamping it to the current stint would undo the very
    case it exists for (crediting a rejoined member's earlier standing).

    Otherwise it is when the member became the type the wait is set for —
    ``member_class_since`` for a type decided by class (administrative,
    social), ``member_status_since`` for one decided by status — but never
    before the current stint began, so a member who left and rejoined is not
    credited with time from before they came back. With no stamp, the stint
    start stands in; with neither, None, which the wait reads as "no wait":
    a missing record is not evidence of a recent change.
    """
    override: Optional[date] = getattr(member, "voting_wait_from", None)
    if override is not None:
        return override
    type_key = voter_type_key(
        getattr(member, "member_class", None),
        getattr(member, "member_status", None),
        getattr(member, "membership_type", None),
    )
    stamp = (
        getattr(member, "member_class_since", None)
        if type_key and voter_type_decided_by_class(type_key)
        else getattr(member, "member_status_since", None)
    )
    became = local_date(stamp, tz) if stamp is not None else None
    stint = current_stint_start(member, periods)
    if became is None:
        return stint
    return max(became, stint) if stint is not None else became


@dataclass(frozen=True)
class WaitOutcome:
    """Where one member stands against one waiting-period rule.

    ``state`` is ``no_rule`` (no wait for their type, or no type), ``never``
    (their type may not vote), ``waived`` (a secretary waived the wait),
    ``eligible`` (the wait is over, or there is no date to wait from) or
    ``waiting``. ``eligible_from`` is set for ``waiting`` and for an
    ``eligible`` that had a date.
    """

    state: str
    type_key: Optional[str]
    months: Optional[int] = None
    eligible_from: Optional[date] = None


def evaluate_wait(
    waiting_periods: Any,
    type_key: Optional[str],
    start: Optional[date],
    waived: bool,
    today: date,
) -> WaitOutcome:
    """Judge one member against an election's ``waiting_periods``.

    The rules are free-form JSON once stored, so a malformed entry reads as
    "no rule" rather than raising — an exception here would take down a whole
    roster or ballot send, not one member. A waiver lifts the wait, never a
    ``never``: that is a rule about the type, not about how long the member
    has held it.
    """
    if not type_key or not isinstance(waiting_periods, dict):
        return WaitOutcome("no_rule", type_key)
    period = waiting_periods.get(type_key)
    if not isinstance(period, dict):
        return WaitOutcome("no_rule", type_key)
    mode = period.get("mode")
    if mode == "never":
        return WaitOutcome("never", type_key)
    months = period.get("months")
    if (
        mode != "months"
        or isinstance(months, bool)
        or not isinstance(months, int)
        or months <= 0
    ):
        return WaitOutcome("no_rule", type_key)
    if waived:
        return WaitOutcome("waived", type_key, months)
    if start is None:
        return WaitOutcome("eligible", type_key, months)
    eligible_from = start + relativedelta(months=months)
    state = "eligible" if today >= eligible_from else "waiting"
    return WaitOutcome(state, type_key, months, eligible_from)


def wait_ineligibility_reason(outcome: WaitOutcome) -> Optional[str]:
    """Why ``outcome`` keeps a member from voting, or None when it does not.

    One wording for the ballot check, the roster and the member's profile, so
    the three never describe one rule two ways (pitfall #29).
    """
    if outcome.type_key is None:
        return None
    label = VOTER_TYPE_LABELS.get(outcome.type_key, outcome.type_key.title())
    if outcome.state == "never":
        return f"{label} members are not eligible to vote"
    if outcome.state == "waiting" and outcome.eligible_from is not None:
        day = outcome.eligible_from
        # Month first ("Apr 30, 2027"), as the profile card's
        # formatCalendarDate shows the same date; %-d is not portable.
        return (
            f"{label} members may vote {outcome.months} months after becoming "
            f"{label.lower()}; eligible from {day:%b} {day.day}, {day.year}"
        )
    return None


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
        meeting_types: Optional[Sequence[str]] = None,
    ) -> float:
        """
        Calculate a member's meeting attendance percentage over a look-back
        period.  Attendance = (meetings marked present / eligible meetings) * 100.
        Only meetings inside ``attendance_window`` count -- none from before the
        member's current stint began, and none that have not happened yet.
        Waived meetings and meetings that fall within an active Leave of Absence
        are excluded from both numerator and denominator so they don't penalise
        the member's percentage. ``meeting_types`` limits the count to those
        meeting types; None counts every meeting.
        Returns 100.0 if no eligible meetings occurred.
        """
        loaded = await self._load_attendance(
            user_id,
            organization_id,
            lambda member, periods, today: attendance_window(
                member, periods, period_months, today
            ),
            meeting_types,
        )
        if loaded is None:
            return 100.0  # No meetings held — don't penalise
        return tally_attendance(*loaded).pct

    async def get_recent_meeting_attendance(
        self,
        user_id: str,
        organization_id: str,
        last_meetings: int,
        meeting_types: Optional[Sequence[str]] = None,
    ) -> RecentAttendance:
        """How many of the member's last ``last_meetings`` meetings they attended.

        Judged on the same eligible meetings as the percentage rule -- held
        since the member's current stint began, on or before the department's
        today, not waived and not during a leave of absence -- so the two
        rules can never disagree on which meetings a member is charged with.
        """
        loaded = await self._load_attendance(
            user_id,
            organization_id,
            stint_window,
            meeting_types,
        )
        if loaded is None:
            return RecentAttendance(attended=0, considered=0)
        return tally_recent_attendance(*loaded, last_meetings=last_meetings)

    async def get_type_wait_start(
        self, member: User, organization_id: str
    ) -> Optional[date]:
        """The date ``member``'s voting waiting period counts from, or None
        when nothing records one. See ``type_wait_start``."""
        periods = await MemberServiceHistoryService(self.db).list_periods(
            organization_id, str(member.id)
        )
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        return type_wait_start(member, periods, tz)

    async def _load_attendance(
        self,
        user_id: str,
        organization_id: str,
        window_for: Callable[
            [Any, Sequence[MemberServicePeriod], date], Tuple[date, date]
        ],
        meeting_types: Optional[Sequence[str]],
    ) -> Optional[
        Tuple[
            List[Tuple[str, date]],
            Tuple[date, date],
            AbstractSet[str],
            AbstractSet[str],
            List[Any],
        ]
    ]:
        """The inputs ``tally_attendance`` needs, or None when no meeting
        falls inside the member's window."""
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
        window_start, window_end = window_for(member, periods, today)

        meeting_filters = [
            Meeting.organization_id == organization_id,
            Meeting.meeting_date >= window_start,
            Meeting.meeting_date <= window_end,
        ]
        if meeting_types:
            meeting_filters.append(Meeting.meeting_type.in_(list(meeting_types)))
        window_meetings_subq = select(Meeting.id).where(*meeting_filters)
        meetings_result = await self.db.execute(
            select(Meeting.id, Meeting.meeting_date).where(*meeting_filters)
        )
        meetings = [(row[0], row[1]) for row in meetings_result.all()]
        if not meetings:
            return None

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

        return meetings, (window_start, window_end), waived_ids, present_ids, leaves

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

    @staticmethod
    def tier_for_status(
        tiers: List[Dict[str, Any]], member_status: Optional[str]
    ) -> Optional[Dict[str, Any]]:
        """The rung a stored ``member_status`` stands on, if it is on this ladder.

        Matched in canonical spelling, because the shipped ladder names its
        second rung ``active`` and the column stores that standing as
        ``regular`` (see ``canonical_member_status``).
        """
        wanted = canonical_member_status(member_status)
        if wanted is None:
            return None
        for tier in tiers:
            if canonical_member_status(tier.get("id")) == wanted:
                return tier
        return None

    @staticmethod
    def ranks_as_by_tier(organization: Optional[Organization]) -> Dict[str, str]:
        """tier id (canonical) -> the built-in status it counts as.

        Only tiers that declare ``ranks_as`` appear; a tier without one counts
        as nothing, which is what ``status_for_tier`` relies on.
        """
        settings = organization.settings if organization else None
        if not isinstance(settings, dict):
            return {}
        tiers = (settings.get("membership_tiers") or {}).get("tiers") or []
        mapping: Dict[str, str] = {}
        for tier in tiers:
            if not isinstance(tier, dict):
                continue
            tier_id = canonical_member_status(tier.get("id"))
            ranks_as = (tier.get("ranks_as") or "").strip().lower()
            if tier_id and ranks_as:
                mapping[tier_id] = ranks_as
        return mapping

    @staticmethod
    def _current_standing(member: Any) -> Optional[str]:
        """The ladder standing to judge a member by.

        ``member_status`` is the authority; a row written before it existed
        still carries the standing fused into ``membership_type``.
        """
        stored = getattr(member, "member_status", None)
        if stored:
            return str(stored)
        _cls, status = split_membership_type(getattr(member, "membership_type", None))
        if status:
            return status
        legacy = (getattr(member, "membership_type", None) or "").strip().lower()
        return legacy or None

    @staticmethod
    def _move_to_tier(member: Any, tier_id: str) -> None:
        """Put ``member`` on ``tier_id`` without touching their class.

        The ladder is a statement about tenure, so every class climbs it: an
        administrative member with twenty years reaches Life like anyone
        else, and stays administrative. The one exception is a tier named
        in the legacy vocabulary for a *class* (``administrative``,
        ``honorary``): such a rung is a class change by construction, and is
        written the way it always was, through the legacy column, so the
        reconciler moves the class with it.
        """
        legacy = canonical_tier = canonical_member_status(tier_id)
        if tier_id in LEGACY_MEMBERSHIP_TYPES:
            cls, _status = split_membership_type(tier_id)
            if cls != "operational":
                member.membership_type = tier_id
                return
        member.member_status = canonical_tier
        # Written as well as derived at flush so a caller reading the row
        # before the flush -- the audit entry, a test double -- sees the
        # legacy value the reconciler will settle on.
        member.membership_type = derive_membership_type(
            getattr(member, "member_class", None), legacy
        )

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

        **The Organization row is locked for the whole scan** (owner decision
        USR-10a). ``update_membership_tier_config`` refuses to remove a tier
        members hold, and it decides that under the same lock; without this
        one, a scan could commit a member onto a tier while an edit removing it
        was between its occupancy count and its own commit. The lock is taken
        first — before any member row — which is the order every writer of a
        member's tier uses (``change_membership_type`` locks the Organization
        before the member too), and released by the commit at the end of every
        path, so a settings edit waits only as long as one scan. The tier
        config is read off the locked row, so the scan always works from the
        ladder as it stands once no edit can be in flight.
        """
        org_result = await self.db.execute(
            select(Organization)
            .where(Organization.id == str(organization_id))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        organization = org_result.scalar_one_or_none()
        if not organization:
            return {"advanced": 0, "members": []}

        tier_config = (organization.settings or {}).get("membership_tiers", {})
        skipped: Optional[str] = None
        tiers: List[Dict[str, Any]] = []
        if not tier_config.get("auto_advance", True):
            skipped = "Auto-advance is disabled"
        else:
            tiers = self._load_tiers(organization)
            if not tiers:
                skipped = "No membership tiers configured"

        advanced: List[Dict[str, Any]] = []
        off_ladder = 0
        if skipped is None:
            advanced, off_ladder = await self._advance_members(
                organization, organization_id, tiers
            )

        if advanced:
            # Audit inside the same transaction as the change, and commit both
            # together. Written after the mutations and before the commit on
            # purpose: `log_audit_event` opens a SAVEPOINT, so an audit failure
            # rolls back only itself and still lets the advancement land, while
            # a success is durable with the row it describes rather than
            # separately from it.
            #
            # The previous order — commit, then audit — lost the audit trail
            # outright on the scheduled path. `log_audit_event` releasing its
            # savepoint does not commit the outer transaction, `_for_each_org`
            # never commits, and the task loop's
            # `async with async_session_factory()` only closes the session, so
            # the rows were discarded. Demonstrated: a cron-path advance moved
            # a member from `active` to `senior` and wrote **zero**
            # `membership_tier_auto_advanced` rows. The endpoint path happened
            # to survive it only because FastAPI's `get_session` dependency
            # commits on teardown — which is not something a service should
            # depend on for its own audit trail, least of all this one: it
            # changes a member's membership class unattended and clears the
            # operational rank of anyone moved into an administrative tier,
            # so the audit row is the only record that those permissions went
            # away.
            for entry in advanced:
                await log_audit_event(
                    db=self.db,
                    event_type="membership_tier_auto_advanced",
                    event_category="user_management",
                    severity="info",
                    event_data=entry,
                    user_id=performed_by,
                )
        # Unconditional: with nothing advanced this is what releases the
        # Organization lock, which would otherwise be held until whatever owns
        # the session next commits — on the scheduled path, past every later
        # organization's scan.
        await self.db.commit()

        if skipped is not None:
            return {"advanced": 0, "members": [], "message": skipped}

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

    async def _advance_members(
        self,
        organization: Organization,
        organization_id: str,
        tiers: List[Dict[str, Any]],
    ) -> Tuple[List[Dict[str, Any]], int]:
        """The scan itself; runs under ``advance_all``'s Organization lock.

        Returns the advancements (one entry per member moved) and how many
        members hold a ``membership_type`` that is not on this ladder.
        """
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

            current_tier_def = self.tier_for_status(
                tiers, self._current_standing(candidate)
            )
            if current_tier_def is None:
                # Only advance along this ladder: a standing that is not a
                # rung (administrative, honorary, retired, prospective in the
                # shipped defaults) is left where it is.
                off_ladder += 1
                continue
            if current_tier_def["id"] == target_tier["id"]:
                continue
            # Only advance (don't demote)
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
            # this member's standing since).
            current_tier_def = self.tier_for_status(
                tiers, self._current_standing(member)
            )
            if current_tier_def is None:
                off_ladder += 1
                continue
            if current_tier_def["id"] == target_tier["id"]:
                continue
            if target_tier.get("sort_order", 0) <= current_tier_def.get(
                "sort_order", 0
            ):
                continue

            previous_type = current_tier_def["id"]
            self._move_to_tier(member, target_tier["id"])
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

            # The account status follows the tier the same way it follows a
            # change made by hand: a member advanced off the probationary rung
            # becomes active. Applied here so the audit entry records it.
            status_change = sync_account_status_with_membership(
                member,
                now=now,
                member_status=canonical_member_status(target_tier["id"]),
                ranks_as_by_tier=self.ranks_as_by_tier(organization),
            )

            advanced.append(
                {
                    "user_id": str(member.id),
                    "name": member.display_name,
                    "previous_tier": previous_type,
                    "new_tier": target_tier["id"],
                    "years_of_service": yos,
                    "cleared_rank": cleared_rank,
                    **(
                        {
                            "previous_status": status_change[0],
                            "new_status": status_change[1],
                        }
                        if status_change
                        else {}
                    ),
                }
            )

        return advanced, off_ladder
