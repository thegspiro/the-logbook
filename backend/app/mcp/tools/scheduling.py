"""Shifts: the duty calendar, open seats and who is assigned.

The member API shows a member only the shifts they are eligible for (by
rank, positions, training and qualifications); a service key has none of
those, so without the ``expose_full_schedule`` switch the shift tools show
the one set every eligible member can see — shifts open to all members.
With it, they show the roster as a scheduling manager sees it.
"""

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    member_names,
    org_uuid,
    page,
    parse_date,
)
from app.models.apparatus import Apparatus
from app.models.location import Location
from app.models.training import AssignmentStatus, Shift, ShiftAssignment, ShiftStatus
from app.services.scheduling_service import SchedulingService

# The most candidate shifts one open-shift call examines, and the widest
# window it accepts — the same bounds the API's /shifts/open enforces. A
# window with more candidates than this is reported as incomplete with the
# date to continue from, never silently cut.
MAX_OPEN_SHIFT_CANDIDATES = 500
MAX_OPEN_SHIFT_WINDOW_DAYS = 366


async def _reference_names(
    db: AsyncSession, organization_id: str, shifts: list[Shift]
) -> tuple[dict[str, str], dict[str, str]]:
    apparatus_ids = {s.apparatus_id for s in shifts if s.apparatus_id}
    station_ids = {s.station_id for s in shifts if s.station_id}
    apparatus: dict[str, str] = {}
    stations: dict[str, str] = {}
    if apparatus_ids:
        rows = await db.execute(
            select(Apparatus).where(
                Apparatus.organization_id == organization_id,
                Apparatus.id.in_(apparatus_ids),
            )
        )
        apparatus = {
            a.id: a.unit_number or a.name or a.id for a in rows.scalars().all()
        }
    if station_ids:
        rows = await db.execute(
            select(Location).where(
                Location.organization_id == organization_id,
                Location.id.in_(station_ids),
            )
        )
        stations = {loc.id: loc.name for loc in rows.scalars().all()}
    return apparatus, stations


async def _assignments_by_shift(
    db: AsyncSession, organization_id: str, shift_ids: list[str]
) -> dict[str, list[dict]]:
    if not shift_ids:
        return {}
    rows = await db.execute(
        select(ShiftAssignment)
        .where(
            ShiftAssignment.organization_id == organization_id,
            ShiftAssignment.shift_id.in_(shift_ids),
            # A declined or cancelled assignment keeps its row; the roster
            # shows who actually holds the seat.
            ShiftAssignment.assignment_status.in_(
                [AssignmentStatus.ASSIGNED, AssignmentStatus.CONFIRMED]
            ),
        )
        .order_by(ShiftAssignment.created_at.asc())
    )
    assignments = list(rows.scalars().all())
    names = await member_names(db, organization_id, (a.user_id for a in assignments))
    grouped: dict[str, list[dict]] = {}
    for a in assignments:
        grouped.setdefault(a.shift_id, []).append(
            {
                "member_id": a.user_id,
                "member_name": names.get(a.user_id),
                "position": a.position,
                "status": iso(a.assignment_status),
                "is_training": bool(a.is_training),
                "confirmed_at": iso(a.confirmed_at),
            }
        )
    return grouped


def _cursor_for(shift: Shift) -> str:
    """Opaque continuation naming the last examined shift."""
    return f"{shift.shift_date.isoformat()}|{iso(shift.start_time)}|{shift.id}"


def _after_cursor(cursor: str):
    """The keyset predicate for rows after ``cursor`` in listing order."""
    try:
        day_text, time_text, shift_id = cursor.split("|", 2)
        day = date.fromisoformat(day_text)
        start_time = datetime.fromisoformat(time_text)
    except ValueError:
        raise ValueError("cursor is not a continuation from a previous call")
    return or_(
        Shift.shift_date > day,
        and_(Shift.shift_date == day, Shift.start_time > start_time),
        and_(
            Shift.shift_date == day,
            Shift.start_time == start_time,
            Shift.id > shift_id,
        ),
    )


def _shift(
    shift: Shift,
    apparatus: dict[str, str],
    stations: dict[str, str],
    officers: dict[str, Optional[str]],
    assignments: list[dict],
) -> dict:
    return {
        "id": shift.id,
        "shift_date": iso(shift.shift_date),
        "start_time": iso(shift.start_time),
        "end_time": iso(shift.end_time),
        "apparatus_id": shift.apparatus_id,
        "apparatus": apparatus.get(shift.apparatus_id or ""),
        "station_id": shift.station_id,
        "station": stations.get(shift.station_id or ""),
        "platoon": shift.platoon,
        "shift_officer_id": shift.shift_officer_id,
        "shift_officer": officers.get(shift.shift_officer_id or ""),
        "positions": SchedulingService.normalize_positions(shift.positions),
        "min_staffing": shift.min_staffing,
        "status": iso(shift.status),
        "is_finalized": bool(shift.is_finalized),
        "open_to_all_members": bool(shift.open_to_all_members),
        "is_outreach": bool(shift.is_outreach),
        "call_count": shift.call_count,
        "total_hours": shift.total_hours,
        "notes": shift.notes,
        "assignments": assignments,
    }


