"""
Training Waiver Calculation Service

Shared logic for adjusting training requirements based on active waivers
and leaves of absence.  Every compliance calculation in the system should
use these helpers so that waiver adjustments are applied consistently
across:
  - GET /my-training  (member self-view)
  - GET /compliance-matrix  (officer view)
  - GET /competency-matrix  (department heat-map)
  - GET /training/reports/user/{id}  (individual report)
  - GET /training/requirements/progress/{id}  (per-requirement)
  - POST /reports/generate  (training_summary / department_overview)
  - Program enrollment progress recalculation

Data sources
------------
Waivers come from two tables:
  1. ``training_waivers``         – training-specific waivers (may target
     specific requirement IDs via a JSON ``requirement_ids`` column).
  2. ``member_leaves_of_absence`` – department-wide leaves that apply to
     *all* training requirements (no ``requirement_ids``).

Both are merged into a single list and deduplicated by calendar day so
that overlapping entries do not double-count waived time.

How much of a month the covered days excuse is the department's
``ComplianceConfig.leave_month_rule`` (see ``month_waivers``). The fetch
helpers stamp it on every period they return, so the many callers that prorate
a target pick it up without each having to load the config.
"""

import calendar
import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.compliance_config import ComplianceConfig, LeaveMonthRule
from app.models.training import TrainingRequirementOverride, TrainingWaiver
from app.models.user import MemberLeaveOfAbsence

# ---------------------------------------------------------------------------
# Lightweight wrapper so calculation helpers work uniformly with both models
# ---------------------------------------------------------------------------


SOURCE_LEAVE = "leave"
SOURCE_WAIVER = "waiver"
# A Chief's override (TrainingRequirementOverride). It travels with the
# waivers so every grader receives it without new plumbing, but it excuses
# no month and no session: month_waivers drops it, and only the attendance
# rule reads it, as "met" (training_compliance.tally_session_attendance).
SOURCE_OVERRIDE = "override"

# Days of leave in a month at which the ``half`` rule excuses half of it.
HALF_MONTH_DAYS = 15


@dataclass
class WaiverPeriod:
    """Uniform representation of a waiver / leave period.

    ``source`` says which table it came from, so a screen can say "leave"
    only where a leave of absence is the reason. ``month_rule`` is the
    department's ``leave_month_rule``; it defaults to the column's own default
    for periods built without a department to read it from.
    """

    start_date: date
    end_date: date
    requirement_ids: Optional[List[str]] = None  # None → applies to all
    source: str = SOURCE_WAIVER
    month_rule: str = LeaveMonthRule.FULL_MONTH.value


@dataclass
class MonthWaiver:
    """How much of one calendar month a member was excused from.

    ``share`` is the fraction of the month's target excused (0 < share <= 1);
    ``days_covered`` and ``days_in_window`` are the counts it came from.
    """

    share: float
    days_covered: int
    days_in_window: int
    sources: Set[str] = field(default_factory=set)

    @property
    def partial(self) -> bool:
        return self.share < 1


_PERMANENT_END = date(9999, 12, 31)


def _to_waiver_period(
    obj, source: str, month_rule: str = LeaveMonthRule.FULL_MONTH.value
) -> WaiverPeriod:
    """Convert a TrainingWaiver or MemberLeaveOfAbsence to a WaiverPeriod.

    Permanent waivers (``end_date is None``) are mapped to a far-future
    sentinel so the calendar-month overlap math in ``month_waivers`` works
    without special-casing ``None``.
    """
    req_ids = getattr(obj, "requirement_ids", None)
    return WaiverPeriod(
        start_date=obj.start_date,
        end_date=obj.end_date or _PERMANENT_END,
        requirement_ids=req_ids,
        source=source,
        month_rule=month_rule,
    )


async def get_leave_month_rule(db: AsyncSession, org_id: str) -> str:
    """The department's ``leave_month_rule``; ``full_month`` without a config.

    An organization that never opened the compliance settings has no row, and
    the column's default is what it would have been given.
    """
    rule = (
        await db.execute(
            select(ComplianceConfig.leave_month_rule).where(
                ComplianceConfig.organization_id == str(org_id)
            )
        )
    ).scalar_one_or_none()
    valid = {r.value for r in LeaveMonthRule}
    return rule if rule in valid else LeaveMonthRule.FULL_MONTH.value


# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------


async def fetch_user_waivers(
    db: AsyncSession,
    org_id: str,
    user_id: str,
) -> List[WaiverPeriod]:
    """
    Fetch all active waiver / leave periods for a single user from both
    ``training_waivers`` and ``member_leaves_of_absence``.
    """
    tw_result = await db.execute(
        select(TrainingWaiver).where(
            TrainingWaiver.organization_id == org_id,
            TrainingWaiver.user_id == user_id,
            TrainingWaiver.active.is_(True),
        )
    )
    ml_result = await db.execute(
        select(MemberLeaveOfAbsence).where(
            MemberLeaveOfAbsence.organization_id == org_id,
            MemberLeaveOfAbsence.user_id == user_id,
            MemberLeaveOfAbsence.active.is_(True),
        )
    )

    waivers = tw_result.scalars().all()
    leaves = ml_result.scalars().all()
    overrides = await _active_overrides(db, org_id, user_id)
    if not waivers and not leaves:
        # Most members have neither; the rule would go unread.
        return overrides
    rule = await get_leave_month_rule(db, org_id)
    periods: List[WaiverPeriod] = []
    for w in waivers:
        periods.append(_to_waiver_period(w, SOURCE_WAIVER, rule))
    for leave in leaves:
        periods.append(_to_waiver_period(leave, SOURCE_LEAVE, rule))
    return periods + overrides


async def fetch_org_waivers(
    db: AsyncSession,
    org_id: str,
) -> Dict[str, List[WaiverPeriod]]:
    """
    Fetch all active waivers / leaves for an entire organization, indexed
    by ``user_id``.  Used by batch evaluators (compliance matrix, etc.) to
    avoid N+1 queries.
    """
    tw_result = await db.execute(
        select(TrainingWaiver).where(
            TrainingWaiver.organization_id == org_id,
            TrainingWaiver.active.is_(True),
        )
    )
    ml_result = await db.execute(
        select(MemberLeaveOfAbsence).where(
            MemberLeaveOfAbsence.organization_id == org_id,
            MemberLeaveOfAbsence.active.is_(True),
        )
    )

    waivers = tw_result.scalars().all()
    leaves = ml_result.scalars().all()
    overrides_by_user: Dict[str, List[WaiverPeriod]] = {}
    for period_user, period in await _active_overrides_by_user(db, org_id):
        overrides_by_user.setdefault(period_user, []).append(period)
    if not waivers and not leaves:
        return overrides_by_user
    rule = await get_leave_month_rule(db, org_id)
    by_user: Dict[str, List[WaiverPeriod]] = {}
    for w in waivers:
        uid = str(w.user_id)
        by_user.setdefault(uid, []).append(_to_waiver_period(w, SOURCE_WAIVER, rule))
    for leave in leaves:
        uid = str(leave.user_id)
        by_user.setdefault(uid, []).append(_to_waiver_period(leave, SOURCE_LEAVE, rule))
    for uid, periods in overrides_by_user.items():
        by_user.setdefault(uid, []).extend(periods)
    return by_user


def _override_period(override: TrainingRequirementOverride) -> WaiverPeriod:
    return WaiverPeriod(
        start_date=override.start_date,
        end_date=override.end_date,
        requirement_ids=[str(override.requirement_id)],
        source=SOURCE_OVERRIDE,
    )


async def _active_overrides_by_user(
    db: AsyncSession, org_id: str, user_id: Optional[str] = None
) -> List[Tuple[str, WaiverPeriod]]:
    """Unrevoked Chief overrides in ``org_id``, as (user id, period)."""
    query = select(TrainingRequirementOverride).where(
        TrainingRequirementOverride.organization_id == str(org_id),
        TrainingRequirementOverride.revoked_at.is_(None),
    )
    if user_id is not None:
        query = query.where(TrainingRequirementOverride.user_id == str(user_id))
    result = await db.execute(query)
    return [(str(o.user_id), _override_period(o)) for o in result.scalars().all()]


async def _active_overrides(
    db: AsyncSession, org_id: str, user_id: str
) -> List[WaiverPeriod]:
    return [p for _, p in await _active_overrides_by_user(db, org_id, user_id)]


