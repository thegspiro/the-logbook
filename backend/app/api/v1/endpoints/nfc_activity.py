"""
NFC Activity Endpoints

Where member ID cards were tapped, seen from the two areas that own the place a
tap happens rather than the card that made it:

  * **Facilities** — which rooms have a reader, and how each is being used
    (``locations.manage``, ``facilities.manage`` or
    ``locations.manage_nfc_tags``; switching a reader stays on
    ``PUT /locations/{id}/badge-check-in``).
  * **Events** — the card taps that checked members in or out of events
    (``events.manage``, the grant every other attendance screen requires).

Both read the tap log the Member ID Cards page writes. A room manager sees that
a tap happened and how it ended; whose card it was is shown only to a viewer
who also holds ``members.manage_id_cards``, so facilities staff do not gain a
who-was-where log they were never given. Event managers already see each
event's attendance by name, so the event views name members.

Not gated on the NFC ID Cards switch: a department that turned cards off still
has the taps it recorded while they were on, and the reader list is where it
finds the rooms whose switch it may want to turn off.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission, user_has_permission
from app.core.database import get_db
from app.models.event import Event
from app.models.nfc_tag import NfcCheckInStatus, NfcCheckInTarget, NfcTapSource
from app.models.user import User
from app.schemas.nfc_tag import NfcCardTapListResponse, NfcReaderListResponse
from app.services.nfc_card_admin_service import (
    READER_SUMMARY_DAYS,
    NfcCardAdminService,
)
from app.utils.nfc_integration import nfc_id_cards_enabled
from app.utils.org_scoping import assert_in_org

router = APIRouter()

_READER_VIEW = ("locations.manage", "facilities.manage", "locations.manage_nfc_tags")


@router.get("/readers", response_model=NfcReaderListResponse)
async def list_card_readers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_READER_VIEW)),
):
    """Every active room, its reader switch, and its kiosk taps this week."""
    org_id = str(current_user.organization_id)
    service = NfcCardAdminService(db)
    return {
        "items": await service.reader_summary(org_id),
        "days": READER_SUMMARY_DAYS,
        "cards_enabled": await nfc_id_cards_enabled(db, org_id),
        "can_switch": user_has_permission(current_user, "locations.manage_nfc_tags"),
        "can_see_members": user_has_permission(current_user, "members.manage_id_cards"),
    }


@router.get("/readers/{location_id}/taps", response_model=NfcCardTapListResponse)
async def list_card_reader_taps(
    location_id: UUID,
    outcome: Optional[NfcCheckInStatus] = Query(None),
    since: Optional[datetime] = Query(None, description="UTC, inclusive"),
    until: Optional[datetime] = Query(None, description="UTC, exclusive"),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_READER_VIEW)),
):
    """Kiosk taps in one room, newest first."""
    org_id = str(current_user.organization_id)
    service = NfcCardAdminService(db)
    if await service.get_location(str(location_id), org_id) is None:
        raise HTTPException(status_code=404, detail="Location not found")
    items, total = await service.list_taps(
        org_id,
        location_id=str(location_id),
        source=NfcTapSource.KIOSK,
        outcome=outcome,
        since=since,
        until=until,
        include_identity=user_has_permission(current_user, "members.manage_id_cards"),
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/event-taps", response_model=NfcCardTapListResponse)
async def list_event_card_taps(
    event_id: Optional[UUID] = Query(None, description="Only this event's taps"),
    outcome: Optional[NfcCheckInStatus] = Query(None),
    source: Optional[NfcTapSource] = Query(None),
    since: Optional[datetime] = Query(None, description="UTC, inclusive"),
    until: Optional[datetime] = Query(None, description="UTC, exclusive"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Card taps against events, from stations and room kiosks alike.

    A kiosk tap the room turned away before choosing an event (none open, or
    two at once) belongs to no event and appears only on the Card Readers page.
    """
    org_id = str(current_user.organization_id)
    if event_id is not None:
        try:
            await assert_in_org(db, Event, str(event_id), org_id, label="Event")
        except ValueError:
            raise HTTPException(status_code=404, detail="Event not found")
    items, total = await NfcCardAdminService(db).list_taps(
        org_id,
        target_type=NfcCheckInTarget.EVENT,
        target_id=str(event_id) if event_id else None,
        outcome=outcome,
        source=source,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}
