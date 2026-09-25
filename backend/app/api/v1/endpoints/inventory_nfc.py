"""
Inventory NFC Tag API Endpoints

NFC tags attached to inventory items and storage areas: linking them,
resolving a tap back to what it names, putting items away on a shelf by tap,
and the staff tap log. Mounted under ``/inventory`` behind the Inventory module gate, in
a file of its own so the NFC surface can be read (and its gates tested) in one
place rather than inside the 7,000-line inventory router.

Every route also requires the organization to have switched NFC tracking on
(``inventory.nfc_tracking_enabled``), checked on the server — except
``GET /nfc/settings``, which is how the screens find out whether it is on.

Permissions follow the barcode flow they sit beside: resolving a tag is
``inventory.view``, like ``GET /inventory/lookup``; changing which tags an item
carries, moving an item, and reading the tap log are ``inventory.manage``.

Shelf audits, the member ID card lookup and the bulk-enrollment list are
``inventory.manage`` too: each is a quartermaster's tool. The card lookup also
requires the NFC ID Cards integration, because it reads that integration's
credentials.

Only taps by ``inventory.manage`` holders are written to the tap log. A member
opening a written tag from their own phone is resolved but not recorded —
logging everyone would turn an equipment trail into a record of where each
member was.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission, user_has_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.inventory import InventoryNfcScanAction
from app.models.user import User
from app.schemas.inventory import ScanLookupResponse
from app.schemas.inventory_nfc import (
    InventoryAuditScheduleListResponse,
    InventoryAuditScheduleRow,
    InventoryAuditScheduleUpdate,
    InventoryNfcAuditApply,
    InventoryNfcAuditCreate,
    InventoryNfcAuditDetail,
    InventoryNfcAuditListResponse,
    InventoryNfcMemberResponse,
    InventoryNfcPutAwayRequest,
    InventoryNfcPutAwayResponse,
    InventoryNfcResolveAnyRequest,
    InventoryNfcResolveAnyResponse,
    InventoryNfcResolveRequest,
    InventoryNfcScanListResponse,
    InventoryNfcSettingsResponse,
    InventoryNfcTagCreate,
    InventoryNfcTagListResponse,
    InventoryNfcTagResponse,
    InventoryNfcTagUpdate,
    InventoryNfcUntaggedListResponse,
)
from app.schemas.nfc_tag import NfcCheckInStatus
from app.services.inventory_audit_schedule_service import (
    InventoryAuditScheduleService,
)
from app.services.inventory_nfc_service import (
    InventoryNfcService,
    InventoryNfcTagNotFound,
)
from app.services.nfc_tag_service import NfcTagService
from app.utils.inventory_nfc import inventory_nfc_enabled, require_inventory_nfc
from app.utils.nfc_integration import require_nfc_id_cards

router = APIRouter()


def _is_staff(user: User) -> bool:
    """Whether this caller's taps belong in the tap log."""
    return user_has_permission(user, "inventory.manage")


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

    if _is_staff(current_user):
        await service.record_scan(
            organization_id=org_id,
            item_id=str(item.id),
            action=InventoryNfcScanAction.LOOKUP,
            scanned_by=str(current_user.id),
            tag_id=str(tag.id),
        )

    return ScanLookupResponse(
        item=item,
        matched_field="nfc_tag",
        matched_value=f"NFC tag …{tag.uid_preview}",
    )