async def _render(
    db: AsyncSession, principal: McpPrincipal, shifts: list[Shift]
) -> list[dict]:
    apparatus, stations = await _reference_names(db, principal.organization_id, shifts)
    officers = await member_names(
        db, principal.organization_id, (s.shift_officer_id for s in shifts)
    )
    assignments = await _assignments_by_shift(
        db, principal.organization_id, [s.id for s in shifts]
    )
    return [
        _shift(s, apparatus, stations, officers, assignments.get(s.id, []))
        for s in shifts
    ]


def register(server: Any) -> None:
    @logbook_tool(server, title="List shifts", module="scheduling")
    async def list_shifts(
        db: AsyncSession,
        principal: McpPrincipal,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Shifts between two dates (YYYY-MM-DD, inclusive), each with its
        apparatus, station, seat list and who is assigned to each seat.
        ``start_time`` and ``end_time`` are UTC instants with an offset;
        convert them to the department's timezone before presenting them.
        Unless the department shares its full schedule with Claude, only
        shifts open to all members are listed."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        shifts, total = await SchedulingService(db).get_shifts(
            org_uuid(principal),
            start_date=parse_date(start_date, "start_date"),
            end_date=parse_date(end_date, "end_date"),
            skip=offset,
            limit=limit,
            open_to_all_only=not principal.expose_full_schedule,
        )
        return page(await _render(db, principal, list(shifts)), total, limit, offset)

    @logbook_tool(server, title="List open shifts", module="scheduling")
    async def list_open_shifts(
        db: AsyncSession,
        principal: McpPrincipal,
        start_date: str,
        end_date: str,
        limit: int = 50,
        cursor: Optional[str] = None,
    ) -> dict:
        """Shifts in the window (at most a year) that still have an unfilled
        seat, with the seats and current assignments so the gaps can be
        named. Unless the department shares its full schedule with Claude,
        only shifts open to all members are listed. At most ``limit`` shifts
        are returned per call, soonest first: when ``has_more`` is true,
        call again with the same dates and ``cursor`` set to
        ``next_cursor``."""
        limit = clamp_limit(limit)
        start = parse_date(start_date, "start_date")
        end = parse_date(end_date, "end_date")
        if start is None or end is None:
            raise ValueError("start_date and end_date are required")
        if end < start:
            raise ValueError("end_date must not be before start_date")
        if (end - start).days > MAX_OPEN_SHIFT_WINDOW_DAYS:
            raise ValueError(
                f"The window must not exceed {MAX_OPEN_SHIFT_WINDOW_DAYS} days"
            )
        # The same candidate query as SchedulingService.get_open_shifts, but
        # one row past the cap so a truncated window is reported as such.
        criteria = [
            Shift.organization_id == principal.organization_id,
            Shift.shift_date >= start,
            Shift.shift_date <= end,
            Shift.is_finalized.is_(False),
            Shift.status != ShiftStatus.CANCELLED,
        ]
        if not principal.expose_full_schedule:
            criteria.append(Shift.open_to_all_members.is_(True))
        if cursor:
            criteria.append(_after_cursor(cursor))
        rows = await db.execute(
            select(Shift)
            .where(*criteria)
            .order_by(Shift.shift_date.asc(), Shift.start_time.asc(), Shift.id.asc())
            .limit(MAX_OPEN_SHIFT_CANDIDATES + 1)
        )
        candidates = list(rows.scalars().all())
        truncated = len(candidates) > MAX_OPEN_SHIFT_CANDIDATES
        candidates = candidates[:MAX_OPEN_SHIFT_CANDIDATES]
        shifts = list(
            await SchedulingService(db).filter_shifts_with_open_positions(
                org_uuid(principal), candidates
            )
        )
        # The batch is examined in full but rendered a page at a time: each
        # shift carries its seats and assignments, so a busy window could
        # otherwise answer with hundreds of them at once.
        shown = shifts[:limit]
        items = await _render(db, principal, shown)
        body: dict[str, Any] = {
            "items": items,
            "limit": limit,
            "has_more": truncated or len(shifts) > limit,
        }
        # A keyset cursor on the last row handed back — or, when the whole
        # batch fitted, on the last row examined. It advances within a date
        # as well as across dates, so a day with more shifts than either
        # bound cannot trap the continuation.
        if len(shifts) > limit:
            body["next_cursor"] = _cursor_for(shown[-1])
        elif truncated and candidates:
            body["next_cursor"] = _cursor_for(candidates[-1])
        return body

    @logbook_tool(server, title="Scheduling summary", module="scheduling")
    async def get_scheduling_summary(db: AsyncSession, principal: McpPrincipal) -> dict:
        """Counts of scheduled shifts and hours worked. Unless the department
        shares its full schedule with Claude, the figures cover only shifts
        open to all members, like the shift listings."""
        return await SchedulingService(db).get_summary(
            org_uuid(principal), open_to_all_only=not principal.expose_full_schedule
        )
