"""
Attendance Waiver Request Endpoints

A member asks to be excused from a training session that counts against them;
an approver the department chose decides. The rules live in
``AttendanceWaiverService``; this layer maps its refusals onto HTTP.

Mounted under ``/training/waivers/requests`` on purpose: ``/training/waivers``
is already uncacheable in the frontend, and a request carries a reason that
may be medical.

GET    /training/waivers/requests/policy             - The department's policy
PUT    /training/waivers/requests/policy             - Save it (training.manage)
GET    /training/waivers/requests/eligibility        - May I ask about this session?
POST   /training/waivers/requests                    - Ask to be excused
POST   /training/waivers/requests/with-attachments   - Ask, filing documents
GET    /training/waivers/requests/mine               - My requests
GET    /training/waivers/requests                    - Requests I decide or decided
GET    /training/waivers/requests/{id}               - One request
POST   /training/waivers/requests/{id}/withdraw      - Withdraw my pending request
POST   /training/waivers/requests/{id}/approve       - Approve a pending request
POST   /training/waivers/requests/{id}/deny          - Deny a pending request
POST   /training/waivers/requests/{id}/override      - The Chief approves a denial
POST   /training/waivers/requests/{id}/attachments   - File documents (pending)
GET    /training/waivers/requests/{id}/attachments/{attachment_id} - Download one

Who may decide is a matter of holding a position, not a permission (the
department picks the positions; the Chief and training managers are the
fallback), so every route but the policy save is signed-in only and the service
decides. A request is answered 404 to anyone who is neither its member nor
someone who may decide it.
"""

from contextlib import contextmanager
from typing import Iterator, List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.attendance_waiver import (
    AttendanceWaiverRequest,
    AttendanceWaiverStatus,
)
from app.models.user import User
from app.schemas.attendance_waiver import (
    MAX_CATEGORY_LENGTH,
    MAX_TEXT_LENGTH,
    AttendanceWaiverDecision,
    AttendanceWaiverEligibilityResponse,
    AttendanceWaiverOverride,
    AttendanceWaiverPolicy,
    AttendanceWaiverRequestPage,
    AttendanceWaiverRequestResponse,
    AttendanceWaiverSubmit,
)
from app.services.attendance_waiver_attachments import (
    AttendanceWaiverAttachmentService,
)
from app.services.attendance_waiver_service import (
    AttendanceWaiverNotFound,
    AttendanceWaiverService,
)

router = APIRouter()

# The decider queue's largest page.
MAX_PAGE = 200


@contextmanager
def _refusals() -> Iterator[None]:
    """The house mapping: not found 404, not allowed 403, refused 400."""
    try:
        yield
    except AttendanceWaiverNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=safe_error_detail(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )


async def _one(
    service: AttendanceWaiverService, viewer: User, request: AttendanceWaiverRequest
) -> AttendanceWaiverRequestResponse:
    bodies = await service.describe(
        str(viewer.organization_id), viewer, [request], with_actions=True
    )
    return AttendanceWaiverRequestResponse(**bodies[0])


