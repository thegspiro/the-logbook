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

Tags on equipment-check compartments belong to whoever builds checklists:
listing and linking them is ``inventory.check_manage``. Relabelling, marking
lost or found, moving or unlinking one through the shared ``/nfc-tags/{id}``
routes asks for ``inventory.check_manage`` or ``inventory.manage`` when the tag
is on a compartment, and ``inventory.manage`` otherwise: the quartermaster runs
the department-wide tag register (``GET /nfc-tags``, its export and bulk
lost/found), which covers every kind of tag, by the owner's decision
(2026-10-23). A checklist manager opens the same register limited to
compartment tags (owner's decision, 2026-10-24). Resolving a tap during a check
(``/nfc/resolve-check``) is for whoever may perform that template's check —
``inventory.check_submit`` limited to their assigned templates, as the check
form itself is, or ``inventory.check_manage``.

Put-away and shelf-audit taps made without signal are queued on the phone as
raw reads and sent later to the ``/replay`` routes, which decide what each tap
names when it arrives and apply them in order with the online rules. Those are
``inventory.manage``, like the screens that queue them.

Shelf audits, the member ID card lookup and the bulk-enrollment list are
``inventory.manage`` too: each is a quartermaster's tool. The card lookup also
requires the NFC ID Cards integration, because it reads that integration's
credentials.

Only taps by ``inventory.manage`` holders are written to the tap log. A member
opening a written tag from their own phone is resolved but not recorded —
logging everyone would turn an equipment trail into a record of where each
member was.
"""

import io
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission, user_has_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.inventory import InventoryNfcScanAction, InventoryNfcTagStatus
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
    InventoryNfcAuditReplayRequest,
    InventoryNfcAuditReplayResponse,
    InventoryNfcMemberResponse,
    InventoryNfcMoveTargetListResponse,
    InventoryNfcPutAwayReplayRequest,
    InventoryNfcPutAwayReplayResponse,
    InventoryNfcPutAwayRequest,
    InventoryNfcPutAwayResponse,
    InventoryNfcRegisterListResponse,
    InventoryNfcResolveAnyRequest,
    InventoryNfcResolveAnyResponse,
    InventoryNfcResolveCheckRequest,
    InventoryNfcResolveCheckResponse,
    InventoryNfcResolveRequest,
    InventoryNfcScanListResponse,
    InventoryNfcSettingsResponse,
    InventoryNfcTagBulkStatusRequest,
    InventoryNfcTagBulkStatusResponse,
    InventoryNfcTagCreate,
    InventoryNfcTagListResponse,
    InventoryNfcTagMove,
    InventoryNfcTagResponse,
    InventoryNfcTagUpdate,
    InventoryNfcUntaggedListResponse,
)
from app.schemas.nfc_tag import NfcCheckInStatus
from app.services.equipment_check_service import EquipmentCheckService
from app.services.inventory_audit_schedule_service import (
    InventoryAuditScheduleService,
)
from app.services.inventory_nfc_register_service import (
    MAX_EXPORT_ROWS,
    TAG_KINDS,
    InventoryNfcRegisterService,
)
from app.services.inventory_nfc_service import (
    InventoryNfcService,
    InventoryNfcTagNotFound,
)
from app.services.nfc_tag_service import NfcTagService
from app.utils.csv_export import SafeCsvWriter
from app.utils.inventory_nfc import inventory_nfc_enabled, require_inventory_nfc
from app.utils.nfc_integration import require_nfc_id_cards
from app.utils.org_timezone import resolve_scheduling_timezone, to_local

router = APIRouter()


def _is_staff(user: User) -> bool:
    """Whether this caller's taps belong in the tap log."""
    return user_has_permission(user, "inventory.manage")


def _require_tag_manager(user: User, tag: dict) -> None:
    """403 unless ``user`` may manage tags of this tag's kind.

    The ``/nfc-tags/{id}`` routes serve every kind of tag and admit either
    permission, so the tag itself decides which is enough: a checklist builder
    should not relabel a quartermaster's item tags, while the quartermaster,
    who keeps the register of every tag, may manage compartment tags too.
    """
    allowed = (
        ("inventory.check_manage", "inventory.manage")
        if tag["check_compartment_id"] is not None
        else ("inventory.manage",)
    )
    if not any(user_has_permission(user, needed) for needed in allowed):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage this tag.",
        )


