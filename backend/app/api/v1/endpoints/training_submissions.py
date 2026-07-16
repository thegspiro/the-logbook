"""
Training Submissions API Endpoints

Handles self-reported training from members, officer review/approval,
and self-report configuration management.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.user import User
from app.schemas.training_submission import (
    SelfReportConfigResponse,
    SelfReportConfigUpdate,
    SubmissionReviewRequest,
    TrainingSubmissionCreate,
    TrainingSubmissionResponse,
    TrainingSubmissionUpdate,
)
from app.services.training_submission_service import TrainingSubmissionService

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
    async with handle_service_errors("Failed to create submission"):
        submission = await service.create_submission(
            organization_id=current_user.organization_id,
            submitted_by=current_user.id,
            **data.model_dump(exclude_unset=True),
        )
        return submission


@router.get("/my", response_model=list[TrainingSubmissionResponse])
async def get_my_submissions(
    status: str | None = Query(None, description="Filter by status"),
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
    status: str | None = Query(None, description="Filter by status"),
    user_id: str | None = Query(None, description="Filter by user"),
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
    # Org boundary enforced in the service query (404 hides cross-org
    # existence), then authorization: members may see only their own
    # submission; officers (training.manage) may see any in their org.
    # A same-org non-owner without the permission must be rejected —
    # submissions can carry PHI.
    submission = ensure_found(
        await service.get_submission(submission_id, current_user.organization_id),
        "Submission",
    )

    if submission.submitted_by != current_user.id and not _has_permission(
        "training.manage", _collect_user_permissions(current_user)
    ):
        raise HTTPException(
            status_code=403, detail="Not authorized to view this submission"
        )

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
    async with handle_service_errors("Failed to update submission"):
        submission = await service.update_submission(
            submission_id=submission_id,
            user_id=current_user.id,
            organization_id=current_user.organization_id,
            **updates.model_dump(exclude_unset=True),
        )
        return submission


@router.delete("/{submission_id}", status_code=204)
async def delete_submission(
    submission_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a submission (only by submitter, before approval)."""
    service = TrainingSubmissionService(db)
    async with handle_service_errors("Failed to delete submission"):
        await service.delete_submission(
            submission_id, current_user.id, current_user.organization_id
        )


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
    wants_apply = bool(
        review.action == "approve"
        and review.apply_to_program_id
        and review.apply_to_requirement_id
    )

    async with handle_service_errors("Failed to review submission"):
        from app.services.training_program_service import TrainingProgramService

        program_service = TrainingProgramService(db)

        # Validate the pipeline target BEFORE approving, so an invalid choice is
        # rejected up front with nothing changed — never "approved but couldn't
        # apply". get_submission gives us the member without mutating anything.
        if wants_apply:
            preview = await service.get_submission(
                submission_id, current_user.organization_id
            )
            if not preview:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found"
                )
            ok, apply_error = await program_service.validate_apply_target(
                user_id=preview.submitted_by,
                organization_id=current_user.organization_id,
                program_id=review.apply_to_program_id,
                requirement_id=review.apply_to_requirement_id,
            )
            if not ok:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=apply_error
                )

        submission = await service.review_submission(
            submission_id=submission_id,
            reviewer_id=current_user.id,
            organization_id=current_user.organization_id,
            action=review.action,
            reviewer_notes=review.reviewer_notes,
            override_hours=review.override_hours,
            override_credit_hours=review.override_credit_hours,
            override_training_type=review.override_training_type,
        )

        # Target already validated above, so this applies cleanly.
        if wants_apply:
            await program_service.apply_training_to_requirement(
                user_id=submission.submitted_by,
                organization_id=current_user.organization_id,
                program_id=review.apply_to_program_id,
                requirement_id=review.apply_to_requirement_id,
                hours=float(submission.hours_completed or 0),
                verified_by=current_user.id,
            )
            await log_audit_event(
                db=db,
                event_type="training_submission_applied_to_requirement",
                event_category="training",
                severity="info",
                event_data={
                    "submission_id": str(submission_id),
                    "target_user_id": str(submission.submitted_by),
                    "program_id": str(review.apply_to_program_id),
                    "requirement_id": str(review.apply_to_requirement_id),
                },
                user_id=str(current_user.id),
                username=current_user.username,
            )

        return submission
