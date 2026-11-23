"""
Leave-of-absence settings, and members asking for leave.

Mounted under ``/users`` beside the member-leave endpoints:

GET  /users/leaves-of-absence/settings      - Department leave settings
PUT  /users/leaves-of-absence/settings      - Change them
GET  /users/leave-requests/config           - Whether this department takes requests
POST /users/leave-requests                  - A member asks for leave
GET  /users/leave-requests/me               - The caller's own requests
GET  /users/leave-requests                  - Requests the caller may decide
GET  /users/leave-requests/{id}             - One request
POST /users/leave-requests/{id}/withdraw    - The member takes a request back
POST /users/leave-requests/{id}/vote        - An approver approves or denies
POST /users/leave-requests/{id}/question    - An approver asks the member
POST /users/leave-requests/{id}/answer      - The member answers
POST /users/leave-requests/{id}/changes     - An approver proposes other dates
POST /users/leave-requests/{id}/changes/respond - The member accepts or declines
GET  /users/leave-requests/summary          - Counts for the navigation
POST /users/leave-requests/my-leaves/{leave_id}/end-early - A member ends
     their own leave in progress
GET    /users/leave-requests/covers         - Approver covers, and the choices
POST   /users/leave-requests/covers         - Name a stand-in for an approver
DELETE /users/leave-requests/covers/{id}    - End a cover now

Who may decide is not a permission: it is the department's chosen approver
positions, with the Chief and then everyone who can record leave as the
fallback (see ``leave_request_service``). So the request routes require only
a signed-in member and the service decides the rest; a request the caller may
not see is a 404, never a 403, so its existence is not disclosed.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.leave_request import LeaveRequestStatus
from app.models.user import User
from app.schemas.leave_of_absence import (
    LeaveApproverCoverBoard,
    LeaveApproverCoverCreate,
    LeaveChangesCreate,
    LeaveChangesResponse,
    LeaveEndEarlyCreate,
    LeaveEndedEarlyResponse,
    LeaveOfAbsenceSettings,
    LeaveQuestionCreate,
    LeaveRequestCreate,
    LeaveRequestResponse,
    LeaveRequestSummary,
    LeaveRequestVoteCreate,
    LeaveSettingsResponse,
)
from app.services.leave_of_absence_notices import (
    RECORDED,
    UPDATED,
    send_leave_notice,
)
from app.services.leave_request_service import (
    LeaveRequestForbidden,
    LeaveRequestNotFound,
    LeaveRequestService,
)
from app.services.leave_workflow_notices import (
    ANSWERED,
    CHANGES_ACCEPTED,
    CHANGES_DECLINED,
    CHANGES_PROPOSED,
    QUESTION_ASKED,
    send_leave_ended_early,
    send_request_denied,
    send_request_event,
    send_request_submitted,
)

router = APIRouter()


class LeaveRequestConfigResponse(BaseModel):
    requests_enabled: bool


def _org(user: User) -> str:
    return str(user.organization_id)


# ==================== Settings ====================


@router.get("/leaves-of-absence/settings", response_model=LeaveSettingsResponse)
async def get_leave_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    The department's leave settings: the ending reminder, and member requests.

    **Requires permission: members.manage**
    """
    return await LeaveRequestService(db).settings_response(_org(current_user))


