"""
Shift evaluation template endpoints

A department's evaluation forms and how it uses them. Administering the forms
is configuring training, so every route needs ``training.configure`` or
``training.manage``. Officers filling an evaluation out read the template
through the evaluation routes, not these.

Registered under ``/training/shift-evaluation-templates``. The fixed paths
(``/settings``, ``/example``) are declared before ``/{template_id}`` so they
are not read as ids.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, safe_error_detail
from app.models.user import User
from app.schemas.shift_evaluation import (
    ShiftEvaluationSettingsResponse,
    ShiftEvaluationSettingsUpdate,
    ShiftEvaluationTemplateResponse,
    ShiftEvaluationTemplateWrite,
)
from app.services.sample_evaluation_templates import emt_shift_evaluation_example
from app.services.shift_evaluation_template_service import (
    ShiftEvaluationTemplateService,
)

router = APIRouter()

_ADMIN = ("training.configure", "training.manage")


async def _audit(db: AsyncSession, user: User, event_type: str, data: dict) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="training",
        severity="INFO",
        event_data={"organization_id": str(user.organization_id), **data},
        user_id=str(user.id),
        username=user.username,
    )


@router.get("", response_model=list[ShiftEvaluationTemplateResponse])
async def list_evaluation_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_ADMIN)),
):
    """The department's evaluation templates, with the programs using each.

    **Permissions required:** training.configure or training.manage
    """
    service = ShiftEvaluationTemplateService(db)
    return await service.list_templates(current_user.organization_id)


@router.get("/settings", response_model=ShiftEvaluationSettingsResponse)
async def get_evaluation_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_ADMIN)),
):
    """The department's general form and multi-program setting.

    **Permissions required:** training.configure or training.manage
    """
    service = ShiftEvaluationTemplateService(db)
    return await service.get_settings(current_user.organization_id)


@router.patch("/settings", response_model=ShiftEvaluationSettingsResponse)
async def update_evaluation_settings(
    body: ShiftEvaluationSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_ADMIN)),
):
    """Change the general form, its mode, or the multi-program setting.

    **Permissions required:** training.configure or training.manage
    """
    service = ShiftEvaluationTemplateService(db)
    try:
        result = await service.update_settings(
            current_user.organization_id, body, current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await _audit(
        db,
        current_user,
        "shift_evaluation_settings_updated",
        result.model_dump(),
    )
    return result


@router.get("/example", response_model=ShiftEvaluationTemplateWrite)
async def get_example_evaluation_template(
    current_user: User = Depends(require_permission(*_ADMIN)),
):
    """An unsaved example template for the editor to start from.

    **Permissions required:** training.configure or training.manage
    """
    return emt_shift_evaluation_example()


@router.post(
    "",
    response_model=ShiftEvaluationTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_evaluation_template(
    body: ShiftEvaluationTemplateWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_ADMIN)),
):
    """Create an evaluation template.

    **Permissions required:** training.configure or training.manage
    """
    service = ShiftEvaluationTemplateService(db)
    try:
        template = await service.create_template(
            current_user.organization_id, body, current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await _audit(
        db,
        current_user,
        "shift_evaluation_template_created",
        {"template_id": template.id},
    )
    return ensure_found(
        await service.get_template_response(template.id, current_user.organization_id),
        "Evaluation template",
    )


@router.get("/{template_id}", response_model=ShiftEvaluationTemplateResponse)
async def get_evaluation_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_ADMIN)),
):
    """One evaluation template.

    **Permissions required:** training.configure or training.manage
    """
    service = ShiftEvaluationTemplateService(db)
    return ensure_found(
        await service.get_template_response(template_id, current_user.organization_id),
        "Evaluation template",
    )


@router.put("/{template_id}", response_model=ShiftEvaluationTemplateResponse)
async def update_evaluation_template(
    template_id: UUID,
    body: ShiftEvaluationTemplateWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_ADMIN)),
):
    """Replace an evaluation template's content; its version goes up by one.

    **Permissions required:** training.configure or training.manage
    """
    service = ShiftEvaluationTemplateService(db)
    try:
        template = await service.update_template(
            template_id, current_user.organization_id, body, current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    template = ensure_found(template, "Evaluation template")
    await _audit(
        db,
        current_user,
        "shift_evaluation_template_updated",
        {"template_id": template.id, "version": template.version},
    )
    return ensure_found(
        await service.get_template_response(template.id, current_user.organization_id),
        "Evaluation template",
    )


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_evaluation_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_ADMIN)),
):
    """Delete an evaluation template. Programs using it are left with no form.

    **Permissions required:** training.configure or training.manage
    """
    service = ShiftEvaluationTemplateService(db)
    cleared = ensure_found(
        await service.delete_template(template_id, current_user.organization_id),
        "Evaluation template",
    )
    await _audit(
        db,
        current_user,
        "shift_evaluation_template_deleted",
        {"template_id": str(template_id), "programs_cleared": len(cleared)},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
