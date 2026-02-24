"""
Shift Completion Report API Endpoints

Allows shift officers to submit reports on trainee shift experiences.
Auto-updates pipeline requirement progress for shift/call/hour requirements.
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.shift_completion import (
    ReportReview,
    ShiftCompletionReportCreate,
    ShiftCompletionReportResponse,
    TraineeAcknowledgment,
)
from app.services.shift_completion_service import ShiftCompletionService
from app.services.training_module_config_service import TrainingModuleConfigService

router = APIRouter()


@router.post("", response_model=ShiftCompletionReportResponse, status_code=201)
async def create_shift_report(
    data: ShiftCompletionReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Submit a shift completion report for a trainee.
    Auto-updates pipeline requirement progress for shift/call/hour-based requirements.
    Only shift officers / training officers can submit.
    If report_review_required is enabled, sets review_status to pending_review.
    """
    # Check if review is required for this organization
    config_service = TrainingModuleConfigService(db)
    config = await config_service.get_config(current_user.organization_id)
    review_status = "pending_review" if config.report_review_required else "approved"

    service = ShiftCompletionService(db)
    try:
        report = await service.create_report(
            organization_id=current_user.organization_id,
            officer_id=current_user.id,
            review_status=review_status,
            **data.model_dump(exclude_unset=True),
        )
        return report
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.get("/my-reports", response_model=list[ShiftCompletionReportResponse])
async def get_my_shift_reports(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
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
        # Never expose reviewer notes to trainees
        report.reviewer_notes = None

    return reports


@router.get("/my-stats")
async def get_my_shift_stats(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get aggregate stats for the current user's shift completion reports."""
    service = ShiftCompletionService(db)
    return await service.get_trainee_stats(
        organization_id=current_user.organization_id,
        trainee_id=str(current_user.id),
        start_date=start_date,
        end_date=end_date,
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


@router.get("/trainee/{trainee_id}", response_model=list[ShiftCompletionReportResponse])
async def get_reports_for_trainee(
    trainee_id: str,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get all shift completion reports for a specific trainee (officers only)."""
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
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
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
    trainee_id: Optional[str] = Query(None),
    officer_id: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
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


@router.get("/pending-review", response_model=list[ShiftCompletionReportResponse])
async def get_pending_review_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get shift completion reports pending review for this organization."""
    service = ShiftCompletionService(db)
    return await service.get_reports_by_status(
        organization_id=current_user.organization_id,
        review_status="pending_review",
    )


@router.get("/{report_id}", response_model=ShiftCompletionReportResponse)
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

    # Access check: trainee or officer in same org
    if report.organization_id != str(current_user.organization_id):
        raise HTTPException(status_code=404, detail="Report not found")

    return report


@router.post("/{report_id}/acknowledge", response_model=ShiftCompletionReportResponse)
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
            status_code=404, detail="Report not found or not your report"
        )
    return report


@router.post("/{report_id}/review", response_model=ShiftCompletionReportResponse)
async def review_report(
    report_id: str,
    review: ReportReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Review a shift completion report — approve, flag, or redact fields.
    Redacting clears specified fields before making the report visible to trainee."""
    service = ShiftCompletionService(db)
    report = await service.review_report(
        report_id=report_id,
        organization_id=current_user.organization_id,
        reviewer_id=str(current_user.id),
        review_status=review.review_status,
        reviewer_notes=review.reviewer_notes,
        redact_fields=review.redact_fields,
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report
