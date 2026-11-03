"""
Public Event Guest Sign-In API Endpoint

The same guest sign-in a room kiosk offers (see ``app/api/public/display.py``),
reached through the event's own guest QR code instead of a room's display
code, so an event held somewhere with no kiosk — an outside venue, a parking
lot open house — can still let visitors record their attendance.

The path's token (``Event.guest_check_in_token``) is the only credential and
names exactly one event, so it — never the request — decides the event and the
organization. A manager issues it, and rotates it to revoke a printed code.

Every gate is the kiosk path's own: this module imports the window, finalized
and email-first checks and the per-IP rate limits from ``display.py`` rather
than restating them, so the two entrances cannot drift apart, and spends the
same per-event daily ceilings, so a caller gains no allowance by alternating
between them. The handlers keep the kiosk handlers' ordering — honeypot, then
every rejection gate, then the daily cap, then the write — for the reason
given there: the cap is spent by asking, so a refusal must come first.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.public.display import (
    _assert_guest_sign_in_open,
    _rate_limit_display,
    _rate_limit_guest_check_in,
    _rate_limit_guest_lookup,
    _require_email_first,
)
from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.database import get_db
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.core.security_middleware import daily_cap_exceeded, get_client_ip
from app.core.utils import safe_error_detail
from app.models.event import Event
from app.models.user import Organization
from app.schemas.event import (
    GuestCheckInEventInfo,
    GuestCheckInRequest,
    GuestCheckInResponse,
    GuestConfirmRequest,
    GuestLookupRequest,
    GuestLookupResponse,
)
from app.services.guest_check_in_service import GuestCheckInService

router = APIRouter(prefix="/public/v1/event-guest", tags=["public-event-guest"])

# Declared on every route so the OpenAPI schema states the shape the service
# checks; the service still rejects anything else with the same 404.
GuestToken = Path(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]+$")


async def _resolve_link_event(
    db: AsyncSession, guest_token: str
) -> tuple[Event, Optional[Organization]]:
    """Resolve the event a guest QR code names.

    Every failure answers the same 404 the kiosk path does, so the endpoint
    cannot be used to learn whether a token was ever issued, or whether the
    event behind it has since been cancelled or had guest sign-in switched off.
    """
    event = await GuestCheckInService(db).get_event_by_link_token(guest_token)
    if event is None:
        raise CodedHTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sign-in is not available for this event.",
            error_code=ErrorCode.EVT_SIGNIN_UNAVAILABLE,
        )
    org = (
        await db.execute(
            select(Organization).where(Organization.id == event.organization_id)
        )
    ).scalar_one_or_none()
    return event, org


def _location_name(event: Event) -> Optional[str]:
    """The room's name when the event has one, else its free-text venue."""
    if event.location_obj is not None:
        return event.location_obj.name
    return event.location


@router.get(
    "/{guest_token}/guest",
    response_model=GuestCheckInEventInfo,
    dependencies=[Depends(_rate_limit_display)],
)
async def get_link_guest_check_in_info(
    guest_token: str = GuestToken,
    db: AsyncSession = Depends(get_db),
):
    """
    Get the event detail shown on the guest sign-in page (public, no auth).

    The same fields the kiosk path discloses: name, type, time and venue, plus
    whether sign-in is open. The description is withheld.
    """
    event, org = await _resolve_link_event(db, guest_token)

    is_open, closed_reason = GuestCheckInService.guest_sign_in_state(
        event, datetime.now(timezone.utc)
    )

    return GuestCheckInEventInfo(
        event_id=str(event.id),
        event_name=event.title,
        event_type=event.event_type.value if event.event_type else None,
        start_datetime=event.start_datetime.isoformat(),
        end_datetime=event.end_datetime.isoformat(),
        location_name=_location_name(event),
        organization_name=org.name if org else None,
        is_open=is_open,
        closed_reason=closed_reason,
        collects_prospect_details=bool(event.guest_check_in_creates_prospect),
        timezone=org.timezone if org else None,
    )


