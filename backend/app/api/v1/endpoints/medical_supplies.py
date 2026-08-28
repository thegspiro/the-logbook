"""
Medical Supplies API Endpoints

The EMS side of the department's stock, served on its own so it can be run by
its own officer. Everything here lives in the same catalog tables as gear and
uniforms — one item list, one lot system, one set of storage areas — but every
route is pinned to the medical domain server-side.

Two things follow from that pinning, and both are deliberate:

* The domain is never read from a query parameter. It comes from
  ``MEDICAL_ITEM_TYPES``, so a caller holding only ``inventory.manage_medical``
  cannot widen their own view into the uniform closet by asking nicely.
* Every by-id write re-checks that the target is *in* the domain before
  touching it. A permission grants access to a domain, not to a row; without
  the second check an EMS officer could edit a turnout coat by passing its id.

Access is OR-logic against the broad inventory permissions, so a department
that runs everything through one quartermaster keeps working unchanged: they
hold ``inventory.manage`` and these routes accept it.
"""

from datetime import date as _date
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail, sanitize_error_message
from app.models.inventory import MEDICAL_ITEM_TYPES, ItemCondition, ItemStatus
from app.models.user import User
from app.schemas.inventory import (
    ExpiringLotResponse,
    InventoryCategoryCreate,
    InventoryCategoryResponse,
    InventoryCategoryUpdate,
    InventoryItemCreate,
    InventoryItemResponse,
    InventoryItemUpdate,
    InventoryLotBulkCreate,
    InventoryLotCreate,
    InventoryLotResponse,
    InventoryLotUpdate,
    ItemsListResponse,
)
from app.services.inventory_service import InventoryService

router = APIRouter()

# Every route below spells out its permissions inline rather than sharing two
# module constants. They are listed domain-first, so the narrower grant is what
# a reader sees the route is for, and repeated because
# tests/test_endpoint_auth_coverage.py reads these signatures with ast to prove
# no endpoint ships unauthenticated — a hoisted constant is opaque to it, and
# an auth guard that cannot be read at the route it guards is worth less than
# the repetition costs.

_NOT_FOUND = "Medical supply item not found"


async def _require_medical_item(
    service: InventoryService, item_id: str, organization_id: str
) -> None:
    """Refuse a by-id write whose target is not medical stock.

    404 rather than 403 on purpose: to a supply officer scoped to medical
    stock, a uniform item does not exist, and answering 403 would confirm the
    id is real.
    """
    if not await service.item_in_domain(item_id, organization_id, MEDICAL_ITEM_TYPES):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)


async def _require_medical_category(
    service: InventoryService, category_id: Optional[str], organization_id: str
) -> None:
    """Refuse a category id that is not a medical supply category."""
    if not await service.category_in_domain(
        category_id, organization_id, MEDICAL_ITEM_TYPES
    ):
        raise HTTPException(status_code=404, detail="Medical supply category not found")


# ============================================
# Categories
# ============================================


