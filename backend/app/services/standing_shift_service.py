"""
Standing Shift Service

A standing shift is a member's recurring claim on a seat — "every Tuesday
night through December". It is deliberately a *member* record rather than a
department one: ``ShiftPattern`` generates the shifts, and a standing claim
seats one member on the shifts that match it.

The claim is read in two places, and it only means anything because both
exist:

* creating a claim seats the member on the matching shifts that already
  exist, and
* creating a shift seats every member whose active claim matches it.

Without the second reader a claim would go quiet the moment the department
generated next month's schedule, which is exactly the month the member set it
up for.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    AssignmentStatus,
    Shift,
    ShiftAssignment,
    ShiftStatus,
    StandingShiftClaim,
    StandingShiftPattern,
    StandingShiftPeriod,
)
from app.utils.apparatus_ref import apparatus_ref_exists
from app.utils.org_timezone import resolve_scheduling_timezone

# A standing claim may not be opened further out than this. Generating a
# preview is cheap, but the create path writes an assignment per matching date
# in one transaction, so the horizon is what bounds that write.
MAX_SERIES_DAYS = 366

_ACTIVE_STATUSES = [AssignmentStatus.ASSIGNED, AssignmentStatus.CONFIRMED]


def _weekday_sunday_first(value: date) -> int:
    """0 = Sunday … 6 = Saturday, matching the member-facing weekday picker."""
    return (value.weekday() + 1) % 7


def series_dates(
    pattern: StandingShiftPattern,
    weekday: int,
    start_date: date,
    end_date: date,
) -> List[date]:
    """Every date the claim covers, in order.

    ``weekly`` is every matching weekday in range. ``biweekly`` is every other
    one, anchored on the first match rather than on an absolute week number so
    a member who sets one up in the middle of a month gets the fortnight they
    were looking at. ``monthly`` keeps the *ordinal* weekday of the anchor —
    "the fourth Tuesday" — because that is how duty rotations are written; a
    month with no fourth Tuesday simply has no date.
    """
    if end_date < start_date:
        return []

    cursor = start_date
    while _weekday_sunday_first(cursor) != weekday:
        cursor += timedelta(days=1)
        if cursor > end_date:
            return []

    if pattern == StandingShiftPattern.WEEKLY:
        step = timedelta(days=7)
    elif pattern == StandingShiftPattern.BIWEEKLY:
        step = timedelta(days=14)
    else:
        return _monthly_series(cursor, end_date)

    dates: List[date] = []
    while cursor <= end_date:
        dates.append(cursor)
        cursor += step
    return dates


def _monthly_series(anchor: date, end_date: date) -> List[date]:
    """The anchor's ordinal weekday, once per month, through ``end_date``."""
    ordinal = (anchor.day - 1) // 7  # 0-based: 0 = first such weekday
    dates: List[date] = []
    year, month = anchor.year, anchor.month
    while True:
        first = date(year, month, 1)
        offset = (anchor.weekday() - first.weekday()) % 7
        candidate = first + timedelta(days=offset + ordinal * 7)
        if candidate.month == month and anchor <= candidate <= end_date:
            dates.append(candidate)
        if candidate > end_date and candidate.month == month:
            break
        month += 1
        if month > 12:
            month = 1
            year += 1
        if date(year, month, 1) > end_date:
            break
    return dates


