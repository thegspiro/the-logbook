"""
Member performance evaluation endpoints — setup.

* ``/templates`` — ``evaluations.configure`` builds the forms and their
  workflows. Reading them is also open to ``evaluations.manage``, who needs
  to see which form each member will get when drafting.
* ``/periods`` — ``evaluations.manage`` opens and closes review periods;
  ``evaluations.configure`` may read them.
* ``/data-sources`` and ``/builder-options`` — what the builder offers: the
  catalog a data block chooses from, and the department's positions and ranks.

* ``""`` — evaluations a holder of ``evaluations.conduct`` evaluates, or every
  one for ``evaluations.view_all`` / ``evaluations.manage``; ``POST`` drafts
  one.
* ``/bulk-preview`` and ``/bulk`` — ``evaluations.manage`` drafts a whole
  review period at once: a preview of every current member and why any is
  left out, then the drafts for the members the manager kept.
* ``/removed`` — deletion records, for holders of ``evaluations.view_all``,
  ``evaluations.manage`` or ``evaluations.delete``.
* ``/mine``, ``/mine/live-data`` and ``/mine/removed`` — a member's own
  evaluations, their figures for the current period and the records of any
  deleted, on authentication alone: the member is entitled to their own
  record whatever positions the department grants.
* ``/{evaluation_id}`` and its actions — open to anyone with a part in the
  evaluation. The service decides who that is and what each may read and do;
  anyone else is told it does not exist. ``/{evaluation_id}/delete`` needs
  ``evaluations.delete`` and a re-verified session; ``/{evaluation_id}/amend``
  needs ``evaluations.manage``.
"""

from typing import List, Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    require_stepup,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.core.utils import ensure_found, handle_service_errors
from app.models.evaluation import EvaluationTemplateKind
from app.models.user import User
from app.schemas.evaluation import (
    BuilderOptions,
    BulkDraftPreview,
    BulkDraftRequest,
    BulkDraftResponse,
    CalibrationComplete,
    DataSourceResponse,
    DraftOptions,
    EvaluationAmend,
    EvaluationCreate,
    EvaluationDelete,
    EvaluationDeletionRecordResponse,
    EvaluationDetail,
    EvaluationPeriodCreate,
    EvaluationPeriodResponse,
    EvaluationPeriodUpdate,
    EvaluationStarterResponse,
    EvaluationSummary,
    EvaluationTemplateCreate,
    EvaluationTemplateDetail,
    EvaluationTemplateSummary,
    EvaluationTemplateUpdate,
    LiveDataResponse,
    PartWrite,
    PreviewOptions,
    PublishResult,
    ResponseWrite,
    SignatureWrite,
    SignResult,
    SubmitResult,
    TemplateDraftWrite,
    TemplatePreviewRequest,
    TemplatePreviewResponse,
)
from app.services import file_storage_service as file_storage
from app.services.evaluation_document_service import EvaluationDocumentService
from app.services.evaluation_service import EvaluationService
from app.services.evaluation_template_service import EvaluationTemplateService

router = APIRouter()


async def _audit(
    db: AsyncSession,
    current_user: User,
    event_type: str,
    event_data: dict,
    severity: str = "info",
) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="evaluations",
        severity=severity,
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


