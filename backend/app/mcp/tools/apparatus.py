"""Apparatus: the fleet, its status and maintenance."""

from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.redaction import scrub_text
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import clamp_limit, clamp_offset, iso, page, parse_uuid
from app.models.location import Location
from app.schemas.apparatus import ApparatusListFilters
from app.services.apparatus_service import ApparatusService


async def _location_names(
    db: AsyncSession, organization_id: str, ids: Iterable[Optional[str]]
) -> dict[str, str]:
    """Station and location names by id. Resolved in one query rather than
    through the relationships, which the list query does not eager-load and
    an async session cannot lazy-load."""
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = await db.execute(
        select(Location).where(
            Location.organization_id == organization_id, Location.id.in_(wanted)
        )
    )
    return {loc.id: loc.name for loc in rows.scalars().all()}


# Characters of an apparatus's free text returned per row; the rest is read
# through ``get_apparatus_text``. Both columns are unbounded Text, so a page
# of the fleet cannot carry every word of them.
APPARATUS_TEXT_CHARS = 20_000
_APPARATUS_TEXT_FIELDS = ("description", "status_reason")


def _clip_apparatus(value: Any) -> tuple[Any, bool]:
    if not isinstance(value, str):
        return value, False
    value = scrub_text(value)
    if len(value) <= APPARATUS_TEXT_CHARS:
        return value, False
    return value[:APPARATUS_TEXT_CHARS], True


def _apparatus(a: Any, locations: dict[str, str]) -> dict:
    status = getattr(a, "status_record", None)
    status_reason, reason_cut = _clip_apparatus(a.status_reason)
    description, description_cut = _clip_apparatus(a.description)
    return {
        "id": a.id,
        "unit_number": a.unit_number,
        "name": a.name,
        "apparatus_type": getattr(getattr(a, "apparatus_type", None), "name", None),
        "status": getattr(status, "name", None),
        "status_code": getattr(status, "code", None),
        "status_reason": status_reason,
        "status_reason_truncated": reason_cut,
        "year": a.year,
        "make": a.make,
        "model": a.model,
        "primary_station": locations.get(a.primary_station_id or ""),
        "current_location": locations.get(a.current_location_id or ""),
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
        "description": description,
        "description_truncated": description_cut,
    }


# Characters of a maintenance record's free text returned per row; the rest
# is read through ``get_maintenance_record_text``. All three columns are
# unbounded Text, so a page of records cannot carry every word of them.
MAINTENANCE_TEXT_CHARS = 20_000
_MAINTENANCE_TEXT_FIELDS = ("description", "work_performed", "findings")


def _clip(value: Any) -> tuple[Any, bool]:
    if not isinstance(value, str):
        return value, False
    value = scrub_text(value)
    if len(value) <= MAINTENANCE_TEXT_CHARS:
        return value, False
    return value[:MAINTENANCE_TEXT_CHARS], True


def _chunk(text: str, offset: int) -> dict:
    text = scrub_text(text)
    piece = text[offset : offset + MAINTENANCE_TEXT_CHARS]
    body = {
        "content": piece,
        "content_offset": offset,
        "content_total_chars": len(text),
        "content_has_more": offset + len(piece) < len(text),
    }
    if body["content_has_more"]:
        body["next_content_offset"] = offset + len(piece)
    return body


def _maintenance(r: Any) -> dict:
    description, description_cut = _clip(r.description)
    work_performed, work_cut = _clip(r.work_performed)
    findings, findings_cut = _clip(r.findings)
    return {
        "id": r.id,
        "apparatus_id": r.apparatus_id,
        "maintenance_type": getattr(getattr(r, "maintenance_type", None), "name", None),
        "description": description,
        "description_truncated": description_cut,
        "scheduled_date": iso(r.scheduled_date),
        "due_date": iso(r.due_date),
        "completed_date": iso(r.completed_date),
        "is_completed": bool(r.is_completed),
        "is_overdue": bool(r.is_overdue),
        "work_performed": work_performed,
        "work_performed_truncated": work_cut,
        "findings": findings,
        "findings_truncated": findings_cut,
        "mileage_at_service": r.mileage_at_service,
        "hours_at_service": r.hours_at_service,
        "cost": float(r.cost) if r.cost is not None else None,
        "vendor": r.vendor,
        "next_due_date": iso(r.next_due_date),
        "next_due_mileage": r.next_due_mileage,
        "next_due_hours": r.next_due_hours,
    }


