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

Both are merged into a single list and deduplicated by calendar-month so
that overlapping entries do not double-count waived time.
"""

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import TrainingWaiver
from app.models.user import MemberLeaveOfAbsence


# ---------------------------------------------------------------------------
# Lightweight wrapper so calculation helpers work uniformly with both models
# ---------------------------------------------------------------------------

@dataclass
class WaiverPeriod:
    """Uniform representation of a waiver / leave period."""
    start_date: date
    end_date: date
    requirement_ids: Optional[List[str]] = None  # None → applies to all


_PERMANENT_END = date(9999, 12, 31)


def _to_waiver_period(obj) -> WaiverPeriod:
    """Convert a TrainingWaiver or MemberLeaveOfAbsence to a WaiverPeriod.

    Permanent waivers (``end_date is None``) are mapped to a far-future
    sentinel so the calendar-month overlap math in ``count_waived_months``
    works without special-casing ``None``.
    """
    req_ids = getattr(obj, "requirement_ids", None)
    return WaiverPeriod(
        start_date=obj.start_date,
        end_date=obj.end_date or _PERMANENT_END,
        requirement_ids=req_ids,
    )


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
            TrainingWaiver.active == True,  # noqa: E712
        )
    )
    ml_result = await db.execute(
        select(MemberLeaveOfAbsence).where(
            MemberLeaveOfAbsence.organization_id == org_id,
            MemberLeaveOfAbsence.user_id == user_id,
            MemberLeaveOfAbsence.active == True,  # noqa: E712
        )
    )

    periods: List[WaiverPeriod] = []
    for w in tw_result.scalars().all():
        periods.append(_to_waiver_period(w))
    for l in ml_result.scalars().all():
        periods.append(_to_waiver_period(l))
    return periods


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
            TrainingWaiver.active == True,  # noqa: E712
        )
    )
    ml_result = await db.execute(
        select(MemberLeaveOfAbsence).where(
            MemberLeaveOfAbsence.organization_id == org_id,
            MemberLeaveOfAbsence.active == True,  # noqa: E712
        )
    )

    by_user: Dict[str, List[WaiverPeriod]] = {}
    for w in tw_result.scalars().all():
        uid = str(w.user_id)
        by_user.setdefault(uid, []).append(_to_waiver_period(w))
    for l in ml_result.scalars().all():
        uid = str(l.user_id)
        by_user.setdefault(uid, []).append(_to_waiver_period(l))
    return by_user


# ---------------------------------------------------------------------------
# Pure calculation helpers (no I/O)
# ---------------------------------------------------------------------------

def get_rolling_period_months(req) -> Optional[int]:
    """Return ``rolling_period_months`` when a requirement uses rolling due dates.

    Returns ``None`` for non-rolling requirements so ``adjust_required``
    falls back to the calendar-month count.
    """
    due_date_type = getattr(req, 'due_date_type', None)
    if due_date_type:
        dt = due_date_type.value if hasattr(due_date_type, 'value') else str(due_date_type)
        if dt == 'rolling':
            return getattr(req, 'rolling_period_months', None)
    return None


def count_waived_months(
    waivers: List[WaiverPeriod],
    period_start: date,
    period_end: date,
    req_id: Optional[str] = None,
) -> int:
    """
    Count how many calendar months within ``[period_start, period_end]``
    are covered by at least one waiver.

    A month is considered "waived" when the waiver covers >= 15 days of
    that month.  Overlapping waivers are deduplicated via a set of
    (year, month) tuples.

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
        return 0

    waived: set = set()
    for w in waivers:
        # Skip requirement-specific waivers that don't cover this requirement
        if w.requirement_ids and req_id and str(req_id) not in w.requirement_ids:
            continue

        # Find overlap with the evaluation period
        overlap_start = max(w.start_date, period_start)
        overlap_end = min(w.end_date, period_end)
        if overlap_start > overlap_end:
            continue

        # Walk month-by-month through the overlap
        y, m = overlap_start.year, overlap_start.month
        while date(y, m, 1) <= overlap_end:
            month_start = date(y, m, 1)
            month_end_day = calendar.monthrange(y, m)[1]
            month_end = date(y, m, month_end_day)

            cov_start = max(overlap_start, month_start)
            cov_end = min(overlap_end, month_end)
            covered_days = (cov_end - cov_start).days + 1
            if covered_days >= 15:
                waived.add((y, m))

            m += 1
            if m > 12:
                m = 1
                y += 1

    return len(waived)


def total_months_in_period(period_start: date, period_end: date) -> int:
    """Count total calendar months spanned by ``[period_start, period_end]``."""
    if not period_start or not period_end:
        return 0
    months = (period_end.year - period_start.year) * 12 + (period_end.month - period_start.month) + 1
    return max(months, 1)


def adjust_required(
    base_required: float,
    period_start: date,
    period_end: date,
    waivers: List[WaiverPeriod],
    req_id: Optional[str] = None,
    period_months: Optional[int] = None,
) -> Tuple[float, int, int]:
    """
    Adjust a requirement's target value for waived months.

    Formula::

        adjusted = base_required × (active_months / total_months)

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

    Returns
    -------
    (adjusted_required, waived_months_count, active_months_count)
    """
    if not period_start or not period_end or base_required <= 0:
        return base_required, 0, 0

    total = period_months if period_months else total_months_in_period(period_start, period_end)
    waived = count_waived_months(waivers, period_start, period_end, req_id)
    active_months = max(total - waived, 1)

    adjusted = base_required * (active_months / total)
    return round(adjusted, 2), waived, active_months
