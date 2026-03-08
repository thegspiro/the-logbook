"""
Equipment Check API Endpoints

Manages equipment check templates (compartments + items) and shift
equipment check submissions.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.equipment_check import (
    CheckTemplateCompartmentCreate,
    CheckTemplateCompartmentResponse,
    CheckTemplateCompartmentUpdate,
    CheckTemplateItemCreate,
    CheckTemplateItemResponse,
    CheckTemplateItemUpdate,
    EquipmentCheckTemplateCreate,
    EquipmentCheckTemplateResponse,
    EquipmentCheckTemplateUpdate,
    ReorderRequest,
    ShiftCheckSummary,
    ShiftEquipmentCheckCreate,
    ShiftEquipmentCheckResponse,
)
from app.services.equipment_check_service import EquipmentCheckService

router = APIRouter()


# =====================================================================
# Template CRUD
# =====================================================================


@router.post(
    "/templates",
    response_model=EquipmentCheckTemplateResponse,
    status_code=201,
)
async def create_template(
    data: EquipmentCheckTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Create a new equipment check template with optional compartments."""
    service = EquipmentCheckService(db)
    try:
        template = await service.create_template(
            organization_id=current_user.organization_id,
            created_by=str(current_user.id),
            data=data.model_dump(exclude_unset=True),
        )
        return template
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.get(
    "/templates",
    response_model=list[EquipmentCheckTemplateResponse],
)
async def list_templates(
    apparatus_id: str | None = Query(None),
    apparatus_type: str | None = Query(None),
    check_timing: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.view")),
):
    """List equipment check templates with optional filters."""
    service = EquipmentCheckService(db)
    return await service.list_templates(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
        apparatus_type=apparatus_type,
        check_timing=check_timing,
    )