def register(server: Any) -> None:
    @logbook_tool(server, title="List apparatus", module="apparatus")
    async def list_apparatus(
        db: AsyncSession,
        principal: McpPrincipal,
        search: Optional[str] = None,
        include_archived: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """The fleet: unit number, type, status, station, capacities, mileage
        and hours, inspection and registration expiries, open deficiencies.
        A description or status reason is cut at 20,000 characters
        (``description_truncated``, ``status_reason_truncated``);
        ``get_apparatus_text`` reads the rest."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        filters = ApparatusListFilters(
            search=search or None,
            is_archived=None if include_archived else False,
        )
        rows, total = await ApparatusService(db).list_apparatus(
            principal.organization_id, filters=filters, skip=offset, limit=limit
        )
        locations = await _location_names(
            db,
            principal.organization_id,
            [i for a in rows for i in (a.primary_station_id, a.current_location_id)],
        )
        return page([_apparatus(a, locations) for a in rows], total, limit, offset)

    @logbook_tool(server, title="Read apparatus text", module="apparatus")
    async def get_apparatus_text(
        db: AsyncSession,
        principal: McpPrincipal,
        apparatus_id: str,
        field: str = "description",
        content_offset: int = 0,
    ) -> dict:
        """One apparatus's ``description`` or ``status_reason`` (``field``),
        20,000 characters at a time. When ``content_has_more`` is true, call
        again with ``content_offset`` set to ``next_content_offset``."""
        if field not in _APPARATUS_TEXT_FIELDS:
            raise ValueError(
                "field must be one of: " + ", ".join(_APPARATUS_TEXT_FIELDS)
            )
        content_offset = clamp_offset(content_offset)
        unit = await ApparatusService(db).get_apparatus(
            str(parse_uuid(apparatus_id, "apparatus_id")), principal.organization_id
        )
        if unit is None:
            raise ValueError("Apparatus not found")
        text = scrub_text(getattr(unit, field) or "")
        piece = text[content_offset : content_offset + APPARATUS_TEXT_CHARS]
        body: dict[str, Any] = {
            "apparatus_id": unit.id,
            "unit_number": unit.unit_number,
            "field": field,
            "content": piece,
            "content_offset": content_offset,
            "content_total_chars": len(text),
            "content_has_more": content_offset + len(piece) < len(text),
        }
        if body["content_has_more"]:
            body["next_content_offset"] = content_offset + len(piece)
        return body

    @logbook_tool(server, title="Fleet summary", module="apparatus")
    async def get_fleet_summary(db: AsyncSession, principal: McpPrincipal) -> dict:
        """Counts by status, deficiencies, and upcoming maintenance and
        expirations across the fleet. ``by_type`` is a list of type name and
        count."""
        summary = await ApparatusService(db).get_fleet_summary(
            principal.organization_id
        )
        # Apparatus type names are department-typed free text and arrive
        # as dictionary keys, which the redactor leaves alone; as rows
        # they are values and get scrubbed like any other string.
        summary["by_type"] = [
            {"apparatus_type": scrub_text(str(name)), "count": count}
            for name, count in (summary.get("by_type") or {}).items()
        ]
        return summary

    @logbook_tool(server, title="Apparatus maintenance", module="apparatus")
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
        items = [_maintenance(r) for r in records]
        return page(items, None, limit, offset)

    @logbook_tool(server, title="Read maintenance text", module="apparatus")
    async def get_maintenance_record_text(
        db: AsyncSession,
        principal: McpPrincipal,
        record_id: str,
        field: str,
        content_offset: int = 0,
    ) -> dict:
        """The full ``description``, ``work_performed`` or ``findings`` text
        of one maintenance record, 20,000 characters at a time. When
        ``content_has_more`` is true, call again with ``content_offset`` set
        to ``next_content_offset``."""
        if field not in _MAINTENANCE_TEXT_FIELDS:
            raise ValueError(
                "field must be one of: " + ", ".join(_MAINTENANCE_TEXT_FIELDS)
            )
        content_offset = clamp_offset(content_offset)
        record = await ApparatusService(db).get_maintenance_record(
            str(parse_uuid(record_id, "record_id")), principal.organization_id
        )
        if record is None:
            raise ValueError("Maintenance record not found")
        body = _chunk(getattr(record, field) or "", content_offset)
        body.update({"record_id": record.id, "field": field})
        return body