@router.get("/nfc/settings", response_model=InventoryNfcSettingsResponse)
async def get_inventory_nfc_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "inventory.view", "inventory.check_submit", "inventory.check_manage"
        )
    ),
):
    """Whether NFC tag tracking is switched on for this organization.

    Also open to whoever performs or builds equipment checks, which need not
    include ``inventory.view``: the check form and the checklist builder read
    it to decide whether to offer compartment and item taps.
    """
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


@router.post("/nfc/put-away/replay", response_model=InventoryNfcPutAwayReplayResponse)
async def replay_put_away_taps(
    data: InventoryNfcPutAwayReplayRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Apply put-away taps made offline, in order, and say what each did.

    A tap that names nothing, or a move the put-away rule refuses, is reported
    in its step and the rest still apply: the answer is 200 unless the request
    itself is refused.
    """
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    result = await service.replay_put_away(
        organization_id=org_id,
        scanned_by=str(current_user.id),
        taps=[t.model_dump() for t in data.taps],
        open_storage_area_id=data.open_storage_area_id,
        held_item_id=data.held_item_id,
        held_item_tag_id=data.held_item_tag_id,
    )

    # One event per move, in the online put-away's shape, so an auditor
    # searching for put-aways finds these beside the ones made with signal.
    for step in result["results"]:
        if step["outcome"] != "moved":
            continue
        await log_audit_event(
            db=db,
            event_type="inventory_items_put_away",
            event_category="inventory",
            severity="info",
            event_data={
                "storage_area_id": step["storage_area_id"],
                "item_ids": [step["item_id"]],
                "skipped": 0,
                "from_storage_area_id": step["from_storage_area_id"],
                "method": "nfc_offline",
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


@router.post("/nfc/resolve-check", response_model=InventoryNfcResolveCheckResponse)
async def resolve_check_inventory_nfc_tag(
    data: InventoryNfcResolveCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.check_submit", "inventory.check_manage")
    ),
):
    """Find what a tap during an equipment check names: one of the template's
    compartments, or the checklist entries linked to a tagged inventory item.

    The template is fetched exactly as the check form fetches it, so a member
    limited to their assigned templates cannot probe another one's contents.
    """
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)

    checks = EquipmentCheckService(db)
    visible_positions = None
    if not (
        user_has_permission(current_user, "inventory.check_view")
        or user_has_permission(current_user, "inventory.check_manage")
    ):
        visible_positions = await checks.get_user_check_positions(
            str(current_user.id), org_id
        )
    template = await checks.get_template(
        data.template_id,
        org_id,
        visible_positions=visible_positions,
        submitter_user_id=str(current_user.id),
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    service = InventoryNfcService(db)
    try:
        resolved = await service.resolve_check(
            org_id, data.template_id, (data.code, data.serial_number)
        )
    except InventoryNfcTagNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    if resolved.item is not None and _is_staff(current_user):
        await service.record_scan(
            organization_id=org_id,
            item_id=str(resolved.item.id),
            action=InventoryNfcScanAction.LOOKUP,
            scanned_by=str(current_user.id),
            tag_id=str(resolved.tag.id),
        )

    return InventoryNfcResolveCheckResponse(
        kind=resolved.kind,
        tag_id=str(resolved.tag.id),
        compartment_id=(str(resolved.compartment.id) if resolved.compartment else None),
        compartment_name=resolved.compartment.name if resolved.compartment else None,
        item_name=resolved.item.name if resolved.item else None,
        template_item_ids=resolved.template_item_ids,
    )


@router.get(
    "/check-compartments/{compartment_id}/nfc-tags",
    response_model=InventoryNfcTagListResponse,
)
async def list_check_compartment_nfc_tags(
    compartment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """List the tags linked to one equipment-check compartment."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        items = await service.list_compartment_tags(compartment_id, org_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"items": items, "total": len(items)}


@router.post(
    "/check-compartments/{compartment_id}/nfc-tags",
    response_model=InventoryNfcTagResponse,
    status_code=status.HTTP_201_CREATED,
)
async def link_check_compartment_nfc_tag(
    compartment_id: str,
    data: InventoryNfcTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Link a tag to an equipment-check compartment on an apparatus."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        tag = await service.link_tag(
            organization_id=org_id,
            check_compartment_id=compartment_id,
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
            "check_compartment_id": compartment_id,
            "uid_preview": tag["uid_preview"],
            "credential_type": data.credential_type.value,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return tag


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


_TagKind = Literal["item", "storage_area", "compartment"]


_REGISTER_PERMISSIONS = ("inventory.manage", "inventory.check_manage")


def _register_kinds(user: User, requested: Optional[_TagKind]) -> Optional[_TagKind]:
    """The kind filter a register read may use.

    The quartermaster (``inventory.manage``) reads every kind. A checklist
    manager (``inventory.check_manage`` alone) reads compartment tags only, the
    ones ``_require_tag_manager`` lets them change; asking for another kind is
    a 403 rather than an empty list, so the screen cannot mistake "not yours"
    for "none".
    """
    if user_has_permission(user, "inventory.manage"):
        return requested
    if requested not in (None, "compartment"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can see compartment tags only.",
        )
    return "compartment"


_KIND_LABELS = {
    "item": "Item",
    "storage_area": "Storage area",
    "compartment": "Compartment",
}


@router.get("/nfc-tags", response_model=InventoryNfcRegisterListResponse)
async def list_inventory_nfc_register(
    kind: Optional[_TagKind] = Query(None),
    tag_status: Optional[InventoryNfcTagStatus] = Query(None, alias="status"),
    search: Optional[str] = Query(None, max_length=100),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_REGISTER_PERMISSIONS)),
):
    """Every tag in the department — items, storage areas and compartments —
    or, for a checklist manager, its compartment tags."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    items, total = await InventoryNfcRegisterService(db).list_tags(
        org_id,
        kind=_register_kinds(current_user, kind),
        status=tag_status,
        search=search,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total}


@router.get("/nfc-tags/export")
async def export_inventory_nfc_register(
    kind: Optional[_TagKind] = Query(None),
    tag_status: Optional[InventoryNfcTagStatus] = Query(None, alias="status"),
    search: Optional[str] = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_REGISTER_PERMISSIONS)),
):
    """The filtered register as a CSV, capped at ``MAX_EXPORT_ROWS``.

    Built in memory: the cap bounds it to about a megabyte.
    """
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    kind = _register_kinds(current_user, kind)
    items, total = await InventoryNfcRegisterService(db).list_tags(
        org_id,
        kind=kind,
        status=tag_status,
        search=search,
        limit=MAX_EXPORT_ROWS,
    )

    tz = await resolve_scheduling_timezone(db, current_user.organization_id)

    def _when(value) -> str:
        return to_local(value, tz).strftime("%Y-%m-%d %H:%M %Z") if value else ""

    output = io.StringIO()
    writer = SafeCsvWriter(output)
    writer.writerow(
        [
            "Kind",
            "Tagged",
            "Checklist",
            "Label",
            "Tag",
            "Status",
            "Linked by",
            "Linked",
            "Last tapped",
        ]
    )
    for row in items:
        writer.writerow(
            [
                _KIND_LABELS[row["kind"]],
                row["target_name"] or "",
                row["template_name"] or "",
                row["label"] or "",
                f"…{row['uid_preview']}",
                "Lost" if row["status"] == InventoryNfcTagStatus.LOST else "Active",
                row["linked_by_name"] or "",
                _when(row["linked_at"]),
                _when(row["last_scanned_at"]),
            ]
        )

    await log_audit_event(
        db=db,
        event_type="inventory_nfc_tags_exported",
        event_category="inventory",
        severity="info",
        event_data={
            "rows": len(items),
            "total": total,
            "kind": kind,
            "status": tag_status.value if tag_status else None,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="inventory_nfc_tags.csv"'
        },
    )


@router.get("/nfc-tags/move-targets", response_model=InventoryNfcMoveTargetListResponse)
async def list_inventory_nfc_move_targets(
    kind: _TagKind = Query(...),
    search: Optional[str] = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_REGISTER_PERMISSIONS)),
):
    """Items, storage areas or compartments a register tag could move to."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    target_kind = _register_kinds(current_user, kind)
    items = await InventoryNfcRegisterService(db).move_targets(
        org_id, target_kind or kind, search
    )
    return {"items": items}


@router.post("/nfc-tags/bulk-status", response_model=InventoryNfcTagBulkStatusResponse)
async def bulk_update_inventory_nfc_tag_status(
    data: InventoryNfcTagBulkStatusRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_REGISTER_PERMISSIONS)),
):
    """Mark several tags lost or found at once — after a bay clean-out turns up
    a pile of peeled-off tags, or a shelf of them goes missing.

    Ids that are not this department's, and for a checklist manager tags not on
    a compartment, come back under ``failed``; the rest still change.
    """
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    allowed = (
        TAG_KINDS
        if user_has_permission(current_user, "inventory.manage")
        else ("compartment",)
    )
    updated, failed = await InventoryNfcRegisterService(db).bulk_update_status(
        org_id, data.tag_ids, data.status, allowed
    )
    for tag in updated:
        await log_audit_event(
            db=db,
            event_type="inventory_nfc_tag_status_changed",
            event_category="inventory",
            severity="info",
            event_data={
                "tag_id": tag["id"],
                "item_id": tag["item_id"],
                "storage_area_id": tag["storage_area_id"],
                "check_compartment_id": tag["check_compartment_id"],
                "new_status": data.status.value,
                "bulk": True,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return {"updated": updated, "failed": failed}


@router.post("/nfc-tags/{tag_id}/move", response_model=InventoryNfcTagResponse)
async def move_inventory_nfc_tag(
    tag_id: str,
    data: InventoryNfcTagMove,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage", "inventory.check_manage")
    ),
):
    """Re-point a tag at another item, storage area or compartment of the same
    kind, without the tag in hand — for one linked to the wrong thing."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        _require_tag_manager(current_user, await service.get_tag(tag_id, org_id))
        before, after = await InventoryNfcRegisterService(db).move_tag(
            tag_id,
            org_id,
            item_id=data.item_id,
            storage_area_id=data.storage_area_id,
            check_compartment_id=data.check_compartment_id,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    await log_audit_event(
        db=db,
        event_type="inventory_nfc_tag_moved",
        event_category="inventory",
        severity="info",
        event_data={
            "tag_id": tag_id,
            "uid_preview": after["uid_preview"],
            "from": {
                "item_id": before["item_id"],
                "storage_area_id": before["storage_area_id"],
                "check_compartment_id": before["check_compartment_id"],
            },
            "to": {
                "item_id": after["item_id"],
                "storage_area_id": after["storage_area_id"],
                "check_compartment_id": after["check_compartment_id"],
            },
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return after


@router.patch("/nfc-tags/{tag_id}", response_model=InventoryNfcTagResponse)
async def update_inventory_nfc_tag(
    tag_id: str,
    data: InventoryNfcTagUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage", "inventory.check_manage")
    ),
):
    """Relabel a tag, or mark it lost or found."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    updates = data.model_dump(exclude_unset=True)
    try:
        _require_tag_manager(current_user, await service.get_tag(tag_id, org_id))
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
                "check_compartment_id": tag["check_compartment_id"],
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
    current_user: User = Depends(
        require_permission("inventory.manage", "inventory.check_manage")
    ),
):
    """Unlink a tag from what it marks, freeing it to be linked again."""
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        _require_tag_manager(current_user, await service.get_tag(tag_id, org_id))
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
            "check_compartment_id": removed["check_compartment_id"],
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


@router.post("/nfc/audits/replay", response_model=InventoryNfcAuditReplayResponse)
async def replay_inventory_nfc_audit(
    data: InventoryNfcAuditReplayRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Save a shelf audit finished offline.

    Sending the same ``client_submission_id`` again returns the audit already
    saved. When the taps name no shelf, nothing is saved and the answer says
    why — a 200, because resending cannot change that.
    """
    org_id = str(current_user.organization_id)
    await require_inventory_nfc(db, org_id)
    service = InventoryNfcService(db)
    try:
        result = await service.replay_audit(
            organization_id=org_id,
            audited_by=str(current_user.id),
            client_submission_id=data.client_submission_id,
            storage_area_id=data.storage_area_id,
            tapped=[(t.item_id, t.tag_id) for t in data.tapped],
            taps=[t.model_dump() for t in data.taps],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    audit = result["audit"]
    # A resend of an audit already saved is not a second audit.
    if audit is not None and result["created"]:
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
                "offline": True,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return result


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
        messages: dict[NfcCheckInStatus | None, str] = {
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
    name = user.display_name
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
