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

import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.nfc_tag import NfcTagStatus, NfcTapSource
from app.models.user import User
from app.schemas.nfc_tag import (
    NfcCardTapListResponse,
    NfcCheckInRequest,
    NfcCheckInResponse,
    NfcCheckInStatus,
    NfcCoverageResponse,
    NfcIdCardSettingsResponse,
    NfcIdCardSettingsUpdate,
    NfcTagBulkStatusRequest,
    NfcTagBulkStatusResponse,
    NfcTagCreate,
    NfcTagListResponse,
    NfcTagResponse,
    NfcTagUpdate,
)
from app.services.nfc_card_admin_service import (
    DEFAULT_UNUSED_DAYS,
    MAX_EXPORT_ROWS,
    NfcCardAdminService,
)
from app.services.nfc_tag_service import NfcTagService
from app.utils.csv_export import SafeCsvWriter
from app.utils.nfc_integration import require_nfc_id_cards
from app.utils.org_timezone import resolve_scheduling_timezone, to_local

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


@router.get("/coverage", response_model=NfcCoverageResponse)
async def get_nfc_card_coverage(
    unused_days: int = Query(DEFAULT_UNUSED_DAYS, ge=1, le=3650),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """Members with no working card, cards nobody uses, cards held by leavers."""
    await require_nfc_id_cards(db, str(current_user.organization_id))
    return await NfcCardAdminService(db).coverage(
        str(current_user.organization_id), unused_days=unused_days
    )


@router.get("/taps", response_model=NfcCardTapListResponse)
async def list_nfc_card_taps(
    tag_id: Optional[str] = Query(None, max_length=36),
    user_id: Optional[str] = Query(None, max_length=36),
    outcome: Optional[NfcCheckInStatus] = Query(None),
    source: Optional[NfcTapSource] = Query(None),
    since: Optional[datetime] = Query(None, description="UTC, inclusive"),
    until: Optional[datetime] = Query(None, description="UTC, exclusive"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """The tap log, newest first. Refused taps are included."""
    await require_nfc_id_cards(db, str(current_user.organization_id))
    items, total = await NfcCardAdminService(db).list_taps(
        str(current_user.organization_id),
        tag_id=tag_id,
        user_id=user_id,
        outcome=outcome,
        source=source,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


_OUTCOME_LABELS = {
    NfcCheckInStatus.CHECKED_IN: "Checked in",
    NfcCheckInStatus.CHECKED_OUT: "Checked out",
    NfcCheckInStatus.ALREADY_CHECKED_IN: "Already checked in",
    NfcCheckInStatus.ALREADY_CHECKED_OUT: "Already checked out",
    NfcCheckInStatus.UNKNOWN_CARD: "Unknown card",
    NfcCheckInStatus.CARD_INACTIVE: "Card not active",
    NfcCheckInStatus.MEMBER_INACTIVE: "Member not active",
    NfcCheckInStatus.REFUSED: "Refused",
}


@router.get("/taps/export")
async def export_nfc_card_taps(
    tag_id: Optional[str] = Query(None, max_length=36),
    user_id: Optional[str] = Query(None, max_length=36),
    outcome: Optional[NfcCheckInStatus] = Query(None),
    source: Optional[NfcTapSource] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """The filtered tap log as a CSV, capped at ``MAX_EXPORT_ROWS``.

    It names members and where they were, so it is audited like the other
    roster exports. Built in memory: the cap bounds it to about a megabyte.
    """
    await require_nfc_id_cards(db, str(current_user.organization_id))
    items, total = await NfcCardAdminService(db).list_taps(
        str(current_user.organization_id),
        tag_id=tag_id,
        user_id=user_id,
        outcome=outcome,
        source=source,
        since=since,
        until=until,
        limit=MAX_EXPORT_ROWS,
    )

    tz = await resolve_scheduling_timezone(db, current_user.organization_id)
    output = io.StringIO()
    writer = SafeCsvWriter(output)
    writer.writerow(
        [
            "Time",
            "Outcome",
            "Member",
            "Card",
            "Reader",
            "Room",
            "Checked into",
            "Operator",
        ]
    )
    for row in items:
        if row["card_uid_preview"]:
            card = f"{row['card_label'] or 'ID card'} …{row['card_uid_preview']}"
        elif row["unknown_card_key"]:
            card = f"Unknown card {row['unknown_card_key']}"
        else:
            card = ""
        writer.writerow(
            [
                to_local(row["tapped_at"], tz).strftime("%Y-%m-%d %H:%M %Z"),
                _OUTCOME_LABELS.get(row["outcome"], row["outcome"].value),
                row["member_name"] or "",
                card,
                "Room kiosk" if row["source"] == NfcTapSource.KIOSK else "Station",
                row["location_name"] or "",
                row["target_name"] or "",
                row["operator_name"] or "",
            ]
        )

    await log_audit_event(
        db=db,
        event_type="nfc_card_taps_exported",
        event_category="members",
        severity="info",
        event_data={
            "rows": len(items),
            "total": total,
            "tag_id": tag_id,
            "member_id": user_id,
            "outcome": outcome.value if outcome else None,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="id_card_taps.csv"'},
    )


@router.post("/bulk-status", response_model=NfcTagBulkStatusResponse)
async def bulk_update_nfc_tag_status(
    data: NfcTagBulkStatusRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """Suspend, reactivate, report lost or revoke several cards at once.

    Cards the lifecycle rules refuse are returned under ``failed`` and the rest
    still change, so one lost card in a selection does not block the others.
    """
    await require_nfc_id_cards(db, str(current_user.organization_id))
    updated, failed = await NfcCardAdminService(db).bulk_update_status(
        str(current_user.organization_id),
        data.tag_ids,
        data.status,
        data.revoked_reason,
    )
    for card in updated:
        await log_audit_event(
            db=db,
            event_type="nfc_tag_status_changed",
            event_category="members",
            severity="warning",
            event_data={
                "tag_id": card["id"],
                "member_id": card["user_id"],
                "new_status": data.status.value,
                "bulk": True,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return {"updated": updated, "failed": failed}


@router.get("/settings", response_model=NfcIdCardSettingsResponse)
async def get_nfc_id_card_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """The department's ID-card settings: today, how long taps are kept."""
    await require_nfc_id_cards(db, str(current_user.organization_id))
    return await NfcCardAdminService(db).get_settings(str(current_user.organization_id))


@router.put("/settings", response_model=NfcIdCardSettingsResponse)
async def update_nfc_id_card_settings(
    data: NfcIdCardSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage_id_cards")),
):
    """Change how long the tap log is kept. Takes effect at the next purge."""
    await require_nfc_id_cards(db, str(current_user.organization_id))
    service = NfcCardAdminService(db)
    before = await service.get_settings(str(current_user.organization_id))
    result = await service.update_settings(
        str(current_user.organization_id),
        tap_retention_months=data.tap_retention_months,
    )
    await log_audit_event(
        db=db,
        event_type="nfc_id_card_settings_changed",
        event_category="members",
        severity="info",
        event_data={
            "tap_retention_months": {
                "from": before["tap_retention_months"],
                "to": data.tap_retention_months,
            }
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return result


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
            operator_id=str(current_user.id),
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
