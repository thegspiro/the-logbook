"""
Public Calendar (ICS) Feed Endpoints

Two read-only RFC 5545 ICS feeds, so they can be subscribed to from
Google/Apple Calendar/Outlook. Those clients cannot authenticate with cookies,
so each feed is protected by an unguessable token embedded in the URL instead
of a login.

- ``/{token}.ics`` — a member's personal shifts. Only the member's own shift
  times/notes are exposed — no other members' data.
- ``/org/{token}.ics`` — the department's published events, behind the
  ``ical`` integration, plus its scheduled shifts when the integration's
  ``include_shifts`` is on. Only the fields in ``_org_feed_event`` and
  ``_org_feed_shift`` are exposed: no descriptions, notes, attendees or
  assignees, RSVP answers, custom fields or organizer.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.models.event import Event, EventType
from app.models.integration import Integration
from app.models.training import Shift, ShiftStatus
from app.models.user import Organization
from app.services.integration_services.ical_service import (
    ICAL_INTEGRATION_TYPE,
    generate_ical_feed,
    org_feed_token_matches,
)
from app.services.scheduling_service import SchedulingService
from app.utils.org_timezone import org_today

router = APIRouter(prefix="/public/v1/calendar", tags=["public-calendar"])

# How far back/ahead the feed covers. Calendar apps re-poll, so a bounded
# window keeps the payload small while staying useful.
FEED_PAST_DAYS = 60
FEED_FUTURE_DAYS = 365

# The department events feed's window, and a ceiling on how many events one
# poll can make the server load and serialize.
ORG_FEED_PAST_DAYS = 30
ORG_FEED_FUTURE_DAYS = 365
ORG_FEED_MAX_EVENTS = 2000


def _shift_title(shift) -> str:
    title = "Duty Shift"
    if getattr(shift, "platoon", None):
        title = f"{title} — Platoon {shift.platoon}"
    return title


async def _rate_limit_feed(request: Request) -> None:
    """Rate limit ICS feed polling: 60/minute per IP (DoS guard on DB-heavy
    feed generation). Calendar apps re-poll infrequently, so this is ample."""
    client_ip = get_client_ip(request)
    is_limited, _ = await public_rate_limit(
        key=f"pub_calendar:{client_ip}", max_requests=60, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


def _feed_not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found")


def _plausible_token(token: str) -> bool:
    # Tokens are base64url from secrets.token_urlsafe(48); reject anything that
    # can't be one before touching the DB.
    return bool(token) and 32 <= len(token) <= 64


@router.get("/{token}.ics", dependencies=[Depends(_rate_limit_feed)])
async def get_personal_calendar_feed(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Return the member's shifts as an ICS feed (public, token-protected)."""
    if not _plausible_token(token):
        raise _feed_not_found()

    service = SchedulingService(db)
    user = await service.get_user_by_calendar_token(token)
    if not user:
        raise _feed_not_found()

    org = (
        await db.execute(
            select(Organization).where(Organization.id == str(user.organization_id))
        )
    ).scalar_one_or_none()
    org_name = org.name if org and org.name else "The Logbook"
    tz_name = org.timezone if org and org.timezone else "UTC"

    today = org_today(org)
    shifts = await service.get_shifts_for_user_feed(
        user,
        today - timedelta(days=FEED_PAST_DAYS),
        today + timedelta(days=FEED_FUTURE_DAYS),
    )

    events = [
        {
            "id": s.id,
            "title": _shift_title(s),
            "start_time": s.start_time,
            "end_time": s.end_time,
            "description": s.notes or "",
        }
        for s in shifts
    ]

    ics = generate_ical_feed(events, org_name=org_name, timezone_name=tz_name)
    return Response(
        content=ics,
        media_type="text/calendar",
        headers={
            "Content-Disposition": 'inline; filename="shifts.ics"',
            "Cache-Control": "private, max-age=300",
        },
    )


def _org_feed_shift(shift: Shift) -> dict:
    """The only shift fields the department feed publishes.

    Title (with platoon) and times. Notes, pass-down notes, positions and who
    is assigned are never included: the feed is a shared bearer link, and the
    roster is each member's to see in the app or their personal feed.
    """
    return {
        # Prefixed so a shift can never share a UID with an event.
        "id": f"shift-{shift.id}",
        "title": _shift_title(shift),
        "start_time": shift.start_time,
        "end_time": shift.end_time,
        "categories": "Shift",
    }


def _event_type_label(event: Event) -> str:
    raw = getattr(event.event_type, "value", event.event_type)
    return str(raw).replace("_", " ").title() if raw else "Event"


