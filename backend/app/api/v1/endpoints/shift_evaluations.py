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
- A shift a member logged on an outside agency's unit has no officer here:
  its preceptor belongs to the other agency. ``training.manage`` enters the
  preceptor's evaluation (``/external/...``) and names the preceptor on it.
- Or the preceptor fills it out themselves through a no-login link
  (``/preceptor-links/...``), which the member who logged the shift, or
  ``training.manage``, creates, shows, emails and revokes.

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
from app.models.external_shift_hours import ExternalShiftHours
from app.models.user import User
from app.schemas.shift_evaluation import (
    OutsideShiftAwaitingEvaluation,
    PreceptorLinkCreate,
    PreceptorLinkResponse,
    PreceptorLinkSend,
    ShiftEvaluationDetail,
    ShiftEvaluationForm,
    ShiftEvaluationRoster,
    ShiftEvaluationSave,
)
from app.services.shift_evaluation_link_service import (
    ShiftEvaluationLinkService,
    link_response,
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


# ---------------------------------------------------------------------------
# Shifts logged on an outside agency's units
# ---------------------------------------------------------------------------


async def _entry(service: ShiftEvaluationService, entry_id: UUID, organization_id):
    return ensure_found(
        await service.get_entry(entry_id, organization_id), "Outside shift"
    )


@router.get(
    "/external/outstanding", response_model=list[OutsideShiftAwaitingEvaluation]
)
async def list_outside_shifts_awaiting_evaluation(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Logged outside shifts whose evaluation is missing or unfinished.

    **Permissions required:** training.manage
    """
    service = ShiftEvaluationService(db)
    rows = await service.outstanding_entries(current_user.organization_id)
    users = await service._users(
        {str(entry.user_id) for entry, _, _ in rows}, current_user.organization_id
    )
    return [
        OutsideShiftAwaitingEvaluation(
            entry_id=str(entry.id),
            member_id=str(entry.user_id),
            member_name=(
                users[str(entry.user_id)].full_name
                if str(entry.user_id) in users
                else None
            ),
            shift_date=entry.shift_date,
            start_at=entry.start_at,
            end_at=entry.end_at,
            agency_name=entry.agency_name,
            apparatus_name=entry.apparatus_name,
            evaluation_status=state,
            scope_key=scope_key,
        )
        for entry, state, scope_key in rows
    ]


@router.get("/external/{entry_id}", response_model=ShiftEvaluationRoster)
async def get_outside_shift_evaluation_roster(
    entry_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """The evaluations a logged outside shift calls for, and their state.

    **Permissions required:** training.manage
    """
    service = ShiftEvaluationService(db)
    entry = await _entry(service, entry_id, current_user.organization_id)
    return await service.entry_roster(entry, current_user.organization_id)


@router.get("/external/{entry_id}/{scope_key}", response_model=ShiftEvaluationForm)
async def get_outside_shift_evaluation_form(
    entry_id: UUID,
    scope_key: str,
    template_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """The form to enter for a logged outside shift, with any saved answers.

    **Permissions required:** training.manage
    """
    service = ShiftEvaluationService(db)
    entry = await _entry(service, entry_id, current_user.organization_id)
    try:
        return await service.entry_form(
            entry,
            scope_key,
            current_user.organization_id,
            str(template_id) if template_id else None,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.put("/external/{entry_id}/{scope_key}", response_model=ShiftEvaluationDetail)
async def save_outside_shift_evaluation(
    entry_id: UUID,
    scope_key: str,
    body: ShiftEvaluationSave,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Save a draft of, or submit, an outside preceptor's evaluation.

    **Permissions required:** training.manage
    """
    service = ShiftEvaluationService(db)
    entry = await _entry(service, entry_id, current_user.organization_id)
    member_id = str(entry.user_id)
    try:
        evaluation = await service.save_for_entry(
            entry, scope_key, current_user.organization_id, body, current_user
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
                "external_shift_id": str(entry_id),
                "member_id": member_id,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return await service.detail(evaluation, current_user.organization_id)


# ---------------------------------------------------------------------------
# Preceptor links for outside shifts
# ---------------------------------------------------------------------------


async def _entry_for_link(
    db: AsyncSession, user: User, entry_id: UUID
) -> tuple[ShiftEvaluationLinkService, ExternalShiftHours]:
    """The logged shift, if the caller logged it or manages training.

    Anyone else gets the same 404 as a missing shift, so a member cannot
    learn which shifts other members logged.
    """
    service = ShiftEvaluationLinkService(db)
    entry = await service.evaluations.get_entry(entry_id, user.organization_id)
    if entry is None or not (
        str(entry.user_id) == str(user.id) or _manages_training(user)
    ):
        raise HTTPException(status_code=404, detail="Outside shift not found")
    return service, entry


async def _link_audit(
    db: AsyncSession, event_type: str, user: User, link, extra: Optional[dict] = None
) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="training",
        severity="INFO",
        event_data={
            "organization_id": str(user.organization_id),
            "link_id": link.id,
            "external_shift_id": link.external_shift_id,
            "member_id": link.member_id,
            **(extra or {}),
        },
        user_id=str(user.id),
        username=user.username,
    )


@router.get(
    "/preceptor-links/{entry_id}",
    response_model=Optional[PreceptorLinkResponse],
)
async def get_preceptor_link(
    entry_id: UUID,
    scope_key: Optional[str] = Query(None, max_length=40),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The open preceptor link for a logged outside shift, or null.

    **Permissions required:** the member who logged the shift, or
    training.manage
    """
    service, entry = await _entry_for_link(db, current_user, entry_id)
    try:
        scope = await service.open_scope(
            entry, str(current_user.organization_id), scope_key
        )
    except ValueError:
        return None
    link = await service.active_link(entry.id, scope, str(current_user.organization_id))
    return link_response(link) if link else None


@router.post(
    "/preceptor-links/{entry_id}",
    response_model=PreceptorLinkResponse,
    status_code=201,
)
async def create_preceptor_link(
    entry_id: UUID,
    body: PreceptorLinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Make a new preceptor link (revoking the open one), and email it if asked.

    **Permissions required:** the member who logged the shift, or
    training.manage
    """
    service, entry = await _entry_for_link(db, current_user, entry_id)
    try:
        link, sent = await service.create(
            entry,
            current_user.organization_id,
            current_user,
            scope_key=body.scope_key,
            preceptor_email=str(body.preceptor_email) if body.preceptor_email else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await _link_audit(
        db,
        "shift_evaluation_link_created",
        current_user,
        link,
        {"emailed": sent},
    )
    return link_response(link, email_sent=sent)


@router.post("/preceptor-links/{entry_id}/send", response_model=PreceptorLinkResponse)
async def send_preceptor_link(
    entry_id: UUID,
    body: PreceptorLinkSend,
    scope_key: Optional[str] = Query(None, max_length=40),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Email the open preceptor link.

    **Permissions required:** the member who logged the shift, or
    training.manage
    """
    service, entry = await _entry_for_link(db, current_user, entry_id)
    org = str(current_user.organization_id)
    try:
        scope = await service.open_scope(entry, org, scope_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    link = ensure_found(await service.active_link(entry.id, scope, org), "Link")
    sent = await service.send(link, entry, str(body.preceptor_email))
    if not sent:
        raise HTTPException(
            status_code=502, detail="The email could not be sent. Try again later."
        )
    await _link_audit(db, "shift_evaluation_link_emailed", current_user, link)
    return link_response(link, email_sent=True)


@router.delete("/preceptor-links/{entry_id}", status_code=204)
async def revoke_preceptor_link(
    entry_id: UUID,
    scope_key: Optional[str] = Query(None, max_length=40),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stop the open preceptor link working.

    **Permissions required:** the member who logged the shift, or
    training.manage
    """
    service, entry = await _entry_for_link(db, current_user, entry_id)
    org = str(current_user.organization_id)
    try:
        scope = await service.open_scope(entry, org, scope_key)
    except ValueError:
        return
    link = await service.active_link(entry.id, scope, org)
    if link is not None:
        await service.revoke(link)
        await _link_audit(db, "shift_evaluation_link_revoked", current_user, link)


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
