"""Scoped, timezone-correct summaries for scheduling dashboard widgets."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import AssignmentStatus, Shift, ShiftAssignment, ShiftStatus
from app.models.user import Organization
from app.utils.positions import normalize_stored_positions

MAX_WIDGET_WINDOW_DAYS = 93
ACTIVE_ASSIGNMENTS = {
    AssignmentStatus.ASSIGNED.value,
    AssignmentStatus.CONFIRMED.value,
}


def _as_utc(value: datetime) -> datetime:
    """Normalize MySQL's timezone-naive UTC datetimes for safe comparisons."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def organization_window(
    timezone_name: str, start: date, end: date
) -> tuple[datetime, datetime]:
    """Return UTC instants bounding inclusive organization-local calendar dates."""
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("America/New_York")
    local_start = datetime.combine(start, time.min, tzinfo=zone)
    local_end = datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone)
    return local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)


class SchedulingWidgetService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def summarize(
        self,
        organization_id: str,
        start: date,
        end: date,
        station_id: str | None = None,
        platoon: str | None = None,
        shift_type: str | None = None,
        position: str | None = None,
    ) -> dict:
        org = await self.db.get(Organization, organization_id)
        timezone_name = (org.timezone if org else None) or "America/New_York"
        module_settings = ((org.settings or {}).get("modules", {})) if org else {}
        scheduling_enabled = module_settings.get("scheduling", True) is not False
        window_start, window_end = organization_window(timezone_name, start, end)
        if not scheduling_enabled:
            return self._empty(timezone_name, window_start, window_end, False)

        query = select(Shift).where(
            Shift.organization_id == organization_id,
            Shift.status == ShiftStatus.SCHEDULED.value,
            Shift.start_time < window_end,
            Shift.end_time > window_start,
        )
        if station_id:
            query = query.where(Shift.station_id == station_id)
        if platoon:
            query = query.where(Shift.platoon == platoon)
        shifts = list((await self.db.execute(query)).scalars().all())
        if shift_type:
            shifts = [
                shift
                for shift in shifts
                if isinstance(shift.activities, dict)
                and shift.activities.get("shift_type") == shift_type
            ]
        shift_ids = [shift.id for shift in shifts]
        assignments: list[ShiftAssignment] = []
        if shift_ids:
            assignment_query = select(ShiftAssignment).where(
                ShiftAssignment.organization_id == organization_id,
                ShiftAssignment.shift_id.in_(shift_ids),
            )
            if position:
                assignment_query = assignment_query.where(
                    ShiftAssignment.position == position
                )
            assignments = list(
                (await self.db.execute(assignment_query)).scalars().all()
            )

        by_shift = Counter(
            str(item.shift_id)
            for item in assignments
            if item.assignment_status in ACTIVE_ASSIGNMENTS
        )
        today_start, today_end = organization_window(timezone_name, start, start)
        today_staffing = sum(
            by_shift[str(shift.id)]
            for shift in shifts
            if _as_utc(shift.start_time) < today_end
            and _as_utc(shift.end_time or shift.start_time) > today_start
        )
        gaps = 0
        open_slots = 0
        for shift in shifts:
            normalized_positions = normalize_stored_positions(shift.positions)
            required_positions = (
                [
                    slot
                    for slot in normalized_positions
                    if slot.get("required", True)
                    and (not position or slot.get("position") == position)
                ]
                if isinstance(normalized_positions, list)
                else []
            )
            required = (
                len(required_positions)
                if position
                else max(len(required_positions), shift.min_staffing or 0)
            )
            missing = max(required - by_shift[str(shift.id)], 0)
            open_slots += missing
            gaps += int(missing > 0 and _as_utc(shift.start_time) >= today_end)

        pending = sum(
            item.assignment_status == AssignmentStatus.PENDING.value
            for item in assignments
        )
        incomplete = sum(
            not shift.is_finalized
            and shift.end_time
            and _as_utc(shift.end_time) < datetime.now(timezone.utc)
            for shift in shifts
        )
        loads = Counter(
            str(item.user_id)
            for item in assignments
            if item.assignment_status in ACTIVE_ASSIGNMENTS
        )
        imbalance = (max(loads.values()) - min(loads.values())) if len(loads) > 1 else 0
        special = sum(
            (
                bool((shift.activities or {}).get("special_operations"))
                if isinstance(shift.activities, dict)
                else False
            )
            for shift in shifts
        )
        return {
            "timezone": timezone_name,
            "window_start": window_start,
            "window_end": window_end,
            "today_staffing": today_staffing,
            "future_coverage_gaps": gaps,
            "open_slots": open_slots,
            "pending_staffing_changes": pending,
            "incomplete_closeouts": incomplete,
            "workload_imbalance": imbalance,
            "special_operations": special,
            "scheduling_enabled": True,
        }

    @staticmethod
    def _empty(timezone_name, window_start, window_end, enabled):
        return {
            "timezone": timezone_name,
            "window_start": window_start,
            "window_end": window_end,
            "today_staffing": 0,
            "future_coverage_gaps": 0,
            "open_slots": 0,
            "pending_staffing_changes": 0,
            "incomplete_closeouts": 0,
            "workload_imbalance": 0,
            "special_operations": 0,
            "scheduling_enabled": enabled,
        }