def _org_feed_event(event: Event, frontend_url: str) -> dict:
    """The only event fields the department feed publishes.

    The feed URL is a bearer link that ends up in shared calendars, so this is
    an allowlist: title, times, location name, type and a link back. The
    description, attendees and RSVPs, custom fields, attachments, cancellation
    reason and organizer are never included.
    """
    location = event.location_obj.name if event.location_obj else event.location
    return {
        "id": event.id,
        "title": event.title,
        "start_time": event.start_datetime,
        "end_time": event.end_datetime,
        "location": location or "",
        "categories": _event_type_label(event),
        "url": f"{frontend_url}/events/{event.id}" if frontend_url else "",
    }


async def _integration_for_org_feed_token(
    db: AsyncSession, token: str
) -> Integration | None:
    # The digest is compared in constant time against each connected feed
    # rather than looked up by value; there is at most one per department.
    rows = (
        (
            await db.execute(
                select(Integration).where(
                    Integration.integration_type == ICAL_INTEGRATION_TYPE,
                    Integration.status == "connected",
                    Integration.enabled.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    match = None
    for row in rows:
        if org_feed_token_matches(row.config, token):
            match = row
    return match


@router.get("/org/{token}.ics", dependencies=[Depends(_rate_limit_feed)])
async def get_department_events_feed(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Return the department's published events as an ICS feed (public, token-protected).

    Serves 404 for an unknown token and for an ``ical`` integration that is not
    connected and enabled (disconnecting also deletes the token).

    Window: events that end no earlier than 30 days ago and start within the
    next 365 days, published (not draft) and not cancelled, filtered to the
    integration's ``included_event_types`` when that is non-empty. When
    ``include_shifts`` is on, scheduled (not cancelled) shifts dated from 30
    days before to 365 days after today on the department's calendar are
    added, the same date-based selection the personal shift feed makes. Each
    list is capped at ``ORG_FEED_MAX_EVENTS``.
    """
    if not _plausible_token(token):
        raise _feed_not_found()

    integration = await _integration_for_org_feed_token(db, token)
    if not integration:
        raise _feed_not_found()
    organization_id = str(integration.organization_id)

    org = (
        await db.execute(select(Organization).where(Organization.id == organization_id))
    ).scalar_one_or_none()
    org_name = org.name if org and org.name else "The Logbook"
    tz_name = org.timezone if org and org.timezone else "UTC"

    now = datetime.now(timezone.utc)
    query = (
        select(Event)
        .options(selectinload(Event.location_obj))
        .where(
            Event.organization_id == organization_id,
            or_(Event.is_draft.is_(False), Event.is_draft.is_(None)),
            Event.is_cancelled.is_(False),
            Event.end_datetime >= now - timedelta(days=ORG_FEED_PAST_DAYS),
            Event.start_datetime <= now + timedelta(days=ORG_FEED_FUTURE_DAYS),
        )
        .order_by(Event.start_datetime)
        .limit(ORG_FEED_MAX_EVENTS)
    )
    included_types = (integration.config or {}).get("included_event_types") or []
    if isinstance(included_types, list) and included_types:
        # Free-form stored config: an unknown name selects nothing rather than
        # reaching the Enum column and failing the whole feed.
        known = {t.value: t for t in EventType}
        query = query.where(
            Event.event_type.in_([known[t] for t in included_types if t in known])
        )
    events = (await db.execute(query)).scalars().all()

    frontend_url = (settings.FRONTEND_URL or "").rstrip("/")
    entries = [_org_feed_event(e, frontend_url) for e in events]
    if (integration.config or {}).get("include_shifts") is True:
        today = org_today(org)
        shifts = (
            (
                await db.execute(
                    select(Shift)
                    .where(
                        Shift.organization_id == organization_id,
                        Shift.status != ShiftStatus.CANCELLED,
                        Shift.shift_date.between(
                            today - timedelta(days=ORG_FEED_PAST_DAYS),
                            today + timedelta(days=ORG_FEED_FUTURE_DAYS),
                        ),
                    )
                    .order_by(Shift.start_time)
                    .limit(ORG_FEED_MAX_EVENTS)
                )
            )
            .scalars()
            .all()
        )
        entries.extend(_org_feed_shift(s) for s in shifts)
    ics = generate_ical_feed(
        entries,
        org_name=org_name,
        timezone_name=tz_name,
    )
    return Response(
        content=ics,
        media_type="text/calendar",
        headers={
            "Content-Disposition": 'inline; filename="events.ics"',
            "Cache-Control": "private, max-age=300",
        },
    )
