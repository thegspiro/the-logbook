"""Facilities: stations and buildings and their status."""

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.redaction import scrub_text
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import clamp_limit, clamp_offset, page, parse_uuid
from app.services.facilities_service import FacilitiesService

# A listing carries this much of a facility's description; the rest is read
# in pieces through ``get_facility_description``. The column is unbounded
# Text, so a page of facilities cannot carry every word of it.
FACILITY_TEXT_CHARS = 20_000


def _clip(value: Any) -> tuple[Any, bool]:
    """``value`` scrubbed and cut to ``FACILITY_TEXT_CHARS``, and whether cut."""
    if not isinstance(value, str):
        return value, False
    value = scrub_text(value)
    if len(value) <= FACILITY_TEXT_CHARS:
        return value, False
    return value[:FACILITY_TEXT_CHARS], True


def _chunk(text: str, offset: int) -> dict:
    text = scrub_text(text)
    piece = text[offset : offset + FACILITY_TEXT_CHARS]
    body = {
        "content": piece,
        "content_offset": offset,
        "content_total_chars": len(text),
        "content_has_more": offset + len(piece) < len(text),
    }
    if body["content_has_more"]:
        body["next_content_offset"] = offset + len(piece)
    return body


def _facility(f: Any) -> dict:
    description, cut = _clip(f.description)
    return {
        "id": f.id,
        "name": f.name,
        "facility_number": f.facility_number,
        "facility_type": getattr(getattr(f, "facility_type", None), "name", None),
        "status": getattr(getattr(f, "status_record", None), "name", None),
        "city": f.city,
        "state": f.state,
        "county": f.county,
        "year_built": f.year_built,
        "square_footage": f.square_footage,
        "num_floors": f.num_floors,
        "num_bays": f.num_bays,
        "is_owned": f.is_owned,
        "max_occupancy": f.max_occupancy,
        "sleeping_quarters": f.sleeping_quarters,
        "is_archived": bool(f.is_archived),
        "description": description,
        "description_truncated": cut,
    }


def register(server: Any) -> None:
    @logbook_tool(server, title="List facilities", module="facilities")
    async def list_facilities(
        db: AsyncSession,
        principal: McpPrincipal,
        search: Optional[str] = None,
        include_archived: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Stations and other buildings: number, type, status, city, size,
        bays, occupancy and whether the department owns the building. A
        description is cut at 20,000 characters (``description_truncated``);
        ``get_facility_description`` reads the rest."""
        # Lease and tax terms (``lease_expiration``, ``property_tax_id``) are
        # blanked by the facilities API unless the caller holds
        # ``facilities.view_sensitive``; a service key carries no such grant,
        # so they are never projected here.
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        rows, total = await FacilitiesService(db).list_facilities(
            principal.organization_id,
            is_archived=None if include_archived else False,
            search=search or None,
            skip=offset,
            limit=limit,
        )
        return page([_facility(f) for f in rows], total, limit, offset)

    @logbook_tool(server, title="Read facility description", module="facilities")
    async def get_facility_description(
        db: AsyncSession,
        principal: McpPrincipal,
        facility_id: str,
        content_offset: int = 0,
    ) -> dict:
        """A facility's description, 20,000 characters at a time. When
        ``content_has_more`` is true, call again with ``content_offset`` set
        to ``next_content_offset``."""
        content_offset = clamp_offset(content_offset)
        facility = await FacilitiesService(db).get_facility(
            str(parse_uuid(facility_id, "facility_id")),
            principal.organization_id,
            include_relations=False,
        )
        if facility is None:
            raise ValueError("Facility not found")
        body = {"facility_id": facility.id, "name": facility.name}
        body.update(_chunk(facility.description or "", content_offset))
        return body

    @logbook_tool(server, title="Facilities counts", module="facilities")
    async def get_facilities_counts(db: AsyncSession, principal: McpPrincipal) -> dict:
        """Dashboard counts: facilities, open maintenance, upcoming
        inspections and similar totals."""
        return await FacilitiesService(db).get_dashboard_counts(
            principal.organization_id
        )