def override_covers(waivers, req_id: str, as_of: date) -> bool:
    """Whether a Chief override counts ``req_id`` as met when graded as of ``as_of``."""
    return any(
        w.source == SOURCE_OVERRIDE
        and str(req_id) in (w.requirement_ids or [])
        and w.start_date <= as_of <= w.end_date
        for w in waivers or []
    )


# ---------------------------------------------------------------------------
# Pure calculation helpers (no I/O)
# ---------------------------------------------------------------------------


def get_rolling_period_months(req) -> Optional[int]:
    """Return ``rolling_period_months`` when a requirement uses rolling due dates.

    Returns ``None`` for non-rolling requirements so ``adjust_required``
    falls back to the calendar-month count.
    """
    due_date_type = getattr(req, "due_date_type", None)
    if due_date_type:
        dt = (
            due_date_type.value
            if hasattr(due_date_type, "value")
            else str(due_date_type)
        )
        if dt == "rolling":
            return getattr(req, "rolling_period_months", None)
    return None


def _month_share(rule: str, covered: int, in_window: int) -> float:
    """The fraction of a month's target that ``covered`` days of leave excuse."""
    if covered <= 0 or in_window <= 0:
        return 0.0
    if covered >= in_window:
        return 1.0
    if rule == LeaveMonthRule.PROPORTIONAL.value:
        return covered / in_window
    if rule == LeaveMonthRule.HALF.value:
        return 0.5 if covered >= HALF_MONTH_DAYS else 0.0
    return 1.0


def month_waivers(
    waivers: List[WaiverPeriod],
    period_start: date,
    period_end: date,
    req_id: Optional[str] = None,
) -> Dict[Tuple[int, int], MonthWaiver]:
    """
    Every calendar month within ``[period_start, period_end]`` that a waiver
    excuses at least part of, keyed by ``(year, month)``.

    Covered days are the union across all applicable waivers, so overlapping
    periods never count a day twice. A month's days are counted within the
    evaluation window, so a window opening mid-month measures that month
    against the days it actually spans. The department's ``leave_month_rule``
    (carried on the periods) turns the covered days into a share:

    - ``full_month``   — any covered day excuses the whole month.
    - ``proportional`` — covered days / days in the month.
    - ``half``         — 15+ covered days excuses half; all of it, the whole.

    A month whose share works out to nothing is left out.

    Parameters
    ----------
    waivers : list[WaiverPeriod]
        Active waiver / leave periods for the user.
    period_start, period_end : date
        The evaluation window (e.g. rolling 12-month period).
    req_id : str | None
        If provided, requirement-specific waivers that target a different
        requirement are skipped.  Blanket waivers (requirement_ids is None)
        always apply.
    """
    if not waivers or not period_start or not period_end:
        return {}

    applicable = [
        w
        for w in waivers
        # An override excuses no month; see SOURCE_OVERRIDE.
        if w.source != SOURCE_OVERRIDE
        and not (w.requirement_ids and req_id and str(req_id) not in w.requirement_ids)
    ]
    if not applicable:
        return {}
    rule = applicable[0].month_rule

    # Per month, the covered day ranges (clipped to the month and window) and
    # the sources behind them; merged below so an overlap counts once.
    spans: Dict[Tuple[int, int], List[Tuple[date, date]]] = {}
    sources: Dict[Tuple[int, int], Set[str]] = {}
    for w in applicable:
        overlap_start = max(w.start_date, period_start)
        overlap_end = min(w.end_date, period_end)
        if overlap_start > overlap_end:
            continue
        y, m = overlap_start.year, overlap_start.month
        while date(y, m, 1) <= overlap_end:
            month_end = date(y, m, calendar.monthrange(y, m)[1])
            span = (max(overlap_start, date(y, m, 1)), min(overlap_end, month_end))
            spans.setdefault((y, m), []).append(span)
            sources.setdefault((y, m), set()).add(w.source)
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    result: Dict[Tuple[int, int], MonthWaiver] = {}
    for (y, m), month_spans in spans.items():
        days = 0
        last_end: Optional[date] = None
        for start, end in sorted(month_spans):
            if last_end is not None and start <= last_end:
                if end <= last_end:
                    continue
                start = last_end + timedelta(days=1)
            days += (end - start).days + 1
            last_end = end
        month_start = max(date(y, m, 1), period_start)
        month_end = min(date(y, m, calendar.monthrange(y, m)[1]), period_end)
        in_window = (month_end - month_start).days + 1
        share = _month_share(rule, days, in_window)
        if share > 0:
            result[(y, m)] = MonthWaiver(
                share=share,
                days_covered=days,
                days_in_window=in_window,
                sources=sources[(y, m)],
            )
    return result


