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

import csv
import io
from collections.abc import AsyncGenerator
from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi import File as FastAPIFile
from fastapi import HTTPException, Query, UploadFile, status
from loguru import logger
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.api.dependencies import require_permission
from app.api.v1.endpoints.inventory import (
    _EXPORT_PAGE_SIZE,
    _IMPORT_TEMPLATE_ROWS,
    MAX_INVENTORY_CSV_BYTES,
    _coerce_csv_row,
)
from app.core.audit import log_audit_event
from app.core.database import async_session_factory, get_db
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.core.utils import safe_error_detail, sanitize_error_message
from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryItem,
    ItemCondition,
    ItemStatus,
)
from app.models.user import User
from app.schemas.equipment_check import ItemDeployment
from app.schemas.inventory import (
    ExpiringLotResponse,
    InventoryCategoryCreate,
    InventoryCategoryDeleteResult,
    InventoryCategoryResponse,
    InventoryCategoryUpdate,
    InventoryItemCreate,
    InventoryItemCreateIfAbsentResult,
    InventoryItemResponse,
    InventoryItemUpdate,
    InventoryLotBulkCreate,
    InventoryLotCreate,
    InventoryLotResponse,
    InventoryLotUpdate,
    ItemBulkRetireFailure,
    ItemBulkRetireRequest,
    ItemBulkRetireResult,
    ItemRetireRequest,
    ItemsListResponse,
    MedicalExpiringStockRow,
    MedicalStorageAreaOption,
    MedicalStorageOptionsResponse,
    MedicalStorageRoom,
)
from app.services.equipment_check_service import EquipmentCheckService
from app.services.inventory_service import (
    CategoryHasItemsError,
    InventoryService,
    ItemNameTakenOutsideDomainError,
    ItemOutsideDomainError,
    LotReceivedAgainstReorderError,
    is_pool_without_stock,
)
from app.services.upload_scanning import reject_if_malicious
from app.utils.csv_export import SafeCsvWriter
from app.utils.name_matching import normalize_name
from app.utils.org_timezone import resolve_org_today
from app.utils.upload_limits import read_upload_limited

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
    categories = await service.get_categories(
        organization_id=current_user.organization_id,
        item_types=MEDICAL_ITEM_TYPES,
        active_only=active_only,
    )
    counts = await service.category_item_counts(
        str(current_user.organization_id), [c.id for c in categories]
    )
    # Transient, like lot_stock on items: read by the response schema and
    # never persisted.
    for category in categories:
        category.item_count = counts.get(str(category.id), 0)
    return categories


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
    if error or new_category is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error or ""),
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

    # Snapshot before the service call: update_category() renames "metadata"
    # to the DB column name "extra_data" in this same dict in place, which
    # would otherwise leak the internal column name into the audit record.
    fields_updated = list(data.keys())

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

    await log_audit_event(
        db=db,
        event_type="medical_category_updated",
        event_category="inventory",
        severity="info",
        event_data={
            "category_id": str(category_id),
            "fields_updated": fields_updated,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return updated


@router.delete(
    "/categories/{category_id}", response_model=InventoryCategoryDeleteResult
)
async def delete_medical_category(
    category_id: UUID,
    move_items_to: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Permanently delete a medical supply category

    A category that still holds supplies is refused (409) unless
    ``move_items_to`` names another medical supply category, in which case its
    supplies — retired ones included — are moved there first. A category with
    subcategories is refused (400). This cannot be undone.

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    await _require_medical_category(service, str(category_id), org_id)
    if move_items_to:
        await _require_medical_category(service, str(move_items_to), org_id)

    try:
        result = await service.delete_category_permanently(
            category_id=category_id,
            organization_id=org_id,
            item_types=MEDICAL_ITEM_TYPES,
            move_items_to=move_items_to,
        )
    except CategoryHasItemsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=safe_error_detail(e)
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Medical supply category not found")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    await log_audit_event(
        db=db,
        event_type="medical_category_deleted",
        event_category="inventory",
        severity="warning",
        event_data={
            "category_id": str(category_id),
            "category_name": result["category_name"],
            "items_moved": result["items_moved"],
            "moved_to_category_id": str(move_items_to) if move_items_to else None,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return result


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
    fuzzy: bool = False,
    low_stock: bool = False,
    exclude_apparatus_only: bool = False,
    uncounted: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    List medical supply items

    ``low_stock=true`` narrows to the supplies at or below their reorder
    point — the set the summary's "Low stock" figure counts.
    ``exclude_apparatus_only=true`` leaves out supplies kept on the apparatus
    only, which have no shelf for a delivery to be received into.
    ``uncounted=true`` narrows to the supplies carried on a truck position no
    crew has counted, whose truck figure is therefore the position's target.
    ``sort_by=next_expiry`` orders by the Next expiry each row shows, shelf
    and trucks together; supplies with nothing dated come last.

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

    org_id = str(current_user.organization_id)
    item_ids = await _medical_filter_ids(
        service,
        org_id,
        low_stock=low_stock,
        location_id=location_id,
        storage_area_id=storage_area_id,
        exclude_apparatus_only=exclude_apparatus_only,
        uncounted=uncounted,
    )
    filters: Dict[str, Any] = {
        "category_id": category_id,
        "status": status_enum,
        "condition": condition_enum,
        "item_types": MEDICAL_ITEM_TYPES,
        "search": search,
        "active_only": active_only,
        "item_ids": item_ids,
    }
    sort_values = (
        await _next_expiry_sort_values(db, service, org_id, filters)
        if sort_by == NEXT_EXPIRY_SORT
        else None
    )

    items, total = await service.get_items(
        organization_id=current_user.organization_id,
        sort_by=sort_by,
        sort_order=sort_order,
        skip=skip,
        limit=limit,
        fuzzy=fuzzy,
        sort_values=sort_values,
        **filters,
    )
    await _attach_medical_list_extras(db, service, org_id, items)
    return ItemsListResponse(items=items, total=total, skip=skip, limit=limit)


async def _medical_filter_ids(
    service: InventoryService,
    organization_id: str,
    *,
    low_stock: bool,
    location_id: Any,
    storage_area_id: Any,
    exclude_apparatus_only: bool = False,
    uncounted: bool = False,
) -> Optional[List[str]]:
    """The id set the list and its export narrow to, or None for no narrowing.

    A storage filter reaches nested areas and an area's room (see
    ``item_ids_stored_in``), which the exact-match item columns cannot, so it
    becomes an id set intersected with the low-stock set. Shared by the list
    and the export so a filtered export holds exactly the rows on screen.
    """
    ids: Optional[set] = None
    if low_stock:
        ids = set(await _low_stock_ids(service, organization_id))
    if location_id or storage_area_id:
        stored = set(
            await service.item_ids_stored_in(
                organization_id,
                MEDICAL_ITEM_TYPES,
                location_id=str(location_id) if location_id else None,
                storage_area_id=str(storage_area_id) if storage_area_id else None,
            )
        )
        ids = stored if ids is None else ids & stored
    if exclude_apparatus_only:
        stocked = set(
            await service.item_ids_kept_in_stock(organization_id, MEDICAL_ITEM_TYPES)
        )
        ids = stocked if ids is None else ids & stocked
    if uncounted:
        unseen = set(
            await service.item_ids_with_uncounted_positions(
                organization_id, MEDICAL_ITEM_TYPES
            )
        )
        ids = unseen if ids is None else ids & unseen
    return sorted(ids) if ids is not None else None


# The list's and the export's sort key for the Next expiry column. Not a
# column or a SQL expression: the value spans shelf lots and truck positions
# and is worked out in Python, so it is handed to get_items as sort_values.
NEXT_EXPIRY_SORT = "next_expiry"


async def _next_expiry_sort_values(
    db: AsyncSession,
    service: InventoryService,
    org_id: str,
    filters: Dict[str, Any],
) -> Dict[str, date]:
    """Each filtered supply's Next expiry, for ordering the whole set.

    Worked out over every supply the filters match, not one page, so page two
    continues where page one stopped. The same figure the rows show
    (``_next_expiries``), so the order cannot disagree with the column.
    """
    ids = await service.item_ids_matching(org_id, **filters)
    today = await resolve_org_today(db, org_id)
    found = await _next_expiries(db, service, org_id, ids, today)
    return {item_id: soonest[0] for item_id, soonest in found.items()}


async def _attach_medical_list_extras(
    db: AsyncSession, service: InventoryService, org_id: str, items: List[Any]
) -> None:
    """Next expiry, storage path and apparatus places for each listed supply.

    Transient attributes, like lot_stock: read by the response schema and
    never persisted. Each is one query for the whole page.
    """
    if not items:
        return
    ids = [str(i.id) for i in items]
    today = await resolve_org_today(db, org_id)
    soonest = await _next_expiries(db, service, org_id, ids, today)
    checks = EquipmentCheckService(db)
    areas = await service.storage_area_index(org_id)
    rooms = await service.location_names(org_id)
    carriers = await checks.apparatus_places_for_items(org_id, ids)
    stock = await service.stock_breakdown(org_id, items)
    unseen = await service.uncounted_positions(
        org_id, [str(i.id) for i in items if stock[i.id]["uncounted"]]
    )
    places = await checks.position_places(
        org_id, [p for positions in unseen.values() for p in positions]
    )
    for item in items:
        item.storage_path = service.storage_path(item, areas, rooms)
        _set_next_expiry(item, soonest.get(str(item.id)), today)
        carried = carriers.get(str(item.id))
        item.apparatus_count = carried["count"] if carried else 0
        item.apparatus_places = carried["places"] if carried else []
        parts = stock[item.id]
        item.apparatus_stock = parts["apparatus"]
        item.apparatus_uncounted = parts["uncounted"]
        item.apparatus_uncounted_places = sorted(
            (
                {"template_item_id": position, **places[position]}
                for position in unseen.get(str(item.id), [])
                if position in places
            ),
            key=lambda place: str(place["where"]).lower(),
        )
        # The same test the Low stock tile and the alert email apply, on the
        # same shelf-plus-trucks figure (InventoryService.ready_on_hand).
        item.is_low_stock = service.is_at_or_below_reorder_point(
            parts["shelf"] + parts["apparatus"], item.reorder_point
        )


async def _soonest_aboard(
    checks: EquipmentCheckService, org_id: str, ids: List[str], today: date
) -> Dict[str, Dict[str, Any]]:
    """Each supply's soonest-expiring row aboard an apparatus.

    Rows holding no units are skipped, as an empty shelf lot is: a position
    counted at zero has nothing on it to expire.
    """
    rows = await checks.apparatus_expiring_stock(
        org_id, list(MEDICAL_ITEM_TYPES), days_ahead=None, today=today, item_ids=ids
    )
    soonest: Dict[str, Dict[str, Any]] = {}
    # Sorted soonest first, so the first row seen for a supply is its answer.
    for row in rows:
        if (row["quantity"] or 0) > 0:
            soonest.setdefault(row["inventory_item_id"], row)
    return soonest


async def _next_expiries(
    db: AsyncSession,
    service: InventoryService,
    org_id: str,
    ids: List[str],
    today: date,
) -> Dict[str, Tuple[date, str, Optional[str]]]:
    """``{item_id: (date, location, truck where)}``: each supply's Next expiry.

    The soonest of the shelf's and the trucks' next date. A tie goes to the
    shelf: it is the stock the officer reading the list manages directly.
    ``truck where`` names the position for a truck date and is None for a
    shelf one, whose place is the supply's storage path. Supplies with
    nothing dated are absent. The one definition behind the column, its sort
    and the export.
    """
    if not ids:
        return {}
    on_shelf = await service.next_lot_expirations(org_id, ids)
    aboard = await _soonest_aboard(EquipmentCheckService(db), org_id, ids, today)
    found: Dict[str, Tuple[date, str, Optional[str]]] = {}
    for item_id in ids:
        shelf_date = on_shelf.get(item_id)
        truck_row = aboard.get(item_id)
        truck_date = truck_row["expiration_date"] if truck_row else None
        if (
            truck_row is not None
            and truck_date is not None
            and (shelf_date is None or truck_date < shelf_date)
        ):
            found[item_id] = (truck_date, "apparatus", truck_row["where"])
        elif shelf_date is not None:
            found[item_id] = (shelf_date, "shelf", None)
    return found


def _set_next_expiry(
    item: Any, soonest: Optional[Tuple[date, str, Optional[str]]], today: date
) -> None:
    """Hang ``_next_expiries``' answer for this supply on it, for the schema."""
    if soonest is None:
        item.next_expiration_date = None
        item.next_expiration_location = None
        item.next_expiration_where = None
        item.days_until_next_expiration = None
        return
    when, location, truck_where = soonest
    item.next_expiration_date = when
    item.next_expiration_location = location
    item.next_expiration_where = (
        truck_where if location == "apparatus" else item.storage_path
    )
    item.days_until_next_expiration = (when - today).days


async def _low_stock_ids(service: InventoryService, organization_id: Any) -> List[str]:
    """Ids of the medical supplies at or below their reorder point.

    The same scan the summary counts with, so the list a "Low stock 2" tile
    opens holds exactly those two — a second definition of "low" here would
    let the two disagree.
    """
    rows = await service.get_low_stock_items_for_alerts(
        organization_id, item_types=MEDICAL_ITEM_TYPES
    )
    return [str(item.id) for item, _on_hand, _from_lots in rows]


# ============================================
# Import / export
#
# Registered ahead of /items/{item_id}: that route's path segment matches any
# string, so "export" and "import-template" would otherwise be swallowed as an
# item id and answered 422.
#
# The CSV parsing is the general inventory import's own (`_coerce_csv_row`),
# not a copy of it, so a column the two imports share cannot come to mean
# different things on the two pages. What differs is the domain: every row
# here lands in a medical supply category, because an item reaches the
# medical domain only through its category and an uncategorized one would be
# filed as gear — gone from the page that imported it.
# ============================================

_DERIVED_STOCK_COLUMNS = [
    "On Apparatus",
    "Uncounted Positions",
    "Next Expiry",
    "Next Expiry Where",
]

# Column order is also the import's: a file exported here imports unchanged
# (the derived Ready Lot Stock, Barcode and stock columns are ignored on the
# way in).
_MEDICAL_EXPORT_COLUMNS = [
    "Name",
    "Category",
    "Also Called",
    "Description",
    "Size",
    "Unit of Measure",
    "Tracking Type",
    "Quantity",
    # Lot-stocked supplies carry their real count here, not in Quantity —
    # see the general export's column of the same name.
    "Ready Lot Stock",
    "Reorder Point",
    # "Yes" for a supply kept on the apparatus only (no stock room).
    "Kept on Apparatus Only",
    "Status",
    "Condition",
    "Manufacturer",
    "Model Number",
    "Serial Number",
    "Asset Tag",
    "Barcode",
    "Storage Location",
    "Station",
    "Vendor",
    "Purchase Date",
    "Purchase Price",
    "Notes",
    # Derived, and read by nothing on import. Appended after the columns the
    # import takes, so a file exported before they existed lines up with one
    # exported after. "On Apparatus" is the in-date truck stock the On hand
    # column adds to the shelf; "Uncounted Positions" how many positions
    # entered it at their target because no crew has counted them.
    *_DERIVED_STOCK_COLUMNS,
]

_MEDICAL_LOT_EXPORT_COLUMNS = [
    "Item",
    "Category",
    "Lot Number",
    "Expiration Date",
    "Days Until Expiration",
    "Quantity",
    "Received Date",
    "Storage Location",
    "Unit Cost",
    "Notes",
    # Appended, so the columns above keep their positions. "Location" is
    # "In storage" or "On apparatus"; "Where" is the storage path, or the
    # apparatus and compartment as the checklist names them.
    "Location",
    "Where",
]

# Read on import only. A row carrying any of them records a stock lot of the
# row's Quantity; the item export has no lot columns because an item has many
# lots, and the lot export is where they are listed.
_LOT_IMPORT_COLUMNS = ["Lot Number", "Expiration Date", "Received Date"]

_MEDICAL_TEMPLATE_HEADER = [
    column
    for column in _MEDICAL_EXPORT_COLUMNS
    if column not in ("Ready Lot Stock", "Barcode", *_DERIVED_STOCK_COLUMNS)
] + _LOT_IMPORT_COLUMNS

# Sample lots for a few of the general template's medical rows, so the
# template shows both shapes: a supply with its first lot, and the same supply
# named again to add a second lot rather than a second supply.
_TEMPLATE_LOT_ROWS: Dict[str, List[Dict[str, str]]] = {
    "Gauze Pads, 4x4 Sterile": [
        {"Lot Number": "GZ-24117", "Expiration Date": "2028-03-31"},
        {"Lot Number": "GZ-25002", "Expiration Date": "2029-01-31", "Quantity": "25"},
    ],
    "Glucometer Test Strips": [
        {
            "Lot Number": "GS-0912",
            "Expiration Date": "2027-06-30",
            "Received Date": "2026-10-01",
            "Notes": "",
        },
    ],
}

# Columns the shared parser does not know. Item Type is read only to refuse a
# row that says it is something other than medical — a gear row pasted into
# this file would otherwise be filed as medical stock without a word.
_REORDER_POINT_HEADERS = {"reorder point", "reorder_point", "reorderpoint"}
_UNIT_HEADERS = {"unit of measure", "unit_of_measure", "unitofmeasure", "unit"}
_ITEM_TYPE_HEADERS = {"item type", "item_type", "itemtype", "type"}
_APPARATUS_ONLY_HEADERS = {
    "kept on apparatus only",
    "apparatus only",
    "apparatus_only",
    "apparatusonly",
}
_YES = {"yes", "y", "true", "1"}
_NO = {"no", "n", "false", "0"}
_LOT_HEADERS = {
    "lot number": "lot_number",
    "lot_number": "lot_number",
    "lotnumber": "lot_number",
    "lot": "lot_number",
    "lot #": "lot_number",
    "expiration date": "expiration_date",
    "expiration_date": "expiration_date",
    "expirationdate": "expiration_date",
    "expiration": "expiration_date",
    "expires": "expiration_date",
    "received date": "received_date",
    "received_date": "received_date",
    "receiveddate": "received_date",
    "received": "received_date",
}


def _enum_text(value: Any) -> str:
    return value.value if hasattr(value, "value") else str(value or "")


def _medical_export_row(item: InventoryItem) -> List[Any]:
    """One CSV row for a medical supply, in ``_MEDICAL_EXPORT_COLUMNS`` order."""
    linked_vendor = item.__dict__.get("vendor_record")
    return [
        item.name,
        item.category.name if item.category else "",
        "; ".join(item.also_called or []),
        item.description or "",
        item.size or "",
        item.unit_of_measure or "",
        _enum_text(item.tracking_type),
        item.quantity if item.quantity is not None else "",
        (
            getattr(item, "lot_stock", None)
            if getattr(item, "is_lot_stocked", False)
            else ""
        ),
        item.reorder_point if item.reorder_point is not None else "",
        "Yes" if item.apparatus_only else "No",
        _enum_text(item.status),
        _enum_text(item.condition),
        item.manufacturer or "",
        item.model_number or "",
        item.serial_number or "",
        item.asset_tag or "",
        item.barcode or "",
        item.storage_location or "",
        item.station or "",
        (linked_vendor.name if linked_vendor is not None else item.vendor) or "",
        str(item.purchase_date) if item.purchase_date else "",
        str(item.purchase_price) if item.purchase_price is not None else "",
        item.notes or "",
        *_derived_stock_cells(item),
    ]


def _derived_stock_cells(item: InventoryItem) -> List[Any]:
    """The ``_DERIVED_STOCK_COLUMNS`` cells, from ``_attach_medical_list_extras``.

    Blank, not 0, where they were never attached: a zero would read as "none
    on the trucks" rather than "not worked out".
    """
    aboard = getattr(item, "apparatus_stock", None)
    uncounted = getattr(item, "apparatus_uncounted", None)
    when = getattr(item, "next_expiration_date", None)
    location = getattr(item, "next_expiration_location", None)
    where = getattr(item, "next_expiration_where", None) or (
        "On an apparatus"
        if location == "apparatus"
        else "In storage" if location == "shelf" else ""
    )
    return [
        aboard if aboard is not None else "",
        uncounted if uncounted is not None else "",
        str(when) if when else "",
        where if when else "",
    ]


def _parse_medical_extras(row: Dict[str, Any]) -> tuple[Dict[str, Any], Optional[str]]:
    """Read the columns only this import understands.

    Returns ``(fields, error)``; an error fails the row.
    """
    fields: Dict[str, Any] = {}
    for raw_col, raw_value in row.items():
        if raw_col is None or not raw_value or not str(raw_value).strip():
            continue
        normalized = raw_col.strip().lower()
        value = str(raw_value).strip()

        if normalized in _ITEM_TYPE_HEADERS:
            if value.lower() != "medical":
                return {}, (
                    f"Item type '{value}' is not medical. Import gear and "
                    "uniforms from Inventory instead."
                )
        elif normalized in _REORDER_POINT_HEADERS:
            try:
                reorder_point = int(value)
            except ValueError:
                return {}, f"Invalid reorder point: '{value}'"
            if reorder_point < 0:
                return {}, f"Reorder point cannot be negative: '{value}'"
            fields["reorder_point"] = reorder_point
        elif normalized in _UNIT_HEADERS:
            if len(value) > 50:
                return {}, "Unit of measure must be 50 characters or fewer"
            fields["unit_of_measure"] = value
        elif normalized in _APPARATUS_ONLY_HEADERS:
            # Refused rather than read as "no": a typo here would otherwise
            # file a LUCAS device as shelf stock and flag it low at once.
            answer = value.lower()
            if answer in _YES:
                fields["apparatus_only"] = True
            elif answer in _NO:
                fields["apparatus_only"] = False
            else:
                return {}, (f"Kept on Apparatus Only must be Yes or No, not '{value}'")
    return fields, None


def _parse_lot_columns(
    row: Dict[str, Any],
) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Read a row's lot columns.

    Returns ``(lot_fields, error)``. ``lot_fields`` is ``None`` when the row
    carries no lot data at all, which makes it a plain item row.
    """
    fields: Dict[str, Any] = {}
    for raw_col, raw_value in row.items():
        if raw_col is None or not raw_value or not str(raw_value).strip():
            continue
        field = _LOT_HEADERS.get(raw_col.strip().lower())
        if field is None:
            continue
        value = str(raw_value).strip()
        if field == "lot_number":
            if len(value) > 100:
                return None, "Lot number must be 100 characters or fewer"
            fields[field] = value
            continue
        # ISO dates only. A spreadsheet's 03/04/2027 is the 3rd of April in
        # one locale and the 4th of March in another, and guessing an
        # expiration date wrong puts expired stock on a rig.
        try:
            fields[field] = date.fromisoformat(value)
        except ValueError:
            label = "expiration" if field == "expiration_date" else "received"
            return None, (
                f"Invalid {label} date: '{value}'. Use YYYY-MM-DD, "
                "for example 2027-03-31"
            )
    return (fields or None), None


@router.get("/items/export")
async def export_medical_items_csv(
    category_id: UUID | None = None,
    status_filter: str | None = Query(None, alias="status"),
    condition: str | None = None,
    location_id: UUID | None = None,
    storage_area_id: UUID | None = None,
    search: str | None = None,
    active_only: bool = True,
    sort_by: str | None = None,
    sort_order: str | None = Query(None, pattern="^(asc|desc)$"),
    low_stock: bool = False,
    uncounted: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Export medical supply items as CSV

    Takes the list route's filters so the file matches the list it was
    exported from. Paging is not accepted: the file is the whole filtered set.

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
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

    organization_id = str(current_user.organization_id)
    if category_id:
        await _require_medical_category(
            InventoryService(db), str(category_id), organization_id
        )
    # Resolved before streaming starts, on the request session, like the
    # category check above.
    filter_ids = await _medical_filter_ids(
        InventoryService(db),
        organization_id,
        low_stock=low_stock,
        location_id=location_id,
        storage_area_id=storage_area_id,
        uncounted=uncounted,
    )
    filters: Dict[str, Any] = {
        "category_id": category_id,
        "status": status_enum,
        "condition": condition_enum,
        "item_types": MEDICAL_ITEM_TYPES,
        "search": search,
        "active_only": active_only,
        "item_ids": filter_ids,
    }
    # Worked out once, before streaming, over the whole filtered set: paging
    # by it needs every page to share one ordering.
    sort_values = (
        await _next_expiry_sort_values(
            db, InventoryService(db), organization_id, filters
        )
        if sort_by == NEXT_EXPIRY_SORT
        else None
    )

    async def _rows() -> AsyncGenerator[str, None]:
        # Its own session, for the reason the general export gives: the
        # request-scoped one is closed before a streamed body is consumed.
        buffer = io.StringIO()
        writer = SafeCsvWriter(buffer)

        def drain() -> str:
            text = buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)
            return text

        writer.writerow(_MEDICAL_EXPORT_COLUMNS)
        yield drain()

        async with async_session_factory() as export_db:
            service = InventoryService(export_db)
            skip = 0
            while True:
                items = await service.get_items_page(
                    organization_id=organization_id,
                    sort_by=sort_by,
                    sort_order=sort_order,
                    skip=skip,
                    limit=_EXPORT_PAGE_SIZE,
                    sort_values=sort_values,
                    **filters,
                )
                if not items:
                    return
                # The figures the list shows beside each row, worked out the
                # same way, so the file and the screen agree.
                await _attach_medical_list_extras(
                    export_db, service, organization_id, items
                )
                for item in items:
                    writer.writerow(_medical_export_row(item))
                yield drain()
                if len(items) < _EXPORT_PAGE_SIZE:
                    return
                skip += _EXPORT_PAGE_SIZE

    return StreamingResponse(
        _rows(),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=medical_supplies_export.csv"
        },
    )


@router.get("/lots/export")
async def export_medical_lots_csv(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Export every stocked medical lot as CSV, on the shelves and the apparatus

    Soonest expiry first, undated last. A unit aboard a truck is listed by its
    deployed lot, or by the position's own lot number and date when no lot is
    recorded; a position recording neither, or holding nothing, has no lot to
    list.

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    # The department's date, not the server's: a lot expiring "today" in the
    # department's timezone must not read as tomorrow's problem.
    today = await resolve_org_today(db, org_id)
    shelf = await service.get_lots_for_export(org_id, MEDICAL_ITEM_TYPES)
    paths = await service.storage_paths_for(
        org_id, {str(lot.inventory_item_id) for lot, _name, _cat in shelf}
    )
    aboard = await EquipmentCheckService(db).apparatus_expiring_stock(
        org_id,
        list(MEDICAL_ITEM_TYPES),
        days_ahead=None,
        today=today,
        include_undated=True,
    )
    categories = await service.item_category_names(
        org_id, {row["inventory_item_id"] for row in aboard}
    )

    def days(when: Optional[date]) -> Any:
        return (when - today).days if when else ""

    rows: List[Tuple[Optional[date], str, List[Any]]] = []
    for lot, item_name, category_name in shelf:
        rows.append(
            (
                lot.expiration_date,
                item_name or "",
                [
                    item_name,
                    category_name or "",
                    lot.lot_number or "",
                    str(lot.expiration_date) if lot.expiration_date else "",
                    days(lot.expiration_date),
                    lot.quantity,
                    str(lot.received_date) if lot.received_date else "",
                    lot.storage_location or "",
                    str(lot.unit_cost) if lot.unit_cost is not None else "",
                    lot.notes or "",
                    "In storage",
                    lot.storage_location or paths.get(str(lot.inventory_item_id)) or "",
                ],
            )
        )
    for row in aboard:
        when = row["expiration_date"]
        rows.append(
            (
                when,
                row["item_name"] or "",
                [
                    row["item_name"] or "",
                    categories.get(row["inventory_item_id"]) or "",
                    row["lot_number"] or "",
                    str(when) if when else "",
                    days(when),
                    row["quantity"],
                    "",
                    "",
                    "",
                    "",
                    "On apparatus",
                    row["where"],
                ],
            )
        )
    # The same order get_lots_for_export gives the shelf alone: dated first,
    # soonest first, then by name; shelf before truck on a tie.
    rows.sort(key=lambda r: (r[0] is None, r[0] or date.max, r[1].lower()))

    output = io.StringIO()
    writer = SafeCsvWriter(output)
    writer.writerow(_MEDICAL_LOT_EXPORT_COLUMNS)
    for _when, _name, cells in rows:
        writer.writerow(cells)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=medical_supply_lots_export.csv"
        },
    )


@router.get("/items/import-template")
async def download_medical_import_template(
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Download a sample CSV for the medical supply import

    The sample rows are the general template's medical ones, so the two
    templates cannot drift apart, with sample lots added to a few of them.

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    output = io.StringIO()
    writer = SafeCsvWriter(output)
    writer.writerow(_MEDICAL_TEMPLATE_HEADER)
    for row in _IMPORT_TEMPLATE_ROWS:
        if row.get("Item Type") != "medical":
            continue
        for lot in _TEMPLATE_LOT_ROWS.get(row["Name"], [{}]):
            sample = {**row, **lot}
            writer.writerow(
                [sample.get(column, "") for column in _MEDICAL_TEMPLATE_HEADER]
            )
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                "attachment; filename=medical_supplies_import_template.csv"
            )
        },
    )


@router.post("/items/import")
async def import_medical_items_csv(
    file: UploadFile = FastAPIFile(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Import medical supply items from a CSV file

    A row creates a new item; nothing already on file is changed. The
    'Name' and 'Category' columns are required. A category is matched by name
    (case-insensitive) against the medical supply categories; a name that
    matches none is created as a new medical supply category, and the
    response lists each one created. A name already used by a gear or
    uniform category is refused for that row rather than duplicated, since
    two categories of one name on different pages is a mistake nobody can
    see from either page.

    A row that fills any of 'Lot Number', 'Expiration Date' or 'Received
    Date' (YYYY-MM-DD) also records a stock lot of the row's Quantity. When
    its Name matches an active pool-tracked medical supply — one on file, or
    one an earlier row of the same file created — the lot is added to that
    supply and the row's other columns are ignored, so naming a supply twice
    records two lots rather than two supplies. Otherwise the supply is created
    and the lot becomes its first stock. Lot rows are pool-tracked.

    'Kept on Apparatus Only' (Yes or No; blank is No) marks a supply with no
    stock room behind it. Such a row may carry a Quantity of 0, and may not
    carry lot columns; nor may a lot row name a supply already kept on the
    apparatus only.

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Please upload a CSV file.",
            error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
        )

    try:
        raw = await read_upload_limited(file, MAX_INVENTORY_CSV_BYTES)
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            content = raw.decode("latin-1")
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="CSV file exceeds the 10MB limit.",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read the uploaded file.",
        )
    # Outside the try above, as in the general import: its catch-all would
    # turn a malware refusal or a scanner outage into a generic 400.
    await reject_if_malicious(
        db, raw, upload_kind="inventory_import", detected_mime=None, user=current_user
    )

    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV file is empty or has no header row.",
        )
    normalized_headers = {name.strip().lower() for name in reader.fieldnames if name}
    if "name" not in normalized_headers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV must contain a 'Name' column.",
        )
    if not normalized_headers & {"category", "category_name", "categoryname"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV must contain a 'Category' column.",
        )

    rows = list(reader)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV file contains no data rows.",
        )

    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    medical_by_name: Dict[str, str] = {
        cat.name.strip().lower(): str(cat.id)
        for cat in await service.get_categories(
            organization_id=org_id, item_types=MEDICAL_ITEM_TYPES, active_only=True
        )
    }
    other_names = {
        cat.name.strip().lower()
        for cat in await service.get_categories(
            organization_id=org_id,
            exclude_item_types=MEDICAL_ITEM_TYPES,
            active_only=False,
        )
    }
    # Inactive vendors included, for the reason the general import gives.
    vendor_by_name: Dict[str, str] = {
        vendor.name.strip().lower(): str(vendor.id)
        for vendor in await service.list_vendors(
            organization_id=org_id, active_only=False
        )
    }

    # Updated as rows create supplies, so a later row naming one adds a lot to
    # it instead of creating a duplicate.
    pool_by_name = await service.pool_item_ids_by_name(org_id, MEDICAL_ITEM_TYPES)
    # Supplies a lot may be added to. One kept on the apparatus only has no
    # stock room, and a lot recorded against it would be ignored everywhere.
    kept_in_stock = set(
        await service.item_ids_kept_in_stock(org_id, MEDICAL_ITEM_TYPES)
    )

    imported = 0
    lots_added = 0
    failed = 0
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = []
    created_categories: List[str] = []
    unmatched_vendors: Dict[str, str] = {}

    for row_num, row in enumerate(rows, start=2):
        item_data, category_name_raw, row_errors, fatal = _coerce_csv_row(row, row_num)
        errors.extend(row_errors)
        if fatal:
            failed += 1
            continue

        if not item_data.get("name"):
            errors.append(
                {"row": row_num, "error": "Missing required 'Name' column value"}
            )
            failed += 1
            continue

        extras, extras_error = _parse_medical_extras(row)
        if extras_error:
            errors.append({"row": row_num, "error": extras_error})
            failed += 1
            continue
        item_data.update(extras)

        lot_fields, lot_error = _parse_lot_columns(row)
        if lot_error:
            errors.append({"row": row_num, "error": lot_error})
            failed += 1
            continue
        if lot_fields is not None:
            if item_data.get("apparatus_only"):
                errors.append(
                    {
                        "row": row_num,
                        "error": (
                            "A supply kept on the apparatus only has no stock "
                            "lots. Clear the lot columns, or set Kept on "
                            "Apparatus Only to No."
                        ),
                    }
                )
                failed += 1
                continue
            if item_data.get("tracking_type") == "individual":
                errors.append(
                    {
                        "row": row_num,
                        "error": (
                            "Lots are recorded against pool-tracked supplies. "
                            "Set Tracking Type to pool or clear the lot columns."
                        ),
                    }
                )
                failed += 1
                continue
            lot_quantity = item_data.get("quantity")
            if not isinstance(lot_quantity, int) or lot_quantity < 1:
                errors.append(
                    {
                        "row": row_num,
                        "error": "A row with lot data needs a Quantity of 1 or more",
                    }
                )
                failed += 1
                continue
            item_data["tracking_type"] = "pool"
            lot_data = InventoryLotCreate(
                quantity=lot_quantity, **lot_fields
            ).model_dump(exclude_unset=True)

            existing_id = pool_by_name.get(normalize_name(item_data["name"]))
            if existing_id is not None and existing_id not in kept_in_stock:
                errors.append(
                    {
                        "row": row_num,
                        "error": (
                            f"'{item_data['name']}' is kept on the apparatus "
                            "only, so it has no stock lots to add to"
                        ),
                    }
                )
                failed += 1
                continue
            if existing_id is not None:
                # Only the lot is written: the row names a supply already on
                # file, and the import never edits one.
                lot = await service.add_lot(
                    item_id=existing_id,
                    organization_id=org_id,
                    data=lot_data,
                    created_by=str(current_user.id),
                    required_item_types=MEDICAL_ITEM_TYPES,
                )
                if lot is None:
                    errors.append(
                        {"row": row_num, "error": "The supply could not be found"}
                    )
                    failed += 1
                else:
                    lots_added += 1
                continue

        category_key = (category_name_raw or "").strip().lower()
        if not category_key:
            errors.append(
                {
                    "row": row_num,
                    "error": (
                        "Category is required: a supply with no medical "
                        "category would be filed as gear"
                    ),
                }
            )
            failed += 1
            continue
        if category_key not in medical_by_name and category_key in other_names:
            errors.append(
                {
                    "row": row_num,
                    "error": (
                        f"Category '{category_name_raw}' belongs to gear and "
                        "uniforms, not medical supplies. Use a different "
                        "category name."
                    ),
                }
            )
            failed += 1
            continue

        # Checked before a category is created for the row, so a row that is
        # going to fail anyway cannot leave an empty category behind.
        if is_pool_without_stock(item_data):
            errors.append(
                {
                    "row": row_num,
                    "error": "Pool items must have a quantity of 1 or more",
                }
            )
            failed += 1
            continue

        category_id = medical_by_name.get(category_key)
        if category_id is None:
            try:
                category_data = InventoryCategoryCreate(
                    name=(category_name_raw or "").strip(), item_type="medical"
                ).model_dump()
            except ValidationError:
                errors.append(
                    {
                        "row": row_num,
                        "error": "Category name must be 255 characters or fewer",
                    }
                )
                failed += 1
                continue
            new_category, category_error = await service.create_category(
                organization_id=org_id,
                category_data=category_data,
                created_by=current_user.id,
            )
            if category_error or new_category is None:
                # create_category returns the raw exception text, which is not
                # fit for a client: logged here, summarized in the response.
                logger.error(
                    "Medical import could not create category on row {}: {}",
                    row_num,
                    category_error,
                )
                errors.append(
                    {"row": row_num, "error": "Could not create the category"}
                )
                failed += 1
                continue
            category_id = str(new_category.id)
            medical_by_name[category_key] = category_id
            created_categories.append(new_category.name)
        item_data["category_id"] = category_id

        vendor_raw = (item_data.get("vendor") or "").strip()
        unmatched_key = ""
        if vendor_raw:
            vendor_id = vendor_by_name.get(vendor_raw.lower())
            if vendor_id:
                item_data["vendor_id"] = vendor_id
            else:
                unmatched_key = vendor_raw.lower()

        if lot_fields is not None:
            # The row's count goes into the lot, not the column. add_lot
            # carries a positive column count forward into an undated
            # opening-balance lot, so leaving it there would count the same
            # boxes twice.
            item_data["quantity"] = 0

        new_item, error = await service.create_item(
            organization_id=org_id,
            item_data=item_data,
            created_by=current_user.id,
        )
        if error or new_item is None:
            errors.append(
                {"row": row_num, "error": sanitize_error_message(error or "")}
            )
            failed += 1
            continue
        imported += 1
        if unmatched_key:
            unmatched_vendors.setdefault(unmatched_key, vendor_raw)

        if lot_fields is not None:
            pool_by_name.setdefault(normalize_name(new_item.name), str(new_item.id))
            kept_in_stock.add(str(new_item.id))
            lot = await service.add_lot(
                item_id=str(new_item.id),
                organization_id=org_id,
                data=lot_data,
                created_by=str(current_user.id),
                required_item_types=MEDICAL_ITEM_TYPES,
            )
            if lot is None:
                errors.append(
                    {
                        "row": row_num,
                        "error": "The supply was created but its lot was not",
                    }
                )
            else:
                lots_added += 1

    if created_categories:
        warnings.insert(
            0,
            f"Created {len(created_categories)} new medical supply "
            f"categor{'y' if len(created_categories) == 1 else 'ies'}: "
            + ", ".join(f'"{name}"' for name in created_categories[:10])
            + (
                f", and {len(created_categories) - 10} more"
                if len(created_categories) > 10
                else ""
            )
            + ".",
        )
    if unmatched_vendors:
        shown = [unmatched_vendors[key] for key in sorted(unmatched_vendors)]
        listed = ", ".join(f'"{name}"' for name in shown[:10])
        if len(shown) > 10:
            listed += f", and {len(shown) - 10} more"
        warnings.append(
            f"{len(shown)} vendor name(s) did not match a vendor on file and "
            f"were left as free text: {listed}."
        )

    if imported > 0 or lots_added > 0 or created_categories:
        await log_audit_event(
            db=db,
            event_type="medical_items_imported",
            event_category="inventory",
            severity="info",
            event_data={
                "imported": imported,
                "lots_added": lots_added,
                "failed": failed,
                "total_rows": len(rows),
                "categories_created": created_categories,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

    return {
        "imported": imported,
        "lots_added": lots_added,
        "failed": failed,
        "total_rows": len(rows),
        "categories_created": created_categories,
        "errors": errors[:50],
        "warnings": warnings[:50],
    }


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

    item = await service.get_item_by_id(
        item_id, current_user.organization_id, attach_lot_stock=True
    )
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
    if error or new_item is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error or ""),
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


@router.post(
    "/items/create-if-absent", response_model=InventoryItemCreateIfAbsentResult
)
async def create_medical_item_if_absent(
    item: InventoryItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Create a medical supply item, or return the one already carrying the name

    The equipment check builder's create-and-link path for medical stock. The
    gear counterpart (`POST /inventory/items/create-if-absent`) files the new
    row with no category, which made it gear: it never appeared on the
    Medical Supplies page and the supply officer could not see the item a
    rig's checklist was counting. This route requires a medical category, so
    the row lands where the EMS officer manages it.

    A pool name already on file in the medical domain is handed back with
    `created: false`. One filed as gear or uniforms is refused with 409 — the
    caller asked for medical stock, and linking a gear row would leave the
    position off the supply officer's list. The response does not describe
    the other row.

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    data = item.model_dump(exclude_unset=True)

    await _require_medical_category(service, str(data.get("category_id") or ""), org_id)

    try:
        new_item, created, error = await service.create_item_if_absent(
            organization_id=org_id,
            item_data=data,
            created_by=current_user.id,
            item_types=MEDICAL_ITEM_TYPES,
        )
    except ItemNameTakenOutsideDomainError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "An item with this name already exists outside Medical "
                "Supplies. Ask your quartermaster to move it into a medical "
                "category, or choose a different name."
            ),
        )

    if error or new_item is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error or "Could not create the item"),
        )

    if created:
        await log_audit_event(
            db=db,
            event_type="medical_item_created",
            event_category="inventory",
            severity="info",
            event_data={"item_id": str(new_item.id), "item_name": new_item.name},
            user_id=str(current_user.id),
            username=current_user.username,
        )

    return InventoryItemCreateIfAbsentResult(item=new_item, created=created)


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

    # The preflights above fail fast; required_item_types is the
    # authoritative check, repeated under the item's lock (MSUP-25).
    updated, error = await service.update_item(
        item_id=item_id,
        organization_id=current_user.organization_id,
        update_data=data,
        required_item_types=MEDICAL_ITEM_TYPES,
    )
    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )
    if not updated:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)

    await log_audit_event(
        db=db,
        event_type="medical_item_updated",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(item_id),
            "fields_updated": list(data.keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return updated


@router.post("/items/{item_id}/retire", status_code=status.HTTP_200_OK)
async def retire_medical_item(
    item_id: UUID,
    retire_data: ItemRetireRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Retire a medical supply item (soft delete)

    Every other write route on this router grants `inventory.manage_medical`
    the same access as the broader `inventory.manage`, but the only retire
    route lived on the general inventory router gated on `inventory.manage`
    alone -- so once the generic item PATCH stopped accepting `active` (it
    now rejects that field outright; retirement is `retire_item`'s job
    alone), a caller holding only `inventory.manage_medical` had no way to
    retire a medical item at all. This mirrors `inventory.py`'s retire route
    behind this router's own domain check, closing that gap.

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    # A fast-fail preflight matching every other route on this router, plus
    # the authoritative check: `required_item_types` re-validates domain
    # membership against the item's *locked* category_id, so a concurrent
    # reclassification between this preflight and retire_item's lock can't
    # let a medical-only manager retire an item that raced out of the
    # medical domain.
    await _require_medical_item(service, str(item_id), org_id)

    _, error = await service.retire_item(
        item_id=item_id,
        organization_id=current_user.organization_id,
        notes=retire_data.notes,
        required_item_types=MEDICAL_ITEM_TYPES,
    )
    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="medical_item_retired",
        event_category="inventory",
        severity="warning",
        event_data={
            "item_id": str(item_id),
            "action": "retired",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return {"message": "Item retired successfully"}


@router.post("/items/bulk-retire", response_model=ItemBulkRetireResult)
async def bulk_retire_medical_items(
    data: ItemBulkRetireRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.manage_medical", "inventory.manage")
    ),
):
    """
    Retire several medical supply items at once

    Each item is retired on its own, exactly as the single retire route does
    it, so one that cannot go — checked out, assigned, or not a medical
    supply — is reported and the rest still are. This is the opposite of a
    received delivery, which is all or nothing: there a partial write leaves
    stock nobody can reconcile, while here every item retired is retired
    correctly, and the response names the ones that were not.

    An id that is not a medical supply in the caller's department is
    reported as not found, the same answer the single route gives.

    **Authentication required**
    **Requires permission: inventory.manage_medical or inventory.manage**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    # Order kept, duplicates dropped: retiring the same row twice would
    # report a spurious failure for the second attempt.
    item_ids = list(dict.fromkeys(str(item_id) for item_id in data.item_ids))
    in_domain = await service.items_in_domain(item_ids, org_id, MEDICAL_ITEM_TYPES)

    retired: List[str] = []
    failed: List[ItemBulkRetireFailure] = []
    for item_id in item_ids:
        if item_id not in in_domain:
            failed.append(ItemBulkRetireFailure(item_id=item_id, error=_NOT_FOUND))
            continue
        # required_item_types repeats the domain check under the item's lock,
        # as on the single route.
        _, error = await service.retire_item(
            item_id=UUID(item_id),
            organization_id=current_user.organization_id,
            notes=data.notes,
            required_item_types=MEDICAL_ITEM_TYPES,
        )
        if error:
            failed.append(
                ItemBulkRetireFailure(
                    item_id=item_id,
                    error=(
                        _NOT_FOUND
                        if error == "Item not found"
                        else sanitize_error_message(error)
                    ),
                )
            )
        else:
            retired.append(item_id)

    if retired:
        await log_audit_event(
            db=db,
            event_type="medical_items_bulk_retired",
            event_category="inventory",
            severity="warning",
            event_data={
                "item_ids": retired,
                "failed": len(failed),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return ItemBulkRetireResult(retired=retired, failed=failed)


# ============================================
# Stock lots
# ============================================


@router.get("/storage-options", response_model=MedicalStorageOptionsResponse)
async def list_medical_storage_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    Rooms and active storage areas a medical supply can be filed under

    The same rooms and areas Inventory › Storage Areas manages, read here so a
    medical-only officer can file and find supplies without being granted
    general inventory access. Read-only; areas are still created and edited
    under Inventory.

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    areas = await service.storage_area_index(org_id)
    rooms = await service.location_names(org_id)
    options = sorted(
        (a for a in areas.values() if a["is_active"]),
        key=lambda a: (
            (a["location_name"] or "").lower(),
            [p.lower() for p in a["path"]],
        ),
    )
    return MedicalStorageOptionsResponse(
        rooms=[
            MedicalStorageRoom(id=room_id, name=name)
            for room_id, name in sorted(rooms.items(), key=lambda r: r[1].lower())
        ],
        areas=[
            MedicalStorageAreaOption(
                id=a["id"],
                name=a["name"],
                label=a["label"],
                storage_type=a["storage_type"],
                parent_id=a["parent_id"],
                location_id=a["location_id"],
                location_name=a["location_name"],
                path=" › ".join(a["path"]),
            )
            for a in options
        ],
    )


@router.get("/items/{item_id}/placements", response_model=list[ItemDeployment])
async def list_medical_item_placements(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    Which apparatus checklists carry this medical supply, and what is aboard

    The medical-domain read of ``/equipment-checks/supply/item-deployments``,
    which needs inventory or checklist access a medical-only officer may not
    hold.

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    await _require_medical_item(service, item_id, org_id)
    return await EquipmentCheckService(db).get_item_deployments(
        inventory_item_id=item_id, organization_id=org_id
    )


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
        required_item_types=MEDICAL_ITEM_TYPES,
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

    # Every line is checked before any is written, in one query rather than
    # one round trip per line — a request near the schema's 200-entry cap
    # would otherwise cost 200 sequential queries. A partially-received
    # shipment is worse than a rejected one: the officer cannot tell which
    # lines landed without re-counting the whole delivery.
    ids = [str(entry.inventory_item_id) for entry in data.entries]
    in_domain = await service.items_in_domain(ids, org_id, MEDICAL_ITEM_TYPES)
    if any(item_id not in in_domain for item_id in ids):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)

    try:
        return await service.add_lots_bulk(
            organization_id=org_id,
            entries=[e.model_dump(exclude_unset=True) for e in data.entries],
            created_by=str(current_user.id),
            required_item_types=MEDICAL_ITEM_TYPES,
        )
    except ItemOutsideDomainError:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
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
            required_item_types=MEDICAL_ITEM_TYPES,
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

    try:
        deleted = await service.delete_lot(
            lot_id, org_id, required_item_types=MEDICAL_ITEM_TYPES
        )
    except LotReceivedAgainstReorderError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=safe_error_detail(e)
        )
    if not deleted:
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
    today = await resolve_org_today(db, current_user.organization_id)
    rows = await service.get_expiring_lots(
        str(current_user.organization_id),
        days_ahead,
        item_types=MEDICAL_ITEM_TYPES,
        today=today,
    )
    # Sizes looked up separately rather than widening get_expiring_lots, whose
    # other callers (the gear endpoint, the daily digest) have no use for them.
    # Here they are what tells the adult mask's lot from the pediatric one's.
    sizes = await service.item_sizes(
        str(current_user.organization_id),
        {str(lot.inventory_item_id) for lot, _ in rows},
    )
    result: List[ExpiringLotResponse] = []
    for lot, item_name in rows:
        days_until = (lot.expiration_date - today).days if lot.expiration_date else None
        result.append(
            ExpiringLotResponse.model_validate(lot, from_attributes=True).model_copy(
                update={
                    "item_name": item_name,
                    "item_size": sizes.get(str(lot.inventory_item_id)),
                    "days_until_expiration": days_until,
                }
            )
        )
    return result


async def _shelf_stock_rows(
    service: InventoryService,
    org_id: str,
    shelf: Sequence[Tuple[Any, Optional[str]]],
    today: date,
) -> List[MedicalExpiringStockRow]:
    """Shelf lots in the row shape the expiring list and the lot search share."""
    item_ids = {str(lot.inventory_item_id) for lot, _ in shelf}
    sizes = await service.item_sizes(org_id, item_ids)
    paths = await service.storage_paths_for(org_id, item_ids)
    rows: List[MedicalExpiringStockRow] = []
    for lot, item_name in shelf:
        item_id = str(lot.inventory_item_id)
        rows.append(
            MedicalExpiringStockRow(
                key=f"lot:{lot.id}",
                location="shelf",
                inventory_item_id=item_id,
                item_name=item_name,
                item_size=sizes.get(item_id),
                lot_id=str(lot.id),
                lot_number=lot.lot_number,
                expiration_date=lot.expiration_date,
                days_until_expiration=(
                    (lot.expiration_date - today).days if lot.expiration_date else None
                ),
                quantity=lot.quantity,
                # A lot's own location note outranks the supply's filing.
                where=lot.storage_location or paths.get(item_id),
            )
        )
    return rows


@router.get("/lots/search", response_model=list[MedicalExpiringStockRow])
async def search_medical_lots(
    lot_number: str = Query(..., min_length=2, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    Find every unit of a lot, on the shelves and on the apparatus

    The recall lookup: medical stock whose lot number contains
    ``lot_number`` (case-insensitive), wherever it is held, with how many
    units and where. Dated or not, expired or not; units that are gone
    (empty lots, positions holding nothing) are left out. Same row shape as
    ``/expiring-stock``, soonest expiry first and undated last.

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    needle = lot_number.strip()
    if len(needle) < 2:
        raise HTTPException(
            status_code=400, detail="Enter at least 2 characters of the lot number"
        )
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    today = await resolve_org_today(db, org_id)
    shelf = await service.find_lots_by_number(
        org_id, needle, item_types=MEDICAL_ITEM_TYPES
    )
    rows = await _shelf_stock_rows(service, org_id, shelf, today)
    aboard = await EquipmentCheckService(db).apparatus_expiring_stock(
        org_id,
        list(MEDICAL_ITEM_TYPES),
        days_ahead=None,
        today=today,
        lot_number=needle,
    )
    rows.extend(MedicalExpiringStockRow(**row) for row in aboard)
    rows.sort(
        key=lambda r: (
            r.expiration_date is None,
            r.expiration_date or date.max,
            r.item_name or "",
            r.where or "",
        )
    )
    return rows


@router.get("/expiring-stock", response_model=list[MedicalExpiringStockRow])
async def list_expiring_medical_stock(
    days_ahead: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.view_medical", "inventory.view")
    ),
):
    """
    Medical stock expiring within N days, on the shelves and on the apparatus

    One list for everything to pull: shelf lots (with their storage path) and
    units aboard the trucks (with the apparatus and compartment), soonest
    first. ``/expiring-lots`` remains the shelf-only list.

    **Authentication required**
    **Requires permission: inventory.view_medical or inventory.view**
    """
    service = InventoryService(db)
    org_id = str(current_user.organization_id)
    today = await resolve_org_today(db, org_id)
    shelf = await service.get_expiring_lots(
        org_id, days_ahead, item_types=MEDICAL_ITEM_TYPES, today=today
    )
    rows = await _shelf_stock_rows(service, org_id, shelf, today)
    aboard = await EquipmentCheckService(db).apparatus_expiring_stock(
        org_id, list(MEDICAL_ITEM_TYPES), days_ahead=days_ahead, today=today
    )
    rows.extend(MedicalExpiringStockRow(**row) for row in aboard)
    rows.sort(
        key=lambda r: (
            r.expiration_date or date.max,
            (r.item_name or "").lower(),
            r.location,
        )
    )
    return rows


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

    # `total` comes from get_items's own count query, which covers the whole
    # org regardless of `limit` — a minimal limit here avoids fetching (and
    # eager-loading) rows this endpoint doesn't otherwise need.
    _items, total = await service.get_items(
        organization_id=current_user.organization_id,
        item_types=MEDICAL_ITEM_TYPES,
        active_only=True,
        limit=1,
    )
    today = await resolve_org_today(db, org_id)
    expiring = await service.get_expiring_lots(
        org_id, expiring_within_days, item_types=MEDICAL_ITEM_TYPES, today=today
    )

    already_expired = sum(
        1 for lot, _ in expiring if lot.expiration_date and lot.expiration_date < today
    )

    # Reorder point is the department's own floor for the item, so "low"
    # means what they said it means rather than a number chosen here.
    # `get_low_stock_items_for_alerts` narrows to items with a reorder point
    # set before loading any rows, so this has no page-size cap — a fixed
    # cap here previously undercounted for any department past it.
    low_stock_items = await service.get_low_stock_items_for_alerts(
        current_user.organization_id, item_types=MEDICAL_ITEM_TYPES
    )
    low_stock = len(low_stock_items)

    # Truck stock in the same window, counted apart so the tiles can say how
    # much of each figure is on the apparatus. The shelf figures above keep
    # their meaning; the page adds the two.
    aboard = await EquipmentCheckService(db).apparatus_expiring_stock(
        org_id,
        list(MEDICAL_ITEM_TYPES),
        days_ahead=expiring_within_days,
        today=today,
    )
    expired_aboard = sum(1 for r in aboard if r["expiration_date"] < today)
    # Supplies, not positions: the figure the "Not yet counted" view lists.
    uncounted = await service.item_ids_with_uncounted_positions(
        org_id, MEDICAL_ITEM_TYPES
    )

    return {
        "total_items": total,
        "expiring_soon": len(expiring) - already_expired,
        "expired": already_expired,
        "low_stock": low_stock,
        "expiring_within_days": expiring_within_days,
        "expiring_soon_on_apparatus": len(aboard) - expired_aboard,
        "expired_on_apparatus": expired_aboard,
        "uncounted_on_apparatus": len(uncounted),
    }