@router.post(
    "/{guest_token}/guest-check-in",
    response_model=GuestCheckInResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rate_limit_guest_check_in)],
)
async def link_guest_check_in(
    payload: GuestCheckInRequest,
    request: Request,
    guest_token: str = GuestToken,
    db: AsyncSession = Depends(get_db),
):
    """
    Record a non-member's attendance through the event's guest QR code (public).

    Creates an external-attendee record. A pipeline-linked event refuses this
    typed form exactly as the kiosk does; its guests use guest-lookup and
    guest-confirm.
    """
    event, _org = await _resolve_link_event(db, guest_token)

    # Honeypot: a plausible success, so a bot has no signal to adapt to.
    if payload.hp_website:
        return GuestCheckInResponse(
            status="checked_in",
            attendee_id=str(UUID(int=0)),
            event_name=event.title,
            checked_in_at=datetime.now(timezone.utc).isoformat(),
            message="Thanks for signing in!",
        )

    if event.guest_check_in_creates_prospect:
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please see a member of staff to sign in.",
            error_code=ErrorCode.EVT_GUEST_STAFF_REQUIRED,
        )

    _assert_guest_sign_in_open(event)

    if await daily_cap_exceeded(
        f"guest_checkin:{event.id}", settings.GUEST_CHECK_IN_DAILY_LIMIT
    ):
        raise CodedHTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="This event is not accepting further sign-ins today.",
            error_code=ErrorCode.EVT_SIGNIN_DAILY_LIMIT,
        )

    service = GuestCheckInService(db)
    try:
        attendee, error, prospect_created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name=payload.first_name,
            last_name=payload.last_name,
            email=str(payload.email) if payload.email else None,
            phone=payload.phone,
            organization_name=payload.organization_name,
            interest_reason=payload.interest_reason,
            source=GuestCheckInService.SOURCE_EVENT_QR,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(exc)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(exc),
        )

    if error or attendee is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "Unable to record sign-in.",
        )

    await log_audit_event(
        db=db,
        event_type="event_guest_checkin",
        event_category="events",
        severity="info",
        event_data={
            "event_id": str(event.id),
            "attendee_id": attendee.id,
            "location_id": event.location_id,
            "prospect_created": prospect_created,
            "source": GuestCheckInService.SOURCE_EVENT_QR,
        },
        organization_id=event.organization_id,
        ip_address=get_client_ip(request),
    )

    return GuestCheckInResponse(
        status="checked_in",
        attendee_id=attendee.id,
        event_name=event.title,
        checked_in_at=(
            attendee.checked_in_at.isoformat() if attendee.checked_in_at else ""
        ),
        message=f"You're signed in to {event.title}.",
    )