def excused_month_reasons(
    waivers: List[WaiverPeriod],
    period_start: Optional[date],
    period_end: Optional[date],
    req_id: Optional[str] = None,
) -> Dict[str, int]:
    """How many excused months a leave and how many a waiver accounted for.

    ``{"leave_months": n, "waiver_months": m}``. A month both touched counts in
    both, so a screen can say "on leave" only where a leave is the reason.
    """
    leave = waiver = 0
    if period_start and period_end:
        for mw in month_waivers(waivers, period_start, period_end, req_id).values():
            leave += SOURCE_LEAVE in mw.sources
            waiver += SOURCE_WAIVER in mw.sources
    return {"leave_months": leave, "waiver_months": waiver}


def waived_month_keys(
    waivers: List[WaiverPeriod],
    period_start: date,
    period_end: date,
    req_id: Optional[str] = None,
) -> set:
    """The ``(year, month)`` of every month a waiver excuses any part of."""
    return set(month_waivers(waivers, period_start, period_end, req_id))


def count_waived_months(
    waivers: List[WaiverPeriod],
    period_start: date,
    period_end: date,
    req_id: Optional[str] = None,
) -> int:
    """How many calendar months of the window a waiver excuses any part of.

    The months ``adjust_required`` prorates by, and the ones the monthly
    breakdown marks (:func:`month_waivers`), so the card's adjusted target and
    its month rows cannot disagree about what was waived.
    """
    return len(month_waivers(waivers, period_start, period_end, req_id))


def total_months_in_period(period_start: date, period_end: date) -> int:
    """Count total calendar months spanned by ``[period_start, period_end]``."""
    if not period_start or not period_end:
        return 0
    months = (
        (period_end.year - period_start.year) * 12
        + (period_end.month - period_start.month)
        + 1
    )
    return max(months, 1)


def adjust_required(
    base_required: float,
    period_start: date,
    period_end: date,
    waivers: List[WaiverPeriod],
    req_id: Optional[str] = None,
    period_months: Optional[int] = None,
    whole_units: bool = False,
) -> Tuple[float, int, float]:
    """
    Adjust a requirement's target value for waived months.

    Formula::

        adjusted = base_required × (active_months / total_months)
        active_months = total_months − Σ month shares   (at least 1)

    Parameters
    ----------
    base_required : float
        Original required value (hours, shifts, calls, etc.).
    period_start, period_end : date
        The evaluation window.
    waivers : list[WaiverPeriod]
        Active waiver / leave periods for the user.
    req_id : str | None
        Requirement ID for requirement-specific filtering.
    period_months : int | None
        Explicit total months for the period.  When provided (e.g. from
        ``rolling_period_months``), this overrides the calendar-month
        count from ``total_months_in_period`` which can be off-by-one
        for mid-month rolling windows.
    whole_units : bool
        Shifts and calls are counted in whole units, so a prorated target is
        rounded down (owner decision 2026-11-02): a member owes 1 shift, not
        1.5, and never more than the department's rate asks.

    Returns
    -------
    (adjusted_required, waived_months_count, active_months)
        ``active_months`` is fractional when a partial month was excused.
    """
    if not period_start or not period_end or base_required <= 0:
        return base_required, 0, 0

    total = (
        period_months
        if period_months
        else total_months_in_period(period_start, period_end)
    )
    excused = month_waivers(waivers, period_start, period_end, req_id)
    waived_share = sum(mw.share for mw in excused.values())
    active = max(total - waived_share, 1)

    adjusted = base_required * (active / total)
    if whole_units:
        # The epsilon keeps 2.9999999 (float error on an exact 3) from
        # rounding down to 2.
        adjusted = float(math.floor(adjusted + 1e-9))
    else:
        adjusted = round(adjusted, 2)
    # Rounded for display only, after the target is computed from the exact
    # figure.
    active_months = round(active, 2)
    if active_months == int(active_months):
        active_months = int(active_months)
    return adjusted, len(excused), active_months
