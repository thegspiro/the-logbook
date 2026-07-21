"""
Public Calendar (ICS) Feed Endpoint

Serves a member's personal read-only shift calendar as an RFC 5545 ICS feed,
so it can be subscribed to from Google/Apple Calendar/Outlook. Those clients
cannot authenticate with cookies, so the feed is protected by an unguessable
per-user token embedded in the URL instead of a login.

Only the member's own shift times/notes are exposed — no other members' data.
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.models.user import Organization
from app.services.integration_services.ical_service import generate_ical_feed
from app.services.scheduling_service import SchedulingService

router = APIRouter(prefix="/public/v1/calendar", tags=["public-calendar"])

# How far back/ahead the feed covers. Calendar apps re-poll, so a bounded
# window keeps the payload small while staying useful.
FEED_PAST_DAYS = 60
FEED_FUTURE_DAYS = 365


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


@router.get("/{token}.ics", dependencies=[Depends(_rate_limit_feed)])
async def get_personal_calendar_feed(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Return the member's shifts as an ICS feed (public, token-protected)."""
    # Token is base64url from secrets.token_urlsafe(48); reject anything that
    # can't be one before touching the DB.
    if not token or len(token) < 32 or len(token) > 64:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found"
        )

    service = SchedulingService(db)
    user = await service.get_user_by_calendar_token(token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found"
        )

    org = (
        await db.execute(
            select(Organization).where(Organization.id == str(user.organization_id))
        )
    ).scalar_one_or_none()
    org_name = org.name if org and org.name else "The Logbook"
    tz_name = org.timezone if org and org.timezone else "UTC"

    # Wall-clock "today" is fine here; the window is deliberately wide.
    today = date.today()
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
