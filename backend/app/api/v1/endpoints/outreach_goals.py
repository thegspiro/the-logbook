"""Yearly outreach goals (owner decisions, 2026-11-24).

Set and read by whoever manages events (``events.manage``), the same people
who manage the CRR catalogue and read Outreach Impact. Every write is audited.
"""

from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.outreach_goal import OUTREACH_METRICS
from app.models.user import User
from app.schemas.outreach_goal import (
    OutreachGoalCreate,
    OutreachGoalsResponse,
    OutreachGoalUpdate,
)
from app.services.outreach_goal_service import (
    MAX_YEAR,
    METRIC_LABELS,
    MIN_YEAR,
    OutreachGoalService,
)

router = APIRouter()


async def _response(
    service: OutreachGoalService, organization_id: str, year: int
) -> OutreachGoalsResponse:
    data = await service.progress(organization_id, year)
    return OutreachGoalsResponse(
        **data,
        current_year=await service.current_year(organization_id),
        metrics=[{"value": m, "label": METRIC_LABELS[m]} for m in OUTREACH_METRICS],
    )


async def _changed(
    db: AsyncSession,
    user: User,
    action: str,
    run: Callable[[], Awaitable[Any]],
    **details: Any,
) -> Any:
    """Run a goal write, commit it and audit it; map refusals to HTTP.

    No rollback on a refusal: get_db rolls the session back when the
    HTTPException reaches it, and rolling back here as well would expire the
    signed-in user.
    """
    try:
        result = await run()
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await db.commit()
    await log_audit_event(
        db=db,
        event_type=f"outreach_goal.{action}",
        event_category="events",
        severity="info",
        event_data=details,
        user_id=str(user.id),
        username=user.username,
    )
    return result


@router.get("", response_model=OutreachGoalsResponse)
async def list_goals(
    year: Optional[int] = Query(None, ge=MIN_YEAR, le=MAX_YEAR),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    A year's goals with what each has reached and whether it is on pace; the
    department's current year when none is given.

    **Requires permission: events.manage**
    """
    service = OutreachGoalService(db)
    org_id = str(current_user.organization_id)
    chosen = year if year is not None else await service.current_year(org_id)
    return await _response(service, org_id, chosen)


@router.post("", response_model=OutreachGoalsResponse)
async def create_goal(
    body: OutreachGoalCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Set a goal for a CRR count or an outreach figure in one year. Returns that
    year's goals.

    **Requires permission: events.manage**
    """
    service = OutreachGoalService(db)
    org_id = str(current_user.organization_id)
    goal = await _changed(
        db,
        current_user,
        "created",
        lambda: service.create(
            org_id,
            str(current_user.id),
            year=body.year,
            target=body.target,
            measure_id=body.measure_id,
            outreach_metric=body.outreach_metric,
        ),
        year=body.year,
        measure_id=body.measure_id,
        outreach_metric=body.outreach_metric,
        target=body.target,
    )
    return await _response(service, org_id, goal.year)


@router.patch("/{goal_id}", response_model=OutreachGoalsResponse)
async def update_goal(
    goal_id: str,
    body: OutreachGoalUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Change a goal's target. Returns its year's goals.

    **Requires permission: events.manage**
    """
    service = OutreachGoalService(db)
    org_id = str(current_user.organization_id)
    goal = await _changed(
        db,
        current_user,
        "updated",
        lambda: service.update_target(org_id, goal_id, body.target),
        goal_id=goal_id,
        target=body.target,
    )
    return await _response(service, org_id, goal.year)


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(
    goal_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Remove a goal.

    **Requires permission: events.manage**
    """
    service = OutreachGoalService(db)
    await _changed(
        db,
        current_user,
        "deleted",
        lambda: service.delete(str(current_user.organization_id), goal_id),
        goal_id=goal_id,
    )
    return Response(status_code=204)