@router.get("/templates/starters", response_model=List[EvaluationStarterResponse])
async def list_template_starters(
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    """Ready-made forms a new template can start from. Fixed content, the
    same for every department; nothing is read from the database."""
    return EvaluationTemplateService.starters()


@router.get("/templates/preview-options", response_model=PreviewOptions)
async def get_preview_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    """Review periods to measure a preview over, and — for a builder who also
    holds ``evaluations.view_all`` — the members whose figures it can show."""
    return await EvaluationService(db).preview_options(
        current_user.organization_id,
        user_has_permission(current_user, "evaluations.view_all"),
    )


@router.post("/templates/preview", response_model=TemplatePreviewResponse)
async def preview_template(
    data: TemplatePreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.configure")),
):
    """The form as it stands in the builder, filled with figures.

    Building a form does not by itself let someone read members' figures
    (owner decision 2026-11-03), so a real member's figures also need
    ``evaluations.view_all``; without it the preview uses sample figures.
    Nothing is stored. A preview of a real member is audited, since it reads
    their records.
    """
    if data.member_id is not None and not user_has_permission(
        current_user, "evaluations.view_all"
    ):
        raise HTTPException(
            status_code=403,
            detail="Previewing with a member's figures needs evaluations.view_all.",
        )
    async with handle_service_errors("Failed to preview the template"):
        preview = await EvaluationService(db).preview_template(
            current_user.organization_id,
            data.definition,
            data.member_id,
            data.period_id,
        )
    if data.member_id is not None:
        await _audit(
            db,
            current_user,
            "evaluation_template_previewed",
            {"member_id": data.member_id, "period_id": data.period_id},
        )
    return preview


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
        {"template_id": template_id, "kind": data.kind.value, "starter": data.starter},
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


# ---------------------------------------------------------------- evaluations

PartKind = Literal["self_evaluation", "evaluator"]


async def _evaluation(
    service: EvaluationService, current_user: User, evaluation_id: str
) -> dict:
    return ensure_found(
        await service.detail(current_user.organization_id, evaluation_id, current_user),
        "Evaluation",
    )


async def _build_document(
    db: AsyncSession, current_user: User, evaluation_id: str
) -> None:
    """Freeze the PDF the moment an evaluation finalizes.

    A failure here does not undo the signature or the submission that
    finalized it: it is logged as an error, and the download endpoint builds
    the document on first request instead (``ensure_document`` is idempotent).
    """
    try:
        await EvaluationDocumentService(db).ensure_document(
            current_user.organization_id, evaluation_id, current_user
        )
    except Exception:
        await db.rollback()
        logger.exception(
            "Could not build the PDF for evaluation {} at finalization", evaluation_id
        )


@router.get("", response_model=List[EvaluationSummary])
async def list_evaluations(
    period_id: Optional[str] = Query(default=None, max_length=36),
    status: Optional[Literal["in_progress", "finalized"]] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "evaluations.conduct", "evaluations.view_all", "evaluations.manage"
        )
    ),
):
    return await EvaluationService(db).list_evaluations(
        current_user.organization_id,
        current_user,
        period_id=period_id,
        status=status,
    )


@router.get("/draft-options", response_model=DraftOptions)
async def get_draft_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("evaluations.conduct", "evaluations.manage")
    ),
):
    """Members, open periods and eligible evaluators for the draft dialog."""
    return await EvaluationService(db).draft_options(current_user.organization_id)


@router.get("/bulk-preview", response_model=BulkDraftPreview)
async def preview_bulk_drafts(
    period_id: str = Query(min_length=1, max_length=36),
    kind: EvaluationTemplateKind = EvaluationTemplateKind.ANNUAL,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.manage")),
):
    """Every current member as drafting the whole period would treat them."""
    async with handle_service_errors("Failed to prepare the drafts"):
        return await EvaluationService(db).bulk_preview(
            current_user.organization_id, current_user, period_id, kind
        )


@router.post("/bulk", response_model=BulkDraftResponse)
async def bulk_draft_evaluations(
    data: BulkDraftRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.manage")),
):
    """Draft the listed members for one period. Each draft stands alone: a
    member who cannot be drafted is reported and the rest go ahead."""
    async with handle_service_errors("Failed to draft the evaluations"):
        results = await EvaluationService(db).bulk_create(
            current_user.organization_id,
            current_user,
            data.period_id,
            data.kind,
            data.items,
        )
    drafted = [r["evaluation_id"] for r in results if r.get("evaluation_id")]
    await _audit(
        db,
        current_user,
        "evaluations_bulk_drafted",
        {
            "period_id": data.period_id,
            "evaluation_ids": drafted,
            "failed": len(results) - len(drafted),
        },
    )
    return {"drafted": len(drafted), "results": results}