@router.get("/policy", response_model=AttendanceWaiverPolicy)
async def get_attendance_waiver_policy(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The department's policy for session waiver requests: whether members may
    ask, the deadline, the cap, the categories and how a reason is taken.
    Every member reads it, because the request form is built from it.

    **Authentication required**
    """
    return await AttendanceWaiverService(db).get_policy(
        str(current_user.organization_id)
    )


@router.put("/policy", response_model=AttendanceWaiverPolicy)
async def save_attendance_waiver_policy(
    body: AttendanceWaiverPolicy,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Save the department's policy for session waiver requests. Approver
    positions must belong to the department (400 otherwise).

    **Requires permission: training.manage**
    """
    with _refusals():
        return await AttendanceWaiverService(db).save_policy(
            str(current_user.organization_id), body, current_user
        )


@router.get("/eligibility", response_model=AttendanceWaiverEligibilityResponse)
async def get_attendance_waiver_eligibility(
    event_id: str = Query(..., min_length=1, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Whether the caller may ask to be excused from this session and, if not,
    why; with the deadline, the waivers left for the session's date and the
    form's fields. Scoped to the caller: it answers only about them.

    **Authentication required**
    """
    with _refusals():
        result = await AttendanceWaiverService(db).eligibility(
            str(current_user.organization_id), current_user, event_id
        )
    return AttendanceWaiverEligibilityResponse(**result.as_response())


@router.post(
    "",
    response_model=AttendanceWaiverRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_attendance_waiver_request(
    body: AttendanceWaiverSubmit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ask to be excused from a training session. Always for the caller; 400
    with the reason when the policy refuses (the deadline has passed, no
    waivers are left, a category or reason is missing).

    **Authentication required**
    """
    service = AttendanceWaiverService(db)
    with _refusals():
        request = await service.submit(
            str(current_user.organization_id),
            current_user,
            body.event_id,
            body.category,
            body.reason,
        )
    return await _one(service, current_user, request)


@router.post(
    "/with-attachments",
    response_model=AttendanceWaiverRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_attendance_waiver_request_with_attachments(
    event_id: str = Form(..., min_length=1, max_length=36),
    category: Optional[str] = Form(None, max_length=MAX_CATEGORY_LENGTH),
    reason: Optional[str] = Form(None, max_length=MAX_TEXT_LENGTH),
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ask to be excused, filing up to three documents (PDF, JPEG, PNG or HEIC,
    10 MB each) with the request, as multipart form data. The request and its
    documents are saved together or not at all. 400 when the department does
    not take documents, for too many, or for a file of the wrong type or size;
    otherwise as ``POST /training/waivers/requests``.

    **Authentication required**
    """
    with _refusals():
        request = await AttendanceWaiverAttachmentService(db).submit_with_attachments(
            str(current_user.organization_id),
            current_user,
            event_id,
            category,
            reason,
            files,
        )
    return await _one(AttendanceWaiverService(db), current_user, request)


@router.get("/mine", response_model=List[AttendanceWaiverRequestResponse])
async def list_my_attendance_waiver_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The caller's own requests, newest first, withdrawn ones included.

    **Authentication required**
    """
    service = AttendanceWaiverService(db)
    org_id = str(current_user.organization_id)
    requests = await service.list_mine(org_id, current_user)
    return [
        AttendanceWaiverRequestResponse(**body)
        for body in await service.describe(org_id, current_user, requests)
    ]


@router.get("", response_model=AttendanceWaiverRequestPage)
async def list_attendance_waiver_requests(
    status_filter: Optional[AttendanceWaiverStatus] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=MAX_PAGE),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The requests the caller may decide or has decided, newest first, filtered
    by status. Empty for a member who decides none: the routed positions, the
    Chief and, when those are vacant, training managers decide.

    **Authentication required**
    """
    service = AttendanceWaiverService(db)
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
async def get_attendance_waiver_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One request with its decision log, for its member or someone who may
    decide it; 404 for anyone else.

    **Authentication required**
    """
    service = AttendanceWaiverService(db)
    with _refusals():
        request = await service.get(
            str(current_user.organization_id), current_user, request_id
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/withdraw", response_model=AttendanceWaiverRequestResponse)
async def withdraw_attendance_waiver_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Withdraw the caller's own pending request. The member may then ask again
    before the deadline. 403 for a decider, 404 for anyone else.

    **Authentication required**
    """
    service = AttendanceWaiverService(db)
    with _refusals():
        request = await service.withdraw(
            str(current_user.organization_id), current_user, request_id
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/approve", response_model=AttendanceWaiverRequestResponse)
async def approve_attendance_waiver_request(
    request_id: str,
    body: AttendanceWaiverDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Approve a pending request. Only someone the request is routed to, a
    holder of a chosen position or the Chief, and never its member. 400 when
    it is no longer pending or approving it would exceed the cap.

    **Authentication required**
    """
    service = AttendanceWaiverService(db)
    with _refusals():
        request = await service.approve(
            str(current_user.organization_id), current_user, request_id, body.note
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/deny", response_model=AttendanceWaiverRequestResponse)
async def deny_attendance_waiver_request(
    request_id: str,
    body: AttendanceWaiverDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Deny a pending request. Decided by the same people as approving. The
    session stays requested, so the member cannot ask again for it.

    **Authentication required**
    """
    service = AttendanceWaiverService(db)
    with _refusals():
        request = await service.deny(
            str(current_user.organization_id), current_user, request_id, body.note
        )
    return await _one(service, current_user, request)


@router.post("/{request_id}/override", response_model=AttendanceWaiverRequestResponse)
async def override_attendance_waiver_request(
    request_id: str,
    body: AttendanceWaiverOverride,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The Chief approves a denied request, with a reason. Only a member holding
    a Chief position, never on their own request; the cap does not block it
    but it counts toward the cap.

    **Authentication required**
    """
    service = AttendanceWaiverService(db)
    with _refusals():
        request = await service.chief_override(
            str(current_user.organization_id), current_user, request_id, body.note
        )
    return await _one(service, current_user, request)


@router.post(
    "/{request_id}/attachments", response_model=AttendanceWaiverRequestResponse
)
async def add_attendance_waiver_attachments(
    request_id: str,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    File more documents with the caller's own pending request, up to three in
    all. 400 once it is decided or withdrawn, or when the department does not
    take documents; 403 for a decider, 404 for anyone else.

    **Authentication required**
    """
    with _refusals():
        request = await AttendanceWaiverAttachmentService(db).add_attachments(
            str(current_user.organization_id), current_user, request_id, files
        )
    return await _one(AttendanceWaiverService(db), current_user, request)


@router.get("/{request_id}/attachments/{attachment_id}")
async def download_attendance_waiver_attachment(
    request_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One filed document, for the request's member or someone who may decide
    it; 403 for someone who may see the request but no longer decides it, 404
    for anyone else. Named ``waiver-attachment-<n>.<ext>``, never by the
    uploader's filename, and sent uncacheable. Each download is audited.

    **Authentication required**
    """
    with _refusals():
        return await AttendanceWaiverAttachmentService(db).download(
            str(current_user.organization_id),
            current_user,
            request_id,
            attachment_id,
        )
