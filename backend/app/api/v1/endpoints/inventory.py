"""
Inventory API Endpoints

Endpoints for inventory management including categories, items, assignments,
checkouts, maintenance, and reporting.
"""

from typing import Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from datetime import datetime

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.models.user import User
from app.models.inventory import ItemStatus, AssignmentType
from app.schemas.inventory import (
    # Category schemas
    InventoryCategoryCreate,
    InventoryCategoryUpdate,
    InventoryCategoryResponse,
    # Item schemas
    InventoryItemCreate,
    InventoryItemUpdate,
    InventoryItemResponse,
    InventoryItemDetailResponse,
    ItemsListResponse,
    ItemRetireRequest,
    # Assignment schemas
    ItemAssignmentCreate,
    ItemAssignmentResponse,
    UnassignItemRequest,
    # Issuance schemas
    ItemIssuanceCreate,
    ItemIssuanceResponse,
    ItemIssuanceReturnRequest,
    # Checkout schemas
    CheckOutCreate,
    CheckOutRecordResponse,
    CheckInRequest,
    # Maintenance schemas
    MaintenanceRecordCreate,
    MaintenanceRecordUpdate,
    MaintenanceRecordResponse,
    MaintenanceDueItem,
    # Summary schemas
    InventorySummary,
    LowStockItem,
    UserInventoryResponse,
    # Departure clearance schemas
    DepartureClearanceCreate,
    DepartureClearanceResponse,
    DepartureClearanceSummaryResponse,
    ClearanceLineItemResponse,
    ResolveClearanceItemRequest,
    CompleteClearanceRequest,
    # Scan / quick-action schemas
    ScanLookupResponse,
    ScanLookupListResponse,
    BatchCheckoutRequest,
    BatchCheckoutResponse,
    BatchReturnRequest,
    BatchReturnResponse,
    LabelGenerateRequest,
    # Members summary
    MembersInventoryListResponse,
)
from app.services.inventory_service import InventoryService
from app.services.departure_clearance_service import DepartureClearanceService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ============================================
# Category Endpoints
# ============================================

@router.get("/categories", response_model=List[InventoryCategoryResponse])
async def list_categories(
    item_type: Optional[str] = None,
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


@router.post("/categories", response_model=InventoryCategoryResponse, status_code=status.HTTP_201_CREATED)
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
            detail=error,
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
            detail=error,
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
    category_id: Optional[UUID] = None,
    status: Optional[str] = None,
    assigned_to: Optional[UUID] = None,
    search: Optional[str] = None,
    active_only: bool = True,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    List inventory items with filtering and pagination

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
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status: {status}",
            )

    items, total = await service.get_items(
        organization_id=current_user.organization_id,
        category_id=category_id,
        status=status_enum,
        assigned_to=assigned_to,
        search=search,
        active_only=active_only,
        skip=skip,
        limit=limit,
    )

    return ItemsListResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post("/items", response_model=InventoryItemResponse, status_code=status.HTTP_201_CREATED)
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
            detail=error,
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

    return new_item


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
            detail=error,
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
            detail=error,
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
            detail=error,
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

    # Convert condition string to enum if provided
    from app.models.inventory import ItemCondition
    return_condition = None
    if unassign_data.return_condition:
        return_condition = ItemCondition(unassign_data.return_condition)

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
            detail=error,
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

    return {"message": "Item unassigned successfully"}


@router.get("/users/{user_id}/assignments", response_model=List[ItemAssignmentResponse])
async def get_user_assignments(
    user_id: UUID,
    active_only: bool = True,
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
    )
    return assignments


# ============================================
# Pool Item Issuance Endpoints
# ============================================

@router.post("/items/{item_id}/issue", response_model=ItemIssuanceResponse, status_code=status.HTTP_201_CREATED)
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
            detail=error,
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
    from app.models.inventory import ItemCondition
    return_condition = None
    if return_data.return_condition:
        return_condition = ItemCondition(return_data.return_condition)

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
            detail=error,
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

    return {"message": "Items returned to pool successfully"}


@router.get("/items/{item_id}/issuances", response_model=List[ItemIssuanceResponse])
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


