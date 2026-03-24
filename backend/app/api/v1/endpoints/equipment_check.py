"""
Equipment Check API Endpoints

Manages equipment check templates (compartments + items) and shift
equipment check submissions.
"""

import base64
from datetime import date
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.training import (
    ShiftEquipmentCheck,
    ShiftEquipmentCheckItem,
)
from app.models.user import User
from app.utils.image_processing import optimize_image
from app.schemas.equipment_check import (
    CheckTemplateCompartmentCreate,
    CheckTemplateCompartmentResponse,
    CheckTemplateCompartmentUpdate,
    CheckTemplateItemCreate,
    CheckTemplateItemResponse,
    CheckTemplateItemUpdate,
    ComplianceReportResponse,
    EquipmentCheckTemplateCreate,
    EquipmentCheckTemplateResponse,
    EquipmentCheckTemplateUpdate,
    FailureLogResponse,
    ItemTrendResponse,
    ReorderRequest,
    ShiftCheckSummary,
    ShiftEquipmentCheckCreate,
    ShiftEquipmentCheckResponse,
    TemplateChangeLogListResponse,
)
from app.services.equipment_check_service import EquipmentCheckService

router = APIRouter()


def _user_display_name(user: User) -> str:
    first = getattr(user, "first_name", "") or ""
    last = getattr(user, "last_name", "") or ""
    return f"{first} {last}".strip() or "Unknown"


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
        await service.log_template_change(
            organization_id=str(current_user.organization_id),
            template_id=str(template.id),
            user_id=str(current_user.id),
            user_name=_user_display_name(current_user),
            action="add",
            entity_type="template",
            entity_id=str(template.id),
            entity_name=template.name,
        )
        await db.commit()
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
    changes = data.model_dump(exclude_unset=True)
    template = await service.update_template(
        template_id,
        current_user.organization_id,
        changes,
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    await service.log_template_change(
        organization_id=str(current_user.organization_id),
        template_id=template_id,
        user_id=str(current_user.id),
        user_name=_user_display_name(current_user),
        action="update",
        entity_type="template",
        entity_id=template_id,
        entity_name=template.name,
        changes=changes,
    )
    await db.commit()
    return template


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Delete a template and all its compartments/items."""
    service = EquipmentCheckService(db)
    template = await service.get_template(
        template_id, current_user.organization_id
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    tmpl_name = template.name
    deleted = await service.delete_template(
        template_id, current_user.organization_id
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Template not found")
    await service.log_template_change(
        organization_id=str(current_user.organization_id),
        template_id=template_id,
        user_id=str(current_user.id),
        user_name=_user_display_name(current_user),
        action="delete",
        entity_type="template",
        entity_id=template_id,
        entity_name=tmpl_name,
    )
    await db.commit()


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
            raise HTTPException(status_code=404, detail="Template not found")
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
    await service.log_template_change(
        organization_id=str(current_user.organization_id),
        template_id=template_id,
        user_id=str(current_user.id),
        user_name=_user_display_name(current_user),
        action="add",
        entity_type="compartment",
        entity_id=str(compartment.id),
        entity_name=compartment.name,
    )
    await db.commit()
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
    changes = data.model_dump(exclude_unset=True)
    compartment = await service.update_compartment(
        compartment_id,
        current_user.organization_id,
        changes,
    )
    if not compartment:
        raise HTTPException(status_code=404, detail="Compartment not found")
    await service.log_template_change(
        organization_id=str(current_user.organization_id),
        template_id=str(compartment.template_id),
        user_id=str(current_user.id),
        user_name=_user_display_name(current_user),
        action="update",
        entity_type="compartment",
        entity_id=compartment_id,
        entity_name=compartment.name,
        changes=changes,
    )
    await db.commit()
    return compartment


@router.delete("/compartments/{compartment_id}", status_code=204)
async def delete_compartment(
    compartment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Delete a compartment and its items."""
    from app.models.apparatus import CheckTemplateCompartment

    service = EquipmentCheckService(db)
    comp_result = await db.execute(
        select(CheckTemplateCompartment).where(
            CheckTemplateCompartment.id == compartment_id
        )
    )
    comp = comp_result.scalar_one_or_none()
    comp_name = comp.name if comp else "Unknown"
    comp_template_id = str(comp.template_id) if comp else ""
    deleted = await service.delete_compartment(
        compartment_id, current_user.organization_id
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Compartment not found")
    if comp_template_id:
        await service.log_template_change(
            organization_id=str(current_user.organization_id),
            template_id=comp_template_id,
            user_id=str(current_user.id),
            user_name=_user_display_name(current_user),
            action="delete",
            entity_type="compartment",
            entity_id=compartment_id,
            entity_name=comp_name,
        )
        await db.commit()


@router.put("/templates/{template_id}/compartments/reorder", status_code=200)
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
    from app.models.apparatus import CheckTemplateCompartment as CTC

    service = EquipmentCheckService(db)
    item = await service.add_item(
        compartment_id,
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if not item:
        raise HTTPException(status_code=404, detail="Compartment not found")
    comp_result = await db.execute(
        select(CTC.template_id).where(CTC.id == compartment_id)
    )
    tmpl_id = comp_result.scalar_one_or_none()
    if tmpl_id:
        await service.log_template_change(
            organization_id=str(current_user.organization_id),
            template_id=str(tmpl_id),
            user_id=str(current_user.id),
            user_name=_user_display_name(current_user),
            action="add",
            entity_type="item",
            entity_id=str(item.id),
            entity_name=item.name,
        )
        await db.commit()
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
    from app.models.apparatus import CheckTemplateCompartment as CTC

    service = EquipmentCheckService(db)
    changes = data.model_dump(exclude_unset=True)
    item = await service.update_item(
        item_id,
        current_user.organization_id,
        changes,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    tmpl_result = await db.execute(
        select(CTC.template_id).where(CTC.id == str(item.compartment_id))
    )
    tmpl_id = tmpl_result.scalar_one_or_none()
    if tmpl_id:
        await service.log_template_change(
            organization_id=str(current_user.organization_id),
            template_id=str(tmpl_id),
            user_id=str(current_user.id),
            user_name=_user_display_name(current_user),
            action="update",
            entity_type="item",
            entity_id=item_id,
            entity_name=item.name,
            changes=changes,
        )
        await db.commit()
    return item


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Delete a check template item."""
    from app.models.apparatus import (
        CheckTemplateCompartment as CTC,
        CheckTemplateItem as CTI,
    )

    service = EquipmentCheckService(db)
    item_result = await db.execute(
        select(CTI).where(CTI.id == item_id)
    )
    item_obj = item_result.scalar_one_or_none()
    item_name = item_obj.name if item_obj else "Unknown"
    item_comp_id = str(item_obj.compartment_id) if item_obj else ""
    tmpl_id = None
    if item_comp_id:
        tmpl_result = await db.execute(
            select(CTC.template_id).where(CTC.id == item_comp_id)
        )
        tmpl_id = tmpl_result.scalar_one_or_none()
    deleted = await service.delete_item(item_id, current_user.organization_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Item not found")
    if tmpl_id:
        await service.log_template_change(
            organization_id=str(current_user.organization_id),
            template_id=str(tmpl_id),
            user_id=str(current_user.id),
            user_name=_user_display_name(current_user),
            action="delete",
            entity_type="item",
            entity_id=item_id,
            entity_name=item_name,
        )
        await db.commit()


@router.put(
    "/compartments/{compartment_id}/items/reorder", status_code=200
)
async def reorder_items(
    compartment_id: str,
    data: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.manage")),
):
    """Reorder items within a compartment."""
    service = EquipmentCheckService(db)
    success = await service.reorder_items(
        compartment_id, current_user.organization_id, data.ordered_ids
    )
    if not success:
        raise HTTPException(status_code=404, detail="Compartment not found")
    return {"ok": True}


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
    check = await service.get_check(check_id, current_user.organization_id)
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


@router.get("/templates/{template_id}/last-results")
async def get_last_check_results(
    template_id: str,
    apparatus_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get item results from the most recent completed check for a template.

    Optionally filter by apparatus_id so results are apparatus-specific
    (e.g. E106 may have different quantities from E105).
    """
    service = EquipmentCheckService(db)
    return await service.get_last_check_results(
        template_id, current_user.organization_id, apparatus_id
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


# =====================================================================
# Photo Upload
# =====================================================================


MAX_PHOTOS_PER_ITEM = 3
MAX_PHOTO_SIZE = 5 * 1024 * 1024  # 5MB
ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}


@router.post(
    "/checks/{check_id}/items/{item_id}/photos",
    status_code=201,
)
async def upload_check_item_photos(
    check_id: str,
    item_id: str,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Upload photo(s) for an equipment check item.

    Accepts up to 3 images per item. Photos are optimized (resized,
    EXIF-stripped, converted to WebP) and stored as base64 data URIs.
    """
    if len(files) > MAX_PHOTOS_PER_ITEM:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {MAX_PHOTOS_PER_ITEM} photos per item",
        )

    # Verify the check item exists and belongs to user's org
    result = await db.execute(
        select(ShiftEquipmentCheckItem)
        .join(
            ShiftEquipmentCheck,
            ShiftEquipmentCheck.id == ShiftEquipmentCheckItem.check_id,
        )
        .where(
            ShiftEquipmentCheckItem.id == item_id,
            ShiftEquipmentCheckItem.check_id == check_id,
            ShiftEquipmentCheck.organization_id
            == current_user.organization_id,
        )
    )
    check_item = result.scalars().first()
    if not check_item:
        raise HTTPException(status_code=404, detail="Check item not found")

    existing_urls: list = check_item.photo_urls or []
    if len(existing_urls) + len(files) > MAX_PHOTOS_PER_ITEM:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Item already has {len(existing_urls)} photo(s); "
                f"maximum is {MAX_PHOTOS_PER_ITEM}"
            ),
        )

    # Detect magic library availability once
    try:
        import magic

        has_magic = True
    except ImportError:
        has_magic = False

    new_urls: list[str] = []
    for upload in files:
        contents = await upload.read()
        if len(contents) > MAX_PHOTO_SIZE:
            raise HTTPException(
                status_code=400,
                detail=(f"File {upload.filename} exceeds 5MB"),
            )

        # MIME validation via magic bytes
        if has_magic:
            detected_mime = magic.from_buffer(contents, mime=True)
        elif contents[:8] == b"\x89PNG\r\n\x1a\n":
            detected_mime = "image/png"
        elif contents[:2] == b"\xff\xd8":
            detected_mime = "image/jpeg"
        elif contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
            detected_mime = "image/webp"
        else:
            detected_mime = "unknown"

        if detected_mime not in ALLOWED_IMAGE_MIMES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid file type for "
                    f"{upload.filename}. "
                    "Allowed: JPEG, PNG, WebP"
                ),
            )

        # Optimize: resize, strip EXIF, convert to WebP
        optimized = optimize_image(
            contents,
            max_size=(1920, 1080),
            quality=80,
            output_format="WEBP",
        )
        encoded = base64.b64encode(optimized).decode()
        data_uri = f"data:image/webp;base64,{encoded}"
        new_urls.append(data_uri)

    # Shallow copy suffices — strings are immutable
    updated_urls = list(existing_urls) + new_urls
    check_item.photo_urls = updated_urls
    flag_modified(check_item, "photo_urls")
    await db.commit()

    return {
        "photo_urls": updated_urls,
        "count": len(updated_urls),
    }


# =====================================================================
# Reports
# =====================================================================


@router.get(
    "/reports/compliance",
    response_model=ComplianceReportResponse,
)
async def get_compliance_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.view")),
):
    """Aggregated compliance stats by apparatus + date range."""
    service = EquipmentCheckService(db)
    return await service.get_compliance_report(
        current_user.organization_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get(
    "/reports/failures",
    response_model=FailureLogResponse,
)
async def get_failure_log(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    apparatus_id: str | None = Query(None),
    item_name: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.view")),
):
    """Paginated failure log with filters."""
    service = EquipmentCheckService(db)
    return await service.get_failure_log(
        current_user.organization_id,
        date_from=date_from,
        date_to=date_to,
        apparatus_id=apparatus_id,
        item_name=item_name,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/reports/item-trends",
    response_model=ItemTrendResponse,
)
async def get_item_trends(
    template_item_id: str = Query(...),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    interval: str = Query("weekly"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.view")),
):
    """Per-item pass/fail trend over time."""
    service = EquipmentCheckService(db)
    return await service.get_item_trends(
        current_user.organization_id,
        template_item_id=template_item_id,
        date_from=date_from,
        date_to=date_to,
        interval=interval,
    )


@router.get("/reports/export/csv")
async def export_csv(
    report_type: str = Query(...),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    apparatus_id: str | None = Query(None),
    template_item_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.view")),
):
    """Export report data as CSV."""
    import csv
    import io

    from starlette.responses import StreamingResponse

    service = EquipmentCheckService(db)
    output = io.StringIO()
    writer = csv.writer(output)

    if report_type == "compliance":
        data = await service.get_compliance_report(
            current_user.organization_id,
            date_from=date_from,
            date_to=date_to,
        )
        writer.writerow(
            [
                "Apparatus",
                "Checks Completed",
                "Pass",
                "Fail",
                "Last Check Date",
                "Last Checked By",
                "Has Deficiency",
            ]
        )
        for a in data.get("apparatus", []):
            writer.writerow(
                [
                    a.get("apparatus_name", ""),
                    a.get("checks_completed", 0),
                    a.get("pass_count", 0),
                    a.get("fail_count", 0),
                    a.get("last_check_date", ""),
                    a.get("last_checked_by", ""),
                    a.get("has_deficiency", False),
                ]
            )

    elif report_type == "failures":
        data = await service.get_failure_log(
            current_user.organization_id,
            date_from=date_from,
            date_to=date_to,
            apparatus_id=apparatus_id,
            limit=10000,
        )
        writer.writerow(
            [
                "Date",
                "Apparatus",
                "Compartment",
                "Item",
                "Check Type",
                "Status",
                "Notes",
                "Checked By",
            ]
        )
        for f in data.get("items", []):
            writer.writerow(
                [
                    f.get("checked_at", ""),
                    f.get("apparatus_name", ""),
                    f.get("compartment_name", ""),
                    f.get("item_name", ""),
                    f.get("check_type", ""),
                    f.get("status", ""),
                    f.get("notes", ""),
                    f.get("checked_by_name", ""),
                ]
            )

    elif report_type == "item-trends" and template_item_id:
        data = await service.get_item_trends(
            current_user.organization_id,
            template_item_id=template_item_id,
            date_from=date_from,
            date_to=date_to,
        )
        writer.writerow(
            [
                "Period",
                "Pass",
                "Fail",
                "Not Checked",
            ]
        )
        for t in data.get("trends", []):
            writer.writerow(
                [
                    t.get("period", ""),
                    t.get("pass_count", 0),
                    t.get("fail_count", 0),
                    t.get("not_checked_count", 0),
                ]
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="Invalid report_type",
        )

    output.seek(0)
    filename = f"equipment_check_{report_type}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": (f"attachment; filename={filename}")},
    )


@router.get("/reports/export/pdf")
async def export_pdf(
    report_type: str = Query(...),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    apparatus_id: str | None = Query(None),
    check_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("equipment_check.view")),
):
    """Export report data as PDF."""
    from starlette.responses import Response

    from app.services.equipment_check_pdf import (
        generate_check_detail_pdf,
        generate_compliance_pdf,
        generate_failure_log_pdf,
    )

    service = EquipmentCheckService(db)
    date_from_str = date_from.isoformat() if date_from else None
    date_to_str = date_to.isoformat() if date_to else None

    if report_type == "compliance":
        data = await service.get_compliance_report(
            current_user.organization_id,
            date_from=date_from,
            date_to=date_to,
        )
        pdf_bytes = generate_compliance_pdf(
            data,
            date_from=date_from_str,
            date_to=date_to_str,
        )
        filename = "equipment_check_compliance.pdf"

    elif report_type == "failures":
        data = await service.get_failure_log(
            current_user.organization_id,
            date_from=date_from,
            date_to=date_to,
            apparatus_id=apparatus_id,
            limit=10000,
        )
        pdf_bytes = generate_failure_log_pdf(
            data,
            date_from=date_from_str,
            date_to=date_to_str,
        )
        filename = "equipment_check_failures.pdf"

    elif report_type == "check-detail" and check_id:
        check = await service.get_check(check_id, current_user.organization_id)
        if not check:
            raise HTTPException(
                status_code=404,
                detail="Check not found",
            )
        # Convert ORM to dict for the PDF generator
        check_dict = {
            "overall_status": check.overall_status,
            "checked_by_name": None,
            "checked_at": (
                check.checked_at.isoformat()
                if check.checked_at else ""
            ),
            "check_timing": check.check_timing,
            "total_items": check.total_items,
            "completed_items": check.completed_items,
            "failed_items": check.failed_items,
            "notes": check.notes,
            "items": [
                {
                    "item_name": i.item_name,
                    "compartment_name": i.compartment_name,
                    "check_type": i.check_type,
                    "status": i.status,
                    "notes": i.notes,
                }
                for i in (check.items or [])
            ],
        }
        # Resolve checker name
        if check.checked_by:
            from app.models.user import User as UserModel

            u_result = await db.execute(
                select(UserModel).where(UserModel.id == str(check.checked_by))
            )
            u = u_result.scalar_one_or_none()
            if u:
                first = u.first_name or ""
                last = u.last_name or ""
                name = f"{first} {last}".strip()
                check_dict["checked_by_name"] = (
                    name or "Unknown"
                )
        pdf_bytes = generate_check_detail_pdf(check_dict)
        filename = f"equipment_check_{check_id[:8]}.pdf"

    else:
        raise HTTPException(
            status_code=400,
            detail="Invalid report_type",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": (f"attachment; filename={filename}")},
    )


# =====================================================================
# Template Change Log
# =====================================================================


@router.get(
    "/templates/{template_id}/changelog",
    response_model=TemplateChangeLogListResponse,
    dependencies=[Depends(require_permission("equipment_check.manage"))],
)
async def get_template_changelog(
    template_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the granular change log for a template (admin only)."""
    service = EquipmentCheckService(db)
    result = await service.get_template_changelog(
        template_id=template_id,
        organization_id=str(current_user.organization_id),
        limit=limit,
        offset=offset,
    )
    return result


# =====================================================================
# CSV Sample Download
# =====================================================================


@router.get("/csv-sample")
async def download_csv_sample(
    _current_user: User = Depends(get_current_user),
):
    """Download a sample CSV file for checklist template import."""
    from fastapi.responses import Response

    csv_content = EquipmentCheckService.generate_csv_sample()
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                "attachment; "
                "filename=checklist_import_sample.csv"
            )
        },
    )