@router.post(
    "/{guest_token}/guest-lookup",
    response_model=GuestLookupResponse,
    dependencies=[Depends(_rate_limit_guest_lookup)],
)
async def link_guest_lookup(
    payload: GuestLookupRequest,
    request: Request,
    guest_token: str = GuestToken,
    db: AsyncSession = Depends(get_db),
):
    """
    Recognise a returning applicant by email (public, no auth required).

    The kiosk's first step at a pipeline-linked event. Writes no attendance;
    the confirm token it issues is bound to this event and to the guest QR
    code rather than a room, so it cannot be replayed at a kiosk.
    """
    event, _org = await _resolve_link_event(db, guest_token)
    _require_email_first(event)

    not_found_message = "We couldn't find you. Please see a member of staff to sign in."

    if payload.hp_website:
        return GuestLookupResponse(
            status=GuestCheckInService.LOOKUP_NOT_FOUND, message=not_found_message
        )

    _assert_guest_sign_in_open(event)
    if await daily_cap_exceeded(
        f"guest_lookup:{event.id}", settings.GUEST_CHECK_IN_DAILY_LIMIT
    ):
        raise CodedHTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="This event is not accepting further sign-ins today.",
            error_code=ErrorCode.EVT_SIGNIN_DAILY_LIMIT,
        )

    service = GuestCheckInService(db)
    outcome, prospect = await service.lookup_guest(
        event.organization_id, str(payload.email)
    )

    # Audited matched or not, as at the kiosk: a run of misses is what probing
    # looks like. The email is not recorded; the prospect id says who matched.
    await log_audit_event(
        db=db,
        event_type="event_guest_lookup",
        event_category="events",
        severity="info",
        event_data={
            "event_id": str(event.id),
            "location_id": event.location_id,
            "outcome": outcome,
            "prospect_id": prospect.id if prospect is not None else None,
            "source": GuestCheckInService.SOURCE_EVENT_QR,
        },
        organization_id=event.organization_id,
        ip_address=get_client_ip(request),
    )

    if prospect is not None:
        return GuestLookupResponse(
            status=outcome,
            display_name=GuestCheckInService.short_name(
                prospect.first_name, prospect.last_name
            ),
            confirm_token=GuestCheckInService.issue_confirm_token(
                prospect_id=prospect.id,
                event_id=str(event.id),
                location_id=None,
                organization_id=event.organization_id,
            ),
            message="Welcome back! Please confirm this is you.",
        )
    if outcome == GuestCheckInService.LOOKUP_MEMBER:
        return GuestLookupResponse(
            status=outcome,
            message=(
                "This looks like a department member account. "
                "Please scan the event's member check-in QR code instead."
            ),
        )
    return GuestLookupResponse(status=outcome, message=not_found_message)


@router.post(
    "/{guest_token}/guest-confirm",
    response_model=GuestCheckInResponse,
    dependencies=[Depends(_rate_limit_guest_check_in)],
)
async def link_guest_confirm(
    payload: GuestConfirmRequest,
    request: Request,
    guest_token: str = GuestToken,
    db: AsyncSession = Depends(get_db),
):
    """
    Sign in an applicant who confirmed the lookup recognised them (public).

    Takes only the token guest-lookup issued through this guest QR code, for
    this event, within ten minutes.
    """
    event, _org = await _resolve_link_event(db, guest_token)
    _require_email_first(event)
    _assert_guest_sign_in_open(event)

    prospect_id = GuestCheckInService.read_confirm_token(
        payload.confirm_token,
        event_id=str(event.id),
        location_id=None,
        organization_id=event.organization_id,
    )
    if prospect_id is None:
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This confirmation has expired. Please enter your email again.",
            error_code=ErrorCode.EVT_SIGNIN_UNAVAILABLE,
        )

    if await daily_cap_exceeded(
        f"guest_checkin:{event.id}", settings.GUEST_CHECK_IN_DAILY_LIMIT
    ):
        raise CodedHTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="This event is not accepting further sign-ins today.",
            error_code=ErrorCode.EVT_SIGNIN_DAILY_LIMIT,
        )

    service = GuestCheckInService(db)
    try:
        attendee, error, already_checked_in = await service.check_in_known_prospect(
            event=event,
            organization_id=event.organization_id,
            prospect_id=prospect_id,
            source=GuestCheckInService.SOURCE_EVENT_QR,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(exc)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(exc),
        )

    if error or attendee is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "Unable to record sign-in.",
        )

    if not already_checked_in:
        await log_audit_event(
            db=db,
            event_type="event_guest_checkin",
            event_category="events",
            severity="info",
            event_data={
                "event_id": str(event.id),
                "attendee_id": attendee.id,
                "location_id": event.location_id,
                "prospect_id": prospect_id,
                "prospect_created": False,
                "source": GuestCheckInService.SOURCE_EVENT_QR,
            },
            organization_id=event.organization_id,
            ip_address=get_client_ip(request),
        )

    return GuestCheckInResponse(
        status="already_checked_in" if already_checked_in else "checked_in",
        attendee_id=attendee.id,
        event_name=event.title,
        checked_in_at=(
            attendee.checked_in_at.isoformat() if attendee.checked_in_at else ""
        ),
        message=(
            f"You're already checked in to {event.title}."
            if already_checked_in
            else f"You're signed in to {event.title}."
        ),
    )
