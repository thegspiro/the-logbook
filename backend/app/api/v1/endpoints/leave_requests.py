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
    LeaveOfAbsenceSettings,
    LeaveRequestCreate,
    LeaveRequestResponse,
    LeaveRequestVoteCreate,
    LeaveSettingsResponse,
)
from app.services.leave_of_absence_notices import RECORDED, send_leave_notice
from app.services.leave_request_service import (
    LeaveRequestForbidden,
    LeaveRequestNotFound,
    LeaveRequestService,
)
from app.services.leave_workflow_notices import (
    send_request_denied,
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

    if request.status == LeaveRequestStatus.APPROVED and request.leave_id:
        background_tasks.add_task(
            send_leave_notice,
            _org(current_user),
            str(request.leave_id),
            str(current_user.id),
            RECORDED,
            summary="Your request for a leave of absence was approved.",
        )
    elif request.status == LeaveRequestStatus.DENIED:
        background_tasks.add_task(
            send_request_denied, _org(current_user), str(request.id), data.note
        )
    [response] = await service.to_responses(_org(current_user), [request], current_user)
    return response