@router.put("/leaves-of-absence/settings", response_model=LeaveSettingsResponse)
async def update_leave_settings(
    data: LeaveOfAbsenceSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Replace the department's leave settings. Each change is audited.

    **Requires permission: members.manage**
    """
    service = LeaveRequestService(db)
    try:
        await service.save_settings(_org(current_user), data, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    return await service.settings_response(_org(current_user))


# ==================== Requests ====================


@router.get("/leave-requests/config", response_model=LeaveRequestConfigResponse)
async def get_leave_request_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Whether the caller's department takes leave requests.

    **Authentication required**
    """
    settings = await LeaveRequestService(db).get_settings(_org(current_user))
    return LeaveRequestConfigResponse(requests_enabled=settings.requests_enabled)


@router.post("/leave-requests", response_model=LeaveRequestResponse, status_code=201)
async def create_leave_request(
    data: LeaveRequestCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ask for a leave of absence. The department's approvers are emailed.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    try:
        request = await service.create_request(_org(current_user), current_user, data)
    except LeaveRequestForbidden as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    background_tasks.add_task(
        send_request_submitted, _org(current_user), str(request.id)
    )
    [response] = await service.to_responses(_org(current_user), [request], current_user)
    return response


@router.get("/leave-requests/summary", response_model=LeaveRequestSummary)
async def get_leave_request_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Whether the department takes requests, how many the caller may decide
    now, and how many of the caller's own wait on their answer. For the
    navigation; carries no request.

    **Authentication required**
    """
    return await LeaveRequestService(db).summary(_org(current_user), current_user)


@router.get("/leave-requests/me", response_model=list[LeaveRequestResponse])
async def list_my_leave_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The caller's own leave requests, newest first.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    rows = await service.list_mine(_org(current_user), current_user)
    return await service.to_responses(_org(current_user), rows, current_user)


@router.get("/leave-requests", response_model=list[LeaveRequestResponse])
async def list_leave_requests_to_decide(
    include_closed: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Leave requests the caller may decide; every request for those who manage
    leave. Reading them is audited, as a request may state a medical reason.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    rows = await service.list_for_decider(
        _org(current_user), current_user, include_closed=include_closed
    )
    if rows:
        await log_audit_event(
            db=db,
            event_type="leave_requests_viewed",
            event_category="user_management",
            severity="info",
            event_data={"record_count": len(rows), "include_closed": include_closed},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        await db.commit()
    return await service.to_responses(_org(current_user), rows, current_user)


# ==================== Approver cover ====================
# Declared before ``/leave-requests/{request_id}``, which would otherwise take
# ``covers`` for a request id.


@router.get("/leave-requests/covers", response_model=LeaveApproverCoverBoard)
async def get_leave_approver_covers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Current and upcoming approver covers the caller may see, with the
    approvers they may set a cover for and who may stand in. Those who manage
    leave see every cover; anyone else, the covers naming them.

    **Authentication required**
    """
    return await LeaveRequestService(db).cover_board(_org(current_user), current_user)


@router.post(
    "/leave-requests/covers", response_model=LeaveApproverCoverBoard, status_code=201
)
async def set_leave_approver_cover(
    data: LeaveApproverCoverCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Name an officer who manages leave to decide leave requests in an
    approver's place for a period. An approver sets their own; those who
    manage leave may set anyone's. Returns the updated board.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    try:
        await service.set_cover(_org(current_user), current_user, data)
    except LeaveRequestForbidden as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    return await service.cover_board(_org(current_user), current_user)


@router.delete(
    "/leave-requests/covers/{cover_id}", response_model=LeaveApproverCoverBoard
)
async def clear_leave_approver_cover(
    cover_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    End an approver's cover now. Votes the stand-in already cast keep
    counting. The approver or an officer who manages leave may clear it.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    try:
        await service.clear_cover(_org(current_user), current_user, cover_id)
    except LeaveRequestNotFound:
        raise HTTPException(status_code=404, detail="Cover not found")
    except LeaveRequestForbidden as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    return await service.cover_board(_org(current_user), current_user)


@router.get("/leave-requests/{request_id}", response_model=LeaveRequestResponse)
async def get_leave_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One leave request: the member's own, or one the caller may decide.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    try:
        request = await service.get_for(_org(current_user), request_id, current_user)
    except LeaveRequestNotFound:
        raise HTTPException(status_code=404, detail="Leave request not found")
    [response] = await service.to_responses(_org(current_user), [request], current_user)
    return response


@router.post(
    "/leave-requests/{request_id}/withdraw", response_model=LeaveRequestResponse
)
async def withdraw_leave_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Take back one's own request while it is still waiting.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    try:
        request = await service.withdraw(_org(current_user), request_id, current_user)
    except LeaveRequestNotFound:
        raise HTTPException(status_code=404, detail="Leave request not found")
    except LeaveRequestForbidden as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    [response] = await service.to_responses(_org(current_user), [request], current_user)
    return response


@router.post("/leave-requests/{request_id}/vote", response_model=LeaveRequestResponse)
async def vote_on_leave_request(
    request_id: str,
    data: LeaveRequestVoteCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Approve or deny a leave request, as one of its approvers. The vote that
    settles it under the department's rule creates the leave, or tells the
    member it was denied.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    try:
        request = await service.vote(
            _org(current_user), request_id, current_user, data.vote, data.note
        )
    except LeaveRequestNotFound:
        raise HTTPException(status_code=404, detail="Leave request not found")
    except LeaveRequestForbidden as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except IntegrityError:
        # Two votes from one approver racing past the check: the constraint
        # kept the second out.
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="You have already voted on this request."
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))

    _queue_outcome(background_tasks, current_user, request, data.note)
    [response] = await service.to_responses(_org(current_user), [request], current_user)
    return response


def _queue_outcome(
    background_tasks: BackgroundTasks,
    current_user: User,
    request,
    note,
) -> None:
    """Tell the member how a settled request ended, after the response."""
    if request.status == LeaveRequestStatus.APPROVED and request.leave_id:
        extended = request.extends_leave_id == request.leave_id
        background_tasks.add_task(
            send_leave_notice,
            _org(current_user),
            str(request.leave_id),
            # The approver who decided, not the caller: a member accepting
            # changed dates can settle their own request, and the notice is
            # never sent to someone about their own action.
            str(request.decided_by or current_user.id),
            UPDATED if extended else RECORDED,
            summary=(
                "Your request to extend your leave was approved."
                if extended
                else "Your request for a leave of absence was approved."
            ),
        )
    elif request.status == LeaveRequestStatus.DENIED:
        background_tasks.add_task(
            send_request_denied, _org(current_user), str(request.id), note
        )


async def _act(service, action, *args):
    """Run a request action, mapping the service's refusals to HTTP."""
    try:
        return await action(*args)
    except LeaveRequestNotFound:
        raise HTTPException(status_code=404, detail="Leave request not found")
    except LeaveRequestForbidden as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))


@router.post(
    "/leave-requests/{request_id}/question", response_model=LeaveRequestResponse
)
async def ask_leave_request_question(
    request_id: str,
    data: LeaveQuestionCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ask the member a question, as one of the request's approvers. Voting
    pauses until they answer. The member is notified; the question is not
    emailed.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    request = await _act(
        service,
        service.ask_question,
        _org(current_user),
        request_id,
        current_user,
        data.text,
    )
    background_tasks.add_task(
        send_request_event,
        _org(current_user),
        str(request.id),
        QUESTION_ASKED,
        str(current_user.id),
    )
    [response] = await service.to_responses(_org(current_user), [request], current_user)
    return response


@router.post("/leave-requests/{request_id}/answer", response_model=LeaveRequestResponse)
async def answer_leave_request_question(
    request_id: str,
    data: LeaveQuestionCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Answer an approver's question on one's own request. Voting resumes and
    the approvers are notified; the answer is not emailed.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    request = await _act(
        service,
        service.answer_question,
        _org(current_user),
        request_id,
        current_user,
        data.text,
    )
    background_tasks.add_task(
        send_request_event,
        _org(current_user),
        str(request.id),
        ANSWERED,
        str(current_user.id),
    )
    [response] = await service.to_responses(_org(current_user), [request], current_user)
    return response


@router.post(
    "/leave-requests/{request_id}/changes", response_model=LeaveRequestResponse
)
async def propose_leave_request_changes(
    request_id: str,
    data: LeaveChangesCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Approve with different dates, as one of the request's approvers. The
    member accepts or declines them; voting pauses until they do.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    request = await _act(
        service,
        service.propose_changes,
        _org(current_user),
        request_id,
        current_user,
        data.start_date,
        data.end_date,
        data.note,
    )
    background_tasks.add_task(
        send_request_event,
        _org(current_user),
        str(request.id),
        CHANGES_PROPOSED,
        str(current_user.id),
    )
    [response] = await service.to_responses(_org(current_user), [request], current_user)
    return response


@router.post(
    "/leave-requests/{request_id}/changes/respond",
    response_model=LeaveRequestResponse,
)
async def respond_to_leave_request_changes(
    request_id: str,
    data: LeaveChangesResponse,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Accept or decline an approver's changed dates on one's own request.
    Accepting moves the request onto them and starts voting again, with the
    proposer's approval counted; under "any one approver" that settles it.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    request = await _act(
        service,
        service.respond_to_changes,
        _org(current_user),
        request_id,
        current_user,
        data.accept,
        data.note,
    )
    if request.status == LeaveRequestStatus.PENDING:
        background_tasks.add_task(
            send_request_event,
            _org(current_user),
            str(request.id),
            CHANGES_ACCEPTED if data.accept else CHANGES_DECLINED,
            str(current_user.id),
        )
    else:
        _queue_outcome(background_tasks, current_user, request, None)
    [response] = await service.to_responses(_org(current_user), [request], current_user)
    return response


@router.post(
    "/leave-requests/my-leaves/{leave_id}/end-early",
    response_model=LeaveEndedEarlyResponse,
)
async def end_own_leave_early(
    leave_id: str,
    data: LeaveEndEarlyCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    End the caller's own leave in progress: the leave now ends the day before
    ``first_day_back``. Offered only where the department takes leave
    requests; the officers who manage leave are notified. Refused (409) for a
    leave not yet begun or already over, or one with a request to extend it
    still waiting; 400 for a date not earlier than the leave's end.

    **Authentication required**
    """
    service = LeaveRequestService(db)
    try:
        leave, previous_end = await service.end_own_leave_early(
            _org(current_user), current_user, leave_id, data.first_day_back
        )
    except LeaveRequestNotFound:
        raise HTTPException(status_code=404, detail="Leave of absence not found")
    except LeaveRequestForbidden as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    background_tasks.add_task(
        send_leave_ended_early, _org(current_user), str(leave.id), previous_end
    )
    return LeaveEndedEarlyResponse(
        leave_id=str(leave.id),
        start_date=leave.start_date,
        end_date=leave.end_date,
        previous_end_date=previous_end,
        first_day_back=data.first_day_back,
    )
