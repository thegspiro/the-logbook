"""Shifts: the duty calendar, open seats and who is assigned."""

from typing import Any, Optional

from sqlalchemy import select
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
from app.models.training import Shift, ShiftAssignment
from app.services.scheduling_service import SchedulingService


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
    @logbook_tool(server, title="List shifts")
    async def list_shifts(
        db: AsyncSession,
        principal: McpPrincipal,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Shifts between two dates (YYYY-MM-DD, inclusive), each with its
        apparatus, station, seat list and who is assigned to each seat. Times
        are the department's local clock times."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        shifts, total = await SchedulingService(db).get_shifts(
            org_uuid(principal),
            start_date=parse_date(start_date, "start_date"),
            end_date=parse_date(end_date, "end_date"),
            skip=offset,
            limit=limit,
        )
        return page(await _render(db, principal, list(shifts)), total, limit, offset)

    @logbook_tool(server, title="List open shifts")
    async def list_open_shifts(
        db: AsyncSession,
        principal: McpPrincipal,
        start_date: str,
        end_date: str,
    ) -> dict:
        """Shifts in the window that still have an unfilled seat, with the
        seats and current assignments so the gaps can be named."""
        start = parse_date(start_date, "start_date")
        end = parse_date(end_date, "end_date")
        if start is None or end is None:
            raise ValueError("start_date and end_date are required")
        shifts = await SchedulingService(db).get_open_shifts(
            org_uuid(principal), start, end
        )
        items = await _render(db, principal, list(shifts))
        return page(items, None, len(items), 0)

    @logbook_tool(server, title="Scheduling summary")
    async def get_scheduling_summary(db: AsyncSession, principal: McpPrincipal) -> dict:
        """Counts of upcoming, open and recent shifts for the department."""
        return await SchedulingService(db).get_summary(org_uuid(principal))
