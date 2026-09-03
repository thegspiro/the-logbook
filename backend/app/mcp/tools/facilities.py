"""Facilities: stations and buildings and their status."""

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import clamp_limit, clamp_offset, page
from app.services.facilities_service import FacilitiesService


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
        bays, occupancy and whether the department owns the building."""
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
        items = [
            {
                "id": f.id,
                "name": f.name,
                "facility_number": f.facility_number,
                "facility_type": getattr(
                    getattr(f, "facility_type", None), "name", None
                ),
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
                "description": f.description,
            }
            for f in rows
        ]
        return page(items, total, limit, offset)

    @logbook_tool(server, title="Facilities counts", module="facilities")
    async def get_facilities_counts(db: AsyncSession, principal: McpPrincipal) -> dict:
        """Dashboard counts: facilities, open maintenance, upcoming
        inspections and similar totals."""
        return await FacilitiesService(db).get_dashboard_counts(
            principal.organization_id
        )
