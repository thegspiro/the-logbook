"""Events: what is on the calendar and who has responded."""

from typing import Any, Optional

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
    parse_datetime,
    parse_uuid,
)
from app.services.event_service import EventService


def _event(event: Any, counts: Optional[dict] = None) -> dict:
    counts = counts or {}
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description,
        "event_type": iso(event.event_type),
        "custom_category": event.custom_category,
        "location": event.location,
        "location_details": event.location_details,
        "location_id": event.location_id,
        "start_datetime": iso(event.start_datetime),
        "end_datetime": iso(event.end_datetime),
        "requires_rsvp": bool(event.requires_rsvp),
        "rsvp_deadline": iso(event.rsvp_deadline),
        "max_attendees": event.max_attendees,
        "is_mandatory": bool(event.is_mandatory),
        "mandatory_membership_types": event.mandatory_membership_types,
        "is_draft": bool(event.is_draft),
        "is_cancelled": bool(event.is_cancelled),
        "cancellation_reason": event.cancellation_reason,
        "is_recurring": bool(event.is_recurring),
        "rsvp_count": counts.get("rsvp_count"),
        "going_count": counts.get("going_count"),
        "waitlist_count": counts.get("waitlist_count"),
    }


def register(server: Any) -> None:
    @logbook_tool(server, title="List events")
    async def list_events(
        db: AsyncSession,
        principal: McpPrincipal,
        start_after: Optional[str] = None,
        start_before: Optional[str] = None,
        event_type: Optional[str] = None,
        include_cancelled: bool = False,
        include_drafts: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Events in a window, with RSVP and waitlist counts. ``start_after``
        and ``start_before`` are ISO-8601 date-times (UTC); omit both for the
        default of every non-cancelled published event. ``event_type`` is one
        of the department's event types (training, business_meeting, ...)."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        rows = await EventService(db).list_events(
            org_uuid(principal),
            event_type=event_type or None,
            start_after=parse_datetime(start_after, "start_after"),
            start_before=parse_datetime(start_before, "start_before"),
            include_cancelled=include_cancelled,
            include_drafts=include_drafts,
            skip=offset,
            limit=limit,
        )
        items = [_event(row["event"], row) for row in rows]
        return page(items, None, limit, offset)

    @logbook_tool(server, title="Get event")
    async def get_event(
        db: AsyncSession, principal: McpPrincipal, event_id: str
    ) -> dict:
        """One event by id, with its full description and RSVP settings."""
        # get_event answers (None, None) for an unknown or foreign id.
        event, _ = await EventService(db).get_event(
            parse_uuid(event_id, "event_id"), org_uuid(principal)
        )
        if event is None:
            raise ValueError("Event not found")
        return _event(event)

    @logbook_tool(server, title="List event RSVPs")
    async def list_event_rsvps(
        db: AsyncSession,
        principal: McpPrincipal,
        event_id: str,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict:
        """Who has responded to an event and how: member name, RSVP status
        (going, not_going, maybe, waitlisted), guest count and whether they
        checked in. ``status`` filters to one RSVP status."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        rsvps = await EventService(db).list_event_rsvps(
            parse_uuid(event_id, "event_id"),
            org_uuid(principal),
            status_filter=status or None,
            skip=offset,
            limit=limit,
        )
        names = await member_names(
            db, principal.organization_id, (r.user_id for r in rsvps)
        )
        items = [
            {
                "member_id": r.user_id,
                "member_name": names.get(r.user_id),
                "status": iso(r.status),
                "guest_count": r.guest_count,
                "responded_at": iso(r.responded_at),
                "checked_in": bool(r.checked_in),
                "checked_in_at": iso(r.checked_in_at),
            }
            for r in rsvps
        ]
        return page(items, None, limit, offset)
