"""
Member Service History Service

Length of service, calculated from the stints a member actually served.

A member who leaves the department (dropped or retired) and later rejoins
should not have the time away counted as service. Each continuous stint is a
``MemberServicePeriod`` row; credited service is the sum of the stints that
count, and a department that restarts a returning member at zero keeps the
earlier stints on record as prior service instead of deleting them.

How the rows come to exist:

  1. A member who has never left has no rows. Their service is one unbroken
     stint from ``hire_date`` -- the calculation that existed before this
     module -- so nothing needed backfilling.
  2. On leaving (a status change into dropped/retired), the open stint is
     closed; for a member with no rows, the stint from hire to today is
     written first.
  3. On rejoining (reactivation, or a status change out of dropped/retired),
     a new stint opens, and the officer's choice decides whether the earlier
     ones keep counting.
  4. Officers can add, correct or remove stints directly, for history that
     predates this feature.

"Today" is ``date.today()`` throughout, matching the tier service's existing
years-of-service calculation so the two can never disagree on an anniversary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import MemberServicePeriod, Organization, User, UserStatus
from app.schemas.organization import RejoinServiceCredit

# Statuses in which a member is away from the department, so time spent in
# them is not service. Leave, suspension and inactivity are still membership
# and keep counting -- a department decision, confirmed when this was built.
SEPARATED_STATUSES = frozenset(
    {
        UserStatus.DROPPED_VOLUNTARY,
        UserStatus.DROPPED_INVOLUNTARY,
        UserStatus.RETIRED,
        UserStatus.ARCHIVED,
    }
)

# What a closed stint can record as the way it ended. ARCHIVED is not one: a
# member is archived after being dropped, so the drop is how the stint ended.
SEPARATION_STATUS_VALUES = frozenset(
    {
        UserStatus.DROPPED_VOLUNTARY.value,
        UserStatus.DROPPED_INVOLUNTARY.value,
        UserStatus.RETIRED.value,
    }
)


def is_separated(status: Any) -> bool:
    """True when ``status`` means the member is away from the department."""
    try:
        return UserStatus(status) in SEPARATED_STATUSES
    except ValueError:
        return False


def whole_years(start: Optional[date], today: date) -> int:
    """Completed anniversaries from ``start`` to ``today`` (0 without a start)."""
    if not start:
        return 0
    return (
        today.year - start.year - ((today.month, today.day) < (start.month, start.day))
    )


@dataclass(frozen=True)
class ResolvedPeriod:
    """A stint with its start resolved and its length measured."""

    period_id: Optional[str]
    start: Optional[date]
    start_is_hire_date: bool
    end: Optional[date]
    counts_toward_service: bool
    separation_status: Optional[str]
    notes: Optional[str]
    days: int


@dataclass(frozen=True)
class ServiceSummary:
    periods: List[ResolvedPeriod]
    credited_days: int
    prior_days: int
    # The date a single unbroken stint would have had to start on to equal
    # the credited service. Anniversary arithmetic runs on this, so a member
    # with one stint gets exactly the years their hire date always gave them.
    effective_service_start: Optional[date]
    credited_years: int
    # No stints are recorded and the member is separated, so the end of their
    # service was inferred from when their status last changed.
    is_estimated: bool
    is_recorded: bool


def _days(start: Optional[date], end: Optional[date], today: date) -> int:
    if not start:
        return 0
    return max(0, ((end or today) - start).days)


def implicit_separation_date(member: Any, today: date) -> date:
    """Best available last day of service for a separated member with no stints.

    ``status_changed_at`` is when they were dropped or retired -- unless they
    were archived since, which overwrites it with the archive date. That is the
    estimate the reactivation dialog pre-fills and lets the officer correct.
    """
    changed = getattr(member, "status_changed_at", None)
    if changed is None:
        return today
    changed_date = changed.date() if hasattr(changed, "date") else changed
    return min(changed_date, today)


def summarize(
    member: Any,
    periods: Sequence[MemberServicePeriod],
    today: Optional[date] = None,
) -> ServiceSummary:
    """Credited and prior service for ``member`` from their recorded stints."""
    today = today or date.today()
    hire_date = getattr(member, "hire_date", None)
    resolved: List[ResolvedPeriod] = []
    is_estimated = False

    if periods:
        for p in periods:
            start = p.start_date or hire_date
            resolved.append(
                ResolvedPeriod(
                    period_id=str(p.id) if p.id else None,
                    start=start,
                    start_is_hire_date=p.start_date is None,
                    end=p.end_date,
                    counts_toward_service=bool(p.counts_toward_service),
                    separation_status=p.separation_status,
                    notes=p.notes,
                    days=_days(start, p.end_date, today),
                )
            )
    elif hire_date:
        separated = is_separated(getattr(member, "status", None))
        end = implicit_separation_date(member, today) if separated else None
        is_estimated = separated
        resolved.append(
            ResolvedPeriod(
                period_id=None,
                start=hire_date,
                start_is_hire_date=True,
                end=end,
                counts_toward_service=True,
                separation_status=None,
                notes=None,
                days=_days(hire_date, end, today),
            )
        )

    credited_days = sum(p.days for p in resolved if p.counts_toward_service)
    prior_days = sum(p.days for p in resolved if not p.counts_toward_service)
    has_credited_start = any(
        p.counts_toward_service and p.start is not None for p in resolved
    )
    effective_start = (
        today - timedelta(days=credited_days) if has_credited_start else None
    )
    return ServiceSummary(
        periods=resolved,
        credited_days=credited_days,
        prior_days=prior_days,
        effective_service_start=effective_start,
        credited_years=whole_years(effective_start, today),
        is_estimated=is_estimated,
        is_recorded=bool(periods),
    )


def resolve_rejoin_credit(settings: Optional[Mapping[str, Any]]) -> RejoinServiceCredit:
    """The department's default, read defensively from free-form settings JSON.

    Absent or unreadable means CONTINUE, the choice closest to how service was
    counted before this setting existed (pitfall #19: absence is never a
    behaviour change).
    """
    tiers = (settings or {}).get("membership_tiers")
    raw = tiers.get("rejoin_service_credit") if isinstance(tiers, dict) else None
    try:
        return RejoinServiceCredit(raw) if raw else RejoinServiceCredit.CONTINUE
    except ValueError:
        logger.warning(f"Ignoring unknown rejoin_service_credit setting: {raw!r}")
        return RejoinServiceCredit.CONTINUE


class MemberServiceHistoryService:
    """Reads and writes a member's service stints."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def list_periods(
        self, organization_id: str, user_id: str
    ) -> List[MemberServicePeriod]:
        # A NULL start is the hire date, the earliest stint, and MySQL sorts
        # NULL first on ASC -- so the natural order is chronological.
        result = await self.db.execute(
            select(MemberServicePeriod)
            .where(
                MemberServicePeriod.organization_id == str(organization_id),
                MemberServicePeriod.user_id == str(user_id),
            )
            .order_by(
                MemberServicePeriod.start_date.asc(),
                MemberServicePeriod.created_at.asc(),
            )
        )
        return list(result.scalars().all())

    async def periods_by_user(
        self, organization_id: str, user_ids: Iterable[str]
    ) -> Dict[str, List[MemberServicePeriod]]:
        """Every listed member's stints in one query, for batch readers."""
        ids = [str(u) for u in user_ids]
        if not ids:
            return {}
        result = await self.db.execute(
            select(MemberServicePeriod)
            .where(
                MemberServicePeriod.organization_id == str(organization_id),
                MemberServicePeriod.user_id.in_(ids),
            )
            .order_by(
                MemberServicePeriod.start_date.asc(),
                MemberServicePeriod.created_at.asc(),
            )
        )
        grouped: Dict[str, List[MemberServicePeriod]] = {}
        for period in result.scalars().all():
            grouped.setdefault(str(period.user_id), []).append(period)
        return grouped

    async def get_rejoin_default(self, organization_id: str) -> RejoinServiceCredit:
        result = await self.db.execute(
            select(Organization.settings).where(Organization.id == str(organization_id))
        )
        return resolve_rejoin_credit(result.scalar_one_or_none())

    # ------------------------------------------------------------------
    # Lifecycle hooks -- called inside the status-change transaction
    # ------------------------------------------------------------------

    async def record_separation(
        self,
        member: User,
        separation_status: UserStatus,
        on_date: date,
        created_by: Optional[str],
    ) -> Optional[MemberServicePeriod]:
        """Close the member's current stint as of ``on_date``.

        Does not commit; the caller's status change and this write land
        together or not at all.
        """
        periods = await self.list_periods(member.organization_id, member.id)
        open_periods = [p for p in periods if p.end_date is None]
        if open_periods:
            current = open_periods[-1]
            start = current.start_date or member.hire_date
            current.end_date = max(on_date, start) if start else on_date
            current.separation_status = separation_status.value
            return current
        if periods:
            # Every stint is already closed -- an officer entered this history
            # by hand. There is nothing open to close, and inventing a stint
            # would double-count time they already accounted for.
            return None
        period = MemberServicePeriod(
            organization_id=str(member.organization_id),
            user_id=str(member.id),
            start_date=None,
            end_date=on_date,
            separation_status=separation_status.value,
            counts_toward_service=True,
            created_by=created_by,
        )
        self.db.add(period)
        return period

    async def record_rejoin(
        self,
        member: User,
        rejoin_date: date,
        credit: Optional[RejoinServiceCredit],
        created_by: Optional[str],
        previous_service_end: Optional[date] = None,
        today: Optional[date] = None,
    ) -> MemberServicePeriod:
        """Open a new stint from ``rejoin_date``; apply the credit choice.

        Must run before the caller changes ``member.status``: a member with no
        recorded stints has their earlier service written here, and its end is
        inferred from the status they are leaving.

        ``previous_service_end`` corrects that inferred end. It is used only
        when no stints are recorded -- otherwise the recorded end stands and
        is edited in the service history instead.

        Raises ValueError for a date the history cannot hold.
        """
        today = today or date.today()
        if rejoin_date > today:
            raise ValueError("The return date cannot be in the future.")
        credit = credit or await self.get_rejoin_default(member.organization_id)

        periods = await self.list_periods(member.organization_id, member.id)
        if any(p.end_date is None for p in periods):
            raise ValueError(
                "This member's service history still has a stint with no end "
                "date. Close it in their Service History before reinstating them."
            )

        if not periods and member.hire_date:
            end = previous_service_end or implicit_separation_date(member, today)
            if end < member.hire_date:
                raise ValueError(
                    "The last day of previous service cannot be before the "
                    "member's hire date."
                )
            status_value = getattr(member.status, "value", member.status)
            prior = MemberServicePeriod(
                organization_id=str(member.organization_id),
                user_id=str(member.id),
                start_date=None,
                end_date=end,
                separation_status=(
                    status_value if status_value in SEPARATION_STATUS_VALUES else None
                ),
                counts_toward_service=True,
                created_by=created_by,
            )
            self.db.add(prior)
            periods = [prior]

        last_end = max((p.end_date for p in periods if p.end_date), default=None)
        if last_end and rejoin_date <= last_end:
            raise ValueError(
                f"The return date must be after the member's last day of "
                f"previous service ({last_end.isoformat()})."
            )

        if credit == RejoinServiceCredit.RESTART:
            for p in periods:
                p.counts_toward_service = False

        new_period = MemberServicePeriod(
            organization_id=str(member.organization_id),
            user_id=str(member.id),
            start_date=rejoin_date,
            end_date=None,
            counts_toward_service=True,
            created_by=created_by,
        )
        self.db.add(new_period)
        return new_period

    # ------------------------------------------------------------------
    # Officer edits
    # ------------------------------------------------------------------

    async def replace_periods(
        self,
        member: User,
        items: Sequence[Mapping[str, Any]],
        created_by: Optional[str],
        today: Optional[date] = None,
    ) -> List[MemberServicePeriod]:
        """Replace the member's whole stint list with ``items``, atomically.

        A full replacement rather than per-row edits, because a member with no
        stored stints still has one -- the stint implied by ``hire_date``, which
        has no row to edit. Correcting it and adding the earlier stint it
        overlaps would otherwise take two writes, the first of which is
        invalid on its own. Validated as a set, the history is never saved
        half-corrected.

        Each item carries every field (``start_date`` None meaning the hire
        date). An item with an ``id`` updates that stint, one without creates
        one, and a stored stint not listed is deleted. An empty list removes
        the recorded history, and service falls back to ``hire_date``.
        Does not commit.
        """
        today = today or date.today()
        existing = await self.list_periods(member.organization_id, member.id)
        by_id = {str(p.id): p for p in existing}

        kept: List[MemberServicePeriod] = []
        for item in items:
            period_id = item.get("id")
            if period_id:
                period = by_id.get(str(period_id))
                if period is None:
                    raise ValueError("A listed service stint does not exist.")
            else:
                period = MemberServicePeriod(
                    organization_id=str(member.organization_id),
                    user_id=str(member.id),
                    created_by=created_by,
                )
            period.start_date = item.get("start_date")
            period.end_date = item.get("end_date")
            period.counts_toward_service = bool(item.get("counts_toward_service", True))
            period.separation_status = item.get("separation_status")
            period.notes = item.get("notes")
            kept.append(period)

        self._validate(member, kept, today)

        kept_ids = {str(p.id) for p in kept if p.id}
        for period in existing:
            if str(period.id) not in kept_ids:
                await self.db.delete(period)
        for period in kept:
            if not period.id:
                self.db.add(period)
        return kept

    @staticmethod
    def _validate(
        member: Any,
        periods: Sequence[MemberServicePeriod],
        today: date,
    ) -> None:
        hire_date = getattr(member, "hire_date", None)

        hire_linked = [p for p in periods if p.start_date is None]
        if len(hire_linked) > 1:
            raise ValueError("Only one service stint can start on the hire date.")
        if hire_linked and hire_date is None:
            raise ValueError(
                "This member has no hire date on file, so every stint needs a "
                "start date."
            )

        for p in periods:
            start = p.start_date or hire_date
            if start and start > today:
                raise ValueError("A service stint cannot start in the future.")
            if p.end_date and p.end_date > today:
                raise ValueError("A service stint cannot end in the future.")
            if start and p.end_date and p.end_date < start:
                raise ValueError("A service stint cannot end before it starts.")
            if (
                p.separation_status is not None
                and p.separation_status not in SEPARATION_STATUS_VALUES
            ):
                raise ValueError(
                    "How a stint ended must be one of: "
                    + ", ".join(sorted(SEPARATION_STATUS_VALUES))
                )
            if p.end_date is None and p.separation_status is not None:
                raise ValueError(
                    "Only a stint with an end date can record how it ended."
                )

        open_periods = [p for p in periods if p.end_date is None]
        if len(open_periods) > 1:
            raise ValueError("A member can have only one stint without an end date.")
        if open_periods and is_separated(member.status):
            raise ValueError(
                "This member is not currently serving, so every stint needs an "
                "end date."
            )
        if periods and not open_periods and not is_separated(member.status):
            raise ValueError(
                "This member is currently serving, so their current stint must "
                "have no end date."
            )

        spans = sorted(
            (
                (p.start_date or hire_date, p.end_date or today)
                for p in periods
                if (p.start_date or hire_date) is not None
            ),
            key=lambda s: s[0],
        )
        for (_a_start, a_end), (b_start, _b_end) in zip(spans, spans[1:]):
            if b_start <= a_end:
                raise ValueError(
                    f"Service stints cannot overlap: one runs to "
                    f"{a_end.isoformat()} and the next starts "
                    f"{b_start.isoformat()}."
                )