@router.get("/removed", response_model=List[EvaluationDeletionRecordResponse])
async def list_deletion_records(
    member_id: Optional[str] = Query(default=None, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "evaluations.view_all", "evaluations.manage", "evaluations.delete"
        )
    ),
):
    """The department's deletion records, newest first."""
    return await EvaluationService(db).deletion_records(
        current_user.organization_id, member_id
    )


@router.post("", response_model=EvaluationDetail, status_code=201)
async def create_evaluation(
    data: EvaluationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("evaluations.conduct", "evaluations.manage")
    ),
):
    service = EvaluationService(db)
    async with handle_service_errors("Failed to draft the evaluation"):
        evaluation_id = await service.create(
            current_user.organization_id, current_user, data
        )
    await _audit(
        db,
        current_user,
        "evaluation_created",
        {
            "evaluation_id": evaluation_id,
            "member_id": data.member_id,
            "period_id": data.period_id,
        },
    )
    return await _evaluation(service, current_user, evaluation_id)


@router.get("/mine", response_model=List[EvaluationSummary])
async def list_my_evaluations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await EvaluationService(db).list_mine(
        current_user.organization_id, current_user
    )


@router.get("/crew", response_model=List[EvaluationSummary])
async def list_crew_evaluations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Evaluations of the members the caller supervises today.

    **Authentication required.** Access comes from the dated supervisor
    assignments, not a permission: a member who supervises nobody gets an
    empty list. Each evaluation's content opens to the supervisor once it is
    released to the member (``GET /evaluations/{id}``)."""
    return await EvaluationService(db).list_crew(
        current_user.organization_id, current_user
    )


@router.get("/mine/removed", response_model=List[EvaluationDeletionRecordResponse])
async def list_my_deletion_records(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Records of the caller's own evaluations that were deleted, with the
    reason given: the member is told an evaluation was removed, and why."""
    return await EvaluationService(db).deletion_records(
        current_user.organization_id, current_user.id
    )


