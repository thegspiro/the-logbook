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

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.training import ShiftEquipmentCheck, ShiftEquipmentCheckItem
from app.models.user import User
from app.schemas.equipment_check import (
    ApparatusInventoryResponse,
    CheckLogResponse,
    CheckTemplateCompartmentClone,
    CheckTemplateCompartmentCreate,
    CheckTemplateCompartmentResponse,
    CheckTemplateCompartmentUpdate,
    CheckTemplateItemBulkCreate,
    CheckTemplateItemBulkDelete,
    CheckTemplateItemBulkDeleteResponse,
    CheckTemplateItemBulkResponse,
    CheckTemplateItemCreate,
    CheckTemplateItemResponse,
    CheckTemplateItemUpdate,
    CompartmentReplaceRequest,
    ComplianceReportResponse,
    DeployedLotUpdateRequest,
    EquipmentCheckCompleteItems,
    EquipmentCheckTemplateCreate,
    EquipmentCheckTemplateResponse,
    EquipmentCheckTemplateUpdate,
    FailureLogResponse,
    FleetReadinessResponse,
    InventoryLinkRequest,
    InventoryLinkResponse,
    InventoryMatchesResponse,
    ItemDeployedLots,
    ItemDeployment,
    ItemQuantityRequest,
    ItemRestockStateResponse,
    ItemTrendResponse,
    ItemUsedRequest,
    LotSwapRequest,
    LotSwapResponse,
    ReorderRequest,
    ShiftCheckSummary,
    ShiftEquipmentCheckCreate,
    ShiftEquipmentCheckResponse,
    StandaloneEquipmentCheckCreate,
    SupplyOverviewResponse,
    TemplateChangeLogListResponse,
)
from app.services.equipment_check_service import (
    EquipmentCheckConflictError,
    EquipmentCheckService,
)
from app.services.equipment_readiness_service import EquipmentReadinessService
from app.utils.image_processing import optimize_image

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
    current_user: User = Depends(require_permission("inventory.check_manage")),
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
    # EC-7: view OR submit (see get_shift_checklists). The member-facing
    # "Start a Check" picker lists templates to choose from, so gating this
    # behind the officer's view permission leaves the picker empty for the
    # people the feature is for. Manage is accepted too: every template write
    # on this router is a manage right, and a manage-without-view role could
    # otherwise edit templates it cannot list.
    current_user: User = Depends(
        require_permission(
            "inventory.check_view",
            "inventory.check_submit",
            "inventory.check_manage",
        )
    ),
):
    """List equipment check templates with optional filters."""
    service = EquipmentCheckService(db)
    permissions = _collect_user_permissions(current_user)
    visible_positions = None
    # Manage is unrestricted like view: a role that may edit every template
    # must not have its listing narrowed to its own shift positions.
    if not (
        _has_permission("inventory.check_view", permissions)
        or _has_permission("inventory.check_manage", permissions)
    ):
        visible_positions = await service.get_user_check_positions(
            str(current_user.id), str(current_user.organization_id)
        )
    return await service.list_templates(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
        apparatus_type=apparatus_type,
        check_timing=check_timing,
        visible_positions=visible_positions,
    )


