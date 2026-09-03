"""Department profile: who the department is and which modules it runs."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import iso, org_uuid
from app.models.location import Location
from app.models.user import Organization
from app.services.organization_service import OrganizationService


def register(server: Any) -> None:
    @logbook_tool(server, title="Department profile")
    async def get_department_profile(db: AsyncSession, principal: McpPrincipal) -> dict:
        """The department's name, type, timezone, identifiers, active stations
        and locations, and which Logbook modules it has enabled. Call this first
        to learn the timezone that shift and event times should be shown in."""
        org = await db.get(Organization, principal.organization_id)
        if org is None:
            raise ValueError("Organization not found")
        modules = await OrganizationService(db).get_enabled_modules(org_uuid(principal))
        locations = await db.execute(
            select(Location)
            .where(
                Location.organization_id == principal.organization_id,
                Location.is_active.is_(True),
            )
            .order_by(Location.name)
        )
        return {
            "id": org.id,
            "name": org.name,
            "organization_type": iso(org.organization_type),
            "timezone": org.timezone,
            "county": org.county,
            "website": org.website,
            "founded_year": org.founded_year,
            "fdid": org.fdid,
            "enabled_modules": list(modules.enabled_modules),
            "locations": [
                {
                    "id": loc.id,
                    "name": loc.name,
                    "description": loc.description,
                    "city": loc.city,
                    "state": loc.state,
                    "building": loc.building,
                    "capacity": loc.capacity,
                }
                for loc in locations.scalars().all()
            ],
        }
