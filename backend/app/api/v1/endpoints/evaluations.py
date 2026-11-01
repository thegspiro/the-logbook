"""
Member performance evaluation endpoints — setup.

* ``/templates`` — ``evaluations.configure`` builds the forms and their
  workflows. Reading them is also open to ``evaluations.manage``, who needs
  to see which form each member will get when drafting.
* ``/periods`` — ``evaluations.manage`` opens and closes review periods;
  ``evaluations.configure`` may read them.
* ``/data-sources`` and ``/builder-options`` — what the builder offers: the
  catalog a data block chooses from, and the department's positions and ranks.

Drafting and conducting evaluations is added by a later change, together with
the permissions it checks.
"""

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.user import User
from app.schemas.evaluation import (
    BuilderOptions,
    DataSourceResponse,
    EvaluationPeriodCreate,
    EvaluationPeriodResponse,
    EvaluationPeriodUpdate,
    EvaluationTemplateCreate,
    EvaluationTemplateDetail,
    EvaluationTemplateSummary,
    EvaluationTemplateUpdate,
    PublishResult,
    TemplateDraftWrite,
)
from app.services.evaluation_template_service import EvaluationTemplateService

router = APIRouter()


async def _audit(
    db: AsyncSession, current_user: User, event_type: str, event_data: dict
) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="evaluations",
        severity="info",
        event_data=event_data,
        user_id=str(current_user.id),
        username=current_user.username,
    )


async def _detail(
    service: EvaluationTemplateService, current_user: User, template_id: str
) -> dict:
    return ensure_found(
        await service.template_detail(current_user.organization_id, template_id),
        "Evaluation template",
    )


# ------------------------------------------------------------------ templates


@router.get("/templates", response_model=List[EvaluationTemplateSummary])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("evaluations.configure", "evaluations.manage")
    ),
):
    return await EvaluationTemplateService(db).list_templates(
        current_user.organization_id
    )


@router.post("/templates", response_model=EvaluationTemplateDetail, status_code=201)
async def create_template(
    data: EvaluationTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    service = EvaluationTemplateService(db)
    async with handle_service_errors("Failed to create evaluation template"):
        template_id = await service.create_template(
            current_user.organization_id, data, str(current_user.id)
        )
    await _audit(
        db,
        current_user,
        "evaluation_template_created",
        {"template_id": template_id, "kind": data.kind.value},
    )
    return await _detail(service, current_user, template_id)


@router.get("/templates/{template_id}", response_model=EvaluationTemplateDetail)
async def get_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("evaluations.configure", "evaluations.manage")
    ),
):
    return await _detail(EvaluationTemplateService(db), current_user, template_id)


