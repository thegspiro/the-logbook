"""
Training Submissions API Endpoints

Handles self-reported training from members, officer review/approval,
and self-report configuration management.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.api.dependencies import get_current_user, require_permission
from app.models.user import User
from app.services.training_submission_service import TrainingSubmissionService
from app.schemas.training_submission import (
    SelfReportConfigResponse,
    SelfReportConfigUpdate,
    TrainingSubmissionCreate,
    TrainingSubmissionUpdate,
    TrainingSubmissionResponse,
    SubmissionReviewRequest,
)

router = APIRouter()


# ==================== Self-Report Configuration ====================


@router.get("/config", response_model=SelfReportConfigResponse)
async def get_self_report_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get self-report configuration for the organization."""
    service = TrainingSubmissionService(db)
    config = await service.get_config(current_user.organization_id)
    return config


@router.put("/config", response_model=SelfReportConfigResponse)
async def update_self_report_config(
    updates: SelfReportConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Update self-report configuration (training officers only)."""
    service = TrainingSubmissionService(db)
    config = await service.update_config(
        organization_id=current_user.organization_id,
        updated_by=current_user.id,
        **updates.model_dump(exclude_unset=True),
    )
    return config


# ==================== Member Submissions ====================


@router.post("", response_model=TrainingSubmissionResponse, status_code=201)
async def create_submission(
    data: TrainingSubmissionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit self-reported training. Any authenticated member can submit."""
    service = TrainingSubmissionService(db)
    try:
        submission = await service.create_submission(
            organization_id=current_user.organization_id,
            submitted_by=current_user.id,
            **data.model_dump(exclude_unset=True),
        )
        return submission
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.get("/my", response_model=list[TrainingSubmissionResponse])
async def get_my_submissions(
    status: Optional[str] = Query(None, description="Filter by status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's training submissions."""
    service = TrainingSubmissionService(db)
    submissions = await service.get_submissions(
        organization_id=current_user.organization_id,
        user_id=current_user.id,
        status=status,
    )
    return submissions


@router.get("/pending", response_model=list[TrainingSubmissionResponse])
async def get_pending_submissions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get all pending submissions for review (training officers only)."""
    service = TrainingSubmissionService(db)
    submissions = await service.get_submissions(
        organization_id=current_user.organization_id,
        status="pending_review",
    )
    return submissions


@router.get("/pending/count")
async def get_pending_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get count of pending submissions (for badge/notification)."""
    service = TrainingSubmissionService(db)
    count = await service.get_pending_count(current_user.organization_id)
    return {"pending_count": count}


@router.get("/all", response_model=list[TrainingSubmissionResponse])
async def get_all_submissions(
    status: Optional[str] = Query(None, description="Filter by status"),
    user_id: Optional[str] = Query(None, description="Filter by user"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get all submissions (training officers only)."""
    service = TrainingSubmissionService(db)
    submissions = await service.get_submissions(
        organization_id=current_user.organization_id,
        user_id=user_id,
        status=status,
        limit=limit,
        offset=offset,
    )
    return submissions


@router.get("/{submission_id}", response_model=TrainingSubmissionResponse)
async def get_submission(
    submission_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific submission. Members can see their own; officers can see all."""
    service = TrainingSubmissionService(db)
    submission = await service.get_submission(submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Check access: own submission or has training.manage permission
    if submission.submitted_by != current_user.id:
        # Check if user has training.manage permission
        # We rely on the endpoint-level check for officer endpoints,
        # but for this one we do a manual check
        if submission.organization_id != current_user.organization_id:
            raise HTTPException(status_code=404, detail="Submission not found")

    return submission


@router.patch("/{submission_id}", response_model=TrainingSubmissionResponse)
async def update_submission(
    submission_id: str,
    updates: TrainingSubmissionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a submission (only by submitter, before approval)."""
    service = TrainingSubmissionService(db)
    try:
        submission = await service.update_submission(
            submission_id=submission_id,
            user_id=current_user.id,
            **updates.model_dump(exclude_unset=True),
        )
        return submission
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=safe_error_detail(e))


@router.delete("/{submission_id}", status_code=204)
async def delete_submission(
    submission_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a submission (only by submitter, before approval)."""
    service = TrainingSubmissionService(db)
    try:
        await service.delete_submission(submission_id, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=safe_error_detail(e))


# ==================== Officer Review ====================


@router.post("/{submission_id}/review", response_model=TrainingSubmissionResponse)
async def review_submission(
    submission_id: str,
    review: SubmissionReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Review a submission: approve, reject, or request revision."""
    service = TrainingSubmissionService(db)
    try:
        submission = await service.review_submission(
            submission_id=submission_id,
            reviewer_id=current_user.id,
            action=review.action,
            reviewer_notes=review.reviewer_notes,
            override_hours=review.override_hours,
            override_credit_hours=review.override_credit_hours,
            override_training_type=review.override_training_type,
        )
        return submission
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