class StandingShiftService:
    """Create, read and end a member's standing shift claims."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Matching
    # ------------------------------------------------------------------

    async def _org_tz(self, organization_id: UUID) -> ZoneInfo:
        # Shared with shift generation on purpose: the two must agree, or a
        # department that never set a timezone gets one answer about which
        # half of the day a shift starts in and the other gets the opposite.
        return await resolve_scheduling_timezone(self.db, organization_id)

    @staticmethod
    def shift_period(shift: Shift, tz: ZoneInfo) -> StandingShiftPeriod:
        """Which half of the day a shift starts in, in the org's timezone.

        Times are stored as UTC, so a department in UTC-5 running an 1800
        night shift stores 23:00 — reading the hour off the raw column would
        call it a day shift for half the year and a night shift for the other
        half, as daylight saving moved it across midnight.
        """
        start = shift.start_time
        if start is None:
            return StandingShiftPeriod.DAY
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        return (
            StandingShiftPeriod.DAY
            if start.astimezone(tz).hour < 12
            else StandingShiftPeriod.NIGHT
        )

    def _matches(
        self,
        shift: Shift,
        claim_period: StandingShiftPeriod,
        apparatus_id: Optional[str],
        tz: ZoneInfo,
    ) -> bool:
        if shift.status == ShiftStatus.CANCELLED or getattr(
            shift, "is_finalized", False
        ):
            return False
        # A community-outreach signup sheet is not the department's regular
        # coverage, and its seats are counted: a standing claim landing on one
        # both commits a member to an event they did not choose and takes a
        # seat away from somebody who would have volunteered for it.
        if getattr(shift, "is_outreach", False):
            return False
        if apparatus_id and str(shift.apparatus_id or "") != str(apparatus_id):
            return False
        return self.shift_period(shift, tz) == claim_period

    async def _shifts_on_dates(
        self,
        organization_id: UUID,
        dates: List[date],
    ) -> Dict[date, List[Shift]]:
        if not dates:
            return {}
        result = await self.db.execute(
            select(Shift)
            .where(Shift.organization_id == str(organization_id))
            .where(Shift.shift_date.in_(dates))
            .order_by(Shift.start_time)
        )
        by_date: Dict[date, List[Shift]] = {}
        for shift in result.scalars().all():
            by_date.setdefault(shift.shift_date, []).append(shift)
        return by_date

    # ------------------------------------------------------------------
    # Preview
    # ------------------------------------------------------------------

    async def preview(
        self,
        organization_id: UUID,
        user_id: UUID,
        pattern: StandingShiftPattern,
        weekday: int,
        period: StandingShiftPeriod,
        start_date: date,
        end_date: date,
        apparatus_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """What the member would be committing to, date by date.

        Every date in the series is reported, including the ones that cannot
        be claimed — a preview that quietly dropped them would understate the
        commitment and leave the member wondering why the count moved.
        """
        dates = series_dates(pattern, weekday, start_date, end_date)
        tz = await self._org_tz(organization_id)
        by_date = await self._shifts_on_dates(organization_id, dates)
        held = await self._held_shift_ids(organization_id, user_id, dates)

        entries: List[Dict[str, Any]] = []
        for day in dates:
            match = next(
                (
                    s
                    for s in by_date.get(day, [])
                    if self._matches(s, period, apparatus_id, tz)
                ),
                None,
            )
            if match is None:
                entries.append(
                    {
                        "date": day,
                        "shift_id": None,
                        "status": "no_shift",
                    }
                )
            elif str(match.id) in held:
                entries.append(
                    {
                        "date": day,
                        "shift_id": str(match.id),
                        "status": "already_yours",
                    }
                )
            elif self._has_conflicting_hold(day, held, by_date, match):
                entries.append(
                    {
                        "date": day,
                        "shift_id": str(match.id),
                        "status": "conflict",
                    }
                )
            else:
                entries.append(
                    {
                        "date": day,
                        "shift_id": str(match.id),
                        "status": "available",
                    }
                )

        return {
            "dates": entries,
            "claimable_count": sum(1 for e in entries if e["status"] == "available"),
            "conflict_count": sum(1 for e in entries if e["status"] == "conflict"),
            "missing_count": sum(1 for e in entries if e["status"] == "no_shift"),
        }

    @staticmethod
    def _has_conflicting_hold(
        day: date,
        held: set,
        by_date: Dict[date, List[Shift]],
        match: Shift,
    ) -> bool:
        """True when the member already holds another shift the same day."""
        return any(str(s.id) in held for s in by_date.get(day, []) if s.id != match.id)

    async def _held_shift_ids(
        self,
        organization_id: UUID,
        user_id: UUID,
        dates: List[date],
    ) -> set:
        if not dates:
            return set()
        result = await self.db.execute(
            select(ShiftAssignment.shift_id)
            .join(Shift, ShiftAssignment.shift_id == Shift.id)
            .where(ShiftAssignment.organization_id == str(organization_id))
            .where(ShiftAssignment.user_id == str(user_id))
            .where(ShiftAssignment.assignment_status.in_(_ACTIVE_STATUSES))
            .where(Shift.shift_date.in_(dates))
        )
        return {str(sid) for sid in result.scalars().all() if sid}

    # ------------------------------------------------------------------
    # Create / list / end
    # ------------------------------------------------------------------

    async def create(
        self,
        organization_id: UUID,
        user_id: UUID,
        *,
        pattern: StandingShiftPattern,
        weekday: int,
        period: StandingShiftPeriod,
        position: str,
        start_date: date,
        end_date: date,
        apparatus_id: Optional[str] = None,
        assign: Any = None,
    ) -> Tuple[Optional[StandingShiftClaim], Dict[str, Any], Optional[str]]:
        """Store the claim and seat the member on the shifts already on record.

        ``assign`` is the per-shift signup callable — normally
        ``SchedulingService.create_assignment`` — so this service does not
        reimplement eligibility, capacity or driver-qualification checks. A
        date it refuses is reported as skipped rather than aborting the run:
        one full shift in November must not cost the member the other eleven.
        """
        if end_date < start_date:
            return None, {}, "The end date must be on or after the start date."
        if (end_date - start_date).days > MAX_SERIES_DAYS:
            return (
                None,
                {},
                f"A standing shift can run at most {MAX_SERIES_DAYS} days.",
            )
        if not 0 <= weekday <= 6:
            return None, {}, "Weekday must be between 0 (Sunday) and 6 (Saturday)."
        # A client-supplied apparatus id must be real and in-org before it is
        # stored (XC-1). It is only ever used as a match filter, so a foreign
        # one leaks nothing — it pins the series to a unit that can never
        # match, and the member gets a standing shift that silently claims
        # nothing for as long as it runs.
        if apparatus_id and not await apparatus_ref_exists(
            self.db, apparatus_id, organization_id
        ):
            return None, {}, "Apparatus not found."

        claim = StandingShiftClaim(
            organization_id=str(organization_id),
            user_id=str(user_id),
            pattern=pattern,
            weekday=weekday,
            period=period,
            position=position,
            apparatus_id=apparatus_id,
            start_date=start_date,
            end_date=end_date,
        )
        self.db.add(claim)
        # Committed before the seating loop, not after it. ``assign`` is
        # ``seat_member_self_service``, which rolls back on a refused date (a
        # driver-qualification block, an assignment race) — and a rollback
        # here would take the not-yet-committed claim with it. The member
        # would be told the series was saved, the first refused date would
        # silently discard it, and the trailing refresh would raise on an
        # instance the session no longer holds. The claim is what the member
        # asked for; the seatings are best-effort on top of it.
        await self.db.commit()
        await self.db.refresh(claim)

        summary = {"claimed": 0, "skipped": 0, "no_shift": 0}
        if assign is not None:
            preview = await self.preview(
                organization_id,
                user_id,
                pattern,
                weekday,
                period,
                start_date,
                end_date,
                apparatus_id,
            )
            for entry in preview["dates"]:
                if entry["status"] == "no_shift":
                    summary["no_shift"] += 1
                    continue
                if entry["status"] != "available":
                    summary["skipped"] += 1
                    continue
                result, error = await assign(
                    organization_id,
                    entry["shift_id"],
                    {"user_id": str(user_id), "position": position},
                    user_id,
                )
                if error or result is None:
                    summary["skipped"] += 1
                else:
                    summary["claimed"] += 1

        await self.db.commit()
        await self.db.refresh(claim)
        return claim, summary, None

    async def list_for_user(
        self,
        organization_id: UUID,
        user_id: UUID,
        active_only: bool = True,
    ) -> List[StandingShiftClaim]:
        query = (
            select(StandingShiftClaim)
            .where(StandingShiftClaim.organization_id == str(organization_id))
            .where(StandingShiftClaim.user_id == str(user_id))
        )
        if active_only:
            query = query.where(StandingShiftClaim.is_active.is_(True))
        result = await self.db.execute(query.order_by(StandingShiftClaim.created_at))
        return list(result.scalars().all())

    async def get_claim(
        self,
        claim_id: UUID,
        organization_id: UUID,
    ) -> Optional[StandingShiftClaim]:
        result = await self.db.execute(
            select(StandingShiftClaim)
            .where(StandingShiftClaim.id == str(claim_id))
            .where(StandingShiftClaim.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def claim_covering_shift(
        self,
        organization_id: UUID,
        user_id: UUID,
        shift: Shift,
    ) -> Optional[StandingShiftClaim]:
        """The member's active claim that this shift belongs to, if any.

        The give-up flow asks this so it can offer "also remove me from the
        rest of this standing series" only when there *is* a series — an
        always-present checkbox invites a member to end a series they never
        set up.
        """
        tz = await self._org_tz(organization_id)
        for claim in await self.list_for_user(organization_id, user_id):
            if not (claim.start_date <= shift.shift_date <= claim.end_date):
                continue
            if claim.weekday != _weekday_sunday_first(shift.shift_date):
                continue
            if not self._matches(shift, claim.period, claim.apparatus_id, tz):
                continue
            if shift.shift_date in series_dates(
                claim.pattern, claim.weekday, claim.start_date, claim.end_date
            ):
                return claim
        return None

    async def end_claim(
        self,
        claim: StandingShiftClaim,
        *,
        release_future: bool = False,
        withdraw: Any = None,
        today: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Stop the series. Optionally give up the dates not yet worked.

        Ending a series and giving up its remaining dates are separate
        decisions: a member who is moving off Tuesdays next quarter still
        works the Tuesdays already on the roster, and silently emptying those
        seats is how a shift goes short with nobody notified.
        """
        claim.is_active = False
        claim.ended_at = datetime.now(timezone.utc)

        released = 0
        if release_future and withdraw is not None:
            # The department's today, not the server's. A UTC server past
            # local midnight would classify the org's current day as future
            # and release a seat the member is about to work; west of UTC the
            # first genuinely future date would instead be kept.
            cutoff = (
                today or datetime.now(await self._org_tz(claim.organization_id)).date()
            )
            dates = [
                d
                for d in series_dates(
                    claim.pattern, claim.weekday, claim.start_date, claim.end_date
                )
                if d > cutoff
            ]
            held = await self._held_shift_ids(
                claim.organization_id, claim.user_id, dates
            )
            by_date = await self._shifts_on_dates(claim.organization_id, dates)
            tz = await self._org_tz(claim.organization_id)
            for day in dates:
                for shift in by_date.get(day, []):
                    if str(shift.id) not in held:
                        continue
                    if not self._matches(shift, claim.period, claim.apparatus_id, tz):
                        continue
                    ok, _error = await withdraw(
                        claim.organization_id,
                        shift.id,
                        claim.user_id,
                    )
                    if ok:
                        released += 1

        await self.db.commit()
        return {"released": released}

    # ------------------------------------------------------------------
    # The shift-creation reader
    # ------------------------------------------------------------------

    async def apply_to_shift(
        self,
        organization_id: UUID,
        shift: Shift,
        assign: Any,
    ) -> int:
        """Seat every member whose active claim matches a newly created shift.

        Runs after the shift is committed, and never raises into the caller:
        a standing claim that cannot be honoured (the member lost the
        qualification, the seat filled first) is a staffing fact for the duty
        officer to see on the roster, not a reason to fail creating the shift.
        """
        tz = await self._org_tz(organization_id)
        weekday = _weekday_sunday_first(shift.shift_date)
        result = await self.db.execute(
            select(StandingShiftClaim)
            .where(StandingShiftClaim.organization_id == str(organization_id))
            .where(StandingShiftClaim.is_active.is_(True))
            .where(StandingShiftClaim.weekday == weekday)
            .where(StandingShiftClaim.start_date <= shift.shift_date)
            .where(StandingShiftClaim.end_date >= shift.shift_date)
            .order_by(StandingShiftClaim.created_at)
        )
        seated = 0
        for claim in result.scalars().all():
            if not self._matches(shift, claim.period, claim.apparatus_id, tz):
                continue
            if shift.shift_date not in series_dates(
                claim.pattern, claim.weekday, claim.start_date, claim.end_date
            ):
                continue
            try:
                _result, error = await assign(
                    organization_id,
                    shift.id,
                    {
                        "user_id": claim.user_id,
                        "position": getattr(claim.position, "value", claim.position),
                    },
                    claim.user_id,
                )
                if error:
                    logger.info(
                        "Standing claim {} not applied to shift {}: {}",
                        claim.id,
                        shift.id,
                        error,
                    )
                else:
                    seated += 1
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning(
                    "Standing claim {} failed against shift {}: {}",
                    claim.id,
                    shift.id,
                    exc,
                )
        return seated
