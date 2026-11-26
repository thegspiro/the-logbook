"""Yearly outreach goals, and how far each has got (owner decisions, 2026-11-24).

A goal targets one figure for one calendar year in the department's timezone:
a CRR count, or one of Outreach Impact's headline figures. Progress is
computed, never stored, from the same rows those screens count:

* a CRR count: the quantities recorded on CRR activities in the year;
* events held, people reached, member hours: CommunityEngagementService's own
  totals over the year so far (pitfall #29), so a goal agrees with the figure
  Outreach Impact shows beside it.

Pace is the target scaled by how much of the year has gone, so in March a goal
of 200 is on pace at about 50. A past year's goal is simply met or missed.
"""

from datetime import date, datetime, time, timezone
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.crr import (
    CrrActivity,
    CrrActivityCount,
    CrrActivityMeasure,
    CrrActivityType,
)
from app.models.outreach_goal import OUTREACH_METRICS, OutreachGoal
from app.models.user import Organization
from app.services.community_engagement_service import CommunityEngagementService
from app.utils.org_timezone import scheduling_timezone

METRIC_LABELS = {
    "events_held": "Events held",
    "people_reached": "People reached",
    "member_hours": "Member hours",
}

#: The years a goal may be set for: far enough back to correct last year's,
#: far enough ahead to plan next year's.
MIN_YEAR, MAX_YEAR = 2000, 2100
#: A target fits the column (Integer) with room to spare.
MAX_TARGET = 1_000_000_000


