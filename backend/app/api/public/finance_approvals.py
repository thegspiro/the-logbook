"""Public finance approval endpoints (external approver, token-authenticated).

External approvers configured on an approval step (approver_type "email") act on
a purchase/expense/check request from an emailed link, without a Logbook login.
The unguessable per-step token (256 bits, 7-day expiry) is the authentication;
these routes are otherwise unauthenticated, so they are rate-limited and expose
only the minimal detail the approver needs to decide.

Wraps the pre-existing FinanceService.approve_by_token / deny_by_token, which
enforce token validity, single-use (status must be PENDING), and expiry.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.core.utils import safe_error_detail
from app.models.finance import ApprovalStepRecord, ApprovalStepStatus
from app.services.finance_service import FinanceService

router = APIRouter(
    prefix="/public/v1/finance/approvals", tags=["public-finance-approvals"]
)


class ApprovalActionRequest(BaseModel):
    notes: Optional[str] = Field(None, max_length=2000)


class ApprovalDetailResponse(BaseModel):
    step_name: str
    entity_type: str
    status: str
    actionable: bool
    expired: bool


class ApprovalActionResponse(BaseModel):
    status: str
    message: str


async def _rate_limit(request: Request) -> None:
    """Per-IP rate limit for the token endpoints (token brute-force guard)."""
    client_ip = get_client_ip(request)
    is_limited, _ = await public_rate_limit(
        key=f"finance_approval:{client_ip}", max_requests=30, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


async def _load_record(db: AsyncSession, token: str) -> ApprovalStepRecord:
    if not token or len(token) < 20 or len(token) > 255:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Approval not found"
        )
    result = await db.execute(
        select(ApprovalStepRecord)
        .where(ApprovalStepRecord.approval_token == token)
        .options(selectinload(ApprovalStepRecord.step))
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Approval not found"
        )
    return record


@router.get(
    "/{token}",
    response_model=ApprovalDetailResponse,
    dependencies=[Depends(_rate_limit)],
)
async def get_approval_detail(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Return the minimal detail an external approver needs to decide."""
    from datetime import datetime, timezone

    record = await _load_record(db, token)
    expires_at = record.token_expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    expired = bool(expires_at and expires_at < datetime.now(timezone.utc))
    return ApprovalDetailResponse(
        step_name=record.step.name if record.step else "Approval",
        entity_type=record.entity_type.value,
        status=record.status.value,
        actionable=record.status == ApprovalStepStatus.PENDING and not expired,
        expired=expired,
    )


@router.post(
    "/{token}/approve",
    response_model=ApprovalActionResponse,
    dependencies=[Depends(_rate_limit)],
)
async def approve_via_token(
    token: str,
    body: ApprovalActionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Approve the step this token belongs to."""
    service = FinanceService(db)
    try:
        record = await service.approve_by_token(token, body.notes or None)
        await db.commit()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    return ApprovalActionResponse(
        status=record.status.value, message="Approval recorded. Thank you."
    )


@router.post(
    "/{token}/deny",
    response_model=ApprovalActionResponse,
    dependencies=[Depends(_rate_limit)],
)
async def deny_via_token(
    token: str,
    body: ApprovalActionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Deny the step this token belongs to."""
    service = FinanceService(db)
    try:
        record = await service.deny_by_token(token, body.notes or None)
        await db.commit()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    return ApprovalActionResponse(
        status=record.status.value, message="Denial recorded. Thank you."
    )
