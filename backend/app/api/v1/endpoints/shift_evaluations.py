"""
Shift evaluation endpoints

Filling out a member's evaluation after a shift, and reading it back.

Who may do what:

- The shift's officer, or anyone with ``training.manage``, lists who needs
  an evaluation on a shift and fills them out. That is exactly who may file
  the shift's completion reports (``_authorize_report_filing``), and the
  grant reaches only that shift. Nobody evaluates themselves.
- The evaluated member reads their own submitted evaluations, once the
  department's report review lets them (``visible_to_member``).
- ``training.manage`` reads any member's evaluations over a date range,
  ratings and comments included. The annual evaluation module reads them
  through the same route.

Registered under ``/training/shift-evaluations``. The fixed paths are
declared before ``/{evaluation_id}`` so they are not read as ids.
"""

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.api.v1.endpoints.shift_completion import (
    _authorize_report_filing,
    _manages_training,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, safe_error_detail
from app.models.user import User
from app.schemas.shift_evaluation import (
    ShiftEvaluationDetail,
    ShiftEvaluationForm,
    ShiftEvaluationRoster,
    ShiftEvaluationSave,
)
from app.services.shift_evaluation_service import ShiftEvaluationService

router = APIRouter()


async def _shift_for_filing(
    db: AsyncSession, user: User, shift_id: UUID, service: ShiftEvaluationService
):
    await _authorize_report_filing(db, user, shift_id)
    return ensure_found(
        await service.get_shift(shift_id, user.organization_id), "Shift"
    )


@router.get("/mine", response_model=list[ShiftEvaluationDetail])
async def list_my_shift_evaluations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Your own submitted shift evaluations that you may see yet.

    **Permissions required:** authenticated; returns only the caller's own.
    """
    service = ShiftEvaluationService(db)
    evaluations = await service.list_for_member(
        current_user.id, current_user.organization_id, member_view=True
    )
    return [await service.detail(e, current_user.organization_id) for e in evaluations]


@router.get("/members/{member_id}", response_model=list[ShiftEvaluationDetail])
async def list_member_shift_evaluations(
    member_id: UUID,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """A member's submitted evaluations, ratings and comments included.

    **Permissions required:** training.manage
    """
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=400, detail="The start date is after the end date"
        )
    service = ShiftEvaluationService(db)
    evaluations = await service.list_for_member(
        member_id,
        current_user.organization_id,
        start_date=start_date,
        end_date=end_date,
    )
    return [await service.detail(e, current_user.organization_id) for e in evaluations]


@router.get("/shifts/{shift_id}", response_model=ShiftEvaluationRoster)
async def get_shift_evaluation_roster(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Who on this shift needs an evaluation, and where each one stands.

    **Permissions required:** training.manage, or being the shift's officer
    """
    service = ShiftEvaluationService(db)
    shift = await _shift_for_filing(db, current_user, shift_id, service)
    return await service.roster(shift, current_user.organization_id)


@router.get(
    "/shifts/{shift_id}/members/{member_id}/{scope_key}",
    response_model=ShiftEvaluationForm,
)
async def get_shift_evaluation_form(
    shift_id: UUID,
    member_id: UUID,
    scope_key: str,
    template_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The form to fill out for one member, with any answers saved so far.

    **Permissions required:** training.manage, or being the shift's officer
    """
    service = ShiftEvaluationService(db)
    shift = await _shift_for_filing(db, current_user, shift_id, service)
    try:
        return await service.form(
            shift,
            str(member_id),
            scope_key,
            current_user.organization_id,
            str(template_id) if template_id else None,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.put(
    "/shifts/{shift_id}/members/{member_id}/{scope_key}",
    response_model=ShiftEvaluationDetail,
)
async def save_shift_evaluation(
    shift_id: UUID,
    member_id: UUID,
    scope_key: str,
    body: ShiftEvaluationSave,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save a draft, or submit the evaluation.

    **Permissions required:** training.manage, or being the shift's officer
    """
    service = ShiftEvaluationService(db)
    shift = await _shift_for_filing(db, current_user, shift_id, service)
    try:
        evaluation = await service.save(
            shift,
            str(member_id),
            scope_key,
            current_user.organization_id,
            body,
            current_user,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    if body.submit:
        await log_audit_event(
            db=db,
            event_type="shift_evaluation_submitted",
            event_category="training",
            severity="INFO",
            event_data={
                "organization_id": str(current_user.organization_id),
                "evaluation_id": evaluation.id,
                "shift_id": str(shift_id),
                "member_id": str(member_id),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return await service.detail(evaluation, current_user.organization_id)


@router.get("/{evaluation_id}", response_model=ShiftEvaluationDetail)
async def get_shift_evaluation(
    evaluation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One evaluation.

    **Permissions required:** training.manage; the evaluator; or the evaluated
    member once it is visible to them
    """
    service = ShiftEvaluationService(db)
    evaluation = ensure_found(
        await service.get(evaluation_id, current_user.organization_id),
        "Shift evaluation",
    )
    allowed = (
        _manages_training(current_user)
        or str(evaluation.evaluator_id) == str(current_user.id)
        or (
            str(evaluation.member_id) == str(current_user.id)
            and await service.visible_to_member(
                evaluation, current_user.organization_id
            )
        )
    )
    if not allowed:
        # Same answer as a missing row: a member must not learn that an
        # evaluation exists before they may read it.
        raise HTTPException(status_code=404, detail="Shift evaluation not found")
    return await service.detail(evaluation, current_user.organization_id)
