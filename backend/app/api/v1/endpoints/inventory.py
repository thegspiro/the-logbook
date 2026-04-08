"""
Inventory API Endpoints

Endpoints for inventory management including categories, items, assignments,
checkouts, maintenance, and reporting.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
)
from fastapi import File as FastAPIFile
from fastapi import (
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import generate_uuid, safe_error_detail, sanitize_error_message
from app.core.websocket_manager import ws_manager
from app.models.inventory import (
    AssignmentType,
    CheckOutRecord,
    EquipmentRequest,
    InventoryCategory,
    InventoryItem,
    IssuanceAllowance,
    ItemCondition,
    ItemIssuance,
    ItemStatus,
    ItemType,
    NFPAExposureRecord,
    NFPAItemCompliance,
    StorageArea,
)
from app.models.operational_rank import OperationalRank
from app.models.user import User
from app.schemas.inventory import (
    BatchCheckoutRequest,
    BatchCheckoutResponse,
    BatchReturnRequest,
    BatchReturnResponse,
    CheckInRequest,
    CheckOutCreate,
    CheckoutExtendRequest,
    CheckOutRecordResponse,
    ClearanceLineItemResponse,
    CompleteClearanceRequest,
    DepartureClearanceCreate,
    DepartureClearanceResponse,
    EquipmentRequestCreate,
    EquipmentRequestReview,
    InventoryCategoryCreate,
    InventoryCategoryResponse,
    InventoryCategoryUpdate,
    InventoryItemCreate,
    InventoryItemResponse,
    InventoryItemUpdate,
    InventorySummary,
    ItemAssignmentCreate,
    ItemAssignmentResponse,
    ItemIssuanceCreate,
    ItemIssuanceResponse,
    ItemIssuanceReturnRequest,
    ItemRetireRequest,
    ItemsListResponse,
    LabelGenerateRequest,
    LowStockItem,
    MaintenanceRecordCreate,
    MaintenanceRecordResponse,
    MaintenanceRecordUpdate,
    MembersInventoryListResponse,
    NFPAComplianceCreate,
    NFPAComplianceResponse,
    NFPAComplianceUpdate,
    NFPAExposureRecordCreate,
    NFPAExposureRecordResponse,
    NFPASummaryResponse,
    ResolveClearanceItemRequest,
    ScanLookupListResponse,
    ScanLookupResponse,
    StorageAreaCreate,
    StorageAreaResponse,
    StorageAreaUpdate,
    UnassignItemRequest,
    UserInventoryResponse,
    WriteOffRequestCreate,
    WriteOffRequestResponse,
    WriteOffReview,
    SizeVariantCreate,
    SizeVariantCreateResponse,
    BulkIssuanceRequest,
    BulkIssuanceResponse,
    BulkIssuanceResultItem,
    IssuanceAllowanceCreate,
    IssuanceAllowanceUpdate,
    IssuanceAllowanceResponse,
    AllowanceCheckResponse,
    IssuanceChargeRequest,
    ChargeManagementResponse,
    IssuanceChargeListItem,
    ReorderRequestCreate,
    ReorderRequestResponse,
    ReorderRequestUpdate,
    ReturnRequestCreate,
    ReturnRequestReview,
    ReturnRequestResponse,
    LocationInventorySummary,
    ItemVariantGroupCreate,
    ItemVariantGroupUpdate,
    ItemVariantGroupResponse,
    ItemVariantGroupDetailResponse,
    EquipmentKitCreate,
    EquipmentKitUpdate,
    EquipmentKitResponse,
    EquipmentKitDetailResponse,
    MemberSizePreferencesCreate,
    MemberSizePreferencesResponse,
)
from app.services.departure_clearance_service import DepartureClearanceService
from app.services.inventory_service import InventoryService

router = APIRouter()


async def _publish_inventory_event(org_id: str, action: str, data: dict = None):
    """Publish a real-time inventory event to WebSocket clients."""
    try:
        await ws_manager.publish_event(
            org_id,
            {
                "type": "inventory_changed",
                "action": action,
                "data": data or {},
            },
        )
    except Exception:
        pass  # Never let WS publishing break an API response


# ============================================
# Category Endpoints
# ============================================


@router.get("/categories", response_model=list[InventoryCategoryResponse])
async def list_categories(
    item_type: str | None = None,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    List all inventory categories

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    categories = await service.get_categories(
        organization_id=current_user.organization_id,
        item_type=item_type,
        active_only=active_only,
    )
    return categories


@router.post(
    "/categories",
    response_model=InventoryCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_category(
    category: InventoryCategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Create a new inventory category

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    new_category, error = await service.create_category(
        organization_id=current_user.organization_id,
        category_data=category.model_dump(),
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_category_created",
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
async def update_category(
    category_id: UUID,
    update_data: InventoryCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Update an inventory category

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    updated_category, error = await service.update_category(
        category_id=category_id,
        organization_id=current_user.organization_id,
        update_data=update_data.model_dump(exclude_unset=True),
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_category_updated",
        event_category="inventory",
        severity="info",
        event_data={
            "category_id": str(category_id),
            "fields_updated": list(update_data.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return updated_category


@router.get("/categories/{category_id}", response_model=InventoryCategoryResponse)
async def get_category(
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get a specific category by ID

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    category = await service.get_category_by_id(
        category_id=category_id,
        organization_id=current_user.organization_id,
    )

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )

    return category


# ============================================
# Item Endpoints
# ============================================


@router.get("/items", response_model=ItemsListResponse)
async def list_items(
    category_id: UUID | None = None,
    status: str | None = None,
    condition: str | None = None,
    item_type: str | None = None,
    assigned_to: UUID | None = None,
    location_id: UUID | None = None,
    storage_area_id: UUID | None = None,
    search: str | None = None,
    active_only: bool = True,
    sort_by: str | None = None,
    sort_order: str | None = Query(None, pattern="^(asc|desc)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    List inventory items with filtering, sorting, and pagination

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)

    # Convert status string to enum if provided
    status_enum = None
    if status:
        try:
            status_enum = ItemStatus(status)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status: {status}",
            )

    # Convert condition string to enum if provided
    condition_enum = None
    if condition:
        try:
            condition_enum = ItemCondition(condition)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid condition: {condition}",
            )

    # Convert item_type string to enum if provided
    item_type_enum = None
    if item_type:
        try:
            item_type_enum = ItemType(item_type)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid item_type: {item_type}",
            )

    items, total = await service.get_items(
        organization_id=current_user.organization_id,
        category_id=category_id,
        status=status_enum,
        condition=condition_enum,
        item_type=item_type_enum,
        assigned_to=assigned_to,
        location_id=location_id,
        storage_area_id=storage_area_id,
        search=search,
        active_only=active_only,
        sort_by=sort_by,
        sort_order=sort_order,
        skip=skip,
        limit=limit,
    )

    return ItemsListResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post(
    "/items", response_model=InventoryItemResponse, status_code=status.HTTP_201_CREATED
)
async def create_item(
    item: InventoryItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Create a new inventory item

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    new_item, error = await service.create_item(
        organization_id=current_user.organization_id,
        item_data=item.model_dump(exclude_unset=True),
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_item_created",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(new_item.id),
            "item_name": new_item.name,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "item_created",
        {"item_id": str(new_item.id), "item_name": new_item.name},
    )

    return new_item


@router.get("/items/export")
async def export_items_csv(
    category_id: UUID | None = None,
    status: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Export inventory items as CSV."""
    import csv
    import io

    from starlette.responses import StreamingResponse

    service = InventoryService(db)
    status_enum = None
    if status:
        try:
            status_enum = ItemStatus(status)
        except ValueError:
            pass

    items, _ = await service.get_items(
        organization_id=current_user.organization_id,
        category_id=category_id,
        status=status_enum,
        search=search,
        active_only=True,
        limit=10000,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Name",
            "Category",
            "Serial Number",
            "Asset Tag",
            "Barcode",
            "Status",
            "Condition",
            "Storage Location",
            "Station",
            "Manufacturer",
            "Model Number",
            "Quantity",
            "Tracking Type",
            "Purchase Date",
            "Purchase Price",
            "Vendor",
            "Warranty Expiration",
            "Notes",
        ]
    )
    for item in items:
        cat_name = item.category.name if item.category else ""
        writer.writerow(
            [
                item.name,
                cat_name,
                item.serial_number or "",
                item.asset_tag or "",
                item.barcode or "",
                (
                    item.status.value
                    if hasattr(item.status, "value")
                    else str(item.status)
                ),
                (
                    item.condition.value
                    if hasattr(item.condition, "value")
                    else str(item.condition)
                ),
                item.storage_location or "",
                item.station or "",
                item.manufacturer or "",
                item.model_number or "",
                item.quantity,
                (
                    item.tracking_type.value
                    if hasattr(item.tracking_type, "value")
                    else str(item.tracking_type)
                ),
                str(item.purchase_date) if item.purchase_date else "",
                str(item.purchase_price) if item.purchase_price else "",
                item.vendor or "",
                str(item.warranty_expiration) if item.warranty_expiration else "",
                item.notes or "",
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=inventory_export.csv"},
    )


@router.get("/items/import-template")
async def download_import_template(
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Download a sample CSV template for inventory import."""
    import csv
    import io

    from starlette.responses import StreamingResponse

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Name",
            "Category",
            "Item Type",
            "Serial Number",
            "Asset Tag",
            "Status",
            "Condition",
            "Tracking Type",
            "Quantity",
            "Manufacturer",
            "Model Number",
            "Purchase Date",
            "Purchase Price",
            "Purchase Order",
            "Vendor",
            "Warranty Expiration",
            "Storage Location",
            "Station",
            "Size",
            "Color",
            "Description",
            "Notes",
        ]
    )
    # Example rows
    writer.writerow(
        [
            "Motorola APX 8000",
            "Portable Radios",
            "electronics",
            "SN-88432",
            "AT-1001",
            "available",
            "good",
            "individual",
            "1",
            "Motorola",
            "APX 8000",
            "2024-06-15",
            "5500.00",
            "PO-2024-0042",
            "Radio Systems Inc",
            "2027-06-15",
            "Apparatus Bay - Rack A",
            "Station 1",
            "",
            "Black",
            "VHF/UHF portable radio",
            "",
        ]
    )
    writer.writerow(
        [
            "Nitrile Gloves (Box)",
            "Medical Supplies",
            "consumable",
            "",
            "",
            "available",
            "good",
            "pool",
            "50",
            "Kimberly-Clark",
            "KC-200L",
            "2025-01-10",
            "12.99",
            "",
            "MedSupply Co",
            "",
            "EMS Room - Cabinet B",
            "Station 1",
            "Large",
            "Blue",
            "Box of 200 nitrile exam gloves",
            "Reorder when below 10 boxes",
        ]
    )
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=inventory_import_template.csv"
        },
    )


@router.post("/items/import")
async def import_items_csv(
    file: UploadFile = FastAPIFile(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Import inventory items from a CSV file.

    The CSV should contain a header row with columns matching the template
    (download via GET /items/import-template). The 'Name' column is required.
    The 'Barcode' column is intentionally excluded — barcodes are auto-generated.
    Categories are matched by name (case-insensitive); unmatched category names
    are reported as warnings but the row is still imported without a category.
    """
    import csv
    import io

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Please upload a CSV file.",
        )

    # Read and decode file
    try:
        raw = await file.read()
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            content = raw.decode("latin-1")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read the uploaded file.",
        )

    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV file is empty or has no header row.",
        )

    # Normalize headers: lowercase + strip
    header_map: Dict[str, str] = {}
    for raw_name in reader.fieldnames:
        header_map[raw_name] = raw_name.strip().lower()

    # Check required 'name' column exists
    name_col = None
    for raw_name, normalized in header_map.items():
        if normalized == "name":
            name_col = raw_name
            break

    if not name_col:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV must contain a 'Name' column.",
        )

    # Pre-load categories for name matching
    service = InventoryService(db)
    categories = await service.get_categories(
        organization_id=current_user.organization_id, active_only=True
    )
    cat_by_name: Dict[str, str] = {}
    for cat in categories:
        cat_by_name[cat.name.strip().lower()] = str(cat.id)

    # Map normalized column names to item fields
    COLUMN_TO_FIELD = {
        "name": "name",
        "description": "description",
        "serial number": "serial_number",
        "serial_number": "serial_number",
        "serialnumber": "serial_number",
        "asset tag": "asset_tag",
        "asset_tag": "asset_tag",
        "assettag": "asset_tag",
        "status": "status",
        "condition": "condition",
        "tracking type": "tracking_type",
        "tracking_type": "tracking_type",
        "trackingtype": "tracking_type",
        "quantity": "quantity",
        "manufacturer": "manufacturer",
        "model number": "model_number",
        "model_number": "model_number",
        "modelnumber": "model_number",
        "purchase date": "purchase_date",
        "purchase_date": "purchase_date",
        "purchasedate": "purchase_date",
        "purchase price": "purchase_price",
        "purchase_price": "purchase_price",
        "purchaseprice": "purchase_price",
        "purchase order": "purchase_order",
        "purchase_order": "purchase_order",
        "purchaseorder": "purchase_order",
        "vendor": "vendor",
        "warranty expiration": "warranty_expiration",
        "warranty_expiration": "warranty_expiration",
        "warrantyexpiration": "warranty_expiration",
        "storage location": "storage_location",
        "storage_location": "storage_location",
        "storagelocation": "storage_location",
        "station": "station",
        "size": "size",
        "color": "color",
        "notes": "notes",
        "item type": "item_type",
        "item_type": "item_type",
        "itemtype": "item_type",
        "type": "item_type",
    }

    VALID_STATUSES = {
        "available",
        "assigned",
        "checked_out",
        "in_maintenance",
        "lost",
        "stolen",
        "retired",
    }
    VALID_CONDITIONS = {
        "excellent",
        "good",
        "fair",
        "poor",
        "damaged",
        "out_of_service",
        "retired",
    }
    VALID_TRACKING = {"individual", "pool"}
    VALID_ITEM_TYPES = {
        "uniform",
        "ppe",
        "tool",
        "equipment",
        "vehicle",
        "electronics",
        "consumable",
        "other",
    }

    imported = 0
    failed = 0
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = []

    rows = list(reader)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV file contains no data rows.",
        )

    for row_num, row in enumerate(rows, start=2):  # Row 1 is header
        # Build item data from CSV columns
        item_data: Dict[str, Any] = {}
        category_name_raw: Optional[str] = None

        for raw_col, value in row.items():
            if not value or not value.strip():
                continue
            value = value.strip()
            normalized = raw_col.strip().lower()

            # Handle category column separately
            if normalized in ("category", "category_name", "categoryname"):
                category_name_raw = value
                continue

            field = COLUMN_TO_FIELD.get(normalized)
            if not field:
                continue

            # Type conversions
            if field == "quantity":
                try:
                    item_data[field] = int(value)
                except ValueError:
                    errors.append(
                        {
                            "row": row_num,
                            "error": f"Invalid quantity value: '{value}'",
                        }
                    )
                    continue
            elif field == "purchase_price":
                try:
                    item_data[field] = float(value.replace("$", "").replace(",", ""))
                except ValueError:
                    errors.append(
                        {
                            "row": row_num,
                            "error": f"Invalid purchase price: '{value}'",
                        }
                    )
                    continue
            elif field == "status":
                val = value.lower().replace(" ", "_")
                if val not in VALID_STATUSES:
                    errors.append(
                        {
                            "row": row_num,
                            "error": f"Invalid status: '{value}'. Must be one of: {', '.join(sorted(VALID_STATUSES))}",
                        }
                    )
                    failed += 1
                    break
                item_data[field] = val
            elif field == "condition":
                val = value.lower().replace(" ", "_")
                if val not in VALID_CONDITIONS:
                    errors.append(
                        {
                            "row": row_num,
                            "error": (
                                f"Invalid condition: '{value}'. "
                                f"Must be one of: {', '.join(sorted(VALID_CONDITIONS))}"
                            ),
                        }
                    )
                    failed += 1
                    break
                item_data[field] = val
            elif field == "tracking_type":
                val = value.lower()
                if val not in VALID_TRACKING:
                    errors.append(
                        {
                            "row": row_num,
                            "error": f"Invalid tracking type: '{value}'. Must be 'individual' or 'pool'",
                        }
                    )
                    failed += 1
                    break
                item_data[field] = val
            elif field == "item_type":
                val = value.lower().replace(" ", "_")
                if val not in VALID_ITEM_TYPES:
                    errors.append(
                        {
                            "row": row_num,
                            "error": (
                                f"Invalid item type: '{value}'. "
                                f"Must be one of: {', '.join(sorted(VALID_ITEM_TYPES))}"
                            ),
                        }
                    )
                    failed += 1
                    break
                # item_type lives on the category, not the item — store for possible category creation
                continue
            else:
                item_data[field] = value
        else:
            # Only reach here if loop completed without break (no fatal field error)
            # Require name
            if not item_data.get("name"):
                errors.append(
                    {"row": row_num, "error": "Missing required 'Name' column value"}
                )
                failed += 1
                continue

            # Match category by name
            if category_name_raw:
                cat_id = cat_by_name.get(category_name_raw.strip().lower())
                if cat_id:
                    item_data["category_id"] = cat_id
                else:
                    warnings.append(
                        f"Row {row_num}: Category '{category_name_raw}' not found — item imported without category"
                    )

            # Create item (barcode auto-generated by service)
            item_data.pop("barcode", None)
            new_item, error = await service.create_item(
                organization_id=current_user.organization_id,
                item_data=item_data,
                created_by=current_user.id,
            )

            if error:
                errors.append({"row": row_num, "error": error})
                failed += 1
            else:
                imported += 1
            continue

        # If we broke out of the inner loop (fatal field error), the row already
        # got an error entry above — just continue to the next row.
        continue

    if imported > 0:
        await log_audit_event(
            db=db,
            event_type="inventory_items_imported",
            event_category="inventory",
            severity="info",
            event_data={
                "imported": imported,
                "failed": failed,
                "total_rows": len(rows),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        await _publish_inventory_event(
            str(current_user.organization_id),
            "items_imported",
            {"count": imported},
        )

    return {
        "imported": imported,
        "failed": failed,
        "total_rows": len(rows),
        "errors": errors[:50],  # Cap error list to prevent huge responses
        "warnings": warnings[:50],
    }


@router.get("/items/{item_id}", response_model=InventoryItemResponse)
async def get_item(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get a specific item by ID with full details

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    item = await service.get_item_by_id(
        item_id=item_id,
        organization_id=current_user.organization_id,
    )

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    return item


@router.get("/items/{item_id}/history")
async def get_item_history(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get unified activity history for an item.

    Returns a chronologically sorted list of all assignments, checkouts,
    pool issuances, and maintenance events.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)

    # Verify item exists and belongs to user's org
    item = await service.get_item_by_id(
        item_id=item_id,
        organization_id=current_user.organization_id,
    )
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    events = await service.get_item_history(
        item_id=item_id,
        organization_id=current_user.organization_id,
    )
    return {"events": events}


@router.patch("/items/{item_id}", response_model=InventoryItemResponse)
async def update_item(
    item_id: UUID,
    update_data: InventoryItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Update an inventory item

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    updated_item, error = await service.update_item(
        item_id=item_id,
        organization_id=current_user.organization_id,
        update_data=update_data.model_dump(exclude_unset=True),
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_item_updated",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(item_id),
            "fields_updated": list(update_data.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "item_updated",
        {"item_id": str(item_id)},
    )

    return updated_item


@router.post("/items/{item_id}/retire", status_code=status.HTTP_200_OK)
async def retire_item(
    item_id: UUID,
    retire_data: ItemRetireRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Retire an item (soft delete)

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    success, error = await service.retire_item(
        item_id=item_id,
        organization_id=current_user.organization_id,
        notes=retire_data.notes,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_item_deleted",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(item_id),
            "action": "retired",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "item_retired",
        {"item_id": str(item_id)},
    )

    return {"message": "Item retired successfully"}


# ============================================
# Assignment Endpoints
# ============================================


@router.post("/items/{item_id}/assign", response_model=ItemAssignmentResponse)
async def assign_item(
    item_id: UUID,
    assignment_data: ItemAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Assign an item to a user

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)

    # Convert assignment_type string to enum
    try:
        assignment_type = AssignmentType(assignment_data.assignment_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid assignment type: '{assignment_data.assignment_type}'",
        )

    assignment, error = await service.assign_item_to_user(
        item_id=assignment_data.item_id,
        user_id=assignment_data.user_id,
        organization_id=current_user.organization_id,
        assigned_by=current_user.id,
        assignment_type=assignment_type,
        reason=assignment_data.assignment_reason,
        expected_return_date=assignment_data.expected_return_date,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_item_assigned",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(assignment_data.item_id),
            "user_id": str(assignment_data.user_id),
            "assignment_type": assignment_data.assignment_type,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "item_assigned",
        {
            "item_id": str(assignment_data.item_id),
            "user_id": str(assignment_data.user_id),
        },
    )

    return assignment


@router.post("/items/{item_id}/unassign", status_code=status.HTTP_200_OK)
async def unassign_item(
    item_id: UUID,
    unassign_data: UnassignItemRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Unassign an item from its current user

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)

    return_condition = None
    if unassign_data.return_condition:
        try:
            return_condition = ItemCondition(unassign_data.return_condition)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid return condition: '{unassign_data.return_condition}'",
            )

    success, error = await service.unassign_item(
        item_id=item_id,
        organization_id=current_user.organization_id,
        returned_by=current_user.id,
        return_condition=return_condition,
        return_notes=unassign_data.return_notes,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_item_unassigned",
        event_category="inventory",
        severity="info",
        event_data={"item_id": str(item_id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "item_unassigned",
        {"item_id": str(item_id)},
    )

    return {"message": "Item unassigned successfully"}


@router.get("/users/{user_id}/assignments", response_model=list[ItemAssignmentResponse])
async def get_user_assignments(
    user_id: UUID,
    active_only: bool = True,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get all assignments for a user

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    assignments = await service.get_user_assignments(
        user_id=user_id,
        organization_id=current_user.organization_id,
        active_only=active_only,
        skip=skip,
        limit=limit,
    )
    return assignments


# ============================================
# Pool Item Issuance Endpoints
# ============================================


@router.post(
    "/items/{item_id}/issue",
    response_model=ItemIssuanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def issue_from_pool(
    item_id: UUID,
    issuance_data: ItemIssuanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Issue units from a pool-tracked item to a member.

    Decrements the item's on-hand quantity and creates an issuance record.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    issuance, error = await service.issue_from_pool(
        item_id=item_id,
        user_id=issuance_data.user_id,
        organization_id=current_user.organization_id,
        issued_by=current_user.id,
        quantity=issuance_data.quantity,
        reason=issuance_data.issue_reason,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_pool_issued",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(item_id),
            "user_id": str(issuance_data.user_id),
            "quantity": issuance_data.quantity,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "pool_issued",
        {"item_id": str(item_id), "user_id": str(issuance_data.user_id)},
    )

    return issuance


@router.post("/issuances/{issuance_id}/return", status_code=status.HTTP_200_OK)
async def return_to_pool(
    issuance_id: UUID,
    return_data: ItemIssuanceReturnRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Return issued units back to the pool.

    Increments the item's on-hand quantity and closes the issuance record.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    return_condition = None
    if return_data.return_condition:
        try:
            return_condition = ItemCondition(return_data.return_condition)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid return condition: '{return_data.return_condition}'",
            )

    service = InventoryService(db)
    success, error = await service.return_to_pool(
        issuance_id=issuance_id,
        organization_id=current_user.organization_id,
        returned_by=current_user.id,
        return_condition=return_condition,
        return_notes=return_data.return_notes,
        quantity_returned=return_data.quantity_returned,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_pool_returned",
        event_category="inventory",
        severity="info",
        event_data={"issuance_id": str(issuance_id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "pool_returned",
        {"issuance_id": str(issuance_id)},
    )

    return {"message": "Items returned to pool successfully"}


@router.get("/items/{item_id}/issuances", response_model=list[ItemIssuanceResponse])
async def get_item_issuances(
    item_id: UUID,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get issuance records for a pool item (who has been issued units).

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    issuances = await service.get_item_issuances(
        item_id=item_id,
        organization_id=current_user.organization_id,
        active_only=active_only,
    )
    return issuances


@router.get("/users/{user_id}/issuances", response_model=list[ItemIssuanceResponse])
async def get_user_issuances(
    user_id: UUID,
    active_only: bool = True,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get all pool items issued to a specific user.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    issuances = await service.get_user_issuances(
        user_id=user_id,
        organization_id=current_user.organization_id,
        active_only=active_only,
        skip=skip,
        limit=limit,
    )
    return issuances


# ============================================
# Check-Out/Check-In Endpoints
# ============================================


@router.post(
    "/checkout",
    response_model=CheckOutRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
async def checkout_item(
    checkout_data: CheckOutCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Check out an item to a user

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    checkout, error = await service.checkout_item(
        item_id=checkout_data.item_id,
        user_id=checkout_data.user_id,
        organization_id=current_user.organization_id,
        checked_out_by=current_user.id,
        expected_return_at=checkout_data.expected_return_at,
        reason=checkout_data.checkout_reason,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_item_checked_out",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(checkout_data.item_id),
            "user_id": str(checkout_data.user_id),
            "checkout_id": str(checkout.id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "item_checked_out",
        {"item_id": str(checkout_data.item_id), "user_id": str(checkout_data.user_id)},
    )

    return checkout


@router.post("/checkout/{checkout_id}/checkin", status_code=status.HTTP_200_OK)
async def checkin_item(
    checkout_id: UUID,
    checkin_data: CheckInRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Check in an item

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)

    try:
        return_condition = ItemCondition(checkin_data.return_condition)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid return condition: '{checkin_data.return_condition}'",
        )

    success, error = await service.checkin_item(
        checkout_id=checkout_id,
        organization_id=current_user.organization_id,
        checked_in_by=current_user.id,
        return_condition=return_condition,
        damage_notes=checkin_data.damage_notes,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_item_checked_in",
        event_category="inventory",
        severity="info",
        event_data={"checkout_id": str(checkout_id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "item_checked_in",
        {"checkout_id": str(checkout_id)},
    )

    return {"message": "Item checked in successfully"}


@router.patch("/checkout/{checkout_id}/extend", status_code=status.HTTP_200_OK)
async def extend_checkout(
    checkout_id: UUID,
    extend_data: CheckoutExtendRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Extend a checkout's expected return date.

    Members can extend their own checkouts.
    Quartermasters (inventory.manage) can extend any checkout in their org.

    **Authentication required**
    """
    from sqlalchemy import select

    result = await db.execute(
        select(CheckOutRecord).where(
            CheckOutRecord.id == str(checkout_id),
            CheckOutRecord.organization_id == str(current_user.organization_id),
        )
    )
    checkout = result.scalar_one_or_none()

    if not checkout:
        raise HTTPException(status_code=404, detail="Checkout not found")

    if checkout.is_returned:
        raise HTTPException(status_code=400, detail="Cannot extend a returned checkout")

    # Authorization: own checkout or inventory.manage
    is_own = str(checkout.user_id) == str(current_user.id)
    can_manage = any(
        p in (role.permissions or [])
        for role in current_user.roles
        for p in ("inventory.manage", "inventory.*", "*")
    )
    if not is_own and not can_manage:
        raise HTTPException(
            status_code=403, detail="Not authorized to extend this checkout"
        )

    checkout.expected_return_at = extend_data.expected_return_at
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="inventory_checkout_extended",
        event_category="inventory",
        severity="info",
        event_data={
            "checkout_id": str(checkout_id),
            "new_return_date": extend_data.expected_return_at.isoformat(),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "checkout_extended",
        {"checkout_id": str(checkout_id)},
    )

    return {
        "message": "Checkout extended successfully",
        "expected_return_at": extend_data.expected_return_at.isoformat(),
    }


@router.get("/checkout/active")
async def get_active_checkouts(
    user_id: UUID | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get all active (not returned) checkouts

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    checkouts = await service.get_active_checkouts(
        organization_id=current_user.organization_id,
        user_id=user_id,
        skip=skip,
        limit=limit,
    )
    return {
        "checkouts": [
            {
                "checkout_id": c.id,
                "item_id": c.item_id,
                "item_name": c.item.name if c.item else "Unknown",
                "user_id": c.user_id,
                "user_name": (
                    f"{c.user.first_name} {c.user.last_name}".strip()
                    if c.user
                    else "Unknown"
                ),
                "checked_out_at": (
                    c.checked_out_at.isoformat() if c.checked_out_at else None
                ),
                "expected_return_at": (
                    c.expected_return_at.isoformat() if c.expected_return_at else None
                ),
                "is_overdue": c.is_overdue,
                "checkout_reason": c.checkout_reason,
            }
            for c in checkouts
        ],
        "total": len(checkouts),
        "skip": skip,
        "limit": limit,
    }


@router.get("/checkout/overdue")
async def get_overdue_checkouts(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get all overdue checkouts

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    checkouts = await service.get_overdue_checkouts(
        organization_id=current_user.organization_id,
        skip=skip,
        limit=limit,
    )
    return {
        "checkouts": [
            {
                "checkout_id": c.id,
                "item_id": c.item_id,
                "item_name": c.item.name if c.item else "Unknown",
                "user_id": c.user_id,
                "user_name": (
                    f"{c.user.first_name} {c.user.last_name}".strip()
                    if c.user
                    else "Unknown"
                ),
                "checked_out_at": (
                    c.checked_out_at.isoformat() if c.checked_out_at else None
                ),
                "expected_return_at": (
                    c.expected_return_at.isoformat() if c.expected_return_at else None
                ),
                "is_overdue": c.is_overdue,
                "checkout_reason": c.checkout_reason,
            }
            for c in checkouts
        ],
        "total": len(checkouts),
        "skip": skip,
        "limit": limit,
    }


# ============================================
# Maintenance Endpoints
# ============================================


@router.post(
    "/maintenance",
    response_model=MaintenanceRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_maintenance_record(
    maintenance_data: MaintenanceRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Create a maintenance record

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    maintenance, error = await service.create_maintenance_record(
        item_id=maintenance_data.item_id,
        organization_id=current_user.organization_id,
        maintenance_data=maintenance_data.model_dump(
            exclude={"item_id"}, exclude_unset=True
        ),
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_maintenance_created",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(maintenance_data.item_id),
            "maintenance_type": maintenance_data.maintenance_type,
            "is_completed": maintenance_data.is_completed,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return maintenance


@router.patch(
    "/items/{item_id}/maintenance/{record_id}", response_model=MaintenanceRecordResponse
)
async def update_maintenance_record(
    item_id: UUID,
    record_id: UUID,
    update_data: MaintenanceRecordUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Update a maintenance record

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    updated_record, error = await service.update_maintenance_record(
        record_id=record_id,
        item_id=item_id,
        organization_id=current_user.organization_id,
        update_data=update_data.model_dump(exclude_unset=True),
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_maintenance_updated",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(item_id),
            "record_id": str(record_id),
            "fields_updated": list(update_data.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return updated_record


@router.get(
    "/items/{item_id}/maintenance", response_model=list[MaintenanceRecordResponse]
)
async def get_item_maintenance_history(
    item_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get maintenance history for an item

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    maintenance_records = await service.get_item_maintenance_history(
        item_id=item_id,
        organization_id=current_user.organization_id,
        skip=skip,
        limit=limit,
    )
    return maintenance_records


@router.get("/maintenance/due", response_model=list[InventoryItemResponse])
async def get_maintenance_due(
    days_ahead: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get items with maintenance due within specified days

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    items = await service.get_maintenance_due(
        organization_id=current_user.organization_id,
        days_ahead=days_ahead,
    )
    return items


# ============================================
# Reporting & Analytics Endpoints
# ============================================


@router.get("/summary", response_model=InventorySummary)
async def get_inventory_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get inventory summary statistics.

    Admins (inventory.manage or settings.manage) see org-wide totals.
    Regular users see only their personally checked-out and assigned items.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)

    user_perms = _collect_user_permissions(current_user)
    is_admin = _has_permission("inventory.manage", user_perms) or _has_permission(
        "settings.manage", user_perms
    )

    if is_admin:
        summary = await service.get_inventory_summary(
            organization_id=current_user.organization_id
        )
    else:
        summary = await service.get_user_inventory_summary(
            organization_id=current_user.organization_id,
            user_id=str(current_user.id),
        )
    return summary


@router.get("/summary/by-location", response_model=list[LocationInventorySummary])
async def get_summary_by_location(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get inventory summary grouped by location

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    return await service.get_summary_by_location(
        organization_id=current_user.organization_id
    )


@router.get("/low-stock", response_model=list[LowStockItem])
async def get_low_stock_alerts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get categories with low stock alerts.

    Only admins (inventory.manage or settings.manage) see low-stock alerts.
    Regular users receive an empty list.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    user_perms = _collect_user_permissions(current_user)
    is_admin = _has_permission("inventory.manage", user_perms) or _has_permission(
        "settings.manage", user_perms
    )

    if not is_admin:
        return []

    service = InventoryService(db)
    low_stock = await service.get_low_stock_items(
        organization_id=current_user.organization_id
    )
    return low_stock


@router.get("/members-summary", response_model=MembersInventoryListResponse)
async def get_members_inventory_summary(
    search: str | None = Query(
        None, description="Search by name, username, or membership number"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    List all active members with their inventory item counts.

    Returns permanent assignment, checkout, issuance, and overdue counts
    for every member. Used by the Quartermaster's Members tab.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    members = await service.get_members_inventory_summary(
        organization_id=current_user.organization_id,
        search=search,
    )
    return MembersInventoryListResponse(members=members, total=len(members))


@router.get("/users/{user_id}/inventory", response_model=UserInventoryResponse)
async def get_user_inventory(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get user's complete inventory (for dashboard)

    Users can view their own inventory.
    Quartermasters can view any user's inventory.

    **Authentication required**
    """
    # Check if user is viewing their own inventory or has inventory.view permission
    if str(user_id) != str(current_user.id):
        # Check if user has inventory.view permission
        has_permission = any(
            "inventory.view" in (role.permissions or []) for role in current_user.roles
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this user's inventory",
            )

    service = InventoryService(db)
    inventory = await service.get_user_inventory(
        user_id=user_id,
        organization_id=current_user.organization_id,
    )
    return inventory


# ============================================
# Barcode Scan & Quick-Action Endpoints
# ============================================


@router.get("/lookup", response_model=ScanLookupListResponse)
async def lookup_item_by_code(
    code: str = Query(
        ..., min_length=1, description="Barcode, serial number, asset tag, or item name"
    ),
    limit: int = Query(20, ge=1, le=50, description="Maximum results to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Search inventory items by barcode, serial number, asset tag, or name.

    Supports partial matching — type part of a barcode, serial number,
    asset tag, or item name to see all matching items. Searches barcode
    first, then serial number, then asset tag, then name.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    matches = await service.search_by_code(
        code=code,
        organization_id=current_user.organization_id,
        limit=limit,
    )

    results = [
        ScanLookupResponse(
            item=item,
            matched_field=matched_field,
            matched_value=matched_value,
        )
        for item, matched_field, matched_value in matches
    ]

    return ScanLookupListResponse(results=results, total=len(results))


@router.post("/batch-checkout", response_model=BatchCheckoutResponse)
async def batch_checkout_items(
    request: BatchCheckoutRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Assign/checkout/issue multiple scanned items to a member in one operation.

    The quartermaster scans multiple barcodes, building a list, then submits
    the batch. Each item is processed based on its tracking type:
    - **Individual + available** → permanently assigned
    - **Pool item** → units issued from the pool
    - Items that are already assigned or unavailable will fail individually

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    result = await service.batch_checkout(
        user_id=request.user_id,
        organization_id=current_user.organization_id,
        performed_by=current_user.id,
        items=[item.model_dump() for item in request.items],
        reason=request.reason,
    )

    if result["successful"] > 0:
        await log_audit_event(
            db=db,
            event_type="inventory_batch_checkout",
            event_category="inventory",
            severity="info",
            event_data={
                "user_id": str(request.user_id),
                "total_scanned": result["total_scanned"],
                "successful": result["successful"],
                "failed": result["failed"],
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        await _publish_inventory_event(
            str(current_user.organization_id),
            "batch_checkout",
            {"user_id": str(request.user_id), "successful": result["successful"]},
        )

    return result


@router.post("/batch-return", response_model=BatchReturnResponse)
async def batch_return_items(
    request: BatchReturnRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Return multiple scanned items from a member in one operation.

    The quartermaster scans each item the member is turning in, building
    a list, then submits the batch. Each item is matched to its current
    assignment, checkout, or pool issuance and the appropriate return
    operation is performed.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    result = await service.batch_return(
        user_id=request.user_id,
        organization_id=current_user.organization_id,
        performed_by=current_user.id,
        items=[item.model_dump() for item in request.items],
        notes=request.notes,
    )

    if result["successful"] > 0:
        await log_audit_event(
            db=db,
            event_type="inventory_batch_return",
            event_category="inventory",
            severity="info",
            event_data={
                "user_id": str(request.user_id),
                "total_scanned": result["total_scanned"],
                "successful": result["successful"],
                "failed": result["failed"],
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        await _publish_inventory_event(
            str(current_user.organization_id),
            "batch_return",
            {"user_id": str(request.user_id), "successful": result["successful"]},
        )

    return result


# ============================================
# Barcode Label Generation
# ============================================


@router.get("/labels/formats")
async def get_label_formats(
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Return available label format presets for barcode label printing.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    formats = []
    for key, fmt in InventoryService.LABEL_FORMATS.items():
        entry = {
            "id": key,
            "description": fmt["description"],
            "type": fmt["type"],
            "auto_rotate": fmt.get("auto_rotate", False),
        }
        if fmt["type"] == "thermal":
            entry["width"] = fmt["width"]
            entry["height"] = fmt["height"]
        formats.append(entry)
    formats.append(
        {
            "id": "custom",
            "description": "Custom label size (specify width and height in inches)",
            "type": "thermal",
        }
    )
    return {"formats": formats}


@router.post("/labels/generate")
async def generate_barcode_labels(
    request: LabelGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Generate a PDF of barcode labels for the specified inventory items.

    Returns a PDF file with printable Code128 barcode labels.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    from fastapi.responses import StreamingResponse

    service = InventoryService(db)
    try:
        pdf_buf, auto_populated = await service.generate_barcode_labels(
            item_ids=request.item_ids,
            organization_id=current_user.organization_id,
            label_format=request.label_format,
            custom_width=request.custom_width,
            custom_height=request.custom_height,
            auto_rotate=request.auto_rotate,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )

    filename = f"inventory-labels-{request.label_format}.pdf"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    if auto_populated > 0:
        headers["X-Barcodes-Auto-Populated"] = str(auto_populated)
    return StreamingResponse(
        pdf_buf,
        media_type="application/pdf",
        headers=headers,
    )


# ============================================
# Departure Clearance Endpoints
# ============================================


@router.post(
    "/clearances",
    response_model=DepartureClearanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def initiate_departure_clearance(
    clearance_data: DepartureClearanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Initiate a departure clearance for a member who is leaving.

    Snapshots all outstanding items (permanent assignments, active checkouts,
    unreturned pool issuances) into clearance line items that can be
    individually resolved as the member turns in gear.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = DepartureClearanceService(db)
    clearance, error = await service.initiate_clearance(
        user_id=str(clearance_data.user_id),
        organization_id=str(current_user.organization_id),
        initiated_by=str(current_user.id),
        departure_type=clearance_data.departure_type,
        return_deadline_days=clearance_data.return_deadline_days,
        notes=clearance_data.notes,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="departure_clearance_initiated",
        event_category="inventory",
        severity="warning",
        event_data={
            "clearance_id": str(clearance.id),
            "member_user_id": str(clearance_data.user_id),
            "total_items": clearance.total_items,
            "total_value": float(clearance.total_value),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return clearance


@router.get("/clearances", response_model=dict)
async def list_departure_clearances(
    status_filter: str | None = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    List all departure clearances for the organization.

    Optionally filter by status: initiated, in_progress, completed, closed_incomplete.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = DepartureClearanceService(db)
    summaries, total = await service.list_clearances(
        organization_id=str(current_user.organization_id),
        status_filter=status_filter,
        skip=skip,
        limit=limit,
    )
    return {
        "clearances": summaries,
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get("/clearances/{clearance_id}", response_model=DepartureClearanceResponse)
async def get_departure_clearance(
    clearance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get a departure clearance with all line items.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = DepartureClearanceService(db)
    clearance = await service.get_clearance(
        clearance_id=str(clearance_id),
        organization_id=str(current_user.organization_id),
    )

    if not clearance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clearance not found",
        )

    return clearance


@router.get("/users/{user_id}/clearance", response_model=DepartureClearanceResponse)
async def get_user_departure_clearance(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the active departure clearance for a specific member.

    Members can view their own clearance. Staff with inventory.view
    can view any member's clearance.

    **Authentication required**
    """
    if str(user_id) != str(current_user.id):
        has_permission = any(
            "inventory.view" in (role.permissions or []) for role in current_user.roles
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this member's clearance",
            )

    service = DepartureClearanceService(db)
    clearance = await service.get_clearance_for_user(
        user_id=str(user_id),
        organization_id=str(current_user.organization_id),
    )

    if not clearance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active departure clearance found for this member",
        )

    return clearance


@router.post(
    "/clearances/{clearance_id}/items/{item_id}/resolve",
    response_model=ClearanceLineItemResponse,
)
async def resolve_clearance_item(
    clearance_id: UUID,
    item_id: UUID,
    resolve_data: ResolveClearanceItemRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Resolve a single clearance line item.

    Dispositions:
    - **returned** — item physically returned in acceptable condition
    - **returned_damaged** — item returned but damaged
    - **written_off** — item lost or unreturnable, written off
    - **waived** — department chose not to require return

    For 'returned' and 'returned_damaged', the underlying inventory
    operation (unassign, check-in, or pool return) is performed
    automatically.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = DepartureClearanceService(db)
    line_item, error = await service.resolve_line_item(
        clearance_item_id=str(item_id),
        clearance_id=str(clearance_id),
        organization_id=str(current_user.organization_id),
        resolved_by=str(current_user.id),
        disposition=resolve_data.disposition,
        return_condition=resolve_data.return_condition,
        resolution_notes=resolve_data.resolution_notes,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="clearance_item_resolved",
        event_category="inventory",
        severity="info",
        event_data={
            "clearance_id": str(clearance_id),
            "clearance_item_id": str(item_id),
            "item_name": line_item.item_name,
            "disposition": resolve_data.disposition,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return line_item


@router.post(
    "/clearances/{clearance_id}/complete", response_model=DepartureClearanceResponse
)
async def complete_departure_clearance(
    clearance_id: UUID,
    complete_data: CompleteClearanceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Complete (close) a departure clearance.

    If all line items are resolved, the clearance is marked as 'completed'.
    If items are still pending and force_close is True, the clearance is
    marked as 'closed_incomplete' (e.g. items written off by leadership).

    After completion, the auto-archive check runs — if the member has
    dropped status and no remaining outstanding items, they are
    automatically archived.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = DepartureClearanceService(db)
    clearance, error = await service.complete_clearance(
        clearance_id=str(clearance_id),
        organization_id=str(current_user.organization_id),
        completed_by=str(current_user.id),
        force_close=complete_data.force_close,
        notes=complete_data.notes,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="departure_clearance_completed",
        event_category="inventory",
        severity="warning",
        event_data={
            "clearance_id": str(clearance_id),
            "status": clearance.status.value,
            "items_cleared": clearance.items_cleared,
            "items_outstanding": clearance.items_outstanding,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return clearance


# ============================================
# Equipment Request Endpoints
# ============================================


@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def create_equipment_request(
    request_data: EquipmentRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create an equipment request.

    Any authenticated member can submit a request for checkout, issuance, or purchase.
    Items with a rank restriction will be validated against the requester's rank.
    """
    # --- Rank & position access check ---
    if request_data.item_id:
        item_result = await db.execute(
            select(
                InventoryItem.min_rank_order, InventoryItem.restricted_to_positions
            ).where(InventoryItem.id == str(request_data.item_id))
        )
        row = item_result.one_or_none()
        if row:
            min_rank, restricted_positions = row
            has_rank_restriction = min_rank is not None
            has_position_restriction = bool(restricted_positions)

            if has_rank_restriction or has_position_restriction:
                # Check rank qualification
                passes_rank = False
                if has_rank_restriction and current_user.rank:
                    rank_result = await db.execute(
                        select(OperationalRank.sort_order).where(
                            OperationalRank.organization_id
                            == str(current_user.organization_id),
                            OperationalRank.rank_code == current_user.rank,
                        )
                    )
                    user_sort = rank_result.scalar_one_or_none()
                    if user_sort is not None and user_sort <= min_rank:
                        passes_rank = True
                elif not has_rank_restriction:
                    passes_rank = True

                # Check position qualification
                passes_position = False
                if has_position_restriction:
                    from app.models.user import Position, user_positions

                    pos_result = await db.execute(
                        select(Position.slug)
                        .join(
                            user_positions, Position.id == user_positions.c.position_id
                        )
                        .where(
                            user_positions.c.user_id == str(current_user.id),
                            Position.slug.in_(restricted_positions),
                        )
                    )
                    if pos_result.first() is not None:
                        passes_position = True
                elif not has_position_restriction:
                    passes_position = True

                # Either qualifier grants access (OR logic)
                if not passes_rank and not passes_position:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="This item is restricted based on rank or position requirements",
                    )

    req = EquipmentRequest(
        id=generate_uuid(),
        organization_id=str(current_user.organization_id),
        requester_id=str(current_user.id),
        item_name=request_data.item_name,
        item_id=str(request_data.item_id) if request_data.item_id else None,
        category_id=str(request_data.category_id) if request_data.category_id else None,
        quantity=request_data.quantity,
        request_type=request_data.request_type,
        priority=request_data.priority,
        reason=request_data.reason,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    await log_audit_event(
        db=db,
        event_type="equipment_request_created",
        event_category="inventory",
        severity="info",
        event_data={
            "request_id": str(req.id),
            "item_name": req.item_name,
            "request_type": request_data.request_type,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "id": req.id,
        "item_name": req.item_name,
        "status": "pending",
        "message": "Request submitted successfully",
    }


@router.get("/requests")
async def list_equipment_requests(
    status_filter: str | None = Query(None, alias="status"),
    mine_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List equipment requests.

    Members see their own requests. Admins with inventory.manage see all org requests.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    query = (
        select(EquipmentRequest)
        .where(EquipmentRequest.organization_id == str(current_user.organization_id))
        .options(
            selectinload(EquipmentRequest.requester),
            selectinload(EquipmentRequest.reviewer),
        )
    )

    can_manage = any(
        "inventory.manage" in (role.permissions or []) for role in current_user.roles
    )
    if mine_only or not can_manage:
        query = query.where(EquipmentRequest.requester_id == str(current_user.id))

    if status_filter:
        query = query.where(EquipmentRequest.status == status_filter)

    query = query.order_by(EquipmentRequest.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    requests = result.scalars().all()

    return {
        "requests": [
            {
                "id": r.id,
                "requester_id": r.requester_id,
                "requester_name": (
                    f"{r.requester.first_name} {r.requester.last_name}".strip()
                    if r.requester
                    else None
                ),
                "item_name": r.item_name,
                "item_id": r.item_id,
                "category_id": r.category_id,
                "quantity": r.quantity,
                "request_type": (
                    r.request_type
                    if isinstance(r.request_type, str)
                    else r.request_type.value
                ),
                "priority": (
                    r.priority if isinstance(r.priority, str) else r.priority.value
                ),
                "reason": r.reason,
                "status": r.status if isinstance(r.status, str) else r.status.value,
                "reviewed_by": r.reviewed_by,
                "reviewer_name": (
                    f"{r.reviewer.first_name} {r.reviewer.last_name}".strip()
                    if r.reviewer
                    else None
                ),
                "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
                "review_notes": r.review_notes,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in requests
        ],
        "total": len(requests),
        "skip": skip,
        "limit": limit,
    }


@router.put("/requests/{request_id}/review")
async def review_equipment_request(
    request_id: UUID,
    review_data: EquipmentRequestReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Review (approve/deny) an equipment request.

    **Requires permission: inventory.manage**
    """
    from sqlalchemy import select

    result = await db.execute(
        select(EquipmentRequest).where(
            EquipmentRequest.id == str(request_id),
            EquipmentRequest.organization_id == str(current_user.organization_id),
        )
    )
    req = result.scalar_one_or_none()

    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    current_status = req.status if isinstance(req.status, str) else req.status.value
    if current_status != "pending":
        raise HTTPException(
            status_code=400, detail="Only pending requests can be reviewed"
        )

    if review_data.status not in ("approved", "denied"):
        raise HTTPException(
            status_code=400, detail="Status must be 'approved' or 'denied'"
        )

    req.status = review_data.status
    req.reviewed_by = str(current_user.id)
    req.reviewed_at = datetime.utcnow()
    req.review_notes = review_data.review_notes

    await db.commit()

    await log_audit_event(
        db=db,
        event_type="equipment_request_reviewed",
        event_category="inventory",
        severity="info",
        event_data={
            "request_id": str(request_id),
            "decision": review_data.status,
            "review_notes": review_data.review_notes,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "id": req.id,
        "status": review_data.status,
        "message": f"Request {review_data.status}",
    }


# ============================================
# Storage Area Endpoints
# ============================================


@router.get("/storage-areas", response_model=list[StorageAreaResponse])
async def list_storage_areas(
    location_id: str | None = Query(None, description="Filter by room/location"),
    parent_id: str | None = Query(None, description="Filter by parent storage area"),
    flat: bool = Query(False, description="Return flat list instead of tree"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    List storage areas, optionally filtered by location or parent.
    Returns a hierarchical tree by default, or flat list if flat=true.
    """
    from sqlalchemy import func as sqlfunc
    from sqlalchemy import select

    query = (
        select(StorageArea)
        .where(StorageArea.organization_id == str(current_user.organization_id))
        .where(StorageArea.is_active == True)  # noqa: E712
        .order_by(StorageArea.sort_order, StorageArea.name)
    )

    if location_id:
        query = query.where(StorageArea.location_id == location_id)
    if parent_id:
        query = query.where(StorageArea.parent_id == parent_id)
    elif not flat and not location_id:
        # For tree view, start with top-level items
        query = query.where(StorageArea.parent_id.is_(None))

    result = await db.execute(query)
    areas = result.scalars().all()

    count_result = await db.execute(
        select(
            InventoryItem.storage_area_id, sqlfunc.count(InventoryItem.id).label("cnt")
        )
        .where(InventoryItem.organization_id == str(current_user.organization_id))
        .where(InventoryItem.active == True)  # noqa: E712
        .where(InventoryItem.storage_area_id.isnot(None))
        .group_by(InventoryItem.storage_area_id)
    )
    item_counts = {row.storage_area_id: row.cnt for row in count_result.all()}

    # Load locations for names
    from app.models.location import Location

    loc_result = await db.execute(
        select(Location.id, Location.name).where(
            Location.organization_id == str(current_user.organization_id)
        )
    )
    loc_names = {row.id: row.name for row in loc_result.all()}

    def build_response(area: StorageArea) -> dict:
        resp = {
            "id": area.id,
            "organization_id": area.organization_id,
            "name": area.name,
            "label": area.label,
            "description": area.description,
            "storage_type": (
                area.storage_type.value
                if hasattr(area.storage_type, "value")
                else area.storage_type
            ),
            "parent_id": area.parent_id,
            "location_id": area.location_id,
            "barcode": area.barcode,
            "sort_order": area.sort_order or 0,
            "is_active": area.is_active,
            "created_at": area.created_at,
            "updated_at": area.updated_at,
            "created_by": area.created_by,
            "children": [],
            "item_count": item_counts.get(area.id, 0),
            "location_name": (
                loc_names.get(area.location_id) if area.location_id else None
            ),
            "parent_name": None,
        }
        return resp

    if flat:
        return [build_response(a) for a in areas]

    # Build tree: load all areas for this org to build complete tree
    all_result = await db.execute(
        select(StorageArea)
        .where(StorageArea.organization_id == str(current_user.organization_id))
        .where(StorageArea.is_active == True)  # noqa: E712
        .order_by(StorageArea.sort_order, StorageArea.name)
    )
    all_areas = all_result.scalars().all()
    area_map = {a.id: build_response(a) for a in all_areas}

    # Attach children to parents
    roots = []
    for a in all_areas:
        resp = area_map[a.id]
        if a.parent_id and a.parent_id in area_map:
            resp["parent_name"] = area_map[a.parent_id]["name"]
            area_map[a.parent_id]["children"].append(resp)
        else:
            roots.append(resp)

    return roots


@router.post(
    "/storage-areas",
    response_model=StorageAreaResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_storage_area(
    data: StorageAreaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Create a new storage area"""
    area = StorageArea(
        id=generate_uuid(),
        organization_id=str(current_user.organization_id),
        name=data.name,
        label=data.label,
        description=data.description,
        storage_type=data.storage_type,
        parent_id=str(data.parent_id) if data.parent_id else None,
        location_id=str(data.location_id) if data.location_id else None,
        barcode=data.barcode,
        sort_order=data.sort_order,
        created_by=str(current_user.id),
    )
    db.add(area)
    await db.commit()
    await db.refresh(area)

    await log_audit_event(
        db=db,
        event_type="storage_area_created",
        event_category="inventory",
        severity="info",
        event_data={
            "storage_area_id": str(area.id),
            "name": area.name,
            "storage_type": data.storage_type,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "id": area.id,
        "organization_id": area.organization_id,
        "name": area.name,
        "label": area.label,
        "description": area.description,
        "storage_type": (
            area.storage_type.value
            if hasattr(area.storage_type, "value")
            else area.storage_type
        ),
        "parent_id": area.parent_id,
        "location_id": area.location_id,
        "barcode": area.barcode,
        "sort_order": area.sort_order or 0,
        "is_active": area.is_active,
        "created_at": area.created_at,
        "updated_at": area.updated_at,
        "created_by": area.created_by,
        "children": [],
        "item_count": 0,
        "location_name": None,
        "parent_name": None,
    }


@router.put("/storage-areas/{area_id}", response_model=StorageAreaResponse)
async def update_storage_area(
    area_id: UUID,
    data: StorageAreaUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Update a storage area"""
    from sqlalchemy import select

    result = await db.execute(
        select(StorageArea)
        .where(StorageArea.id == str(area_id))
        .where(StorageArea.organization_id == str(current_user.organization_id))
    )
    area = result.scalar_one_or_none()
    if not area:
        raise HTTPException(status_code=404, detail="Storage area not found")

    ALLOWED_AREA_FIELDS = {
        "name",
        "label",
        "description",
        "storage_type",
        "parent_id",
        "location_id",
        "barcode",
        "sort_order",
        "is_active",
    }
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field not in ALLOWED_AREA_FIELDS:
            continue
        if field in ("parent_id", "location_id") and value is not None:
            value = str(value)
        setattr(area, field, value)

    await db.commit()
    await db.refresh(area)

    await log_audit_event(
        db=db,
        event_type="storage_area_updated",
        event_category="inventory",
        severity="info",
        event_data={
            "storage_area_id": str(area_id),
            "fields_updated": list(data.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "id": area.id,
        "organization_id": area.organization_id,
        "name": area.name,
        "label": area.label,
        "description": area.description,
        "storage_type": (
            area.storage_type.value
            if hasattr(area.storage_type, "value")
            else area.storage_type
        ),
        "parent_id": area.parent_id,
        "location_id": area.location_id,
        "barcode": area.barcode,
        "sort_order": area.sort_order or 0,
        "is_active": area.is_active,
        "created_at": area.created_at,
        "updated_at": area.updated_at,
        "created_by": area.created_by,
        "children": [],
        "item_count": 0,
        "location_name": None,
        "parent_name": None,
    }


@router.delete("/storage-areas/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_storage_area(
    area_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Delete (deactivate) a storage area"""
    from sqlalchemy import select

    result = await db.execute(
        select(StorageArea)
        .where(StorageArea.id == str(area_id))
        .where(StorageArea.organization_id == str(current_user.organization_id))
    )
    area = result.scalar_one_or_none()
    if not area:
        raise HTTPException(status_code=404, detail="Storage area not found")

    area.is_active = False
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="storage_area_deleted",
        event_category="inventory",
        severity="info",
        event_data={
            "storage_area_id": str(area_id),
            "name": area.name,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )


# ============================================
# Write-Off Endpoints
# ============================================


@router.post("/write-offs", response_model=WriteOffRequestResponse)
async def create_write_off_request(
    data: WriteOffRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Create a write-off request for an inventory item.

    Write-off reasons: lost, damaged_beyond_repair, obsolete, stolen, other.
    The request is created in 'pending' status and must be approved by a
    supervisor before the item is retired from inventory.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    result, error = await service.create_write_off_request(
        item_id=str(data.item_id),
        organization_id=str(current_user.organization_id),
        requested_by=str(current_user.id),
        reason=data.reason,
        description=data.description,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type="write_off_requested",
        event_category="inventory",
        severity="warning",
        event_data={
            "write_off_id": result["id"],
            "item_name": result["item_name"],
            "reason": data.reason,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return result


@router.get("/write-offs", response_model=list[WriteOffRequestResponse])
async def list_write_off_requests(
    write_off_status: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    List write-off requests for the organization.

    Optionally filter by status: pending, approved, denied.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    return await service.get_write_off_requests(
        organization_id=str(current_user.organization_id),
        status_filter=write_off_status,
    )


@router.put("/write-offs/{write_off_id}/review")
async def review_write_off_request(
    write_off_id: UUID,
    review_data: WriteOffReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Approve or deny a write-off request.

    On approval, the item is automatically marked as lost/stolen or retired
    depending on the write-off reason.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    result, error = await service.review_write_off(
        write_off_id=str(write_off_id),
        organization_id=str(current_user.organization_id),
        reviewed_by=str(current_user.id),
        decision=review_data.status,
        review_notes=review_data.review_notes,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error),
        )

    await log_audit_event(
        db=db,
        event_type=f"write_off_{review_data.status}",
        event_category="inventory",
        severity="warning",
        event_data={
            "write_off_id": str(write_off_id),
            "item_name": result["item_name"],
            "decision": review_data.status,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "write_off_reviewed",
        {"write_off_id": str(write_off_id), "decision": review_data.status},
    )

    return result


# ============================================
# NFPA 1851/1852 Compliance Endpoints
# ============================================


@router.get("/items/{item_id}/nfpa-compliance", response_model=NFPAComplianceResponse)
async def get_nfpa_compliance(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """Get NFPA compliance record for an item."""
    result = await db.execute(
        select(NFPAItemCompliance).where(
            NFPAItemCompliance.item_id == str(item_id),
            NFPAItemCompliance.organization_id == str(current_user.organization_id),
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=404, detail="No NFPA compliance record found for this item"
        )
    return record


@router.post(
    "/items/{item_id}/nfpa-compliance",
    response_model=NFPAComplianceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_nfpa_compliance(
    item_id: UUID,
    data: NFPAComplianceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Create NFPA compliance record for an item. Requires NFPA tracking on the item's category."""
    # Verify item exists and belongs to this org
    item_result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.id == str(item_id),
            InventoryItem.organization_id == str(current_user.organization_id),
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Verify category has NFPA tracking enabled
    if item.category_id:
        cat_result = await db.execute(
            select(InventoryCategory.nfpa_tracking_enabled).where(
                InventoryCategory.id == str(item.category_id)
            )
        )
        nfpa_enabled = cat_result.scalar_one_or_none()
        if not nfpa_enabled:
            raise HTTPException(
                status_code=400,
                detail="NFPA tracking is not enabled for this item's category",
            )

    # Check for existing record
    existing = await db.execute(
        select(NFPAItemCompliance.id).where(NFPAItemCompliance.item_id == str(item_id))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="NFPA compliance record already exists for this item",
        )

    record = NFPAItemCompliance(
        id=generate_uuid(),
        item_id=str(item_id),
        organization_id=str(current_user.organization_id),
        created_by=str(current_user.id),
        **data.model_dump(exclude_unset=True),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    await log_audit_event(
        db=db,
        event_type="nfpa_compliance_created",
        event_category="inventory",
        severity="info",
        event_data={"item_id": str(item_id), "item_name": item.name},
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return record


@router.patch("/items/{item_id}/nfpa-compliance", response_model=NFPAComplianceResponse)
async def update_nfpa_compliance(
    item_id: UUID,
    data: NFPAComplianceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Update NFPA compliance record for an item."""
    result = await db.execute(
        select(NFPAItemCompliance).where(
            NFPAItemCompliance.item_id == str(item_id),
            NFPAItemCompliance.organization_id == str(current_user.organization_id),
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=404, detail="No NFPA compliance record found for this item"
        )

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(record, field, value)

    await db.commit()
    await db.refresh(record)

    await log_audit_event(
        db=db,
        event_type="nfpa_compliance_updated",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(item_id),
            "fields_updated": list(update_data.keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return record


@router.delete(
    "/items/{item_id}/nfpa-compliance", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_nfpa_compliance(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Remove NFPA compliance record from an item."""
    result = await db.execute(
        select(NFPAItemCompliance).where(
            NFPAItemCompliance.item_id == str(item_id),
            NFPAItemCompliance.organization_id == str(current_user.organization_id),
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=404, detail="No NFPA compliance record found for this item"
        )

    await db.delete(record)
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="nfpa_compliance_deleted",
        event_category="inventory",
        severity="warning",
        event_data={"item_id": str(item_id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )


# --- Exposure Records ---


@router.get(
    "/items/{item_id}/exposures", response_model=list[NFPAExposureRecordResponse]
)
async def list_exposure_records(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """List exposure records for an NFPA-tracked item."""
    result = await db.execute(
        select(NFPAExposureRecord)
        .where(
            NFPAExposureRecord.item_id == str(item_id),
            NFPAExposureRecord.organization_id == str(current_user.organization_id),
        )
        .order_by(NFPAExposureRecord.exposure_date.desc())
    )
    return result.scalars().all()


@router.post(
    "/items/{item_id}/exposures",
    response_model=NFPAExposureRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_exposure_record(
    item_id: UUID,
    data: NFPAExposureRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Log a hazardous exposure event for an NFPA-tracked item."""
    # Verify item exists and belongs to this org
    item_result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.id == str(item_id),
            InventoryItem.organization_id == str(current_user.organization_id),
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    record = NFPAExposureRecord(
        id=generate_uuid(),
        item_id=str(item_id),
        organization_id=str(current_user.organization_id),
        created_by=str(current_user.id),
        exposure_type=data.exposure_type,
        exposure_date=data.exposure_date,
        incident_number=data.incident_number,
        description=data.description,
        decon_required=data.decon_required,
        decon_completed=data.decon_completed,
        decon_completed_date=data.decon_completed_date,
        decon_method=data.decon_method,
        user_id=str(data.user_id) if data.user_id else None,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    await log_audit_event(
        db=db,
        event_type="nfpa_exposure_recorded",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(item_id),
            "item_name": item.name,
            "exposure_type": data.exposure_type,
            "exposure_date": str(data.exposure_date),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return record


# --- NFPA Dashboard ---


@router.get("/nfpa/summary", response_model=NFPASummaryResponse)
async def get_nfpa_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """Get NFPA compliance dashboard summary."""
    from sqlalchemy import func as sa_func

    org_id = str(current_user.organization_id)
    today = datetime.utcnow().date()
    from datetime import timedelta

    retirement_warning_date = today + timedelta(days=180)

    # Total NFPA items
    total_result = await db.execute(
        select(sa_func.count(NFPAItemCompliance.id)).where(
            NFPAItemCompliance.organization_id == org_id
        )
    )
    total_nfpa = total_result.scalar() or 0

    # Nearing retirement (within 180 days)
    nearing_result = await db.execute(
        select(sa_func.count(NFPAItemCompliance.id)).where(
            NFPAItemCompliance.organization_id == org_id,
            NFPAItemCompliance.expected_retirement_date != None,  # noqa: E711
            NFPAItemCompliance.expected_retirement_date <= retirement_warning_date,
            NFPAItemCompliance.is_retired_by_age == False,  # noqa: E712
        )
    )
    nearing_retirement = nearing_result.scalar() or 0

    # Overdue inspection (items with next_inspection_due in the past)
    overdue_result = await db.execute(
        select(sa_func.count(InventoryItem.id)).where(
            InventoryItem.organization_id == org_id,
            InventoryItem.next_inspection_due != None,  # noqa: E711
            InventoryItem.next_inspection_due < today,
            InventoryItem.active == True,  # noqa: E712
            InventoryItem.id.in_(
                select(NFPAItemCompliance.item_id).where(
                    NFPAItemCompliance.organization_id == org_id
                )
            ),
        )
    )
    overdue_inspection = overdue_result.scalar() or 0

    # Pending decontamination
    pending_decon_result = await db.execute(
        select(sa_func.count(NFPAExposureRecord.id)).where(
            NFPAExposureRecord.organization_id == org_id,
            NFPAExposureRecord.decon_required == True,  # noqa: E712
            NFPAExposureRecord.decon_completed == False,  # noqa: E712
        )
    )
    pending_decon = pending_decon_result.scalar() or 0

    # Unique ensembles
    ensemble_result = await db.execute(
        select(sa_func.count(sa_func.distinct(NFPAItemCompliance.ensemble_id))).where(
            NFPAItemCompliance.organization_id == org_id,
            NFPAItemCompliance.ensemble_id != None,  # noqa: E711
        )
    )
    ensembles_count = ensemble_result.scalar() or 0

    return {
        "total_nfpa_items": total_nfpa,
        "nearing_retirement": nearing_retirement,
        "overdue_inspection": overdue_inspection,
        "pending_decon": pending_decon,
        "ensembles_count": ensembles_count,
    }


@router.get("/nfpa/retirement-due")
async def get_nfpa_retirement_due(
    days_ahead: int = Query(180, ge=1, le=730),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """List items approaching NFPA 10-year retirement deadline."""
    from datetime import timedelta

    org_id = str(current_user.organization_id)
    cutoff = datetime.utcnow().date() + timedelta(days=days_ahead)

    result = await db.execute(
        select(NFPAItemCompliance, InventoryItem)
        .join(InventoryItem, NFPAItemCompliance.item_id == InventoryItem.id)
        .where(
            NFPAItemCompliance.organization_id == org_id,
            NFPAItemCompliance.expected_retirement_date != None,  # noqa: E711
            NFPAItemCompliance.expected_retirement_date <= cutoff,
            NFPAItemCompliance.is_retired_by_age == False,  # noqa: E712
            InventoryItem.active == True,  # noqa: E712
        )
        .order_by(NFPAItemCompliance.expected_retirement_date)
    )

    items = []
    for compliance, item in result.all():
        items.append(
            {
                "item_id": item.id,
                "item_name": item.name,
                "serial_number": item.serial_number,
                "manufacture_date": (
                    compliance.manufacture_date.isoformat()
                    if compliance.manufacture_date
                    else None
                ),
                "expected_retirement_date": (
                    compliance.expected_retirement_date.isoformat()
                    if compliance.expected_retirement_date
                    else None
                ),
                "days_remaining": (
                    (
                        compliance.expected_retirement_date - datetime.utcnow().date()
                    ).days
                    if compliance.expected_retirement_date
                    else None
                ),
                "ensemble_id": compliance.ensemble_id,
            }
        )

    return {"items": items, "total": len(items)}


# ============================================
# WebSocket — Real-Time Inventory Updates
# ============================================


@router.websocket("/ws")
async def inventory_websocket(
    websocket: WebSocket,
    token: str | None = Query(None),
):
    """
    WebSocket endpoint for real-time inventory change notifications.

    Authentication: Prefer httpOnly cookies (sent automatically by browsers
    during the WebSocket handshake). Falls back to a query-param token for
    non-browser clients.

    Events pushed to clients:
        { "type": "inventory_changed", "action": "...", "data": {...} }

    Actions: item_created, item_updated, item_assigned, item_unassigned,
             item_checked_out, item_checked_in, batch_checkout, batch_return,
             pool_issued, pool_returned, item_retired, write_off_reviewed
    """
    # Accept the WebSocket upgrade first so that close codes are delivered
    # to the client.  Without accept(), Starlette sends a bare HTTP 403
    # which the browser surfaces as a generic error (no close code).
    await websocket.accept()

    # Prefer httpOnly cookie, fall back to query param for non-browser clients
    if not token:
        token = websocket.cookies.get("access_token")
    if not token:
        from loguru import logger

        logger.warning("Inventory WS rejected: no access_token cookie or query param")
        await websocket.close(code=4001, reason="Missing token")
        return

    # Validate JWT and verify the user session is still active
    try:
        from app.core.security import decode_token

        payload = decode_token(token)
        org_id = payload.get("org_id")
        user_id = payload.get("sub")
        if not org_id:
            await websocket.close(code=4003, reason="Invalid token")
            return

        # Verify user is still active (not revoked/deactivated)
        from sqlalchemy import select as sa_select

        from app.core.database import async_session_factory
        from app.models.user import User as UserModel

        async with async_session_factory() as db:
            result = await db.execute(
                sa_select(UserModel).where(
                    UserModel.id == user_id,
                    UserModel.organization_id == org_id,
                    UserModel.is_active.is_(True),
                    UserModel.deleted_at.is_(None),
                )
            )
            user = result.scalar_one_or_none()
            if not user:
                await websocket.close(code=4001, reason="Invalid or revoked session")
                return
    except Exception:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    await ws_manager.connect(websocket, org_id)
    try:
        while True:
            # Keep alive — clients can send pings or we just wait
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(websocket, org_id)


# ============================================
# Size Variant Quick-Create
# ============================================


@router.post(
    "/items/create-variants",
    response_model=SizeVariantCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_size_variants(
    data: SizeVariantCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Create multiple pool items from a base name with size/color variants.

    E.g. "Dept Polo" with sizes ["S", "M", "L", "XL"] and colors ["Navy", "White"]
    creates 8 items: "Dept Polo — S — Navy", "Dept Polo — S — White", etc.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    items, variant_group_id = await service.create_size_variants(
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        base_name=data.base_name,
        sizes=data.sizes,
        colors=data.colors,
        styles=data.styles,
        create_variant_group=data.create_variant_group,
        category_id=data.category_id,
        quantity_per_variant=data.quantity_per_variant,
        replacement_cost=data.replacement_cost,
        purchase_price=data.purchase_price,
        unit_of_measure=data.unit_of_measure,
        location_id=data.location_id,
        storage_area_id=data.storage_area_id,
        station=data.station,
        notes=data.notes,
    )

    await log_audit_event(
        db=db,
        event_type="inventory_variants_created",
        event_category="inventory",
        severity="info",
        event_data={
            "base_name": data.base_name,
            "sizes": data.sizes,
            "colors": data.colors,
            "styles": data.styles,
            "count": len(items),
            "variant_group_id": variant_group_id,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return SizeVariantCreateResponse(
        created_count=len(items),
        items=[InventoryItemResponse.model_validate(i) for i in items],
        variant_group_id=variant_group_id,
    )


# ============================================
# Bulk Issuance
# ============================================


@router.post(
    "/items/{item_id}/bulk-issue",
    response_model=BulkIssuanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def bulk_issue_from_pool(
    item_id: UUID,
    data: BulkIssuanceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Issue a pool item to multiple members at once.

    Useful for new recruit onboarding or uniform distribution.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    targets = [
        {
            "user_id": t.user_id,
            "quantity": t.quantity,
            "issue_reason": t.issue_reason,
        }
        for t in data.targets
    ]

    results = await service.bulk_issue_from_pool(
        item_id=item_id,
        targets=targets,
        organization_id=current_user.organization_id,
        issued_by=current_user.id,
    )

    successful = sum(1 for r in results if r["success"])
    failed = len(results) - successful

    await log_audit_event(
        db=db,
        event_type="inventory_bulk_issued",
        event_category="inventory",
        severity="info",
        event_data={
            "item_id": str(item_id),
            "total_targets": len(targets),
            "successful": successful,
            "failed": failed,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "bulk_issued",
        {"item_id": str(item_id), "count": successful},
    )

    return BulkIssuanceResponse(
        item_id=item_id,
        total=len(results),
        successful=successful,
        failed=failed,
        results=[
            BulkIssuanceResultItem(
                user_id=r["user_id"],
                success=r["success"],
                issuance_id=r.get("issuance_id"),
                error=r.get("error"),
            )
            for r in results
        ],
    )


# ============================================
# Issuance Allowances
# ============================================


@router.get("/allowances", response_model=List[IssuanceAllowanceResponse])
async def list_allowances(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """List all issuance allowances for the organization."""
    result = await db.execute(
        select(IssuanceAllowance).where(
            IssuanceAllowance.organization_id == str(current_user.organization_id)
        )
    )
    allowances = result.scalars().all()
    return [IssuanceAllowanceResponse.model_validate(a) for a in allowances]


@router.post(
    "/allowances",
    response_model=IssuanceAllowanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_allowance(
    data: IssuanceAllowanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Create an issuance allowance (e.g. 3 polo shirts/year per firefighter)."""
    allowance = IssuanceAllowance(
        organization_id=str(current_user.organization_id),
        category_id=str(data.category_id),
        role_id=str(data.role_id) if data.role_id else None,
        max_quantity=data.max_quantity,
        period_type=data.period_type,
        created_by=str(current_user.id),
    )
    db.add(allowance)
    await db.commit()
    await db.refresh(allowance)
    return IssuanceAllowanceResponse.model_validate(allowance)


@router.put("/allowances/{allowance_id}", response_model=IssuanceAllowanceResponse)
async def update_allowance(
    allowance_id: UUID,
    data: IssuanceAllowanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Update an issuance allowance."""
    result = await db.execute(
        select(IssuanceAllowance)
        .where(IssuanceAllowance.id == str(allowance_id))
        .where(IssuanceAllowance.organization_id == str(current_user.organization_id))
    )
    allowance = result.scalar_one_or_none()
    if not allowance:
        raise HTTPException(status_code=404, detail="Allowance not found")

    if data.max_quantity is not None:
        allowance.max_quantity = data.max_quantity
    if data.period_type is not None:
        allowance.period_type = data.period_type
    if data.is_active is not None:
        allowance.is_active = data.is_active

    await db.commit()
    await db.refresh(allowance)
    return IssuanceAllowanceResponse.model_validate(allowance)


@router.delete("/allowances/{allowance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_allowance(
    allowance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Delete an issuance allowance."""
    result = await db.execute(
        select(IssuanceAllowance)
        .where(IssuanceAllowance.id == str(allowance_id))
        .where(IssuanceAllowance.organization_id == str(current_user.organization_id))
    )
    allowance = result.scalar_one_or_none()
    if not allowance:
        raise HTTPException(status_code=404, detail="Allowance not found")

    await db.delete(allowance)
    await db.commit()


@router.get(
    "/allowances/check/{user_id}/{category_id}",
    response_model=AllowanceCheckResponse,
)
async def check_member_allowance(
    user_id: UUID,
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """Check a member's remaining issuance allowance for a category."""
    # Get user's role for role-specific allowances
    user_result = await db.execute(select(User).where(User.id == str(user_id)))
    user = user_result.scalar_one_or_none()
    role_id = user.role_id if user else None

    service = InventoryService(db)
    check = await service.check_allowance(
        user_id=user_id,
        category_id=category_id,
        organization_id=current_user.organization_id,
        role_id=role_id,
    )
    return AllowanceCheckResponse(
        category_id=category_id,
        max_quantity=check["max_quantity"],
        issued_this_period=check["issued_this_period"],
        remaining=check["remaining"],
        period_type=check["period_type"],
    )


# ============================================
# Cost Recovery (Charge for Lost/Damaged)
# ============================================


@router.put(
    "/issuances/{issuance_id}/charge",
    response_model=ItemIssuanceResponse,
)
async def update_issuance_charge(
    issuance_id: UUID,
    data: IssuanceChargeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Record a cost-recovery charge on an issuance (for lost/damaged items).

    Set charge_status to "charged" to bill the member, or "waived" to forgive.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    success, error = await service.update_issuance_charge(
        issuance_id=issuance_id,
        organization_id=current_user.organization_id,
        charge_status=data.charge_status,
        charge_amount=data.charge_amount,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error or "Unknown error"),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_issuance_charged",
        event_category="inventory",
        severity="info",
        event_data={
            "issuance_id": str(issuance_id),
            "charge_status": data.charge_status,
            "charge_amount": str(data.charge_amount) if data.charge_amount else None,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    result = await db.execute(
        select(ItemIssuance).where(ItemIssuance.id == str(issuance_id))
    )
    issuance = result.scalar_one()
    return ItemIssuanceResponse.model_validate(issuance)


# ============================================
# Charge Management Endpoints
# ============================================


@router.get(
    "/charges",
    response_model=ChargeManagementResponse,
)
async def get_charges(
    charge_status: Optional[str] = Query(None, description="Filter by charge status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    List all issuances with active charges (pending/charged/waived) for admin management.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    data = await service.get_charges(
        organization_id=current_user.organization_id,
        charge_status_filter=charge_status,
    )

    return ChargeManagementResponse(
        items=[IssuanceChargeListItem(**item) for item in data["items"]],
        total=data["total"],
        total_pending=data["total_pending"],
        total_charged=data["total_charged"],
        total_waived=data["total_waived"],
    )


# ============================================
# Return Request Endpoints
# ============================================


@router.post(
    "/return-requests",
    response_model=ReturnRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_return_request(
    data: ReturnRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit a return request for quartermaster review.

    Members use this to declare intent to return equipment. The quartermaster
    must approve before the actual return is processed.

    **Authentication required**
    """
    service = InventoryService(db)
    request_obj, error = await service.create_return_request(
        organization_id=current_user.organization_id,
        requester_id=current_user.id,
        return_type=data.return_type,
        item_id=data.item_id,
        assignment_id=data.assignment_id,
        issuance_id=data.issuance_id,
        checkout_id=data.checkout_id,
        quantity_returning=data.quantity_returning,
        reported_condition=data.reported_condition,
        member_notes=data.member_notes,
    )

    if not request_obj:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error or "Unknown error"),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_return_requested",
        event_category="inventory",
        severity="info",
        event_data={
            "return_request_id": str(request_obj.id),
            "item_id": str(data.item_id),
            "return_type": data.return_type,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    # Build response with requester name
    resp = ReturnRequestResponse.model_validate(request_obj)
    resp.requester_name = (
        f"{current_user.first_name or ''} {current_user.last_name or ''}".strip()
    )
    return resp


@router.get(
    "/return-requests",
    response_model=List[ReturnRequestResponse],
)
async def list_return_requests(
    request_status: Optional[str] = Query(None, alias="status"),
    mine_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List return requests. Members see their own; admins see all.

    **Authentication required**
    """
    service = InventoryService(db)

    requester_id = current_user.id if mine_only else None

    requests = await service.get_return_requests(
        organization_id=current_user.organization_id,
        status_filter=request_status,
        requester_id=requester_id,
    )

    result = []
    for req in requests:
        resp = ReturnRequestResponse.model_validate(req)
        # Enrich with names
        if req.requester:
            resp.requester_name = f"{req.requester.first_name or ''} {req.requester.last_name or ''}".strip()
        if req.reviewer:
            resp.reviewer_name = f"{req.reviewer.first_name or ''} {req.reviewer.last_name or ''}".strip()
        result.append(resp)

    return result


@router.put(
    "/return-requests/{request_id}/review",
    response_model=Dict[str, Any],
)
async def review_return_request(
    request_id: UUID,
    data: ReturnRequestReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Approve or deny a return request. On approval, the actual return is executed.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    success, error = await service.review_return_request(
        request_id=request_id,
        organization_id=current_user.organization_id,
        reviewer_id=current_user.id,
        status=data.status,
        review_notes=data.review_notes,
        override_condition=data.override_condition,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_message(error or "Unknown error"),
        )

    await log_audit_event(
        db=db,
        event_type="inventory_return_reviewed",
        event_category="inventory",
        severity="info",
        event_data={
            "return_request_id": str(request_id),
            "decision": data.status,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await _publish_inventory_event(
        str(current_user.organization_id),
        "return_request_reviewed",
        {"request_id": str(request_id), "status": data.status},
    )

    return {
        "id": str(request_id),
        "status": data.status,
        "message": f"Return request {data.status}",
    }


# ============================================
# Issuance History Endpoint
# ============================================


@router.get(
    "/users/{user_id}/issuance-history",
    response_model=List[ItemIssuanceResponse],
)
async def get_user_issuance_history(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get full issuance history (active + returned) for a member.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    issuances = await service.get_user_issuance_history(
        user_id=user_id,
        organization_id=current_user.organization_id,
    )
    return [ItemIssuanceResponse.model_validate(iss) for iss in issuances]


# ------------------------------------------------------------------
# Reorder Requests
# ------------------------------------------------------------------


@router.get("/reorder-requests", response_model=list[ReorderRequestResponse])
async def list_reorder_requests(
    status: str | None = Query(None, description="Filter by status"),
    urgency: str | None = Query(None, description="Filter by urgency"),
    search: str | None = Query(None, description="Search by item name"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    List reorder requests for the organization.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    requests = await service.list_reorder_requests(
        organization_id=current_user.organization_id,
        status=status,
        urgency=urgency,
        search=search,
    )
    results = []
    for req in requests:
        resp = ReorderRequestResponse.model_validate(req)
        if req.requester:
            resp.requester_name = f"{req.requester.first_name or ''} {req.requester.last_name or ''}".strip()
        if req.approver:
            resp.approver_name = f"{req.approver.first_name or ''} {req.approver.last_name or ''}".strip()
        results.append(resp)
    return results


@router.get("/reorder-requests/{request_id}", response_model=ReorderRequestResponse)
async def get_reorder_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Get a single reorder request.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    req = await service.get_reorder_request(request_id, current_user.organization_id)
    if not req:
        raise HTTPException(status_code=404, detail="Reorder request not found")
    resp = ReorderRequestResponse.model_validate(req)
    if req.requester:
        resp.requester_name = (
            f"{req.requester.first_name or ''} {req.requester.last_name or ''}".strip()
        )
    if req.approver:
        resp.approver_name = (
            f"{req.approver.first_name or ''} {req.approver.last_name or ''}".strip()
        )
    return resp


@router.post(
    "/reorder-requests",
    response_model=ReorderRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reorder_request(
    data: ReorderRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Create a new reorder request.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    reorder, error = await service.create_reorder_request(
        organization_id=current_user.organization_id,
        data=data.model_dump(exclude_unset=True),
        requested_by=current_user.id,
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="reorder_request_created",
        event_category="inventory",
        severity="info",
        event_data={
            "resource_type": "reorder_request",
            "resource_id": str(reorder.id),
            "item_name": reorder.item_name,
            "quantity": reorder.quantity_requested,
        },
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )

    return ReorderRequestResponse.model_validate(reorder)


@router.patch("/reorder-requests/{request_id}", response_model=ReorderRequestResponse)
async def update_reorder_request(
    request_id: UUID,
    data: ReorderRequestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Update a reorder request (status, vendor info, costs, etc.).

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    reorder, error = await service.update_reorder_request(
        request_id=request_id,
        organization_id=current_user.organization_id,
        data=data.model_dump(exclude_unset=True),
        current_user_id=current_user.id,
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="reorder_request_updated",
        event_category="inventory",
        severity="info",
        event_data={
            "resource_type": "reorder_request",
            "resource_id": str(reorder.id),
            "status": (
                reorder.status.value
                if hasattr(reorder.status, "value")
                else reorder.status
            ),
        },
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )

    resp = ReorderRequestResponse.model_validate(reorder)
    if reorder.requester:
        resp.requester_name = f"{reorder.requester.first_name or ''} {reorder.requester.last_name or ''}".strip()
    if reorder.approver:
        resp.approver_name = f"{reorder.approver.first_name or ''} {reorder.approver.last_name or ''}".strip()
    return resp


@router.delete("/reorder-requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reorder_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Delete a pending reorder request.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    error = await service.delete_reorder_request(
        request_id, current_user.organization_id
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="reorder_request_deleted",
        event_category="inventory",
        severity="info",
        event_data={
            "resource_type": "reorder_request",
            "resource_id": str(request_id),
        },
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )


# ============================================
# Variant Group Endpoints
# ============================================


@router.get("/variant-groups", response_model=List[ItemVariantGroupResponse])
async def list_variant_groups(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    List all variant groups.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    groups = await service.get_variant_groups(
        current_user.organization_id, active_only=active_only
    )
    return [ItemVariantGroupResponse.model_validate(g) for g in groups]


@router.post(
    "/variant-groups",
    response_model=ItemVariantGroupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_variant_group(
    data: ItemVariantGroupCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Create a variant group for grouping pool item variants.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    group, error = await service.create_variant_group(
        organization_id=current_user.organization_id,
        data=data.model_dump(),
        created_by=UUID(current_user.id),
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()
    await db.refresh(group)
    return ItemVariantGroupResponse.model_validate(group)


@router.get(
    "/variant-groups/{group_id}",
    response_model=ItemVariantGroupDetailResponse,
)
async def get_variant_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get a variant group with its member items.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    group = await service.get_variant_group_by_id(
        group_id, current_user.organization_id
    )
    if not group:
        raise HTTPException(status_code=404, detail="Variant group not found")
    return ItemVariantGroupDetailResponse.model_validate(group)


@router.patch(
    "/variant-groups/{group_id}",
    response_model=ItemVariantGroupResponse,
)
async def update_variant_group(
    group_id: UUID,
    data: ItemVariantGroupUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Update a variant group.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    group, error = await service.update_variant_group(
        group_id,
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()
    await db.refresh(group)
    return ItemVariantGroupResponse.model_validate(group)


# ============================================
# Equipment Kit Endpoints
# ============================================


@router.get("/kits", response_model=List[EquipmentKitResponse])
async def list_equipment_kits(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    List all equipment kit templates.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    kits = await service.get_equipment_kits(
        current_user.organization_id, active_only=active_only
    )
    return [EquipmentKitResponse.model_validate(k) for k in kits]


@router.post(
    "/kits",
    response_model=EquipmentKitDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_equipment_kit(
    data: EquipmentKitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Create an equipment kit template.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    kit, error = await service.create_equipment_kit(
        organization_id=current_user.organization_id,
        data=data.model_dump(),
        created_by=UUID(current_user.id),
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()
    # Re-fetch with relationships
    kit = await service.get_equipment_kit_by_id(
        UUID(kit.id), current_user.organization_id
    )
    return EquipmentKitDetailResponse.model_validate(kit)


@router.get("/kits/{kit_id}", response_model=EquipmentKitDetailResponse)
async def get_equipment_kit(
    kit_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get a kit with its items.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    kit = await service.get_equipment_kit_by_id(kit_id, current_user.organization_id)
    if not kit:
        raise HTTPException(status_code=404, detail="Equipment kit not found")
    return EquipmentKitDetailResponse.model_validate(kit)


@router.patch("/kits/{kit_id}", response_model=EquipmentKitResponse)
async def update_equipment_kit(
    kit_id: UUID,
    data: EquipmentKitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Update a kit's metadata.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    kit, error = await service.update_equipment_kit(
        kit_id,
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()
    await db.refresh(kit)
    return EquipmentKitResponse.model_validate(kit)


@router.post("/kits/{kit_id}/issue/{user_id}")
async def issue_kit_to_member(
    kit_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Issue all items in a kit to a member.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    issuances, error = await service.issue_kit_to_member(
        kit_id=kit_id,
        user_id=user_id,
        organization_id=current_user.organization_id,
        issued_by=UUID(current_user.id),
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="kit_issued",
        event_category="inventory",
        severity="info",
        event_data={
            "resource_type": "equipment_kit",
            "resource_id": str(kit_id),
            "target_user_id": str(user_id),
            "items_count": len(issuances),
        },
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )

    return {"message": "Kit issued successfully", "items_issued": len(issuances)}


# ============================================
# Member Size Preferences Endpoints
# ============================================


@router.get(
    "/members/{user_id}/size-preferences",
    response_model=MemberSizePreferencesResponse,
)
async def get_member_size_preferences(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get a member's size preferences.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    prefs = await service.get_member_size_preferences(
        user_id, current_user.organization_id
    )
    if not prefs:
        raise HTTPException(
            status_code=404, detail="Size preferences not found for this member"
        )
    return MemberSizePreferencesResponse.model_validate(prefs)


@router.put(
    "/members/{user_id}/size-preferences",
    response_model=MemberSizePreferencesResponse,
)
async def upsert_member_size_preferences(
    user_id: UUID,
    data: MemberSizePreferencesCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """
    Create or update a member's size preferences.

    **Authentication required**
    **Requires permission: inventory.manage**
    """
    service = InventoryService(db)
    prefs, error = await service.upsert_member_size_preferences(
        user_id=user_id,
        organization_id=current_user.organization_id,
        data=data.model_dump(exclude_unset=True),
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()
    await db.refresh(prefs)
    return MemberSizePreferencesResponse.model_validate(prefs)


@router.get(
    "/my/size-preferences",
    response_model=MemberSizePreferencesResponse,
)
async def get_my_size_preferences(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get the current user's own size preferences.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    prefs = await service.get_member_size_preferences(
        UUID(current_user.id), current_user.organization_id
    )
    if not prefs:
        raise HTTPException(status_code=404, detail="Size preferences not set")
    return MemberSizePreferencesResponse.model_validate(prefs)


@router.put(
    "/my/size-preferences",
    response_model=MemberSizePreferencesResponse,
)
async def upsert_my_size_preferences(
    data: MemberSizePreferencesCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Create or update the current user's own size preferences.

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    prefs, error = await service.upsert_member_size_preferences(
        user_id=UUID(current_user.id),
        organization_id=current_user.organization_id,
        data=data.model_dump(exclude_unset=True),
    )
    if error:
        raise HTTPException(status_code=400, detail=sanitize_error_message(error))
    await db.commit()
    await db.refresh(prefs)
    return MemberSizePreferencesResponse.model_validate(prefs)
