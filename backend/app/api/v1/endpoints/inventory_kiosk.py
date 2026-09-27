"""
Inventory Self-Service Kiosk Endpoints

A shared tablet opened by an officer holding ``inventory.kiosk``. Members
identify themselves by tapping their NFC ID card and check loaner gear out and
back in by tapping its tag. Mounted under ``/inventory`` behind the Inventory
module gate.

Every route needs the ``inventory.kiosk`` grant **and** the organization's
inventory NFC switch **and** the NFC ID Cards integration: the kiosk works only
by tapping cards and tags, and each switch is checked on the server.

Refusals (a card or tag the kiosk will not act on, an item the member may not
take) are ``409`` with the reason as the detail, which the kiosk shows to the
member. They are not errors in the kiosk; they are answers.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.models.user import User
from app.schemas.inventory_kiosk import (
    KioskActionResponse,
    KioskIdentifyRequest,
    KioskIdentifyResponse,
    KioskItemRequest,
    KioskPreviewResponse,
    KioskReturnRequest,
)
from app.services.inventory_kiosk_service import InventoryKioskService, KioskRefusal
from app.utils.inventory_nfc import require_inventory_nfc
from app.utils.nfc_integration import require_nfc_id_cards

router = APIRouter()


async def _require_switches(db: AsyncSession, organization_id: str) -> None:
    await require_inventory_nfc(db, organization_id)
    await require_nfc_id_cards(db, organization_id)


def _refused(e: KioskRefusal) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@router.post("/kiosk/identify", response_model=KioskIdentifyResponse)
async def kiosk_identify(
    data: KioskIdentifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.kiosk")),
):
    """Who tapped their card, and what they have out right now."""
    org_id = str(current_user.organization_id)
    await _require_switches(db, org_id)
    try:
        return await InventoryKioskService(db).identify(
            org_id, (data.card.code, data.card.serial_number)
        )
    except KioskRefusal as e:
        raise _refused(e)


@router.post("/kiosk/preview", response_model=KioskPreviewResponse)
async def kiosk_preview(
    data: KioskItemRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.kiosk")),
):
    """What tapping this item would do (check out or return), or why not."""
    org_id = str(current_user.organization_id)
    await _require_switches(db, org_id)
    try:
        return await InventoryKioskService(db).preview(
            org_id,
            (data.card.code, data.card.serial_number),
            (data.item.code, data.item.serial_number),
        )
    except KioskRefusal as e:
        raise _refused(e)


@router.post("/kiosk/checkout", response_model=KioskActionResponse)
async def kiosk_checkout(
    data: KioskItemRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.kiosk")),
):
    """Check the tapped item out to the member whose card was tapped."""
    org_id = str(current_user.organization_id)
    await _require_switches(db, org_id)
    try:
        result = await InventoryKioskService(db).checkout(
            org_id,
            str(current_user.id),
            (data.card.code, data.card.serial_number),
            (data.item.code, data.item.serial_number),
        )
    except KioskRefusal as e:
        raise _refused(e)

    await log_audit_event(
        db=db,
        event_type="inventory_kiosk_checkout",
        event_category="inventory",
        severity="info",
        event_data={
            "checkout_id": result["checkout_id"],
            "item_id": result["item_id"],
            "member_id": result["member_id"],
            "operator_id": str(current_user.id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return result


@router.post("/kiosk/return", response_model=KioskActionResponse)
async def kiosk_return(
    data: KioskReturnRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.kiosk")),
):
    """Check the tapped item back in from the member who has it."""
    org_id = str(current_user.organization_id)
    await _require_switches(db, org_id)
    try:
        result = await InventoryKioskService(db).return_item(
            org_id,
            str(current_user.id),
            (data.card.code, data.card.serial_number),
            (data.item.code, data.item.serial_number),
            damaged=data.damaged,
            damage_notes=data.damage_notes,
        )
    except KioskRefusal as e:
        raise _refused(e)

    await log_audit_event(
        db=db,
        event_type="inventory_kiosk_return",
        event_category="inventory",
        severity="warning" if data.damaged else "info",
        event_data={
            "checkout_id": result["checkout_id"],
            "item_id": result["item_id"],
            "member_id": result["member_id"],
            "operator_id": str(current_user.id),
            "damaged": data.damaged,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return result
