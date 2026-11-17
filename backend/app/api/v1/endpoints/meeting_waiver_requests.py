"""
Business-Meeting Waiver Request Endpoints

A member asks to be excused from a business meeting before (or, as the
department chooses, shortly after) it is held; an approver the department
chose decides. The rules are the training workflow's, in the same engine
(``AttendanceWaiverService`` bound to the business-meeting workflow); only the
policy, the events asked about and the routing fallback differ. This layer
maps the engine's refusals onto HTTP exactly as the training endpoints do.

A request attaches to the business_meeting EVENT, because members cannot see
a minutes record until it is approved. Approving one writes the waiver onto
the minutes record, now or when it is created from the event.

Mounted under ``/meetings/waiver-requests``, ahead of the meetings router,
whose ``/{meeting_id}`` would otherwise claim the path. ``/meetings`` is
already uncacheable in the frontend, and a request carries a reason that may
be medical.

GET    /meetings/waiver-requests/policy             - The department's policy
PUT    /meetings/waiver-requests/policy             - Save it (meetings.manage)
GET    /meetings/waiver-requests/policy/alternate   - Who may be the officers'
                                                      alternate (meetings.manage)
GET    /meetings/waiver-requests/policy/positions   - The positions to choose
                                                      from (meetings.manage)
GET    /meetings/waiver-requests/eligibility        - May I ask about this meeting?
POST   /meetings/waiver-requests                    - Ask to be excused
GET    /meetings/waiver-requests/attention          - Do I decide any? How many wait?
GET    /meetings/waiver-requests/mine               - My requests
GET    /meetings/waiver-requests                    - Requests I decide or decided
GET    /meetings/waiver-requests/{id}               - One request
POST   /meetings/waiver-requests/{id}/withdraw      - Withdraw my pending request
POST   /meetings/waiver-requests/{id}/confirm       - My moved meeting still needs it
POST   /meetings/waiver-requests/{id}/approve       - Approve a pending request
POST   /meetings/waiver-requests/{id}/deny          - Deny a pending request
POST   /meetings/waiver-requests/{id}/override      - The Chief approves a denial
POST   /meetings/waiver-requests/{id}/request-info  - Ask the member a question
POST   /meetings/waiver-requests/{id}/respond       - Answer the open question

Who may decide is a matter of holding a position (the department picks the
positions; the Secretary and meetings managers are the fallback, and a Chief
or President may always decide), so every route but the policy save is signed-in only and
the service decides. A request is answered 404 to anyone who is neither its
member nor someone who may decide it.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.api.v1.endpoints.attendance_waiver_requests import MAX_PAGE, _one, _refusals
from app.core.database import get_db
from app.models.attendance_waiver import (
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.user import User
from app.schemas.attendance_waiver import (
    AttendanceWaiverAlternateOptions,
    AttendanceWaiverAttention,
    AttendanceWaiverDecision,
    AttendanceWaiverEligibilityResponse,
    AttendanceWaiverMessage,
    AttendanceWaiverOverride,
    AttendanceWaiverPolicy,
    AttendanceWaiverPositionOptions,
    AttendanceWaiverRequestPage,
    AttendanceWaiverRequestResponse,
    AttendanceWaiverSubmit,
)
from app.services.attendance_waiver_service import AttendanceWaiverService
from app.services.compliance_config_service import ComplianceConfigService

router = APIRouter()


def _service(db: AsyncSession) -> AttendanceWaiverService:
    return AttendanceWaiverService(db, AttendanceWaiverWorkflow.BUSINESS_MEETING)


@router.get("/policy", response_model=AttendanceWaiverPolicy)
async def get_meeting_waiver_policy(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The department's policy for business-meeting waiver requests. Every member
    reads it, because the request form is built from it.

    **Authentication required**
    """
    return await _service(db).get_policy(str(current_user.organization_id))


