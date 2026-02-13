"""
Training Session API Endpoints

Endpoints for creating and managing training sessions and approvals.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.models.user import User
from app.schemas.training_session import (
    TrainingSessionCreate,
    TrainingSessionResponse,
    TrainingApprovalRequest,
    TrainingApprovalResponse,
)
from app.services.training_session_service import TrainingSessionService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


@router.post("", response_model=TrainingSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_training_session(
    session_data: TrainingSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Create a new training session

    This creates both an Event and a TrainingSession record.
    The event will have event_type='training' and include training-specific
    metadata in custom_fields.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = TrainingSessionService(db)

    training_session, error = await service.create_training_session(
        session_data=session_data,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    await log_audit_event(
        db=db,
        event_type="training_session_created",
        event_category="training",
        severity="info",
        event_data={
            "session_id": str(training_session.id),
            "course_name": training_session.course_name,
            "event_id": str(training_session.event_id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return TrainingSessionResponse(
        id=training_session.id,
        organization_id=training_session.organization_id,
        event_id=training_session.event_id,
        course_id=training_session.course_id,
        course_name=training_session.course_name,
        course_code=training_session.course_code,
        training_type=training_session.training_type.value,
        credit_hours=training_session.credit_hours,
        instructor=training_session.instructor,
        issues_certification=training_session.issues_certification,
        certification_number_prefix=training_session.certification_number_prefix,
        issuing_agency=training_session.issuing_agency,
        expiration_months=training_session.expiration_months,
        auto_create_records=training_session.auto_create_records,
        require_completion_confirmation=training_session.require_completion_confirmation,
        approval_required=training_session.approval_required,
        approval_deadline_days=training_session.approval_deadline_days,
        is_finalized=training_session.is_finalized,
        finalized_at=training_session.finalized_at,
        finalized_by=training_session.finalized_by,
        created_at=training_session.created_at,
        updated_at=training_session.updated_at,
        created_by=training_session.created_by,
    )


@router.post("/{training_session_id}/finalize")
async def finalize_training_session(
    training_session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Finalize a training session after the event ends

    This triggers the approval workflow by creating a TrainingApproval record
    and sending email notifications to training officers.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = TrainingSessionService(db)

    approval, error = await service.finalize_training_session(
        training_session_id=training_session_id,
        organization_id=current_user.organization_id,
        finalized_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    await log_audit_event(
        db=db,
        event_type="training_session_updated",
        event_category="training",
        severity="info",
        event_data={
            "session_id": str(training_session_id),
            "action": "finalized",
            "approval_id": str(approval.id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "message": "Training session finalized successfully",
        "approval_id": approval.id,
        "approval_deadline": approval.approval_deadline,
    }


@router.get("/approve/{token}", response_model=TrainingApprovalResponse)
async def get_training_approval(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get training approval data by token

    This endpoint is accessed via email link and does not require authentication.
    The token serves as authentication.

    **No authentication required** (token-based access)
    """
    service = TrainingSessionService(db)

    approval_data, error = await service.get_training_approval_by_token(token=token)

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return TrainingApprovalResponse(**approval_data)


@router.post("/approve/{token}")
async def submit_training_approval(
    token: str,
    approval_data: TrainingApprovalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit training approval with time adjustments

    Training officers can approve attendance times, adjust check-in/check-out times,
    or override durations for individual members.

    **Authentication required**
    """
    service = TrainingSessionService(db)

    success, error = await service.submit_training_approval(
        token=token,
        attendees=approval_data.attendees,
        approval_notes=approval_data.approval_notes,
        approved_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    await log_audit_event(
        db=db,
        event_type="training_session_approved",
        event_category="training",
        severity="info",
        event_data={
            "token": token,
            "attendee_count": len(approval_data.attendees),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "message": "Training approval submitted successfully",
        "status": "approved",
    }
