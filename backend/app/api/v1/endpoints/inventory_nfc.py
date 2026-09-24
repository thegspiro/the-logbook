"""
Inventory NFC Tag API Endpoints

NFC tags attached to inventory items: linking them, and resolving a tap back
to the item. Mounted under ``/inventory`` behind the Inventory module gate, in
a file of its own so the NFC surface can be read (and its gates tested) in one
place rather than inside the 7,000-line inventory router.

Every route also requires the organization to have switched NFC tracking on
(``inventory.nfc_tracking_enabled``), checked on the server — except
``GET /nfc/settings``, which is how the screens find out whether it is on.

Permissions follow the barcode flow they sit beside: resolving a tag is
``inventory.view``, like ``GET /inventory/lookup``; changing which tags an item
carries is ``inventory.manage``.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.inventory import ScanLookupResponse
from app.schemas.inventory_nfc import (
    InventoryNfcResolveRequest,
    InventoryNfcSettingsResponse,
    InventoryNfcTagCreate,
    InventoryNfcTagListResponse,
    InventoryNfcTagResponse,
    InventoryNfcTagUpdate,
)
from app.services.inventory_nfc_service import (
    InventoryNfcService,
    InventoryNfcTagNotFound,
)
from app.utils.inventory_nfc import inventory_nfc_enabled, require_inventory_nfc

router = APIRouter()


@router.get("/nfc/settings", response_model=InventoryNfcSettingsResponse)
async def get_inventory_nfc_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """Whether NFC tag tracking is switched on for this organization."""
    enabled = await inventory_nfc_enabled(db, str(current_user.organization_id))
    return {"enabled": enabled}


@router.post("/nfc/resolve", response_model=ScanLookupResponse)
async def resolve_inventory_nfc_tag(
    data: InventoryNfcResolveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """Find the item a tapped tag is linked to.

    Returns the same shape as ``GET /inventory/lookup`` so the scan screens can
    treat a tap exactly like a scanned barcode. An exact match only — never
    the lookup's partial match, which would let a short serial name the wrong
    item.
    """
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        tag, item = await service.resolve(org_id, (data.code, data.serial_number))
    except InventoryNfcTagNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    return ScanLookupResponse(
        item=item,
        matched_field="nfc_tag",
        matched_value=f"NFC tag …{tag.uid_preview}",
    )


@router.get("/items/{item_id}/nfc-tags", response_model=InventoryNfcTagListResponse)
async def list_item_nfc_tags(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """List the tags linked to one item."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        items = await service.list_item_tags(item_id, org_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"items": items, "total": len(items)}


@router.post(
    "/items/{item_id}/nfc-tags",
    response_model=InventoryNfcTagResponse,
    status_code=status.HTTP_201_CREATED,
)
async def link_item_nfc_tag(
    item_id: str,
    data: InventoryNfcTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Link a tag to an item."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        tag = await service.link_tag(
            organization_id=org_id,
            item_id=item_id,
            tag_uid=data.tag_uid,
            credential_type=data.credential_type,
            label=data.label,
            linked_by=str(current_user.id),
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    await log_audit_event(
        db=db,
        event_type="inventory_nfc_tag_linked",
        event_category="inventory",
        severity="info",
        event_data={
            "tag_id": tag["id"],
            "item_id": item_id,
            "uid_preview": tag["uid_preview"],
            "credential_type": data.credential_type.value,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return tag


@router.patch("/nfc-tags/{tag_id}", response_model=InventoryNfcTagResponse)
async def update_inventory_nfc_tag(
    tag_id: str,
    data: InventoryNfcTagUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Relabel a tag, or mark it lost or found."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    updates = data.model_dump(exclude_unset=True)
    try:
        tag = await service.update_tag(tag_id, org_id, updates)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    if "status" in updates:
        await log_audit_event(
            db=db,
            event_type="inventory_nfc_tag_status_changed",
            event_category="inventory",
            severity="info",
            event_data={
                "tag_id": tag_id,
                "item_id": tag["item_id"],
                "new_status": tag["status"].value,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return tag


@router.delete("/nfc-tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_inventory_nfc_tag(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Unlink a tag from its item, freeing it to be linked again."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        removed = await service.unlink_tag(tag_id, org_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))

    await log_audit_event(
        db=db,
        event_type="inventory_nfc_tag_unlinked",
        event_category="inventory",
        severity="info",
        event_data={
            "tag_id": tag_id,
            "item_id": removed["item_id"],
            "uid_preview": removed["uid_preview"],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
