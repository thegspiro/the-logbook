"""Events: what is on the calendar and who has responded."""

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.redaction import scrub_text
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
from app.models.event import AttendeeVisibility
from app.models.user import Organization
from app.services.event_service import EventService, resolve_attendee_visibility

# Characters of an event description returned per call; a longer one is
# read in pieces through ``get_event_description``. The column is unbounded
# Text, so a page of events cannot be allowed to carry every word of it.
EVENT_TEXT_CHARS = 20_000


def _clip(value: Any) -> tuple[Any, bool]:
    """``value`` scrubbed and cut to ``EVENT_TEXT_CHARS``, and whether cut."""
    if not isinstance(value, str):
        return value, False
    value = scrub_text(value)
    if len(value) <= EVENT_TEXT_CHARS:
        return value, False
    return value[:EVENT_TEXT_CHARS], True


def _chunk(text: str, offset: int) -> dict:
    text = scrub_text(text)
    piece = text[offset : offset + EVENT_TEXT_CHARS]
    body = {
        "content": piece,
        "content_offset": offset,
        "content_total_chars": len(text),
        "content_has_more": offset + len(piece) < len(text),
    }
    if body["content_has_more"]:
        body["next_content_offset"] = offset + len(piece)
    return body


def _event(event: Any, counts: Optional[dict] = None) -> dict:
    counts = counts or {}
    description, cut = _clip(event.description)
    return {
        "id": event.id,
        "title": event.title,
        "description": description,
        "description_truncated": cut,
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
        of the department's event types (training, business_meeting, ...).
        A description is cut at 20,000 characters (``description_truncated``);
        ``get_event_description`` reads the rest."""
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
        """One event by id, with its description (cut at 20,000 characters;
        ``get_event_description`` reads the rest) and RSVP settings."""
        # get_event answers (None, None) for an unknown or foreign id.
        event, _ = await EventService(db).get_event(
            parse_uuid(event_id, "event_id"), org_uuid(principal)
        )
        if event is None:
            raise ValueError("Event not found")
        return _event(event)

    @logbook_tool(server, title="Read event description")
    async def get_event_description(
        db: AsyncSession,
        principal: McpPrincipal,
        event_id: str,
        content_offset: int = 0,
    ) -> dict:
        """An event's description, 20,000 characters at a time. When
        ``content_has_more`` is true, call again with ``content_offset`` set
        to ``next_content_offset``."""
        content_offset = clamp_offset(content_offset)
        event, _ = await EventService(db).get_event(
            parse_uuid(event_id, "event_id"), org_uuid(principal)
        )
        if event is None:
            raise ValueError("Event not found")
        body = _chunk(event.description or "", content_offset)
        body.update({"event_id": event.id, "title": event.title})
        return body

    @logbook_tool(server, title="List event attendees")
    async def list_event_attendees(
        db: AsyncSession,
        principal: McpPrincipal,
        event_id: str,
        limit: int = 100,
        offset: int = 0,
    ) -> dict:
        """Who is going to an event: member id, name and response. Only
        ``going`` responses, and only when the event (or the department's
        default) shares its attendee list with members; otherwise the list
        is not available here."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        event, rsvps = await EventService(db).list_event_attendees_for_member(
            event_id=parse_uuid(event_id, "event_id"),
            organization_id=org_uuid(principal),
            skip=offset,
            limit=limit,
        )
        if event is None:
            raise ValueError("Event not found")
        # The same gate the member-facing endpoint applies: a service key is
        # not an events manager, so a managers-only roster stays closed.
        org = await db.get(Organization, principal.organization_id)
        visibility = resolve_attendee_visibility(event, org.settings if org else None)
        if visibility != AttendeeVisibility.MEMBERS:
            raise ValueError(
                "The attendee list for this event is not shared with members"
            )
        names = await member_names(
            db, principal.organization_id, (r.user_id for r in rsvps)
        )
        # The same allowlist as EventAttendeeResponse, the member-facing
        # roster row: guest counts, response times and the check-in block
        # are organizer-only attendance detail and stay out.
        items = [
            {
                "member_id": r.user_id,
                "member_name": names.get(r.user_id),
                "status": iso(r.status),
            }
            for r in rsvps
        ]
        return page(items, None, limit, offset)