@router.put("/policy", response_model=AttendanceWaiverPolicy)
async def save_meeting_waiver_policy(
    body: AttendanceWaiverPolicy,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """
    Save the department's policy for business-meeting waiver requests, so the
    Secretary can change it without settings.manage. Approver and copy-to
    (CC) positions must belong to the department (400 otherwise).

    **Requires permission: meetings.manage**
    """
    with _refusals():
        return await _service(db).save_policy(
            str(current_user.organization_id), body, current_user
        )


@router.get("/policy/positions", response_model=AttendanceWaiverPositionOptions)
async def get_meeting_waiver_position_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """
    For the settings screen: the department's positions, by id and name, to
    choose who decides and who is copied on decisions.

    **Requires permission: meetings.manage**
    """
    positions = await ComplianceConfigService(db).get_available_positions(
        str(current_user.organization_id)
    )
    return {"positions": positions}


@router.get("/policy/alternate", response_model=AttendanceWaiverAlternateOptions)
async def get_meeting_waiver_alternate_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """
    For the settings: the current members who may be named to decide the
    Chief's or President's own request when the other office is vacant, and
    whether the stored alternate is still a current member.

    **Requires permission: meetings.manage**
    """
    return await _service(db).alternate_options(str(current_user.organization_id))


@router.get("/eligibility", response_model=AttendanceWaiverEligibilityResponse)
async def get_meeting_waiver_eligibility(
    event_id: str = Query(..., min_length=1, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Whether the caller may ask to be excused from this business meeting and,
    if not, why; with the deadline, the waivers left and the form's fields.
    Scoped to the caller.

    **Authentication required**
    """
    with _refusals():
        result = await _service(db).eligibility(
            str(current_user.organization_id), current_user, event_id
        )
    return AttendanceWaiverEligibilityResponse(**result.as_response())


@router.post(
    "",
    response_model=AttendanceWaiverRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_meeting_waiver_request(
    body: AttendanceWaiverSubmit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ask to be excused from a business meeting. Always for the caller; 400
    with the reason when the policy refuses.

    **Authentication required**
    """
    service = _service(db)
    with _refusals():
        request = await service.submit(
            str(current_user.organization_id),
            current_user,
            body.event_id,
            body.category,
            body.reason,
        )
    return await _one(service, current_user, request)


@router.get("/attention", response_model=AttendanceWaiverAttention)
async def get_meeting_waiver_attention(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    For the navigation: whether the caller decides business-meeting requests, and how
    many pending ones they may decide now. Answers only about the caller, so
    every member may ask; the queue itself lists only what they may decide.

    **Authentication required**
    """
    return await _service(db).attention(str(current_user.organization_id), current_user)


@router.get("/mine", response_model=List[AttendanceWaiverRequestResponse])
async def list_my_meeting_waiver_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The caller's own business-meeting requests, newest first, each with its
    decision log, so a decider's question can be read and answered.

    **Authentication required**
    """
    service = _service(db)
    org_id = str(current_user.organization_id)
    requests = await service.list_mine(org_id, current_user)
    return [
        AttendanceWaiverRequestResponse(**body)
        for body in await service.describe(
            org_id, current_user, requests, with_actions=True
        )
    ]


@router.get("", response_model=AttendanceWaiverRequestPage)
async def list_meeting_waiver_requests(
    status_filter: Optional[AttendanceWaiverStatus] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=MAX_PAGE),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The business-meeting requests the caller may decide or has decided,
    newest first, filtered by status.

    **Authentication required**
    """
    service = _service(db)
    org_id = str(current_user.organization_id)
    requests, total = await service.list_for_decider(
        org_id, current_user, status_filter, skip=skip, limit=limit
    )
    return AttendanceWaiverRequestPage(
        items=[
            AttendanceWaiverRequestResponse(**body)
            for body in await service.describe(org_id, current_user, requests)
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/{request_id}", response_model=AttendanceWaiverRequestResponse)
async def get_meeting_waiver_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One request with its decision log, for its member or someone who may
    decide it; 404 for anyone else.

    **Authentication required**
    """
    service = _service(db)
    with _refusals():
        request = await service.get(
            str(current_user.organization_id), current_user, request_id
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/withdraw", response_model=AttendanceWaiverRequestResponse)
async def withdraw_meeting_waiver_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Withdraw the caller's own pending request.

    **Authentication required**
    """
    service = _service(db)
    with _refusals():
        request = await service.withdraw(
            str(current_user.organization_id), current_user, request_id
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/confirm", response_model=AttendanceWaiverRequestResponse)
async def confirm_meeting_waiver_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Confirm that the caller's own request still stands after its meeting
    moved, which sends it back to the deciders. 400 when it is not waiting on
    a confirmation, or the new date no longer needs a waiver; 403 for a
    decider, 404 for anyone else.

    **Authentication required**
    """
    service = _service(db)
    with _refusals():
        request = await service.confirm(
            str(current_user.organization_id), current_user, request_id
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/approve", response_model=AttendanceWaiverRequestResponse)
async def approve_meeting_waiver_request(
    request_id: str,
    body: AttendanceWaiverDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Approve a pending request. The waiver is written onto the meeting's
    minutes record with a standard text, never the member's reason.

    **Authentication required**
    """
    service = _service(db)
    with _refusals():
        request = await service.approve(
            str(current_user.organization_id), current_user, request_id, body.note
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/deny", response_model=AttendanceWaiverRequestResponse)
async def deny_meeting_waiver_request(
    request_id: str,
    body: AttendanceWaiverDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Deny a pending request. The meeting stays requested, so the member cannot
    ask again for it.

    **Authentication required**
    """
    service = _service(db)
    with _refusals():
        request = await service.deny(
            str(current_user.organization_id), current_user, request_id, body.note
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/override", response_model=AttendanceWaiverRequestResponse)
async def override_meeting_waiver_request(
    request_id: str,
    body: AttendanceWaiverOverride,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The Chief approves a denied request, with a reason. Not blocked by the
    cap, but it counts toward it.

    **Authentication required**
    """
    service = _service(db)
    with _refusals():
        request = await service.chief_override(
            str(current_user.organization_id), current_user, request_id, body.note
        )
    return await _one(service, current_user, request)


@router.post(
    "/{request_id}/request-info", response_model=AttendanceWaiverRequestResponse
)
async def request_meeting_waiver_info(
    request_id: str,
    body: AttendanceWaiverMessage,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ask the member a question about their pending request. Only someone who
    may decide it; the request stays pending and may still be decided. 400
    when it is no longer pending or a question is already open.

    **Authentication required**
    """
    service = _service(db)
    with _refusals():
        request = await service.request_info(
            str(current_user.organization_id), current_user, request_id, body.note
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/respond", response_model=AttendanceWaiverRequestResponse)
async def respond_meeting_waiver_request(
    request_id: str,
    body: AttendanceWaiverMessage,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The member answers the open question on their own pending request, and
    its deciders are asked again. 400 when no question is open; 403 for a
    decider, 404 for anyone else.

    **Authentication required**
    """
    service = _service(db)
    with _refusals():
        request = await service.respond(
            str(current_user.organization_id), current_user, request_id, body.note
        )
    return await _one(service, current_user, request)