class OutreachGoalService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _organization(self, organization_id: str) -> Optional[Organization]:
        return (
            await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one_or_none()

    @staticmethod
    def year_bounds(
        year: int, org: Optional[Organization]
    ) -> tuple[datetime, datetime]:
        """1 January and the next 1 January, midnight in the department's zone, as UTC."""
        tz = scheduling_timezone(org)
        start = datetime.combine(date(year, 1, 1), time.min, tz)
        end = datetime.combine(date(year + 1, 1, 1), time.min, tz)
        return start.astimezone(timezone.utc), end.astimezone(timezone.utc)

    async def current_year(self, organization_id: str) -> int:
        org = await self._organization(organization_id)
        return datetime.now(timezone.utc).astimezone(scheduling_timezone(org)).year

    async def _get(self, organization_id: str, goal_id: str) -> OutreachGoal:
        goal = (
            await self.db.execute(
                select(OutreachGoal).where(
                    OutreachGoal.id == goal_id,
                    OutreachGoal.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if goal is None:
            raise LookupError("Goal not found")
        return goal

    async def _measure(
        self, organization_id: str, measure_id: str
    ) -> CrrActivityMeasure:
        measure = (
            await self.db.execute(
                select(CrrActivityMeasure).where(
                    CrrActivityMeasure.id == measure_id,
                    CrrActivityMeasure.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if measure is None:
            raise ValueError("That count is not in the department's CRR catalogue")
        if not measure.is_active:
            # Owner decision, 2026-11-26: a new goal needs an active count. A
            # goal set before the count was retired keeps counting.
            raise ValueError("That count is retired and cannot be given a new goal")
        return measure

    @staticmethod
    def _check(year: int, target: int) -> None:
        if not MIN_YEAR <= year <= MAX_YEAR:
            raise ValueError(f"The year must be between {MIN_YEAR} and {MAX_YEAR}")
        if not 1 <= target <= MAX_TARGET:
            raise ValueError("The target must be a whole number of at least 1")

    async def create(
        self,
        organization_id: str,
        user_id: str,
        *,
        year: int,
        target: int,
        measure_id: Optional[str] = None,
        outreach_metric: Optional[str] = None,
    ) -> OutreachGoal:
        self._check(year, target)
        if (measure_id is None) == (outreach_metric is None):
            raise ValueError("Choose either a CRR count or an outreach figure")
        duplicate = select(OutreachGoal.id).where(
            OutreachGoal.organization_id == organization_id,
            OutreachGoal.year == year,
        )
        if measure_id is not None:
            await self._measure(organization_id, measure_id)
            duplicate = duplicate.where(OutreachGoal.measure_id == measure_id)
        else:
            if outreach_metric not in OUTREACH_METRICS:
                raise ValueError("Unknown outreach figure")
            duplicate = duplicate.where(OutreachGoal.outreach_metric == outreach_metric)
        # The unique keys catch two saves racing past this; it is here to give
        # the ordinary case a sentence rather than a constraint error.
        if await self.db.scalar(duplicate) is not None:
            raise ValueError(f"There is already a goal for that in {year}")
        goal = OutreachGoal(
            organization_id=organization_id,
            year=year,
            target=target,
            measure_id=measure_id,
            outreach_metric=outreach_metric,
            created_by=user_id,
        )
        try:
            # In a savepoint, so a save that raced past the check above is
            # refused with the same sentence and the session stays usable.
            async with self.db.begin_nested():
                self.db.add(goal)
                await self.db.flush()
        except IntegrityError:
            raise ValueError(f"There is already a goal for that in {year}")
        return goal

    async def update_target(
        self, organization_id: str, goal_id: str, target: int
    ) -> OutreachGoal:
        goal = await self._get(organization_id, goal_id)
        self._check(goal.year, target)
        goal.target = target
        await self.db.flush()
        return goal

    async def delete(self, organization_id: str, goal_id: str) -> None:
        goal = await self._get(organization_id, goal_id)
        await self.db.delete(goal)
        await self.db.flush()

    async def progress(
        self,
        organization_id: str,
        year: int,
        now: Optional[datetime] = None,
    ) -> dict[str, Any]:
        """The year's goals with what each has reached and whether it is on pace."""
        org = await self._organization(organization_id)
        start, end = self.year_bounds(year, org)
        moment = now or datetime.now(timezone.utc)
        until = min(max(moment, start), end)
        elapsed = (until - start) / (end - start)

        goals = list(
            (
                await self.db.execute(
                    select(OutreachGoal).where(
                        OutreachGoal.organization_id == organization_id,
                        OutreachGoal.year == year,
                    )
                )
            )
            .scalars()
            .all()
        )

        measure_ids = [g.measure_id for g in goals if g.measure_id]
        labels: dict[str, tuple[str, str]] = {}
        reached: dict[str, int] = {}
        if measure_ids:
            for measure_id, label, type_name in await self.db.execute(
                select(
                    CrrActivityMeasure.id,
                    CrrActivityMeasure.label,
                    CrrActivityType.name,
                )
                .join(
                    CrrActivityType,
                    CrrActivityType.id == CrrActivityMeasure.activity_type_id,
                )
                .where(
                    CrrActivityMeasure.organization_id == organization_id,
                    CrrActivityMeasure.id.in_(measure_ids),
                )
            ):
                labels[measure_id] = (type_name, label)
            for measure_id, total in await self.db.execute(
                select(CrrActivityCount.measure_id, func.sum(CrrActivityCount.quantity))
                .join(CrrActivity, CrrActivity.id == CrrActivityCount.activity_id)
                .where(
                    CrrActivity.organization_id == organization_id,
                    CrrActivity.occurred_at >= start,
                    CrrActivity.occurred_at < until,
                    CrrActivityCount.measure_id.in_(measure_ids),
                )
                .group_by(CrrActivityCount.measure_id)
            ):
                reached[measure_id] = int(total or 0)

        totals = None
        if any(g.outreach_metric for g in goals) and until > start:
            totals = await CommunityEngagementService(self.db).window_totals(
                organization_id, start, until
            )

        # Outreach figures first, in their fixed order, then counts by name.
        order = {metric: i for i, metric in enumerate(OUTREACH_METRICS)}
        keyed: list[tuple[tuple[int, int, str], dict[str, Any]]] = []
        for goal in goals:
            actual: float
            if goal.measure_id:
                type_name, label = labels.get(goal.measure_id, ("", ""))
                actual = reached.get(goal.measure_id, 0)
                name = f"{type_name} · {label}" if type_name else label
                kind = "crr_measure"
                key = (1, 0, name)
            else:
                metric = goal.outreach_metric or ""
                actual = getattr(totals, metric, 0) if totals is not None else 0
                name = METRIC_LABELS.get(metric, metric)
                kind = "outreach"
                key = (0, order.get(metric, 0), name)
            pace = goal.target * elapsed
            keyed.append(
                (
                    key,
                    {
                        "id": goal.id,
                        "year": goal.year,
                        "kind": kind,
                        "measure_id": goal.measure_id,
                        "outreach_metric": goal.outreach_metric,
                        "label": name,
                        "target": goal.target,
                        "actual": round(float(actual), 2),
                        "pace_target": round(pace, 2),
                        "met": actual >= goal.target,
                        "on_pace": actual >= pace,
                    },
                )
            )
        keyed.sort(key=lambda pair: pair[0])
        rows = [row for _, row in keyed]
        return {
            "year": year,
            "year_fraction": round(elapsed, 4),
            "year_complete": moment >= end,
            "goals": rows,
        }