@router.get("/categories", response_model=list[InventoryCategoryResponse])
async def list_medical_categories(
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    List medical supply categories

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    service = InventoryService(db)
    return await service.get_categories(
        organization_id=current_user.organization_id,
        item_types=MEDICAL_ITEM_TYPES,
        active_only=active_only,
    )


@router.post(
    "/categories",
    response_model=InventoryCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_medical_category(
    category: InventoryCategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Create a medical supply category

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    data = category.model_dump()
    # The domain is not the caller's to choose on this router: a category
    # created here is medical whatever the payload said, so a medical-only
    # officer cannot mint a uniform category through the side door.
    data["item_type"] = "medical"

    if data.get("parent_category_id"):
        await _require_medical_category(
            service, str(data["parent_category_id"]), str(current_user.organization_id)
        )

    new_category, error = await service.create_category(
        organization_id=current_user.organization_id,
        category_data=data,
        created_by=current_user.id,
    )
    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="medical_category_created",
        event_category="inventory",
        severity="info",
        event_data={
            "category_id": str(new_category.id),
            "category_name": new_category.name,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return new_category


@router.patch("/categories/{category_id}", response_model=InventoryCategoryResponse)
async def update_medical_category(
    category_id: UUID,
    update_data: InventoryCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Update a medical supply category

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    await _require_medical_category(service, str(category_id), org_id)

    data = update_data.model_dump(exclude_unset=True)
    # Reclassifying a category out of the medical domain would move its items
    # to the gear page and, for a medical-only officer, out of their own reach
    # — an irreversible action from a screen that cannot undo it.
    if "item_type" in data and data["item_type"] != "medical":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "A medical supply category cannot be reclassified from this page. "
                "Move it from Gear & Uniforms admin instead."
            ),
        )
    data.pop("item_type", None)

    if data.get("parent_category_id"):
        await _require_medical_category(
            service, str(data["parent_category_id"]), org_id
        )

    updated, error = await service.update_category(
        category_id=category_id,
        organization_id=current_user.organization_id,
        update_data=data,
    )
    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )
    if not updated:
        raise HTTPException(status_code=404, detail="Medical supply category not found")
    return updated


# ============================================
# Items
# ============================================


@router.get("/items", response_model=ItemsListResponse)
async def list_medical_items(
    category_id: UUID | None = None,
    status_filter: str | None = Query(None, alias="status"),
    condition: str | None = None,
    location_id: UUID | None = None,
    storage_area_id: UUID | None = None,
    search: str | None = None,
    active_only: bool = True,
    sort_by: str | None = None,
    sort_order: str | None = Query(None, pattern="^(asc|desc)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    List medical supply items

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    service = InventoryService(db)

    status_enum = None
    if status_filter:
        try:
            status_enum = ItemStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid status: {status_filter}"
            )

    condition_enum = None
    if condition:
        try:
            condition_enum = ItemCondition(condition)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid condition: {condition}"
            )

    if category_id:
        await _require_medical_category(
            service, str(category_id), str(current_user.organization_id)
        )

    items, total = await service.get_items(
        organization_id=current_user.organization_id,
        category_id=category_id,
        status=status_enum,
        condition=condition_enum,
        item_types=MEDICAL_ITEM_TYPES,
        location_id=location_id,
        storage_area_id=storage_area_id,
        search=search,
        active_only=active_only,
        sort_by=sort_by,
        sort_order=sort_order,
        skip=skip,
        limit=limit,
    )
    return ItemsListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/items/{item_id}", response_model=InventoryItemResponse)
async def get_medical_item(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    Get a single medical supply item

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    await _require_medical_item(service, str(item_id), org_id)

    item = await service.get_item_by_id(item_id, current_user.organization_id)
    if not item:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return item


@router.post(
    "/items",
    response_model=InventoryItemResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_medical_item(
    item: InventoryItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Create a medical supply item

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    data = item.model_dump(exclude_unset=True)

    # Items reach a domain through their category, so an item created here
    # must name a medical one — otherwise it would be filed as gear and
    # vanish from the page that created it.
    await _require_medical_category(service, str(data.get("category_id") or ""), org_id)

    new_item, error = await service.create_item(
        organization_id=current_user.organization_id,
        item_data=data,
        created_by=current_user.id,
    )
    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="medical_item_created",
        event_category="inventory",
        severity="info",
        event_data={"item_id": str(new_item.id), "item_name": new_item.name},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return new_item


@router.patch("/items/{item_id}", response_model=InventoryItemResponse)
async def update_medical_item(
    item_id: UUID,
    update_data: InventoryItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Update a medical supply item

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    await _require_medical_item(service, str(item_id), org_id)

    data = update_data.model_dump(exclude_unset=True)
    # Moving an item to a non-medical category is the same escape hatch as
    # reclassifying the category, one item at a time.
    #
    # Key presence, not truthiness: `exclude_unset` keeps an explicitly-sent
    # null, and `data.get(...)` reads that as falsy. That skipped the check and
    # let `{"category_id": null}` through to `update_item`, which cleared the
    # column — stranding the item as uncategorized, out of this page's domain
    # filter and into the gear page's uncategorized rows, with no way back.
    if "category_id" in data:
        if data["category_id"] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "A medical supply must stay in a medical supply category. "
                    "Pick a different category rather than clearing it."
                ),
            )
        await _require_medical_category(service, str(data["category_id"]), org_id)

    updated, error = await service.update_item(
        item_id=item_id,
        organization_id=current_user.organization_id,
        update_data=data,
    )
    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )
    if not updated:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return updated


# ============================================
# Stock lots
# ============================================


@router.get("/items/{item_id}/lots", response_model=list[InventoryLotResponse])
async def list_medical_item_lots(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    List stock lots for a medical supply item, soonest-to-expire first

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    await _require_medical_item(service, item_id, org_id)
    return await service.list_lots(item_id, org_id)


@router.post(
    "/items/{item_id}/lots",
    response_model=InventoryLotResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_medical_item_lot(
    item_id: str,
    data: InventoryLotCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Add a dated stock lot to a medical supply item

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    await _require_medical_item(service, item_id, org_id)

    lot = await service.add_lot(
        item_id=item_id,
        organization_id=org_id,
        data=data.model_dump(exclude_unset=True),
        created_by=str(current_user.id),
    )
    if lot is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return lot


@router.post(
    "/lots/bulk",
    response_model=list[InventoryLotResponse],
    status_code=status.HTTP_201_CREATED,
)
async def receive_medical_delivery(
    data: InventoryLotBulkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Receive a delivery: one dated stock lot per item line, in one pass

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)

    # Every line is checked before any is written. A partially-received
    # shipment is worse than a rejected one: the officer cannot tell which
    # lines landed without re-counting the whole delivery.
    for entry in data.entries:
        await _require_medical_item(service, entry.inventory_item_id, org_id)

    try:
        return await service.add_lots_bulk(
            organization_id=org_id,
            entries=[e.model_dump(exclude_unset=True) for e in data.entries],
            created_by=str(current_user.id),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.patch("/lots/{lot_id}", response_model=InventoryLotResponse)
async def update_medical_lot(
    lot_id: str,
    data: InventoryLotUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Update a medical stock lot (quantity, expiration, lot number, notes)

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    if not await service.lot_in_domain(lot_id, org_id, MEDICAL_ITEM_TYPES):
        raise HTTPException(status_code=404, detail="Stock lot not found")

    try:
        lot = await service.update_lot(
            lot_id=lot_id,
            organization_id=org_id,
            data=data.model_dump(exclude_unset=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    if lot is None:
        raise HTTPException(status_code=404, detail="Stock lot not found")
    return lot


@router.delete("/lots/{lot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_medical_lot(
    lot_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Delete a medical stock lot

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    if not await service.lot_in_domain(lot_id, org_id, MEDICAL_ITEM_TYPES):
        raise HTTPException(status_code=404, detail="Stock lot not found")

    if not await service.delete_lot(lot_id, org_id):
        raise HTTPException(status_code=404, detail="Stock lot not found")


@router.get("/lots/expiring", response_model=list[ExpiringLotResponse])
async def list_expiring_medical_lots(
    days_ahead: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    List medical stock lots expiring within N days

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    service = InventoryService(db)
    rows = await service.get_expiring_lots(
        str(current_user.organization_id),
        days_ahead,
        item_types=MEDICAL_ITEM_TYPES,
    )
    today = _date.today()
    result: List[ExpiringLotResponse] = []
    for lot, item_name in rows:
        days_until = (lot.expiration_date - today).days if lot.expiration_date else None
        result.append(
            ExpiringLotResponse.model_validate(lot, from_attributes=True).model_copy(
                update={"item_name": item_name, "days_until_expiration": days_until}
            )
        )
    return result


# ============================================
# Overview
# ============================================


@router.get("/summary")
async def medical_supply_summary(
    expiring_within_days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
) -> Dict[str, Any]:
    """
    Headline counts for the medical supplies page

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)

    items, total = await service.get_items(
        organization_id=current_user.organization_id,
        item_types=MEDICAL_ITEM_TYPES,
        active_only=True,
        limit=500,
    )
    expiring = await service.get_expiring_lots(
        org_id, expiring_within_days, item_types=MEDICAL_ITEM_TYPES
    )

    today = _date.today()
    already_expired = sum(
        1 for lot, _ in expiring if lot.expiration_date and lot.expiration_date < today
    )

    # Reorder point is the department's own floor for the item, so "low" means
    # what they said it means rather than a number chosen here.
    #
    # On-hand comes from the lots when the item is stocked as lots. `quantity`
    # and the lots are separate ledgers — receiving a lot never touches the
    # column — so counting `quantity` alone reported a replenished supply as
    # still low, and missed a depleted one. That is most of this page's stock,
    # and it made the tile disagree with the table right beside it.
    def _on_hand(item) -> int:
        if getattr(item, "is_lot_stocked", False):
            return item.lot_stock or 0
        return item.quantity or 0

    low_stock = sum(
        1
        for i in items
        if i.reorder_point is not None and _on_hand(i) <= i.reorder_point
    )

    return {
        "total_items": total,
        "expiring_soon": len(expiring) - already_expired,
        "expired": already_expired,
        "low_stock": low_stock,
        "expiring_within_days": expiring_within_days,
    }