@router.get(
    "/templates/{template_id}",
    response_model=EquipmentCheckTemplateResponse,
)
async def get_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.view")),
):
    """Get a specific template with all compartments and items."""
    service = EquipmentCheckService(db)
    template = await service.get_template(
        template_id, current_user.organization_id
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.put(
    "/templates/{template_id}",
    response_model=EquipmentCheckTemplateResponse,
)
async def update_template(
    template_id: str,
    data: EquipmentCheckTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Update template metadata."""
    service = EquipmentCheckService(db)
    template = await service.update_template(
        template_id,
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Delete a template and all its compartments/items."""
    service = EquipmentCheckService(db)
    deleted = await service.delete_template(
        template_id, current_user.organization_id
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Template not found")


@router.post(
    "/templates/{template_id}/clone",
    response_model=EquipmentCheckTemplateResponse,
    status_code=201,
)
async def clone_template(
    template_id: str,
    target_apparatus_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Clone a template to a specific apparatus."""
    service = EquipmentCheckService(db)
    try:
        template = await service.clone_template(
            template_id,
            current_user.organization_id,
            target_apparatus_id,
            str(current_user.id),
        )
        if not template:
            raise HTTPException(
                status_code=404, detail="Template not found"
            )
        return template
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


# =====================================================================
# Compartment CRUD
# =====================================================================


@router.post(
    "/templates/{template_id}/compartments",
    response_model=CheckTemplateCompartmentResponse,
    status_code=201,
)
async def add_compartment(
    template_id: str,
    data: CheckTemplateCompartmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Add a compartment to a template."""
    service = EquipmentCheckService(db)
    compartment = await service.add_compartment(
        template_id,
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if not compartment:
        raise HTTPException(status_code=404, detail="Template not found")
    return compartment


@router.put(
    "/compartments/{compartment_id}",
    response_model=CheckTemplateCompartmentResponse,
)
async def update_compartment(
    compartment_id: str,
    data: CheckTemplateCompartmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Update a compartment."""
    service = EquipmentCheckService(db)
    compartment = await service.update_compartment(
        compartment_id,
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if not compartment:
        raise HTTPException(status_code=404, detail="Compartment not found")
    return compartment


@router.delete("/compartments/{compartment_id}", status_code=204)
async def delete_compartment(
    compartment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Delete a compartment and its items."""
    service = EquipmentCheckService(db)
    deleted = await service.delete_compartment(
        compartment_id, current_user.organization_id
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Compartment not found")


@router.put(
    "/templates/{template_id}/compartments/reorder", status_code=200
)
async def reorder_compartments(
    template_id: str,
    data: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Reorder compartments within a template."""
    service = EquipmentCheckService(db)
    success = await service.reorder_compartments(
        template_id, current_user.organization_id, data.ordered_ids
    )
    if not success:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


# =====================================================================
# Item CRUD
# =====================================================================


@router.post(
    "/compartments/{compartment_id}/items",
    response_model=CheckTemplateItemResponse,
    status_code=201,
)
async def add_item(
    compartment_id: str,
    data: CheckTemplateItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Add an item to a compartment."""
    service = EquipmentCheckService(db)
    item = await service.add_item(
        compartment_id,
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if not item:
        raise HTTPException(status_code=404, detail="Compartment not found")
    return item


@router.put(
    "/items/{item_id}",
    response_model=CheckTemplateItemResponse,
)
async def update_item(
    item_id: str,
    data: CheckTemplateItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Update a check template item."""
    service = EquipmentCheckService(db)
    item = await service.update_item(
        item_id,
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Delete a check template item."""
    service = EquipmentCheckService(db)
    deleted = await service.delete_item(
        item_id, current_user.organization_id
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Item not found")


# =====================================================================
# Shift Check Endpoints
# =====================================================================


@router.get(
    "/shifts/{shift_id}/checklists",
    response_model=list[ShiftCheckSummary],
)
async def get_shift_checklists(
    shift_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all applicable checklists for the current user on a shift."""
    service = EquipmentCheckService(db)
    try:
        status = await service.get_shift_check_status(
            shift_id, current_user.organization_id
        )
        return status
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.post(
    "/shifts/{shift_id}/checks",
    response_model=ShiftEquipmentCheckResponse,
    status_code=201,
)
async def submit_check(
    shift_id: str,
    data: ShiftEquipmentCheckCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit an equipment check for a shift."""
    service = EquipmentCheckService(db)
    try:
        check = await service.submit_check(
            shift_id=shift_id,
            organization_id=current_user.organization_id,
            checked_by=str(current_user.id),
            data=data.model_dump(exclude_unset=True),
        )
        return check
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.get(
    "/shifts/{shift_id}/checks",
    response_model=list[ShiftEquipmentCheckResponse],
)
async def get_shift_checks(
    shift_id: str,
    check_timing: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all completed equipment checks for a shift."""
    service = EquipmentCheckService(db)
    return await service.get_checks_for_shift(
        shift_id, current_user.organization_id, check_timing
    )


@router.get(
    "/checks/{check_id}",
    response_model=ShiftEquipmentCheckResponse,
)
async def get_check(
    check_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single completed equipment check with item details."""
    service = EquipmentCheckService(db)
    check = await service.get_check(
        check_id, current_user.organization_id
    )
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")
    return check


@router.get("/items/{item_id}/history")
async def get_item_history(
    item_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get check history for a specific template item."""
    service = EquipmentCheckService(db)
    return await service.get_item_check_history(
        item_id, current_user.organization_id, limit
    )


# =====================================================================
# My Checklists (Member Page)
# =====================================================================


@router.get("/my-checklists")
async def get_my_checklists(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get pending and recent checklists for the current user."""
    service = EquipmentCheckService(db)
    return await service.get_my_checklists(
        str(current_user.id), current_user.organization_id
    )


@router.get(
    "/my-checklists/history",
    response_model=list[ShiftEquipmentCheckResponse],
)
async def get_my_checklist_history(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get completed check history for the current user."""
    service = EquipmentCheckService(db)
    return await service.get_my_checklist_history(
        str(current_user.id),
        current_user.organization_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )
