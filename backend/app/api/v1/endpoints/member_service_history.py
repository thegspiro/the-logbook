"""
Member Service History API Endpoints

Length of service, stint by stint, for the membership module:

GET /users/{user_id}/service-history   - credited and prior service, with stints
PUT /users/{user_id}/service-periods   - replace a member's recorded stints

Stints are also written by the status lifecycle (member_status.py): leaving
closes the current one and rejoining opens a new one.
"""

from datetime import date
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.user import User
from app.schemas.member_service import (
    ServiceHistoryReplace,
    ServiceHistoryResponse,
    ServicePeriodResponse,
)
from app.services.member_service_history_service import (
    MemberServiceHistoryService,
    summarize,
)

router = APIRouter()


async def _load_member(db: AsyncSession, user_id: str, organization_id: str) -> User:
    result = await db.execute(
        select(User).where(
            User.id == str(user_id),
            User.organization_id == str(organization_id),
            User.deleted_at.is_(None),
        )
    )
    return ensure_found(result.scalar_one_or_none(), "Member")


async def _history_response(
    svc: MemberServiceHistoryService, member: User
) -> ServiceHistoryResponse:
    periods = await svc.list_periods(member.organization_id, member.id)
    summary = summarize(member, periods, date.today())
    return ServiceHistoryResponse(
        user_id=str(member.id),
        hire_date=member.hire_date,
        periods=[
            ServicePeriodResponse(
                id=p.period_id,
                start_date=p.start,
                start_is_hire_date=p.start_is_hire_date,
                end_date=p.end,
                separation_status=p.separation_status,
                counts_toward_service=p.counts_toward_service,
                notes=p.notes,
                days=p.days,
            )
            for p in summary.periods
        ],
        credited_days=summary.credited_days,
        credited_years=summary.credited_years,
        prior_days=summary.prior_days,
        effective_service_start=summary.effective_service_start,
        is_recorded=summary.is_recorded,
        is_estimated=summary.is_estimated,
        default_rejoin_credit=await svc.get_rejoin_default(member.organization_id),
    )


@router.get("/{user_id}/service-history", response_model=ServiceHistoryResponse)
async def get_service_history(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    A member's length of service: credited time, prior time that no longer
    counts, and each stint.

    **Authentication required.** A member may read their own history. Reading
    anyone else's needs the `members.manage` grant, because a stint records how
    the member left the department (a voluntary or involuntary drop).
    """
    if str(current_user.id) != str(user_id) and not user_has_permission(
        current_user, "members.manage"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized"
        )

    member = await _load_member(db, user_id, current_user.organization_id)
    return await _history_response(MemberServiceHistoryService(db), member)


@router.put("/{user_id}/service-periods", response_model=ServiceHistoryResponse)
async def replace_service_periods(
    user_id: str,
    payload: ServiceHistoryReplace,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Replace a member's recorded service stints.

    The list is saved as a whole and validated as a set: stints may not
    overlap, only a serving member may have a stint with no end date, and
    dates may not be in the future. A listed `id` updates that stint, an item
    without one creates a stint, and a stored stint left out is deleted. An
    empty list clears the recorded history, and service is again calculated
    from the hire date.

    **Requires permission: members.manage**
    """
    member = await _load_member(db, user_id, current_user.organization_id)
    svc = MemberServiceHistoryService(db)

    items: List[Dict[str, Any]] = [
        {
            "id": item.id,
            "start_date": item.start_date,
            "end_date": item.end_date,
            "counts_toward_service": item.counts_toward_service,
            "separation_status": (
                item.separation_status.value if item.separation_status else None
            ),
            "notes": (item.notes or "").strip() or None,
        }
        for item in payload.periods
    ]

    async with handle_service_errors("Failed to save service history"):
        await svc.replace_periods(member, items, str(current_user.id))
        await db.commit()

    response = await _history_response(svc, member)

    await log_audit_event(
        db=db,
        event_type="member_service_history_updated",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(member.id),
            "member_name": member.full_name,
            "period_count": len(items),
            "credited_days": response.credited_days,
            "prior_days": response.prior_days,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return response
