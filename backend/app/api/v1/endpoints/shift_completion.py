"""
Shift Completion Report API Endpoints

Allows shift officers to submit reports on trainee shift experiences.
Auto-updates pipeline requirement progress for shift/call/hour requirements.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.shift_completion import (
    BatchReviewRequest,
    BatchShiftReportCreate,
    BatchShiftReportResponse,
    ReportReview,
    ShiftCompletionReportCreate,
    ShiftCompletionReportResponse,
    ShiftCompletionReportUpdate,
    TraineeAcknowledgment,
)
from app.services.shift_completion_service import ShiftCompletionService
from app.services.training_module_config_service import (
    TrainingModuleConfigService,
)

router = APIRouter()


def _apply_trainee_visibility(report, visibility: dict) -> None:
    """Strip fields from a report that the trainee should not see."""
    if not visibility.get("show_performance_rating", True):
        report.performance_rating = None
    if not visibility.get("show_officer_narrative", False):
        report.officer_narrative = None
    if not visibility.get("show_areas_of_strength", True):
        report.areas_of_strength = None
    if not visibility.get("show_areas_for_improvement", True):
        report.areas_for_improvement = None
    if not visibility.get("show_skills_observed", True):
        report.skills_observed = None
    report.reviewer_notes = None


@router.get("/shift-preview/{shift_id}/{trainee_id}")
async def preview_shift_data(
    shift_id: str,
    trainee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Preview auto-populated data for a shift+trainee before filing.

    Returns hours, call count, and call types from actual records.
    """
    service = ShiftCompletionService(db)
    hours = await service._get_trainee_hours_from_shift(shift_id, trainee_id)
    calls, call_types = await service._get_trainee_call_data_from_shift(
        shift_id, trainee_id
    )
    return {
        "hours_on_shift": hours,
        "calls_responded": calls,
        "call_types": call_types,
    }