@router.get("/users/{user_id}/issuances", response_model=List[ItemIssuanceResponse])
async def get_user_issuances(
    user_id: UUID,
    active_only: bool = True,
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
    )
    return issuances


# ============================================
# Check-Out/Check-In Endpoints
# ============================================

@router.post("/checkout", response_model=CheckOutRecordResponse, status_code=status.HTTP_201_CREATED)
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
            detail=error,
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

    # Convert condition string to enum
    from app.models.inventory import ItemCondition
    return_condition = ItemCondition(checkin_data.return_condition)

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
            detail=error,
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

    return {"message": "Item checked in successfully"}


@router.get("/checkout/active", response_model=List[CheckOutRecordResponse])
async def get_active_checkouts(
    user_id: Optional[UUID] = None,
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
    )
    return checkouts


@router.get("/checkout/overdue", response_model=List[CheckOutRecordResponse])
async def get_overdue_checkouts(
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
        organization_id=current_user.organization_id
    )
    return checkouts


# ============================================
# Maintenance Endpoints
# ============================================

@router.post("/maintenance", response_model=MaintenanceRecordResponse, status_code=status.HTTP_201_CREATED)
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
        maintenance_data=maintenance_data.model_dump(exclude={"item_id"}, exclude_unset=True),
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
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


@router.get("/items/{item_id}/maintenance", response_model=List[MaintenanceRecordResponse])
async def get_item_maintenance_history(
    item_id: UUID,
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
    )
    return maintenance_records


@router.get("/maintenance/due", response_model=List[InventoryItemResponse])
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
    Get overall inventory summary statistics

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    summary = await service.get_inventory_summary(
        organization_id=current_user.organization_id
    )
    return summary


@router.get("/low-stock", response_model=List[LowStockItem])
async def get_low_stock_alerts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Get categories with low stock alerts

    **Authentication required**
    **Requires permission: inventory.view**
    """
    service = InventoryService(db)
    low_stock = await service.get_low_stock_items(
        organization_id=current_user.organization_id
    )
    return low_stock


@router.get("/members-summary", response_model=MembersInventoryListResponse)
async def get_members_inventory_summary(
    search: Optional[str] = Query(None, description="Search by name, username, or membership number"),
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
    if user_id != current_user.id:
        # Check if user has inventory.view permission
        has_permission = any(
            "inventory.view" in (role.permissions or [])
            for role in current_user.roles
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
    code: str = Query(..., min_length=1, description="Barcode, serial number, or asset tag"),
    limit: int = Query(20, ge=1, le=50, description="Maximum results to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.view")),
):
    """
    Search inventory items by barcode, serial number, or asset tag.

    Supports partial matching — type part of a barcode, serial number,
    or asset tag to see all matching items. Searches barcode first,
    then serial number, then asset tag.

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
        entry = {"id": key, "description": fmt["description"], "type": fmt["type"]}
        if fmt["type"] == "thermal":
            entry["width"] = fmt["width"]
            entry["height"] = fmt["height"]
        formats.append(entry)
    formats.append({
        "id": "custom",
        "description": "Custom label size (specify width and height in inches)",
        "type": "thermal",
    })
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
        pdf_buf = await service.generate_barcode_labels(
            item_ids=request.item_ids,
            organization_id=current_user.organization_id,
            label_format=request.label_format,
            custom_width=request.custom_width,
            custom_height=request.custom_height,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    filename = f"inventory-labels-{request.label_format}.pdf"
    return StreamingResponse(
        pdf_buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ============================================
# Departure Clearance Endpoints
# ============================================

@router.post("/clearances", response_model=DepartureClearanceResponse, status_code=status.HTTP_201_CREATED)
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
            detail=error,
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


@router.get("/clearances", response_model=Dict)
async def list_departure_clearances(
    status_filter: Optional[str] = Query(None, alias="status"),
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
            "inventory.view" in (role.permissions or [])
            for role in current_user.roles
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
        organization_id=str(current_user.organization_id),
        resolved_by=str(current_user.id),
        disposition=resolve_data.disposition,
        return_condition=resolve_data.return_condition,
        resolution_notes=resolve_data.resolution_notes,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
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


@router.post("/clearances/{clearance_id}/complete", response_model=DepartureClearanceResponse)
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
            detail=error,
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
