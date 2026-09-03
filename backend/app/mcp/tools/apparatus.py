"""Apparatus: the fleet, its status and maintenance."""

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import clamp_limit, clamp_offset, iso, page, parse_uuid
from app.schemas.apparatus import ApparatusListFilters
from app.services.apparatus_service import ApparatusService


def _apparatus(a: Any) -> dict:
    status = getattr(a, "status_record", None)
    return {
        "id": a.id,
        "unit_number": a.unit_number,
        "name": a.name,
        "apparatus_type": getattr(getattr(a, "apparatus_type", None), "name", None),
        "status": getattr(status, "name", None),
        "status_code": getattr(status, "code", None),
        "status_reason": a.status_reason,
        "year": a.year,
        "make": a.make,
        "model": a.model,
        "primary_station": getattr(getattr(a, "primary_station", None), "name", None),
        "current_location": getattr(getattr(a, "current_location", None), "name", None),
        "seating_capacity": a.seating_capacity,
        "min_staffing": a.min_staffing,
        "pump_capacity_gpm": a.pump_capacity_gpm,
        "tank_capacity_gallons": a.tank_capacity_gallons,
        "ladder_length_feet": a.ladder_length_feet,
        "current_mileage": a.current_mileage,
        "current_hours": a.current_hours,
        "in_service_date": iso(a.in_service_date),
        "inspection_expiration": iso(a.inspection_expiration),
        "registration_expiration": iso(a.registration_expiration),
        "has_deficiency": bool(a.has_deficiency),
        "deficiency_since": iso(a.deficiency_since),
        "is_archived": bool(a.is_archived),
        "description": a.description,
    }


def register(server: Any) -> None:
    @logbook_tool(server, title="List apparatus")
    async def list_apparatus(
        db: AsyncSession,
        principal: McpPrincipal,
        search: Optional[str] = None,
        include_archived: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """The fleet: unit number, type, status, station, capacities, mileage
        and hours, inspection and registration expiries, open deficiencies."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        filters = ApparatusListFilters(
            search=search or None,
            is_archived=None if include_archived else False,
        )
        rows, total = await ApparatusService(db).list_apparatus(
            principal.organization_id, filters=filters, skip=offset, limit=limit
        )
        return page([_apparatus(a) for a in rows], total, limit, offset)

    @logbook_tool(server, title="Fleet summary")
    async def get_fleet_summary(db: AsyncSession, principal: McpPrincipal) -> dict:
        """Counts by status, deficiencies, and upcoming maintenance and
        expirations across the fleet."""
        return await ApparatusService(db).get_fleet_summary(principal.organization_id)

    @logbook_tool(server, title="Apparatus maintenance")
    async def list_apparatus_maintenance(
        db: AsyncSession,
        principal: McpPrincipal,
        apparatus_id: Optional[str] = None,
        is_completed: Optional[bool] = None,
        is_overdue: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Maintenance records — scheduled, due, completed and overdue work —
        for one apparatus or the whole fleet."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        records = await ApparatusService(db).list_maintenance_records(
            principal.organization_id,
            apparatus_id=(
                str(parse_uuid(apparatus_id, "apparatus_id")) if apparatus_id else None
            ),
            is_completed=is_completed,
            is_overdue=is_overdue,
            skip=offset,
            limit=limit,
        )
        items = [
            {
                "id": r.id,
                "apparatus_id": r.apparatus_id,
                "maintenance_type": getattr(
                    getattr(r, "maintenance_type", None), "name", None
                ),
                "description": r.description,
                "scheduled_date": iso(r.scheduled_date),
                "due_date": iso(r.due_date),
                "completed_date": iso(r.completed_date),
                "is_completed": bool(r.is_completed),
                "is_overdue": bool(r.is_overdue),
                "work_performed": r.work_performed,
                "findings": r.findings,
                "mileage_at_service": r.mileage_at_service,
                "hours_at_service": r.hours_at_service,
                "cost": float(r.cost) if r.cost is not None else None,
                "vendor": r.vendor,
                "next_due_date": iso(r.next_due_date),
                "next_due_mileage": r.next_due_mileage,
                "next_due_hours": r.next_due_hours,
            }
            for r in records
        ]
        return page(items, None, limit, offset)