@router.post("", response_model=ShiftCompletionReportResponse, status_code=201)
async def create_shift_report(
    data: ShiftCompletionReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Submit a shift completion report for a trainee.
    Auto-updates pipeline requirement progress.
    Only shift officers / training officers can submit.
    If report_review_required is enabled, sets review_status to pending_review.
    """
    # Check if review is required for this organization
    config_service = TrainingModuleConfigService(db)
    config = await config_service.get_config(current_user.organization_id)
    if data.save_as_draft:
        review_status = "draft"
    elif config.report_review_required:
        review_status = "pending_review"
    else:
        review_status = "approved"

    service = ShiftCompletionService(db)
    try:
        report = await service.create_report(
            organization_id=current_user.organization_id,
            officer_id=current_user.id,
            review_status=review_status,
            **data.model_dump(
                exclude_unset=True,
                exclude={"save_as_draft"},
            ),
        )
        await log_audit_event(
            db=db,
            event_type="shift_report_created",
            event_category="training",
            severity="info",
            event_data={
                "report_id": str(report.id),
                "trainee_id": data.trainee_id,
                "shift_date": str(data.shift_date),
                "shift_id": data.shift_id,
                "review_status": review_status,
                "hours_on_shift": data.hours_on_shift,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return report
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.get("/shift-crew/{shift_id}")
async def get_shift_crew_status(
    shift_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get crew members for a shift with enrollment and report status."""
    service = ShiftCompletionService(db)
    try:
        return await service.get_shift_crew_status(
            current_user.organization_id, shift_id
        )
    except Exception as e:
        logger.error(
            "Failed to load crew status for shift {}: {}",
            shift_id,
            str(e),
        )
        raise HTTPException(
            status_code=500, detail=safe_error_detail(e)
        )


@router.post(
    "/batch",
    response_model=BatchShiftReportResponse,
    status_code=201,
)
async def batch_create_shift_reports(
    data: BatchShiftReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Create shift reports for all crew members on a shift.

    Non-trainees get hours/calls credit only.
    Trainees with evaluations get full evaluation data.
    """
    config_service = TrainingModuleConfigService(db)
    config = await config_service.get_config(
        current_user.organization_id
    )
    if data.save_as_draft:
        review_status = "draft"
    elif config.report_review_required:
        review_status = "pending_review"
    else:
        review_status = "approved"

    service = ShiftCompletionService(db)
    try:
        result = await service.batch_create_reports(
            organization_id=current_user.organization_id,
            officer_id=current_user.id,
            shift_id=data.shift_id,
            shift_date=data.shift_date,
            hours_on_shift=data.hours_on_shift,
            calls_responded=data.calls_responded,
            call_types=data.call_types,
            officer_narrative=data.officer_narrative,
            crew_member_ids=data.crew_member_ids,
            trainee_evaluations=(
                [
                    e.model_dump()
                    for e in data.trainee_evaluations
                ]
                if data.trainee_evaluations
                else None
            ),
            review_status=review_status,
        )
        await log_audit_event(
            db=db,
            event_type="shift_report_batch_created",
            event_category="training",
            severity="info",
            event_data={
                "shift_id": data.shift_id,
                "shift_date": str(data.shift_date),
                "crew_count": len(data.crew_member_ids),
                "created": result["created"],
                "skipped": result["skipped"],
                "review_status": review_status,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=400, detail=safe_error_detail(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=safe_error_detail(e)
        )


@router.get("/my-reports", response_model=list[ShiftCompletionReportResponse])
async def get_my_shift_reports(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get shift completion reports where the current user is the trainee.
    Only returns approved reports if review workflow is enabled."""
    service = ShiftCompletionService(db)
    reports = await service.get_reports_for_trainee(
        organization_id=current_user.organization_id,
        trainee_id=str(current_user.id),
        start_date=start_date,
        end_date=end_date,
    )

    # Filter to only approved reports if review workflow is enabled
    config_service = TrainingModuleConfigService(db)
    config = await config_service.get_config(current_user.organization_id)
    if config.report_review_required:
        reports = [r for r in reports if r.review_status == "approved"]

    # Strip sensitive fields based on visibility config
    visibility = config.to_visibility_dict()
    for report in reports:
        _apply_trainee_visibility(report, visibility)

    return reports


@router.get("/my-stats")
async def get_my_shift_stats(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get aggregate stats for the current user's shift completion reports."""
    config_service = TrainingModuleConfigService(db)
    config = await config_service.get_config(current_user.organization_id)
    visibility = config.to_visibility_dict()

    service = ShiftCompletionService(db)
    stats = await service.get_trainee_stats(
        organization_id=current_user.organization_id,
        trainee_id=str(current_user.id),
        start_date=start_date,
        end_date=end_date,
    )

    if not visibility.get("show_performance_rating", True):
        stats["avg_rating"] = None
    if not visibility.get("show_shift_stats", True):
        stats["total_hours"] = None
        stats["total_calls"] = None
        stats["monthly"] = []

    return stats


@router.get("/officer-analytics")
async def get_officer_analytics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get org-wide shift report analytics for training officers."""
    service = ShiftCompletionService(db)
    return await service.get_officer_analytics(
        organization_id=current_user.organization_id,
    )


@router.get("/by-officer", response_model=list[ShiftCompletionReportResponse])
async def get_reports_by_officer(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get shift reports filed by the current officer."""
    service = ShiftCompletionService(db)
    return await service.get_reports_by_officer(
        organization_id=current_user.organization_id,
        officer_id=str(current_user.id),
    )


@router.get(
    "/trainee/{trainee_id}",
    response_model=list[ShiftCompletionReportResponse],
)
async def get_reports_for_trainee(
    trainee_id: str,
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get all reports for a specific trainee (officers only)."""
    service = ShiftCompletionService(db)
    return await service.get_reports_for_trainee(
        organization_id=current_user.organization_id,
        trainee_id=trainee_id,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/trainee/{trainee_id}/stats")
async def get_trainee_stats(
    trainee_id: str,
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get aggregate stats for a specific trainee (officers only)."""
    service = ShiftCompletionService(db)
    return await service.get_trainee_stats(
        organization_id=current_user.organization_id,
        trainee_id=trainee_id,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/all", response_model=list[ShiftCompletionReportResponse])
async def get_all_reports(
    trainee_id: str | None = Query(None),
    officer_id: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get all shift completion reports (officers only)."""
    service = ShiftCompletionService(db)
    return await service.get_all_reports(
        organization_id=current_user.organization_id,
        trainee_id=trainee_id,
        officer_id=officer_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )


async def _get_reports_by_review_status(
    review_status: str,
    db: AsyncSession,
    current_user: User,
) -> list:
    """Shared implementation for fetching reports by review status."""
    valid_statuses = {"pending_review", "flagged", "draft"}
    if review_status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid review_status. Must be one of: "
            f"{', '.join(sorted(valid_statuses))}",
        )
    service = ShiftCompletionService(db)
    return await service.get_reports_by_status(
        organization_id=current_user.organization_id,
        review_status=review_status,
    )


@router.get(
    "/by-status",
    response_model=list[ShiftCompletionReportResponse],
)
async def get_reports_by_status(
    review_status: str = Query(
        ..., description="Filter by review status: pending_review, flagged, or draft"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get shift completion reports filtered by review status."""
    return await _get_reports_by_review_status(review_status, db, current_user)


@router.get(
    "/pending-review",
    response_model=list[ShiftCompletionReportResponse],
)
async def get_pending_review_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get shift completion reports pending review for this organization."""
    return await _get_reports_by_review_status("pending_review", db, current_user)


@router.get(
    "/flagged",
    response_model=list[ShiftCompletionReportResponse],
)
async def get_flagged_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get shift completion reports that have been flagged for follow-up."""
    return await _get_reports_by_review_status("flagged", db, current_user)


@router.get("/drafts", response_model=list[ShiftCompletionReportResponse])
async def get_draft_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get auto-created draft shift completion reports awaiting officer input.

    Drafts are created automatically when a shift is finalized for
    trainees with active program enrollments.
    """
    return await _get_reports_by_review_status("draft", db, current_user)


@router.post("/drafts/submit-all")
async def submit_all_drafts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Submit all draft reports at once.

    Transitions each draft to pending_review or approved based
    on the org's review workflow setting, and triggers deferred
    pipeline progress for each.
    """
    config_service = TrainingModuleConfigService(db)
    config = await config_service.get_config(current_user.organization_id)
    target_status = "pending_review" if config.report_review_required else "approved"

    service = ShiftCompletionService(db)
    drafts = await service.get_reports_by_status(
        organization_id=current_user.organization_id,
        review_status="draft",
    )

    submitted = 0
    for draft in drafts:
        try:
            await service.update_report(
                report_id=draft.id,
                organization_id=(current_user.organization_id),
                officer_id=str(current_user.id),
                updates={
                    "review_status": target_status,
                },
            )
            submitted += 1
        except ValueError:
            continue

    if submitted > 0:
        await log_audit_event(
            db=db,
            event_type="shift_reports_bulk_submitted",
            event_category="training",
            severity="info",
            event_data={
                "submitted_count": submitted,
                "total_drafts": len(drafts),
                "target_status": target_status,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

    return {
        "submitted": submitted,
        "total": len(drafts),
    }


@router.get(
    "/{report_id}",
    response_model=ShiftCompletionReportResponse,
)
async def get_shift_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific shift completion report."""
    service = ShiftCompletionService(db)
    report = await service.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if report.organization_id != str(current_user.organization_id):
        raise HTTPException(status_code=404, detail="Report not found")

    user_id = str(current_user.id)
    is_trainee = report.trainee_id == user_id
    is_filing_officer = report.officer_id == user_id
    user_perms = _collect_user_permissions(current_user)
    has_manage = _has_permission("training.manage", user_perms)

    if not (is_trainee or is_filing_officer or has_manage):
        raise HTTPException(status_code=404, detail="Report not found")

    # Trainees without manage permission see visibility-filtered data
    if is_trainee and not has_manage:
        config_service = TrainingModuleConfigService(db)
        config = await config_service.get_config(current_user.organization_id)
        visibility = config.to_visibility_dict()
        _apply_trainee_visibility(report, visibility)

    return report


@router.put("/{report_id}", response_model=ShiftCompletionReportResponse)
async def update_shift_report(
    report_id: str,
    data: ShiftCompletionReportUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Update a draft shift completion report.

    Officers use this to complete auto-created drafts with ratings,
    narratives, and skills before submitting.  When review_status
    transitions from draft to approved/pending_review, training
    pipeline progress is triggered automatically.
    """
    service = ShiftCompletionService(db)
    try:
        update_fields = data.model_dump(exclude_unset=True)
        report = await service.update_report(
            report_id=report_id,
            organization_id=current_user.organization_id,
            officer_id=str(current_user.id),
            updates=update_fields,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    await log_audit_event(
        db=db,
        event_type="shift_report_updated",
        event_category="training",
        severity="info",
        event_data={
            "report_id": report_id,
            "updated_fields": list(update_fields.keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return report


@router.post(
    "/{report_id}/acknowledge",
    response_model=ShiftCompletionReportResponse,
)
async def acknowledge_report(
    report_id: str,
    ack: TraineeAcknowledgment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trainee acknowledges a shift completion report."""
    service = ShiftCompletionService(db)
    report = await service.acknowledge_report(
        report_id=report_id,
        trainee_id=str(current_user.id),
        trainee_comments=ack.trainee_comments,
    )
    if not report:
        raise HTTPException(
            status_code=404,
            detail="Report not found or not your report",
        )
    await log_audit_event(
        db=db,
        event_type="shift_report_acknowledged",
        event_category="training",
        severity="info",
        event_data={
            "report_id": report_id,
            "has_comments": bool(ack.trainee_comments),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return report


@router.post(
    "/{report_id}/review",
    response_model=ShiftCompletionReportResponse,
)
async def review_report(
    report_id: str,
    review: ReportReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Review a shift completion report.

    Approve, flag, or redact fields. Redacting clears specified
    fields before making the report visible to trainee.
    """
    service = ShiftCompletionService(db)
    report = await service.review_report(
        report_id=report_id,
        organization_id=current_user.organization_id,
        reviewer_id=str(current_user.id),
        review_status=review.review_status,
        reviewer_notes=review.reviewer_notes,
        redact_fields=review.redact_fields,
        reviewer_name=current_user.full_name,
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    await log_audit_event(
        db=db,
        event_type="shift_report_reviewed",
        event_category="training",
        severity="info",
        event_data={
            "report_id": report_id,
            "review_status": review.review_status,
            "redacted_fields": review.redact_fields,
            "trainee_id": report.trainee_id,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return report


@router.post("/batch-review")
async def batch_review_reports(
    data: BatchReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Review multiple shift completion reports at once."""
    service = ShiftCompletionService(db)
    reviewed = 0
    failed = 0
    for report_id in data.report_ids:
        try:
            report = await service.review_report(
                report_id=report_id,
                organization_id=current_user.organization_id,
                reviewer_id=str(current_user.id),
                review_status=data.review_status,
                reviewer_notes=data.reviewer_notes,
                redact_fields=None,
                reviewer_name=current_user.full_name,
            )
            if report:
                reviewed += 1
                await log_audit_event(
                    db=db,
                    event_type="shift_report_reviewed",
                    event_category="training",
                    severity="info",
                    event_data={
                        "report_id": report_id,
                        "review_status": data.review_status,
                        "batch": True,
                        "trainee_id": report.trainee_id,
                    },
                    user_id=str(current_user.id),
                    username=current_user.username,
                )
            else:
                failed += 1
        except Exception as e:
            logger.error(f"Batch review failed for report {report_id}: {e}")
            failed += 1
    return {"reviewed": reviewed, "failed": failed}