@router.patch("/templates/{template_id}", response_model=EvaluationTemplateDetail)
async def update_template(
    template_id: str,
    data: EvaluationTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    service = EvaluationTemplateService(db)
    updates = data.model_dump(exclude_unset=True)
    async with handle_service_errors("Failed to update evaluation template"):
        ensure_found(
            await service.update_template(
                current_user.organization_id, template_id, updates
            ),
            "Evaluation template",
        )
    await _audit(
        db,
        current_user,
        "evaluation_template_updated",
        {"template_id": template_id, "fields": sorted(updates)},
    )
    return await _detail(service, current_user, template_id)


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    async with handle_service_errors("Failed to delete evaluation template"):
        deleted = await EvaluationTemplateService(db).delete_template(
            current_user.organization_id, template_id
        )
    ensure_found(deleted or None, "Evaluation template")
    await _audit(
        db, current_user, "evaluation_template_deleted", {"template_id": template_id}
    )


@router.put("/templates/{template_id}/draft", response_model=EvaluationTemplateDetail)
async def save_draft(
    template_id: str,
    data: TemplateDraftWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    service = EvaluationTemplateService(db)
    async with handle_service_errors("Failed to save the template draft"):
        ensure_found(
            await service.save_draft(
                current_user.organization_id, template_id, data, str(current_user.id)
            ),
            "Evaluation template",
        )
    detail = await _detail(service, current_user, template_id)
    draft = detail["draft"]
    await _audit(
        db,
        current_user,
        "evaluation_template_draft_saved",
        {
            "template_id": template_id,
            "version": draft["version_number"] if draft else None,
        },
    )
    return detail


@router.delete(
    "/templates/{template_id}/draft", response_model=EvaluationTemplateDetail
)
async def discard_draft(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    service = EvaluationTemplateService(db)
    async with handle_service_errors("Failed to discard the template draft"):
        found = await service.discard_draft(current_user.organization_id, template_id)
    ensure_found(found or None, "Evaluation template")
    await _audit(
        db,
        current_user,
        "evaluation_template_draft_discarded",
        {"template_id": template_id},
    )
    return await _detail(service, current_user, template_id)


@router.post("/templates/{template_id}/publish", response_model=PublishResult)
async def publish_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    """Freeze the draft as the version new evaluations start on.

    A draft that is not ready answers 200 with ``published: false`` and the
    list of what to finish, so the builder can show every problem at once.
    """
    service = EvaluationTemplateService(db)
    async with handle_service_errors("Failed to publish the template"):
        errors = ensure_found(
            await service.publish(
                current_user.organization_id, template_id, str(current_user.id)
            ),
            "Evaluation template",
        )
    if errors:
        return PublishResult(published=False, errors=errors)
    detail = await _detail(service, current_user, template_id)
    await _audit(
        db,
        current_user,
        "evaluation_template_published",
        {"template_id": template_id, "version": detail["published_version"]},
    )
    return PublishResult(published=True, template=detail)


@router.get("/data-sources", response_model=List[DataSourceResponse])
async def list_data_sources(
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    return EvaluationTemplateService.data_sources()


@router.get("/builder-options", response_model=BuilderOptions)
async def get_builder_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    """Position and rank names for the builder's pickers.

    Served here rather than from ``/roles`` so building a template does not
    also require ``positions.view``; only ids and names leave, never a
    position's permissions or its members.
    """
    return await EvaluationTemplateService(db).builder_options(
        current_user.organization_id
    )


# -------------------------------------------------------------------- periods


@router.get("/periods", response_model=List[EvaluationPeriodResponse])
async def list_periods(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("evaluations.manage", "evaluations.configure")
    ),
):
    return await EvaluationTemplateService(db).list_periods(
        current_user.organization_id
    )


@router.post("/periods", response_model=EvaluationPeriodResponse, status_code=201)
async def create_period(
    data: EvaluationPeriodCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.manage")),
):
    async with handle_service_errors("Failed to create review period"):
        period = await EvaluationTemplateService(db).create_period(
            current_user.organization_id, data, str(current_user.id)
        )
    await _audit(
        db,
        current_user,
        "evaluation_period_created",
        {
            "period_id": period["id"],
            "start_date": period["start_date"].isoformat(),
            "end_date": period["end_date"].isoformat(),
        },
    )
    return period


@router.patch("/periods/{period_id}", response_model=EvaluationPeriodResponse)
async def update_period(
    period_id: str,
    data: EvaluationPeriodUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.manage")),
):
    updates = data.model_dump(exclude_unset=True)
    async with handle_service_errors("Failed to update review period"):
        period = ensure_found(
            await EvaluationTemplateService(db).update_period(
                current_user.organization_id, period_id, updates
            ),
            "Review period",
        )
    await _audit(
        db,
        current_user,
        "evaluation_period_updated",
        {"period_id": period_id, "fields": sorted(updates)},
    )
    return period


@router.delete("/periods/{period_id}", status_code=204)
async def delete_period(
    period_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.manage")),
):
    async with handle_service_errors("Failed to delete review period"):
        deleted = await EvaluationTemplateService(db).delete_period(
            current_user.organization_id, period_id
        )
    ensure_found(deleted or None, "Review period")
    await _audit(
        db, current_user, "evaluation_period_deleted", {"period_id": period_id}
    )
