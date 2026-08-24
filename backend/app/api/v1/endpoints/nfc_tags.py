"""
NFC Tag API Endpoints

Member ID card (NFC) credentials, and the check-in station that reads them.

Two audiences, both of them staff:
  * officers issuing and revoking cards (``members.manage_id_cards``)
  * whoever is running a check-in station (``members.check_in``)

There is deliberately **no self-service path**. A card is a credential that
records attendance, so it is issued the way a key is: an officer binds it and
hands it over, and a member cannot register, relabel or revoke one on their
own — not even their own.

Every route here additionally requires the organization to have turned on the
``nfc-id-cards`` integration. That check is on the server, not just in the
navigation: hiding a screen leaves its endpoints reachable, and these endpoints
issue and consume credentials.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.nfc_tag import NfcTagStatus
from app.models.user import User
from app.schemas.nfc_tag import (
    NfcCheckInRequest,
    NfcCheckInResponse,
    NfcCheckInStatus,
    NfcTagCreate,
    NfcTagListResponse,
    NfcTagResponse,
    NfcTagUpdate,
)
from app.services.nfc_tag_service import NfcTagService
from app.utils.nfc_integration import require_nfc_id_cards

router = APIRouter()


@router.get("", response_model=NfcTagListResponse)
async def list_nfc_tags(
    user_id: Optional[str] = Query(
        None, description="Only cards issued to this member"
    ),
    tag_status: Optional[NfcTagStatus] = Query(
        None, alias="status", description="Only cards in this state"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """List issued ID cards for the organization."""
    await require_nfc_id_cards(db, str(current_user.organization_id))
    service = NfcTagService(db)
    items, total = await service.list_tags(
        str(current_user.organization_id), user_id=user_id, status=tag_status
    )
    return {"items": items, "total": total}


@router.post("", response_model=NfcTagResponse, status_code=status.HTTP_201_CREATED)
async def register_nfc_tag(
    data: NfcTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """Bind a physical card to a member."""
    await require_nfc_id_cards(db, str(current_user.organization_id))
    service = NfcTagService(db)
    try:
        tag = await service.register_tag(
            organization_id=str(current_user.organization_id),
            user_id=data.user_id,
            tag_uid=data.tag_uid,
            label=data.label,
            issued_by=str(current_user.id),
            credential_type=data.credential_type,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    await log_audit_event(
        db=db,
        event_type="nfc_tag_issued",
        event_category="members",
        severity="info",
        event_data={
            "tag_id": tag["id"],
            "member_id": data.user_id,
            "uid_preview": tag["uid_preview"],
            "credential_type": data.credential_type.value,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return tag


@router.patch("/{tag_id}", response_model=NfcTagResponse)
async def update_nfc_tag(
    tag_id: str,
    data: NfcTagUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """Relabel a card, or suspend / report it lost / revoke it."""
    await require_nfc_id_cards(db, str(current_user.organization_id))
    service = NfcTagService(db)
    updates = data.model_dump(exclude_unset=True)
    try:
        tag = await service.update_tag(
            tag_id, str(current_user.organization_id), updates
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    if "status" in updates:
        await log_audit_event(
            db=db,
            event_type="nfc_tag_status_changed",
            event_category="members",
            severity="warning",
            event_data={
                "tag_id": tag_id,
                "member_id": tag["user_id"],
                # `.value` rather than str(): a (str, Enum) member stringifies
                # as "NfcTagStatus.LOST", which is not what an audit reader is
                # looking for and does not match the stored column.
                "new_status": updates["status"].value,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_nfc_tag(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """Remove a card registration entirely."""
    await require_nfc_id_cards(db, str(current_user.organization_id))
    service = NfcTagService(db)
    deleted = await service.delete_tag(tag_id, str(current_user.organization_id))
    if not deleted:
        raise HTTPException(status_code=404, detail="Card not found")

    await log_audit_event(
        db=db,
        event_type="nfc_tag_deleted",
        event_category="members",
        severity="warning",
        event_data={"tag_id": tag_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )


@router.post("/check-in", response_model=NfcCheckInResponse)
async def station_check_in(
    data: NfcCheckInRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.check_in")),
):
    """Record a card tap at a check-in station.

    Domain outcomes — an unregistered card, a member already checked in, a
    closed check-in window — come back as a 200 carrying ``status``, because
    the station has to draw each of them on screen and a kiosk that throws is
    a kiosk somebody has to walk over and restart. A target that does not
    exist is a caller error and still raises.
    """
    await require_nfc_id_cards(db, str(current_user.organization_id))
    service = NfcTagService(db)
    try:
        result = await service.check_in(
            organization_id=str(current_user.organization_id),
            tag_uid=data.tag_uid,
            tag_payload=data.tag_payload,
            target_type=data.target_type,
            target_id=data.target_id,
            direction=data.direction,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=safe_error_detail(e))

    if result["status"] in (
        NfcCheckInStatus.CHECKED_IN,
        NfcCheckInStatus.CHECKED_OUT,
    ):
        await log_audit_event(
            db=db,
            event_type="nfc_station_check_in",
            event_category="members",
            severity="info",
            event_data={
                "target_type": data.target_type.value,
                "target_id": data.target_id,
                "member_id": result.get("user_id"),
                "outcome": result["status"].value,
                "operator_id": str(current_user.id),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return result
