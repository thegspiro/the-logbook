"""Department profile: who the department is and which modules it runs."""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.redaction import scrub_text
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    org_uuid,
    page,
    parse_uuid,
)
from app.models.location import Location
from app.models.user import Organization
from app.services.organization_service import OrganizationService

# A listing carries this much of a location's description; the rest is
# read in pieces through ``get_location_description``. The column is
# unbounded Text, so a page of locations cannot carry every word of it.
LOCATION_TEXT_CHARS = 20_000


def _clip(value: Any) -> tuple[Any, bool]:
    """``value`` scrubbed and cut to ``LOCATION_TEXT_CHARS``, and whether cut."""
    if not isinstance(value, str):
        return value, False
    value = scrub_text(value)
    if len(value) <= LOCATION_TEXT_CHARS:
        return value, False
    return value[:LOCATION_TEXT_CHARS], True


def _chunk(text: str, offset: int) -> dict:
    text = scrub_text(text)
    piece = text[offset : offset + LOCATION_TEXT_CHARS]
    body = {
        "content": piece,
        "content_offset": offset,
        "content_total_chars": len(text),
        "content_has_more": offset + len(piece) < len(text),
    }
    if body["content_has_more"]:
        body["next_content_offset"] = offset + len(piece)
    return body


def _active_locations(organization_id: str):
    return [
        Location.organization_id == organization_id,
        Location.is_active.is_(True),
    ]


def register(server: Any) -> None:
    @logbook_tool(server, title="Department profile")
    async def get_department_profile(db: AsyncSession, principal: McpPrincipal) -> dict:
        """The department's name, type, timezone, identifiers, how many active
        stations and locations it has (``list_locations`` names them), and
        which Logbook modules it has enabled. Call this first to learn the
        timezone that shift and event times should be shown in."""
        org = await db.get(Organization, principal.organization_id)
        if org is None:
            raise ValueError("Organization not found")
        modules = await OrganizationService(db).get_enabled_modules(org_uuid(principal))
        location_count = (
            await db.execute(
                select(func.count())
                .select_from(Location)
                .where(*_active_locations(principal.organization_id))
            )
        ).scalar_one()
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
            "active_location_count": location_count,
        }

    @logbook_tool(server, title="List locations")
    async def list_locations(
        db: AsyncSession,
        principal: McpPrincipal,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """The department's active stations and other locations, by name:
        city, state, building and capacity. Paged; ``total`` counts every
        active location. A description is cut at 20,000 characters
        (``description_truncated``); ``get_location_description`` reads the
        rest."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        criteria = _active_locations(principal.organization_id)
        total = (
            await db.execute(
                select(func.count()).select_from(Location).where(*criteria)
            )
        ).scalar_one()
        rows = await db.execute(
            select(Location)
            .where(*criteria)
            .order_by(Location.name, Location.id)
            .offset(offset)
            .limit(limit)
        )
        items = []
        for loc in rows.scalars().all():
            description, cut = _clip(loc.description)
            items.append(
                {
                    "id": loc.id,
                    "name": loc.name,
                    "description": description,
                    "description_truncated": cut,
                    "city": loc.city,
                    "state": loc.state,
                    "building": loc.building,
                    "capacity": loc.capacity,
                }
            )
        return page(items, total, limit, offset)

    @logbook_tool(server, title="Read location description")
    async def get_location_description(
        db: AsyncSession,
        principal: McpPrincipal,
        location_id: str,
        content_offset: int = 0,
    ) -> dict:
        """A location's description, 20,000 characters at a time. When
        ``content_has_more`` is true, call again with ``content_offset`` set
        to ``next_content_offset``."""
        content_offset = clamp_offset(content_offset)
        location = (
            await db.execute(
                select(Location).where(
                    Location.id == str(parse_uuid(location_id, "location_id")),
                    *_active_locations(principal.organization_id),
                )
            )
        ).scalar_one_or_none()
        if location is None:
            raise ValueError("Location not found")
        body = {"location_id": location.id, "name": location.name}
        body.update(_chunk(location.description or "", content_offset))
        return body