@router.get("/mine/live-data", response_model=LiveDataResponse)
async def get_my_live_data(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The member's figures for the current review period, measured now."""
    async with handle_service_errors("Failed to load your figures"):
        return await EvaluationService(db).live_data(
            current_user.organization_id, current_user
        )


@router.get("/{evaluation_id}", response_model=EvaluationDetail)
async def get_evaluation(
    evaluation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _evaluation(EvaluationService(db), current_user, evaluation_id)


@router.put("/{evaluation_id}/parts/{kind}", response_model=EvaluationDetail)
async def save_evaluation_part(
    evaluation_id: str,
    kind: PartKind,
    data: PartWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save progress on a part. Saving never locks it."""
    service = EvaluationService(db)
    async with handle_service_errors("Failed to save"):
        ensure_found(
            await service.save_part(
                current_user.organization_id,
                evaluation_id,
                current_user,
                kind,
                data.content,
            ),
            "Evaluation",
        )
    await _audit(
        db,
        current_user,
        "evaluation_part_saved",
        {"evaluation_id": evaluation_id, "part": kind},
    )
    return await _evaluation(service, current_user, evaluation_id)


@router.post("/{evaluation_id}/parts/{kind}/submit", response_model=SubmitResult)
async def submit_evaluation_part(
    evaluation_id: str,
    kind: PartKind,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit and lock a saved part.

    An evaluator's first submission on a form with a calibration step sends
    it to calibration instead (``sent_for_calibration``); a check-in is
    finalized when the evaluator locks it (``finalized``).
    """
    service = EvaluationService(db)
    async with handle_service_errors("Failed to submit"):
        outcome = ensure_found(
            await service.submit_part(
                current_user.organization_id, evaluation_id, current_user, kind
            ),
            "Evaluation",
        )
    await _audit(
        db,
        current_user,
        "evaluation_part_submitted",
        {"evaluation_id": evaluation_id, "part": kind, "outcome": outcome},
    )
    if outcome == "finalized":
        await _build_document(db, current_user, evaluation_id)
    return SubmitResult(
        outcome=outcome,
        evaluation=await _evaluation(service, current_user, evaluation_id),
    )


@router.post("/{evaluation_id}/refresh-data", response_model=EvaluationDetail)
async def refresh_evaluation_data(
    evaluation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Measure the figures again; allowed until the evaluator locks."""
    service = EvaluationService(db)
    async with handle_service_errors("Failed to refresh the figures"):
        ensure_found(
            await service.refresh_data(
                current_user.organization_id, evaluation_id, current_user
            ),
            "Evaluation",
        )
    await _audit(
        db,
        current_user,
        "evaluation_data_refreshed",
        {"evaluation_id": evaluation_id},
    )
    return await _evaluation(service, current_user, evaluation_id)


@router.post("/{evaluation_id}/calibration/complete", response_model=EvaluationDetail)
async def complete_evaluation_calibration(
    evaluation_id: str,
    data: Optional[CalibrationComplete] = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.view_all")),
):
    """Record that calibration happened. The body is optional: without one,
    nothing is flagged, as before flags existed."""
    flagged = data.flagged_items if data else []
    service = EvaluationService(db)
    async with handle_service_errors("Failed to complete calibration"):
        ensure_found(
            await service.complete_calibration(
                current_user.organization_id, evaluation_id, current_user, flagged
            ),
            "Evaluation",
        )
    await _audit(
        db,
        current_user,
        "evaluation_calibration_completed",
        {"evaluation_id": evaluation_id, "flagged_items": len(set(flagged))},
    )
    return await _evaluation(service, current_user, evaluation_id)


@router.post("/{evaluation_id}/sign", response_model=SignResult)
async def sign_evaluation(
    evaluation_id: str,
    data: SignatureWrite,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _stepup: User = Depends(require_stepup),
):
    """Sign the step now open to the caller.

    Requires a recent re-verification of the session (step-up) and the
    caller's own name typed as the signature. An approver signs; the member
    acknowledges receipt or refuses with a reason, and either finalizes.
    """
    service = EvaluationService(db)
    async with handle_service_errors("Failed to record the signature"):
        outcome = ensure_found(
            await service.sign(
                current_user.organization_id,
                evaluation_id,
                current_user,
                signed_name=data.signed_name,
                disposition=data.disposition,
                comment=data.comment,
                ip_address=get_client_ip(request),
                user_agent=request.headers.get("user-agent"),
            ),
            "Evaluation",
        )
    await _audit(
        db,
        current_user,
        "evaluation_signed",
        {
            "evaluation_id": evaluation_id,
            "disposition": data.disposition,
            "finalized": outcome == "finalized",
        },
    )
    if outcome == "finalized":
        await _build_document(db, current_user, evaluation_id)
    return SignResult(
        outcome=outcome,
        evaluation=await _evaluation(service, current_user, evaluation_id),
    )


@router.get("/{evaluation_id}/document")
async def download_evaluation_document(
    evaluation_id: str,
    version: Literal["latest", "signed"] = "latest",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The finalized evaluation's frozen PDF, for whoever may read it.

    ``latest`` is the PDF carrying the member's written response once they
    have submitted one, and the signed PDF otherwise; ``signed`` is always
    the PDF as it was signed."""
    detail = await _evaluation(EvaluationService(db), current_user, evaluation_id)
    if not detail["document_available"]:
        raise HTTPException(status_code=404, detail="This evaluation has no PDF yet.")
    with_response = version == "latest" and detail["response_document_available"]
    documents = EvaluationDocumentService(db)
    async with handle_service_errors("Failed to prepare the evaluation PDF"):
        document = await documents.ensure_document(
            current_user.organization_id,
            evaluation_id,
            current_user,
            with_response=with_response,
        )
    document = ensure_found(document, "Evaluation PDF")
    evaluation = ensure_found(
        await documents.evaluations._evaluation(
            current_user.organization_id, evaluation_id
        ),
        "Evaluation",
    )
    await _audit(
        db,
        current_user,
        "evaluation_document_downloaded",
        {
            "evaluation_id": evaluation_id,
            "revision": document.revision,
            "includes_response": document.includes_response,
        },
    )
    try:
        return await documents.response(
            current_user.organization_id, evaluation, document
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="The evaluation's PDF is missing.")


@router.post("/{evaluation_id}/delete", response_model=EvaluationDeletionRecordResponse)
async def delete_evaluation(
    evaluation_id: str,
    data: EvaluationDelete,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.delete")),
    _stepup: User = Depends(require_stepup),
):
    """Delete an evaluation, keeping a record with the reason on the member's
    history and emailing the member.

    A personnel record is removed for good, so the session must have
    re-verified recently, as for deleting a member account. The stored PDFs
    go too: a deleted evaluation's signed copy must not outlive it.
    """
    service = EvaluationService(db)
    async with handle_service_errors("Failed to delete the evaluation"):
        removed = ensure_found(
            await service.delete(
                current_user.organization_id, evaluation_id, current_user, data.reason
            ),
            "Evaluation",
        )
    record, paths = removed
    for path in paths:
        await file_storage.delete_quietly(path)
    await _audit(
        db,
        current_user,
        "evaluation_deleted",
        {
            "evaluation_id": evaluation_id,
            "member_id": record["member"]["id"],
            "was_finalized": record["was_finalized"],
            "documents_removed": len(paths),
        },
        severity="warning",
    )
    return record


@router.post("/{evaluation_id}/amend", response_model=EvaluationDetail)
async def amend_evaluation(
    evaluation_id: str,
    data: EvaluationAmend,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("evaluations.manage")),
):
    """Reopen a finalized evaluation as a new revision, from the evaluator
    onward, with the reason kept on the evaluation and its PDF. The member
    and everyone who signed are emailed; the earlier revision's text and PDF
    are removed."""
    service = EvaluationService(db)
    async with handle_service_errors("Failed to amend the evaluation"):
        paths = ensure_found(
            await service.amend(
                current_user.organization_id, evaluation_id, current_user, data.reason
            ),
            "Evaluation",
        )
    for path in paths:
        await file_storage.delete_quietly(path)
    await _audit(
        db,
        current_user,
        "evaluation_amended",
        {"evaluation_id": evaluation_id, "documents_removed": len(paths)},
        severity="warning",
    )
    return await _evaluation(service, current_user, evaluation_id)


@router.put("/{evaluation_id}/response", response_model=EvaluationDetail)
async def save_evaluation_response(
    evaluation_id: str,
    data: ResponseWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save the member's written response as a draft. Only the member, on
    their finalized evaluation, inside the template's response window."""
    service = EvaluationService(db)
    async with handle_service_errors("Failed to save your response"):
        ensure_found(
            await service.save_response(
                current_user.organization_id, evaluation_id, current_user, data.text
            ),
            "Evaluation",
        )
    return await _evaluation(service, current_user, evaluation_id)


@router.post("/{evaluation_id}/response/submit", response_model=EvaluationDetail)
async def submit_evaluation_response(
    evaluation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit the saved response. It is final, joins the record, and is
    printed in a second PDF beside the signed one; the evaluator and the
    evaluation managers are emailed."""
    service = EvaluationService(db)
    async with handle_service_errors("Failed to submit your response"):
        ensure_found(
            await service.submit_response(
                current_user.organization_id, evaluation_id, current_user
            ),
            "Evaluation",
        )
    await _audit(
        db,
        current_user,
        "evaluation_response_submitted",
        {"evaluation_id": evaluation_id},
    )
    try:
        await EvaluationDocumentService(db).ensure_document(
            current_user.organization_id,
            evaluation_id,
            current_user,
            with_response=True,
        )
    except Exception:
        # Built on first download instead; the response itself is saved.
        await db.rollback()
        logger.exception(
            "Could not build the response PDF for evaluation {}", evaluation_id
        )
    return await _evaluation(service, current_user, evaluation_id)