@router.get(
    "/templates/{template_id}",
    response_model=EquipmentCheckTemplateResponse,
)
async def get_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    # EC-7: view OR submit (see get_shift_checklists). This is the endpoint the
    # check form itself loads — the member taps "Start Check" on a checklist
    # assigned to them, and without submit here the form never opens, so the
    # whole start/end-of-shift flow 403s for the crew it is meant for. Manage
    # is accepted too — a manage-without-view role edits templates it must be
    # able to fetch (see list_templates).
    current_user: User = Depends(
        require_permission(
            "inventory.check_view",
            "inventory.check_submit",
            "inventory.check_manage",
        )
    ),
):
    """Get a specific template with all compartments and items."""
    service = EquipmentCheckService(db)
    permissions = _collect_user_permissions(current_user)
    visible_positions = None
    # Manage is unrestricted like view (see list_templates).
    if not (
        _has_permission("inventory.check_view", permissions)
        or _has_permission("inventory.check_manage", permissions)
    ):
        visible_positions = await service.get_user_check_positions(
            str(current_user.id), str(current_user.organization_id)
        )
    template = await service.get_template(
        template_id,
        current_user.organization_id,
        visible_positions=visible_positions,
        # A restricted member resuming their own incomplete check can still
        # load the template even if it was deactivated after they started.
        submitter_user_id=str(current_user.id),
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
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Update template metadata."""
    service = EquipmentCheckService(db)
    changes = data.model_dump(exclude_unset=True)
    try:
        template = await service.update_template(
            template_id,
            current_user.organization_id,
            changes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
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
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Delete a template and all its compartments/items."""
    service = EquipmentCheckService(db)
    template = await service.get_template(template_id, current_user.organization_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    tmpl_name = template.name
    deleted = await service.delete_template(template_id, current_user.organization_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Template not found")
    # The deletion cannot be recorded in the template's own changelog:
    # `template_change_logs.template_id` is a NOT NULL foreign key to the row
    # being deleted, so the insert failed with MySQL 1452 and every template
    # delete returned a 500. The changelog is also only ever read back per
    # template (`GET /templates/{id}/changelog`), so a surviving delete row
    # would be unreachable anyway. A template's edit history dies with the
    # template; the fact that someone deleted it belongs in the org-wide
    # audit log, which outlives both.
    await log_audit_event(
        db=db,
        event_type="equipment_check_template_deleted",
        event_category="equipment_check",
        severity="warning",
        event_data={
            "template_id": template_id,
            "template_name": tmpl_name,
        },
        user_id=str(current_user.id),
        username=current_user.username,
        organization_id=str(current_user.organization_id),
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
    current_user: User = Depends(require_permission("inventory.check_manage")),
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
# Catalog Linking (template setup)
# =====================================================================


@router.get(
    "/templates/{template_id}/inventory-matches",
    response_model=InventoryMatchesResponse,
)
async def suggest_inventory_matches(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Propose a catalog item for each unlinked position on this template.

    Read-only — nothing is linked until the reviewed set comes back through
    ``POST /templates/{id}/inventory-links``.

    **Requires permission: inventory.check_manage**
    """
    service = EquipmentCheckService(db)
    result = await service.suggest_inventory_matches(
        template_id, current_user.organization_id
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return result


@router.post(
    "/templates/{template_id}/inventory-links",
    response_model=InventoryLinkResponse,
)
async def link_inventory_items(
    template_id: str,
    data: InventoryLinkRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Apply a reviewed set of catalog links to this template's items.

    **Requires permission: inventory.check_manage**
    """
    service = EquipmentCheckService(db)
    try:
        changed = await service.link_inventory_items(
            template_id,
            current_user.organization_id,
            data.links,
            user_id=str(current_user.id),
            user_name=_user_display_name(current_user),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    if changed is None:
        raise HTTPException(status_code=404, detail="Template not found")

    coverage = await service.get_link_coverage(
        template_id, current_user.organization_id
    )
    return {"linked": changed, "coverage": coverage or {}}


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
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Add a compartment to a template."""
    service = EquipmentCheckService(db)
    try:
        compartment = await service.add_compartment(
            template_id,
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
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
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Update a compartment."""
    service = EquipmentCheckService(db)
    changes = data.model_dump(exclude_unset=True)
    try:
        compartment = await service.update_compartment(
            compartment_id,
            current_user.organization_id,
            changes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
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
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Delete a compartment and its items."""
    service = EquipmentCheckService(db)
    # EC-8: org-scope the changelog-metadata read too (via the org-scoped
    # getter), so a foreign compartment id never even loads — not just relying
    # on the delete below to fail. Behavior is unchanged for in-org ids.
    comp = await service._get_compartment(
        compartment_id, str(current_user.organization_id)
    )
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


@router.post(
    "/templates/{template_id}/compartments/replace",
    response_model=List[CheckTemplateCompartmentResponse],
)
async def replace_compartments(
    template_id: str,
    data: CompartmentReplaceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Swap a template's contents for the ones supplied, atomically.

    Backs the builder's bulk-replacement paths, which promise to clear the
    template before loading a preset or an import. Discarding without the
    replacement in the same request commits an empty template and leaves the
    new contents in the browser until the next Save — so a closed tab in
    between costs the department the checklist it had.
    """
    service = EquipmentCheckService(db)
    org_id = str(current_user.organization_id)

    try:
        result = await service.replace_compartments(
            template_id,
            org_id,
            [entry.model_dump(exclude_unset=True) for entry in data.compartments],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Template not found")
    discarded, created = result

    for compartment_id, name in discarded:
        await service.log_template_change(
            organization_id=org_id,
            template_id=template_id,
            user_id=str(current_user.id),
            user_name=_user_display_name(current_user),
            action="delete",
            entity_type="compartment",
            entity_id=compartment_id,
            entity_name=name,
        )
    for compartment in created:
        await service.log_template_change(
            organization_id=org_id,
            template_id=template_id,
            user_id=str(current_user.id),
            user_name=_user_display_name(current_user),
            action="create",
            entity_type="compartment",
            entity_id=str(compartment.id),
            entity_name=compartment.name,
        )
    if discarded or created:
        await db.commit()
    return created


@router.post(
    "/compartments/{compartment_id}/clone",
    response_model=CheckTemplateCompartmentResponse,
    status_code=201,
)
async def clone_compartment(
    compartment_id: str,
    data: CheckTemplateCompartmentClone,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Atomically clone a compartment and its complete item graph."""
    compartment = await EquipmentCheckService(db).clone_compartment(
        compartment_id, str(current_user.organization_id), data.sort_order
    )
    if not compartment:
        raise HTTPException(status_code=404, detail="Compartment not found")
    return compartment


@router.put("/templates/{template_id}/compartments/reorder", status_code=200)
async def reorder_compartments(
    template_id: str,
    data: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
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
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Add an item to a compartment."""
    from app.models.apparatus import CheckTemplateCompartment as CTC

    service = EquipmentCheckService(db)
    try:
        item = await service.add_item(
            compartment_id,
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
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


@router.post(
    "/compartments/{compartment_id}/items/bulk",
    response_model=CheckTemplateItemBulkResponse,
    status_code=201,
)
async def add_items_bulk(
    compartment_id: str,
    data: CheckTemplateItemBulkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Create an ordered item batch atomically; safe to retry with the same key."""
    service = EquipmentCheckService(db)
    try:
        result = await service.add_items_bulk(
            compartment_id,
            str(current_user.organization_id),
            [item.model_dump() for item in data.items],
            data.idempotency_key,
            str(current_user.id),
            _user_display_name(current_user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Compartment not found")
    items, replayed = result
    return CheckTemplateItemBulkResponse(
        items=items, created_count=0 if replayed else len(items), replayed=replayed
    )


@router.put(
    "/items/{item_id}",
    response_model=CheckTemplateItemResponse,
)
async def update_item(
    item_id: str,
    data: CheckTemplateItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Update a check template item."""
    from app.models.apparatus import CheckTemplateCompartment as CTC

    service = EquipmentCheckService(db)
    changes = data.model_dump(exclude_unset=True)
    try:
        item = await service.update_item(
            item_id,
            current_user.organization_id,
            changes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
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
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Delete a check template item."""
    from app.models.apparatus import CheckTemplateCompartment as CTC

    service = EquipmentCheckService(db)
    # EC-8: org-scope the changelog-metadata read via the org-scoped getter so a
    # foreign item id never loads. item_comp_id then comes from an in-org item,
    # so the template lookup below is on a validated id.
    item_obj = await service._get_item(item_id, str(current_user.organization_id))
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


@router.post(
    "/compartments/{compartment_id}/items/bulk-delete",
    response_model=CheckTemplateItemBulkDeleteResponse,
)
async def delete_items_bulk(
    compartment_id: str,
    data: CheckTemplateItemBulkDelete,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
):
    """Delete an org-scoped compartment's item batch atomically."""
    service = EquipmentCheckService(db)
    try:
        result = await service.delete_items_bulk(
            compartment_id,
            str(current_user.organization_id),
            data.item_ids,
            data.idempotency_key,
            str(current_user.id),
            _user_display_name(current_user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Compartment not found")
    deleted_item_ids, replayed = result
    return CheckTemplateItemBulkDeleteResponse(
        deleted_item_ids=deleted_item_ids, replayed=replayed
    )


@router.put("/compartments/{compartment_id}/items/reorder", status_code=200)
async def reorder_items(
    compartment_id: str,
    data: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_manage")),
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
    # EC-7: read endpoints accept view OR submit — members hold
    # inventory.check_submit (default member position) so the check-performing
    # flow keeps working, while report endpoints stay view-only.
    current_user: User = Depends(
        require_permission("inventory.check_view", "inventory.check_submit")
    ),
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
    current_user: User = Depends(
        require_permission("inventory.check_submit", "inventory.check_manage")
    ),
):
    """Submit an equipment check for a shift."""
    service = EquipmentCheckService(db)
    try:
        check = await service.submit_check(
            shift_id=shift_id,
            organization_id=current_user.organization_id,
            checked_by=str(current_user.id),
            data=data.model_dump(exclude_unset=True),
            allow_manage=_has_permission(
                "inventory.check_manage", _collect_user_permissions(current_user)
            ),
        )
        return check
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=safe_error_detail(e))
    except EquipmentCheckConflictError as e:
        raise HTTPException(status_code=409, detail=safe_error_detail(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.post(
    "/checks",
    response_model=ShiftEquipmentCheckResponse,
    status_code=201,
)
async def submit_standalone_check(
    data: StandaloneEquipmentCheckCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.check_submit", "inventory.check_manage")
    ),
):
    """Submit a standalone equipment check not tied to a shift."""
    service = EquipmentCheckService(db)
    try:
        check = await service.submit_standalone_check(
            organization_id=current_user.organization_id,
            checked_by=str(current_user.id),
            data=data.model_dump(exclude_unset=True),
        )
        return check
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.put(
    "/checks/{check_id}/complete",
    response_model=ShiftEquipmentCheckResponse,
)
async def complete_incomplete_check(
    check_id: str,
    data: EquipmentCheckCompleteItems,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.check_submit", "inventory.check_manage")
    ),
):
    """Complete remaining items on an incomplete check."""
    service = EquipmentCheckService(db)
    # Only the member who started the check may complete it; managers may
    # complete any check in their org (supervisory correction / shift handover).
    allow_any = _has_permission(
        "inventory.check_manage", _collect_user_permissions(current_user)
    )
    try:
        check = await service.complete_incomplete_check(
            check_id=check_id,
            organization_id=current_user.organization_id,
            checked_by=str(current_user.id),
            data=data.model_dump(exclude_unset=True),
            allow_any=allow_any,
        )
        return check
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=safe_error_detail(e),
        )


@router.get(
    "/shifts/{shift_id}/checks",
    response_model=list[ShiftEquipmentCheckResponse],
)
async def get_shift_checks(
    shift_id: str,
    check_timing: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    # EC-7: view OR submit (see get_shift_checklists)
    current_user: User = Depends(
        require_permission("inventory.check_view", "inventory.check_submit")
    ),
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
    # EC-7: view OR submit (see get_shift_checklists)
    current_user: User = Depends(
        require_permission("inventory.check_view", "inventory.check_submit")
    ),
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
    # EC-7: view OR submit (see get_shift_checklists)
    current_user: User = Depends(
        require_permission("inventory.check_view", "inventory.check_submit")
    ),
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
    # EC-7: view OR submit (see get_shift_checklists)
    current_user: User = Depends(
        require_permission("inventory.check_view", "inventory.check_submit")
    ),
):
    """Get item results from the most recent completed check for a template.

    Optionally filter by apparatus_id so results are apparatus-specific
    (e.g. E106 may have different quantities from E105).
    """
    service = EquipmentCheckService(db)
    return await service.get_last_check_results(
        template_id, current_user.organization_id, apparatus_id
    )


@router.get("/templates/{template_id}/last-seals")
async def get_last_check_seals(
    template_id: str,
    apparatus_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    # EC-7: view OR submit, matching last-results — the same crew reads both.
    current_user: User = Depends(
        require_permission("inventory.check_view", "inventory.check_submit")
    ),
):
    """Get the seal each sealed container carried at the last completed check.

    Keyed by compartment id. The check form compares the number the previous
    crew recorded against the one in front of this crew: equal means the bag
    has not been opened since it was counted, which is what lets the seal
    clear the contents count in one tap.
    """
    service = EquipmentCheckService(db)
    return await service.get_last_check_seals(
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
    raw = await service.get_my_checklists(
        str(current_user.id), current_user.organization_id
    )

    results = []
    for cl in raw:
        tmpl = cl["template"]
        check = cl.get("check")

        status = "not_started"
        if check:
            if check.overall_status == "incomplete":
                status = "in_progress"
            else:
                status = check.overall_status or "not_started"

        results.append(
            {
                "shiftId": cl["shift_id"],
                "shiftDate": str(cl.get("shift_date") or ""),
                "apparatusName": cl.get("apparatus_name", ""),
                "templateId": tmpl.id,
                "templateName": tmpl.name,
                "checkTiming": tmpl.check_timing,
                "status": status,
                "totalItems": (
                    check.total_items
                    if check
                    # Headers and free-text rows are captions, not questions.
                    # The form excludes them and a submitted check's
                    # total_items excludes them, so counting them here made an
                    # unstarted card advertise more items than it asked for —
                    # 0/13 before opening, 12/12 after submitting.
                    else sum(
                        1
                        for c in tmpl.compartments
                        for item in c.items
                        if item.check_type not in ("header", "text")
                    )
                ),
                "completedItems": check.completed_items if check else 0,
                "checkId": (
                    check.id if check and check.overall_status == "incomplete" else None
                ),
            }
        )

    return results


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
# Fleet Readiness / Check Log
# =====================================================================


@router.get("/fleet", response_model=FleetReadinessResponse)
async def get_fleet_readiness(
    strip_dates: int = Query(7, ge=1, le=90),
    expiring_days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.check_view")),
):
    """Readiness roll-up for every apparatus the department runs.

    Officer-level: this reports on other people's checks and on apparatus the
    caller may not ride, so it sits behind ``inventory.check_view`` rather than
    the submit permission that opens a member's own checklist.
    """
    service = EquipmentReadinessService(db)
    try:
        payload = await service.get_fleet_readiness(
            str(current_user.organization_id),
            strip_dates=strip_dates,
            expiring_days=expiring_days,
        )
        return await service.resolve_user_names(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=safe_error_detail(exc))


@router.get("/log", response_model=CheckLogResponse)
async def get_check_log(
    dates: int = Query(14, ge=1, le=90),
    apparatus_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Expected-vs-actual check history over the most recent duty days.

    Open to every member, but the scope is not the same for everyone: a caller
    holding ``inventory.check_view`` gets the fleet grid and every member's
    rows, and one without it gets only the checks they performed themselves.
    The narrower scope is still strictly more than the old my-checks accordion
    offered, which could not be filtered by apparatus or date at all.
    """
    service = EquipmentReadinessService(db)
    can_view_fleet = user_has_permission(current_user, "inventory.check_view")
    try:
        payload = await service.get_check_log(
            str(current_user.organization_id),
            dates=dates,
            apparatus_id=apparatus_id,
            only_user_id=None if can_view_fleet else str(current_user.id),
        )
        return await service.resolve_user_names(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=safe_error_detail(exc))


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
            ShiftEquipmentCheck.organization_id == current_user.organization_id,
        )
    )
    check_item = result.scalars().first()
    if not check_item:
        raise HTTPException(status_code=404, detail="Check item not found")

    existing_urls: list[str] = check_item.photo_urls or []

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
        try:
            optimized = optimize_image(
                contents,
                max_size=(1920, 1080),
                quality=80,
                output_format="WEBP",
            )
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid image {upload.filename}: {safe_error_detail(exc)}",
            ) from exc
        encoded = base64.b64encode(optimized).decode()
        data_uri = f"data:image/webp;base64,{encoded}"
        # Retrying after the server committed but its response was lost must
        # not append the same evidence twice. Optimization is deterministic,
        # so the stored data URI is also the content fingerprint.
        if data_uri not in existing_urls and data_uri not in new_urls:
            new_urls.append(data_uri)

    if len(existing_urls) + len(new_urls) > MAX_PHOTOS_PER_ITEM:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Item already has {len(existing_urls)} photo(s); "
                f"maximum is {MAX_PHOTOS_PER_ITEM}"
            ),
        )

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
    current_user: User = Depends(require_permission("inventory.check_view")),
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
    current_user: User = Depends(require_permission("inventory.check_view")),
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
    current_user: User = Depends(require_permission("inventory.check_view")),
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
    current_user: User = Depends(require_permission("inventory.check_view")),
):
    """Export report data as CSV."""
    import io

    from starlette.responses import StreamingResponse

    from app.utils.csv_export import SafeCsvWriter

    service = EquipmentCheckService(db)
    output = io.StringIO()
    # SafeCsvWriter neutralizes spreadsheet formula injection in free-text cells.
    writer = SafeCsvWriter(output)

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
                "Not Applicable",
                "Not Checked",
            ]
        )
        for t in data.get("trends", []):
            writer.writerow(
                [
                    t.get("period", ""),
                    t.get("pass_count", 0),
                    t.get("fail_count", 0),
                    t.get("not_applicable_count", 0),
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
    current_user: User = Depends(require_permission("inventory.check_view")),
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
            "checked_at": (check.checked_at.isoformat() if check.checked_at else ""),
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
                check_dict["checked_by_name"] = name or "Unknown"
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
    dependencies=[Depends(require_permission("inventory.check_manage"))],
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
                "attachment; " "filename=checklist_import_sample.csv"
            )
        },
    )


# =====================================================================
# Supply Officer: Expiring Items + Lot Swap
# =====================================================================


@router.get(
    "/supply/expiring-items",
    response_model=SupplyOverviewResponse,
)
async def get_supply_expiring_items(
    days_ahead: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.check_view", "inventory.manage")
    ),
):
    """Checklist items expiring soon on apparatus, with ready replacement
    stock the supply officer can prepare or swap in."""
    service = EquipmentCheckService(db)
    return await service.get_supply_overview(
        organization_id=str(current_user.organization_id),
        days_ahead=days_ahead,
    )


@router.get(
    "/apparatus/{apparatus_id}/inventory",
    response_model=ApparatusInventoryResponse,
)
async def get_apparatus_inventory(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    # inventory.check_submit is the default member position: recording what you
    # just used is crew work, not officer work, and gating it behind a manage
    # permission is what leaves the gap for the next morning's check to find.
    current_user: User = Depends(
        require_permission(
            "inventory.check_view", "inventory.check_submit", "inventory.view"
        )
    ),
):
    """What this apparatus is carrying right now, with the stock behind it.

    Readable at any hour and outside any check — the standing view a crew opens
    mid-shift rather than a scheduled, signed pass over the whole truck.
    """
    service = EquipmentCheckService(db)
    result = await service.get_apparatus_inventory(
        apparatus_id=apparatus_id,
        organization_id=str(current_user.organization_id),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Apparatus not found")
    return result


@router.post(
    "/items/{template_item_id}/used",
    response_model=ItemRestockStateResponse,
)
async def report_item_used(
    template_item_id: str,
    data: ItemUsedRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "inventory.check_submit", "inventory.check_manage", "inventory.manage"
        )
    ),
):
    """Report a checklist item used or pulled, at the time it happened.

    Puts the item on the supply worklist immediately instead of leaving the
    gap for the next crew's check to discover.
    """
    service = EquipmentCheckService(db)
    result = await service.report_item_used(
        template_item_id=template_item_id,
        organization_id=str(current_user.organization_id),
        user=current_user,
        note=data.note,
        quantity_used=data.quantity_used,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return result


@router.get(
    "/items/{template_item_id}/deployed-lots",
    response_model=ItemDeployedLots,
)
async def get_item_deployed_lots(
    template_item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "inventory.check_view", "inventory.check_submit", "inventory.view"
        )
    ),
):
    """Which lots are on the truck for this position, and how many of each.

    Listed soonest-to-expire first — the order a crew should draw from, and the
    order consumption is applied in.
    """
    service = EquipmentCheckService(db)
    result = await service.get_item_deployed_lots(
        template_item_id=template_item_id,
        organization_id=str(current_user.organization_id),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return result


@router.put(
    "/items/{template_item_id}/deployed-lots/{deployed_lot_id}",
    response_model=ItemDeployedLots,
)
async def update_deployed_lot(
    template_item_id: str,
    deployed_lot_id: str,
    data: DeployedLotUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "inventory.check_submit", "inventory.check_manage", "inventory.manage"
        )
    ),
):
    """Correct one lot aboard — count, lot number and expiration together.

    This is how a crew that changed a drug out makes the application say what
    the box in the bag says. Zero quantity removes the lot from the truck.
    """
    updates = data.model_dump(exclude_unset=True)
    # Rewriting lot metadata stays a manage right, but the decision has to be
    # made against the row's *current values*, not key presence: the check form
    # round-trips the lot number and date it was shown, so gating on the keys
    # alone 403'd every quantity-only save by submit-only crew. The service
    # raises PermissionError only when a submitted value actually differs.
    permissions = _collect_user_permissions(current_user)
    can_manage_lot_metadata = _has_permission(
        "inventory.check_manage", permissions
    ) or _has_permission("inventory.manage", permissions)

    service = EquipmentCheckService(db)
    try:
        result = await service.update_deployed_lot(
            template_item_id=template_item_id,
            deployed_lot_id=deployed_lot_id,
            organization_id=str(current_user.organization_id),
            user=current_user,
            updates=updates,
            allow_metadata_change=can_manage_lot_metadata,
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=safe_error_detail(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    if result is None:
        raise HTTPException(status_code=404, detail="Deployed lot not found")
    return result


@router.put(
    "/items/{template_item_id}/quantity",
    response_model=ItemRestockStateResponse,
)
async def set_item_quantity(
    template_item_id: str,
    data: ItemQuantityRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "inventory.check_submit", "inventory.check_manage", "inventory.manage"
        )
    ),
):
    """Set how many of this item are on the truck right now.

    A recount rather than a consumption: the crew saying what is actually in
    the compartment, which is also how a drifted count gets put right without
    inventing a use that never happened.
    """
    service = EquipmentCheckService(db)
    try:
        result = await service.set_item_quantity(
            template_item_id=template_item_id,
            organization_id=str(current_user.organization_id),
            user=current_user,
            quantity=data.quantity,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    if result is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return result


@router.delete(
    "/items/{template_item_id}/used",
    response_model=ItemRestockStateResponse,
)
async def clear_item_restock(
    template_item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.check_manage", "inventory.manage")
    ),
):
    """Withdraw a restock report — restocked by hand, or raised in error."""
    service = EquipmentCheckService(db)
    result = await service.clear_item_restock(
        template_item_id=template_item_id,
        organization_id=str(current_user.organization_id),
        user=current_user,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return result


@router.get(
    "/supply/item-deployments/{inventory_item_id}",
    response_model=list[ItemDeployment],
)
async def get_item_deployments(
    inventory_item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("inventory.check_view", "inventory.view")
    ),
):
    """Which apparatus checklists carry this inventory item, and what is on
    each of them now.

    The reverse of /supply/expiring-items: worked from an item in hand (a
    recall, an expiring lot) rather than from a truck.
    """
    service = EquipmentCheckService(db)
    return await service.get_item_deployments(
        inventory_item_id=inventory_item_id,
        organization_id=str(current_user.organization_id),
    )


@router.post(
    "/items/{template_item_id}/swap",
    response_model=LotSwapResponse,
)
async def swap_item_lot(
    template_item_id: str,
    data: LotSwapRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "inventory.check_submit", "inventory.check_manage", "inventory.manage"
        )
    ),
):
    """Swap a ready-stock lot onto the apparatus for a checklist item.

    Decrements the lot's on-hand quantity and updates the deployed item's
    lot number and expiration to the fresher unit that was swapped in.

    Naming ``replaced_deployed_lot_id`` also takes that lot off the truck and
    records the disposition the crew reports for it; omitting it tops the
    position up without retiring anything.

    Open to ``inventory.check_submit``, not officers alone. Replacing expired
    stock is the crew's job at the truck, and a gate they could not pass left
    them looking at an expired unit, ready stock on the shelf, and no action
    but to find an officer — while the item stayed force-failed. EC-3, which
    put a permission here, was about the endpoint having had *none*: every
    value this writes still comes from the org-scoped ``InventoryLot`` row
    rather than the request, so a submitter can move real stock but cannot
    invent a lot number or a date, and ``log_template_change`` records who did
    it. This mirrors the deployed-lot editor, which already admits submitters
    and narrows what they may rewrite rather than shutting them out.
    """
    # Tying a checklist position to a catalog item for the first time is a
    # setup decision with its own manage-only screen, and the first swap does
    # it as a side effect. Submitters may move stock onto positions already
    # linked; they may not create the link.
    permissions = _collect_user_permissions(current_user)
    can_link_catalog = _has_permission(
        "inventory.check_manage", permissions
    ) or _has_permission("inventory.manage", permissions)

    service = EquipmentCheckService(db)
    try:
        result = await service.swap_item_lot(
            template_item_id=template_item_id,
            inventory_lot_id=data.inventory_lot_id,
            organization_id=str(current_user.organization_id),
            user=current_user,
            quantity=data.quantity,
            replaced_deployed_lot_id=data.replaced_deployed_lot_id,
            disposition=data.disposition.value if data.disposition else None,
            allow_first_link=can_link_catalog,
            enforce_submitter_limits=not can_link_catalog,
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=safe_error_detail(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    if result is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return result