@router.post("/nfc/resolve-any", response_model=InventoryNfcResolveAnyResponse)
async def resolve_any_inventory_nfc_tag(
    data: InventoryNfcResolveAnyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """Find the item *or storage area* a tapped tag is linked to.

    Separate from ``/nfc/resolve`` so that endpoint keeps the barcode lookup's
    response shape for the scanner, which only ever wants an item.
    """
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        resolved = await service.resolve_any(org_id, (data.code, data.serial_number))
    except InventoryNfcTagNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    if resolved.item is not None and data.record and _is_staff(current_user):
        await service.record_scan(
            organization_id=org_id,
            item_id=str(resolved.item.id),
            action=InventoryNfcScanAction.LOOKUP,
            scanned_by=str(current_user.id),
            tag_id=str(resolved.tag.id),
        )

    return InventoryNfcResolveAnyResponse(
        kind="item" if resolved.item is not None else "storage_area",
        tag_id=str(resolved.tag.id),
        tag_uid_preview=resolved.tag.uid_preview,
        item=resolved.item,
        storage_area=resolved.storage_area,
    )


@router.post("/nfc/put-away", response_model=InventoryNfcPutAwayResponse)
async def put_away_inventory_item(
    data: InventoryNfcPutAwayRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Move an item onto a storage area, as recorded by tapping both."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        result = await service.put_away(
            organization_id=org_id,
            item_id=data.item_id,
            storage_area_id=data.storage_area_id,
            scanned_by=str(current_user.id),
            item_tag_id=data.item_tag_id,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    if result["moved"]:
        # The barcode put-away's event type and shape, so an auditor searching
        # for put-aways finds both ways of doing one.
        await log_audit_event(
            db=db,
            event_type="inventory_items_put_away",
            event_category="inventory",
            severity="info",
            event_data={
                "storage_area_id": result["storage_area_id"],
                "item_ids": [result["item_id"]],
                "skipped": 0,
                "from_storage_area_id": result["from_storage_area_id"],
                "method": "nfc",
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return result


@router.get("/items/{item_id}/nfc-scans", response_model=InventoryNfcScanListResponse)
async def list_item_nfc_scans(
    item_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """An item's tap log, newest first — its "last seen" trail."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        items = await service.list_item_scans(item_id, org_id, limit=limit)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"items": items, "total": len(items)}


@router.get(
    "/storage-areas/{storage_area_id}/nfc-tags",
    response_model=InventoryNfcTagListResponse,
)
async def list_storage_area_nfc_tags(
    storage_area_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """List the tags linked to one storage area."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        items = await service.list_storage_area_tags(storage_area_id, org_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"items": items, "total": len(items)}


@router.post(
    "/storage-areas/{storage_area_id}/nfc-tags",
    response_model=InventoryNfcTagResponse,
    status_code=status.HTTP_201_CREATED,
)
async def link_storage_area_nfc_tag(
    storage_area_id: str,
    data: InventoryNfcTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Link a tag to a storage area (a shelf, bin or cabinet)."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        tag = await service.link_tag(
            organization_id=org_id,
            storage_area_id=storage_area_id,
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
            "storage_area_id": storage_area_id,
            "uid_preview": tag["uid_preview"],
            "credential_type": data.credential_type.value,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return tag


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
                "storage_area_id": tag["storage_area_id"],
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
            "storage_area_id": removed["storage_area_id"],
            "uid_preview": removed["uid_preview"],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )


@router.post(
    "/nfc/audits",
    response_model=InventoryNfcAuditDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_inventory_nfc_audit(
    data: InventoryNfcAuditCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Record a shelf audit: compare the items tapped with the items recorded
    there. Reports only — nothing is moved and nothing is marked lost."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        audit = await service.create_audit(
            organization_id=org_id,
            storage_area_id=data.storage_area_id,
            tapped=[(t.item_id, t.tag_id) for t in data.tapped],
            audited_by=str(current_user.id),
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    await log_audit_event(
        db=db,
        event_type="inventory_nfc_shelf_audited",
        event_category="inventory",
        severity="info",
        event_data={
            "audit_id": audit["id"],
            "storage_area_id": audit["storage_area_id"],
            "expected": audit["expected_count"],
            "found": audit["found_count"],
            "missing": audit["missing_count"],
            "unexpected": audit["unexpected_count"],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return audit


@router.get("/nfc/audits", response_model=InventoryNfcAuditListResponse)
async def list_inventory_nfc_audits(
    storage_area_id: Optional[str] = Query(None, max_length=36),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Shelf audits, newest first."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    items = await InventoryNfcService(db).list_audits(
        org_id, storage_area_id=storage_area_id, limit=limit
    )
    return {"items": items, "total": len(items)}


@router.get("/nfc/audits/{audit_id}", response_model=InventoryNfcAuditDetail)
async def get_inventory_nfc_audit(
    audit_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """One shelf audit with every line."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    try:
        return await InventoryNfcService(db).get_audit(audit_id, org_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/nfc/audits/{audit_id}/apply", response_model=InventoryNfcAuditDetail)
async def apply_inventory_nfc_audit(
    audit_id: str,
    data: InventoryNfcAuditApply,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Move the chosen unexpected items onto the audited shelf, by the same
    rule as every other put-away."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        audit = await service.apply_audit(
            audit_id=audit_id,
            organization_id=org_id,
            item_ids=data.item_ids,
            applied_by=str(current_user.id),
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    if audit["moved_item_ids"]:
        await log_audit_event(
            db=db,
            event_type="inventory_items_put_away",
            event_category="inventory",
            severity="info",
            event_data={
                "storage_area_id": audit["storage_area_id"],
                "item_ids": audit["moved_item_ids"],
                "skipped": len(audit["skipped"]),
                "method": "nfc_audit",
                "audit_id": audit["id"],
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return audit


@router.post("/nfc/resolve-member", response_model=InventoryNfcMemberResponse)
async def resolve_inventory_nfc_member(
    data: InventoryNfcResolveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Find the member a tapped ID card belongs to, to hand them equipment.

    Refusals are one 404 whatever the reason — unknown card, card marked lost,
    member inactive — with a message saying which, as the check-in station
    does. Card taps here are not logged: the tap log records equipment.
    """
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    await require_nfc_id_cards(db, org_id)
    _tag, user, refusal = await NfcTagService(db).resolve_tag(
        org_id, (data.code, data.serial_number)
    )
    if refusal is not None or user is None:
        messages = {
            NfcCheckInStatus.UNKNOWN_CARD: "This card is not registered to a member.",
            NfcCheckInStatus.CARD_INACTIVE: (
                "This card has been marked lost or replaced and no longer works."
            ),
        }
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=messages.get(
                refusal, "This card belongs to a member who is not currently active."
            ),
        )
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return InventoryNfcMemberResponse(
        user_id=str(user.id),
        member_name=name or user.username,
        membership_number=user.membership_number,
    )


@router.get("/nfc/untagged", response_model=InventoryNfcUntaggedListResponse)
async def list_untagged_inventory_items(
    search: Optional[str] = Query(None, max_length=100),
    category_id: Optional[str] = Query(None, max_length=36),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Active items with no working tag, for tagging them one after another."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    items = await InventoryNfcService(db).list_untagged_items(
        org_id, search=search, category_id=category_id, limit=limit
    )
    return {"items": items, "total": len(items)}


@router.get("/nfc/audit-schedule", response_model=InventoryAuditScheduleListResponse)
async def list_inventory_audit_schedule(
    due_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Storage areas on an audit schedule, overdue first."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    items = await InventoryAuditScheduleService(db).list_schedule(
        org_id, due_only=due_only
    )
    return {"items": items, "total": len(items)}


@router.put(
    "/storage-areas/{storage_area_id}/audit-schedule",
    response_model=InventoryAuditScheduleRow,
)
async def set_inventory_audit_schedule(
    storage_area_id: str,
    data: InventoryAuditScheduleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Set how often a storage area should be audited, or clear it."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    try:
        row = await InventoryAuditScheduleService(db).set_frequency(
            storage_area_id, org_id, data.audit_frequency
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    await log_audit_event(
        db=db,
        event_type="inventory_audit_schedule_changed",
        event_category="inventory",
        severity="info",
        event_data={
            "storage_area_id": storage_area_id,
            "audit_frequency": (
                data.audit_frequency.value if data.audit_frequency else None
            ),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return row
