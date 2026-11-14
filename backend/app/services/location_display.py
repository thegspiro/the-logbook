"""
The room display payload, built once for both of its endpoints.

Two endpoints report what is on in a room right now: the public kiosk
(``GET /api/public/v1/display/{display_code}``, a tablet left in the room with
no session) and the authenticated ``GET /api/v1/locations/{id}/display``
(``RoomCheckInPage``, where a room's NFC tag lands a member's phone). Each used
to construct ``LocationDisplayInfo`` and its ``QRCheckInData`` rows field by
field, the two copies filled different subsets, and that kind of drift is how
LOC-1 (a check-in window computed two ways) happened. LOC-40, owner decision
2026-11-01: one builder.

What stays different is a parameter, not a second copy — see
``recheck_window`` on :func:`build_location_display`.

Everything here is served without a session, so it carries only what the kiosk
already showed: no event description (LOC5-32-1 — the room reports whatever
event is physically using it, with no audience filter on top), no training
credit flags, and no member's own check-in times, which leave those
``QRCheckInData`` fields at their defaults.
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.location import Location
from app.models.user import Organization
from app.schemas.event import QRCheckInData
from app.schemas.location import LocationDisplayInfo
from app.services.event_service import EventService
from app.utils.nfc_integration import nfc_id_cards_enabled


async def build_location_display(
    db: AsyncSession,
    location: Location,
    events: Sequence[Event],
    *,
    recheck_window: bool,
) -> LocationDisplayInfo:
    """Build the display payload for ``location`` from its in-window ``events``.

    ``events`` must come from
    ``LocationService.get_current_events_in_check_in_window``, which keeps only
    events whose strict window (``check_in_start <= now <= check_in_end``) is
    open.

    ``recheck_window`` is the one deliberate difference between the callers:

    - ``True`` (public kiosk) re-evaluates each event with
      ``EventService._validate_check_in_window`` against the clock now, the
      same permissive rule the check-in endpoint enforces, and reports its
      answer as both ``is_valid`` and ``can_check_in``. A kiosk polls and
      keeps a stale answer on screen, so it asks the authoritative rule.
    - ``False`` (authenticated room page) reports both as ``True``: the
      selection already applied the strict window, and the permissive rule
      admits a superset of it, so anything listed can be checked into.
    """
    now = datetime.now(timezone.utc)
    event_service = EventService(db) if recheck_window else None

    current_events = []
    for event in events:
        check_in_start, check_in_end = EventService._get_check_in_window(event)
        if event_service is not None:
            can_check_in, _error, _notice = event_service._validate_check_in_window(
                event, now
            )
        else:
            can_check_in = True

        current_events.append(
            QRCheckInData(
                event_id=str(event.id),
                event_name=event.title,
                event_type=event.event_type.value if event.event_type else None,
                event_description=None,
                start_datetime=event.start_datetime.isoformat(),
                end_datetime=event.end_datetime.isoformat(),
                actual_end_time=(
                    event.actual_end_time.isoformat() if event.actual_end_time else None
                ),
                check_in_start=check_in_start.isoformat(),
                check_in_end=check_in_end.isoformat(),
                is_valid=can_check_in,
                can_check_in=can_check_in,
                location=event.location,
                location_id=str(event.location_id) if event.location_id else None,
                location_name=location.name,
                require_checkout=event.require_checkout or False,
                allow_guest_check_in=event.allow_guest_check_in or False,
            ).model_dump()
        )

    # The department's zone, so a caller with no profile (the kiosk) renders
    # these UTC times in department-local time rather than the device's zone,
    # which on a wall-mounted tablet is commonly UTC out of the box.
    org_timezone = (
        await db.execute(
            select(Organization.timezone).where(
                Organization.id == location.organization_id
            )
        )
    ).scalar_one_or_none()

    # The room's own switch first, so a room that never turned badge check-in
    # on costs no integration lookup.
    badge_check_in_enabled = bool(
        location.nfc_badge_check_in_enabled
    ) and await nfc_id_cards_enabled(db, location.organization_id)

    return LocationDisplayInfo(
        location_id=UUID(location.id),
        location_name=location.name,
        current_events=current_events,
        has_overlap=len(current_events) > 1,
        timezone=org_timezone,
        badge_check_in_enabled=badge_check_in_enabled,
    )
