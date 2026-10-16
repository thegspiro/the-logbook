"""
Meeting Minutes Record-Keeping Endpoints

Attendance, election results, attachments, carry-forward of action items,
approved versions and the printable PDF. They share ``/minutes-records`` with
``minutes.py`` and follow its access rules: a caller without ``minutes.manage``
sees only approved, non-executive minutes, and everything attached to a set of
minutes is exactly as visible as the minutes themselves.
"""

from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_active_user,
    require_permission,
)
from app.api.v1.endpoints.minutes import (
    _adopting_title,
    _build_action_item_response,
    _build_response,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import check_rate_limit
from app.core.utils import ensure_found, handle_service_errors, safe_error_detail
from app.models.minute import MinutesStatus
from app.models.user import Organization, User
from app.schemas.minute import (
    ActionItemResponse,
    AgendaSyncApply,
    AgendaSyncPreview,
    ApplyOutline,
    AttendanceSuggestions,
    CarryForwardRequest,
    ClosedSessionCreate,
    ClosedSessionResponse,
    ClosedSessionUpdate,
    ElectionResultCapture,
    ImportableElection,
    MinutesAttachmentResponse,
    MinutesElectionResultResponse,
    MinutesResponse,
    MinutesRevisionDetail,
    MinutesRevisionResponse,
    MinutesVerification,
    MyActionItem,
    OpenActionItem,
    SignatureResponse,
    SignatureStatusResponse,
    SignRequest,
    SuggestionApply,
    SuggestionCreate,
    SuggestionResolve,
    SuggestionResponse,
    validate_attachment_category,
)
from app.services.minute_service import MinuteService
from app.services.minutes_record_service import (
    MinutesRecordService,
    SuggestionApplyConflict,
)
from app.services.minutes_signature_service import MinutesSignatureService
from app.utils import download_names
from app.utils.minutes_pdf import render_minutes_pdf
from app.utils.motion_votes import vote_summary
from app.utils.org_timezone import resolve_scheduling_timezone, scheduling_timezone

router = APIRouter()


def _election_result_response(row, names: dict) -> MinutesElectionResultResponse:
    response = MinutesElectionResultResponse.model_validate(row)
    response.captured_by_name = names.get(row.captured_by)
    return response


def _attachment_response(row, names: dict) -> MinutesAttachmentResponse:
    response = MinutesAttachmentResponse.model_validate(row)
    response.uploaded_by_name = names.get(row.uploaded_by)
    return response


def _revision_response(row, names: dict) -> MinutesRevisionResponse:
    response = MinutesRevisionResponse.model_validate(row)
    response.submitted_by_name = names.get(row.submitted_by)
    response.approved_by_name = names.get(row.approved_by)
    response.superseded_by_name = names.get(row.superseded_by)
    return response


def _restricted(user: User) -> bool:
    """True for a caller who may read only approved, non-executive minutes."""
    return not _has_permission("minutes.manage", _collect_user_permissions(user))


# ============================================
# My action items (declared first: static path)
# ============================================


@router.get("/action-items/mine", response_model=list[MyActionItem])
async def list_my_action_items(
    include_closed: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Action items assigned to the caller across all approved minutes

    Any member may read their own list; it never includes someone else's
    items. Items carried forward appear on the newer minutes.

    **Authentication required**
    """
    rows = await MinutesRecordService(db).list_my_action_items(
        current_user.id, current_user.organization_id, include_closed
    )
    return [
        MyActionItem(
            **_build_action_item_response(item).model_dump(),
            minutes_title=title,
            meeting_date=meeting_date,
            minutes_status=minutes_status,
        )
        for item, title, meeting_date, minutes_status in rows
    ]


# ============================================
# Attendance
# ============================================


@router.get(
    "/{minutes_id}/attendance-suggestions", response_model=AttendanceSuggestions
)
async def get_attendance_suggestions(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    A starting roll call for the minutes: event check-ins, else the roster

    Nothing is saved; review the entries and save them with the minutes.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    suggestions = await MinutesRecordService(db).suggest_attendance(
        minutes_id, current_user.organization_id
    )
    return ensure_found(suggestions, "Meeting minutes")


# ============================================
# Election results
# ============================================


@router.get(
    "/{minutes_id}/importable-elections", response_model=list[ImportableElection]
)
async def list_importable_elections(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Closed elections whose result can be filed with these minutes

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    elections = await MinutesRecordService(db).list_importable_elections(
        minutes_id, current_user.organization_id
    )
    return ensure_found(elections, "Meeting minutes")


@router.get(
    "/{minutes_id}/election-results",
    response_model=list[MinutesElectionResultResponse],
)
async def list_election_results(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Election results filed with the minutes

    **Authentication required**
    **Requires permission: minutes.view**
    """
    service = MinutesRecordService(db)
    rows = ensure_found(
        await service.list_election_results(
            minutes_id,
            current_user.organization_id,
            restricted=_restricted(current_user),
        ),
        "Meeting minutes",
    )
    names = await service.member_names(
        [r.captured_by for r in rows], current_user.organization_id
    )
    return [_election_result_response(r, names) for r in rows]


@router.post(
    "/{minutes_id}/election-results",
    response_model=MinutesElectionResultResponse,
    status_code=status.HTTP_201_CREATED,
)
async def file_election_result(
    minutes_id: str,
    data: ElectionResultCapture,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Freeze a closed election's result into the minutes

    The result is copied as it stands now; later changes to the election do
    not alter what the minutes recorded.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to file the election result"):
        row = await MinutesRecordService(db).capture_election_result(
            minutes_id, current_user.organization_id, data.election_id, current_user.id
        )
    row = ensure_found(row, "Meeting minutes")

    await log_audit_event(
        db=db,
        event_type="minutes_election_result_filed",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "election_id": row.election_id,
            "election_title": row.election_title,
        },
        user_id=str(current_user.id),
    )
    return _election_result_response(
        row,
        await MinutesRecordService(db).member_names(
            [row.captured_by], current_user.organization_id
        ),
    )


@router.delete(
    "/{minutes_id}/election-results/{result_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_election_result(
    minutes_id: str,
    result_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Remove an election result from draft or rejected minutes

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to remove the election result"):
        removed = await MinutesRecordService(db).remove_election_result(
            minutes_id, result_id, current_user.organization_id
        )
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election result not found"
        )
    await log_audit_event(
        db=db,
        event_type="minutes_election_result_removed",
        event_category="meetings",
        severity="warning",
        event_data={"minutes_id": minutes_id, "result_id": result_id},
        user_id=str(current_user.id),
    )


# ============================================
# Attachments
# ============================================


@router.get("/{minutes_id}/attachments", response_model=list[MinutesAttachmentResponse])
async def list_attachments(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Files filed with the minutes

    **Authentication required**
    **Requires permission: minutes.view**
    """
    service = MinutesRecordService(db)
    rows = ensure_found(
        await service.list_attachments(
            minutes_id,
            current_user.organization_id,
            restricted=_restricted(current_user),
        ),
        "Meeting minutes",
    )
    names = await service.member_names(
        [r.uploaded_by for r in rows], current_user.organization_id
    )
    return [_attachment_response(r, names) for r in rows]


@router.post(
    "/{minutes_id}/attachments",
    response_model=MinutesAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    minutes_id: str,
    file: UploadFile = File(...),
    title: str = Form(..., min_length=1, max_length=200),
    category: str = Form("other"),
    description: Optional[str] = Form(None, max_length=2000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    File a report, handout or signed copy with the minutes

    The file is size-capped, type-checked, malware-scanned and encrypted at
    rest. While the minutes are in draft or rejected any category is accepted;
    once approved only ``signed_copy`` is.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    try:
        normalized_category = validate_attachment_category(category)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    clean_title = title.strip()
    if not clean_title:
        raise HTTPException(status_code=400, detail="A title is required")

    async with handle_service_errors("Failed to attach the file"):
        attachment = await MinutesRecordService(db).store_minutes_attachment(
            minutes_id,
            current_user,
            file,
            clean_title,
            normalized_category,
            (description or "").strip() or None,
        )
    attachment = ensure_found(attachment, "Meeting minutes")

    await log_audit_event(
        db=db,
        event_type="minutes_attachment_uploaded",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "attachment_id": attachment.id,
            "category": attachment.category,
            "file_type": attachment.mime_type,
            "file_size": attachment.file_size,
            "sha256": attachment.sha256,
        },
        user_id=str(current_user.id),
    )
    return _attachment_response(
        attachment,
        await MinutesRecordService(db).member_names(
            [attachment.uploaded_by], current_user.organization_id
        ),
    )


@router.get("/{minutes_id}/attachments/{attachment_id}/file")
async def download_attachment(
    minutes_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Download a file filed with the minutes

    Visible to exactly those who can read the minutes: an attachment of
    executive-session minutes answers 404 to everyone else.

    **Authentication required**
    **Requires permission: minutes.view**
    """
    minutes = ensure_found(
        await MinuteService(db).get_minutes(
            minutes_id,
            current_user.organization_id,
            restricted=_restricted(current_user),
            load_children=False,
        ),
        "Meeting minutes",
    )
    service = MinutesRecordService(db)
    attachment = ensure_found(
        await service.get_attachment(
            minutes.id, attachment_id, current_user.organization_id
        ),
        "Attachment",
    )
    tz = await resolve_scheduling_timezone(db, current_user.organization_id)
    await log_audit_event(
        db=db,
        event_type="minutes_attachment_downloaded",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "attachment_id": attachment.id},
        user_id=str(current_user.id),
    )
    return await service.serve_attachment(
        minutes,
        attachment,
        current_user.organization_id,
        download_names.local_day(minutes.meeting_date, tz),
    )


@router.delete(
    "/{minutes_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_attachment(
    minutes_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Remove a file from draft or rejected minutes

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to remove the attachment"):
        removed = await MinutesRecordService(db).delete_attachment(
            minutes_id, attachment_id, current_user.organization_id
        )
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )
    await log_audit_event(
        db=db,
        event_type="minutes_attachment_deleted",
        event_category="meetings",
        severity="warning",
        event_data={"minutes_id": minutes_id, "attachment_id": attachment_id},
        user_id=str(current_user.id),
    )


# ============================================
# Revisions
# ============================================


@router.get("/{minutes_id}/revisions", response_model=list[MinutesRevisionResponse])
async def list_revisions(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Every approved version of the minutes, newest first

    **Authentication required**
    **Requires permission: minutes.view**
    """
    service = MinutesRecordService(db)
    rows = ensure_found(
        await service.list_revisions(
            minutes_id,
            current_user.organization_id,
            restricted=_restricted(current_user),
        ),
        "Meeting minutes",
    )
    names = await service.member_names(
        [
            person
            for r in rows
            for person in (r.submitted_by, r.approved_by, r.superseded_by)
        ],
        current_user.organization_id,
    )
    return [_revision_response(r, names) for r in rows]


# ============================================
# Signatures
# ============================================


async def _rate_limit_signing(request: Request) -> None:
    # Signing re-asks for a password, so it is a place a password can be
    # guessed from an already signed-in session. Its own scope keeps it from
    # sharing a budget with login.
    await check_rate_limit(
        request,
        max_requests=10,
        window_seconds=60,
        lockout_seconds=300,
        scope="minutes_signing",
    )


@router.get("/{minutes_id}/signatures", response_model=SignatureStatusResponse)
async def get_signature_status(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Each signature slot for the current adopted version, who has signed it, and
    which the caller may sign

    **Authentication required**
    **Requires permission: minutes.view**
    """
    result = await MinutesSignatureService(db).status(
        minutes_id,
        current_user.organization_id,
        current_user,
        restricted=_restricted(current_user),
    )
    return ensure_found(result, "Meeting minutes")


@router.post(
    "/{minutes_id}/signatures",
    response_model=SignatureResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rate_limit_signing)],
)
async def sign_minutes(
    minutes_id: str,
    data: SignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Sign the adopted minutes in one of the department's signature slots

    The signer types their name as it stands on their account and confirms
    their password. Which slots a member may sign is the department's rule.

    **Authentication required**
    **Requires permission: minutes.view** (the slot's own rule is checked too)
    """
    async with handle_service_errors("Failed to sign the minutes"):
        signature = await MinutesSignatureService(db).sign(
            minutes_id,
            current_user.organization_id,
            current_user,
            data.slot_key,
            data.signed_name,
            data.password,
            restricted=_restricted(current_user),
        )
    signature = ensure_found(signature, "Meeting minutes")

    await log_audit_event(
        db=db,
        event_type="minutes_signed",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "slot": signature.slot_key,
            "content_hash": signature.content_hash,
        },
        user_id=str(current_user.id),
    )
    return SignatureResponse(
        id=signature.id,
        slot_key=signature.slot_key,
        slot_title=signature.slot_title,
        signed_name=signature.signed_name,
        signed_at=signature.signed_at,
        intact=True,
    )


@router.get("/{minutes_id}/verify", response_model=MinutesVerification)
async def verify_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Check that approved minutes still match the version that was approved

    **Authentication required**
    **Requires permission: minutes.view**
    """
    result = await MinutesRecordService(db).verify(
        minutes_id, current_user.organization_id, restricted=_restricted(current_user)
    )
    return ensure_found(result, "Meeting minutes")


@router.get(
    "/{minutes_id}/revisions/{revision_id}", response_model=MinutesRevisionDetail
)
async def get_revision(
    minutes_id: str,
    revision_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    One approved version with the content it recorded

    **Authentication required**
    **Requires permission: minutes.view**
    """
    service = MinutesRecordService(db)
    revision = ensure_found(
        await service.get_revision(
            minutes_id,
            revision_id,
            current_user.organization_id,
            restricted=_restricted(current_user),
        ),
        "Revision",
    )
    names = await service.member_names(
        [revision.submitted_by, revision.approved_by, revision.superseded_by],
        current_user.organization_id,
    )
    return MinutesRevisionDetail(
        **_revision_response(revision, names).model_dump(), snapshot=revision.snapshot
    )


# ============================================
# Carry-forward
# ============================================


@router.get("/{minutes_id}/open-action-items", response_model=list[OpenActionItem])
async def list_open_action_items(
    minutes_id: str,
    include_other_types: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Open action items from earlier approved minutes, for carrying forward

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    rows = ensure_found(
        await MinutesRecordService(db).list_open_items_for_carry_forward(
            minutes_id, current_user.organization_id, include_other_types
        ),
        "Meeting minutes",
    )
    return [
        OpenActionItem(
            **_build_action_item_response(item).model_dump(),
            minutes_title=title,
            meeting_date=meeting_date,
        )
        for item, title, meeting_date in rows
    ]


@router.post(
    "/{minutes_id}/carry-forward",
    response_model=list[ActionItemResponse],
    status_code=status.HTTP_201_CREATED,
)
async def carry_forward_action_items(
    minutes_id: str,
    data: CarryForwardRequest,
    include_other_types: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Copy open action items from earlier minutes into these draft minutes

    The originals stop counting as open and are no longer reminded about; the
    copies point back at them.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to carry the action items forward"):
        created = await MinutesRecordService(db).carry_forward(
            minutes_id, current_user.organization_id, data.item_ids, include_other_types
        )
    created = ensure_found(created, "Meeting minutes")

    await log_audit_event(
        db=db,
        event_type="minutes_action_items_carried_forward",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "from_item_ids": [i.carried_from_id for i in created],
        },
        user_id=str(current_user.id),
    )
    return [_build_action_item_response(item) for item in created]


# ============================================
# Closed sessions
# ============================================


@router.get("/{minutes_id}/closed-sessions", response_model=list[ClosedSessionResponse])
async def list_closed_sessions(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Closed sessions held during the meeting: why, when, and who stayed

    **Authentication required**
    **Requires permission: minutes.view**
    """
    rows = await MinutesRecordService(db).list_closed_sessions(
        minutes_id, current_user.organization_id, restricted=_restricted(current_user)
    )
    return ensure_found(rows, "Meeting minutes")


@router.post(
    "/{minutes_id}/closed-sessions",
    response_model=ClosedSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_closed_session(
    minutes_id: str,
    data: ClosedSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Record a closed session (draft or rejected minutes only)

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to record the closed session"):
        session = await MinutesRecordService(db).add_closed_session(
            minutes_id, current_user.organization_id, data, current_user.id
        )
    session = ensure_found(session, "Meeting minutes")
    await log_audit_event(
        db=db,
        event_type="minutes_closed_session_recorded",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "session_id": session.id},
        user_id=str(current_user.id),
    )
    return ClosedSessionResponse.model_validate(session)


@router.put(
    "/{minutes_id}/closed-sessions/{session_id}",
    response_model=ClosedSessionResponse,
)
async def update_closed_session(
    minutes_id: str,
    session_id: str,
    data: ClosedSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Change a closed session (draft or rejected minutes only)

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to update the closed session"):
        session = await MinutesRecordService(db).update_closed_session(
            minutes_id, session_id, current_user.organization_id, data
        )
    session = ensure_found(session, "Closed session")
    await log_audit_event(
        db=db,
        event_type="minutes_closed_session_updated",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "session_id": session_id},
        user_id=str(current_user.id),
    )
    return ClosedSessionResponse.model_validate(session)


@router.delete(
    "/{minutes_id}/closed-sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_closed_session(
    minutes_id: str,
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Remove a closed session (draft or rejected minutes only)

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to remove the closed session"):
        removed = await MinutesRecordService(db).delete_closed_session(
            minutes_id, session_id, current_user.organization_id
        )
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Closed session not found"
        )
    await log_audit_event(
        db=db,
        event_type="minutes_closed_session_removed",
        event_category="meetings",
        severity="warning",
        event_data={"minutes_id": minutes_id, "session_id": session_id},
        user_id=str(current_user.id),
    )


# ============================================
# Review: suggestions, recall, outlines
# ============================================


def _suggestion_response(row, names: dict) -> SuggestionResponse:
    response = SuggestionResponse.model_validate(row)
    response.created_by_name = names.get(row.created_by)
    response.resolved_by_name = names.get(row.resolved_by)
    return response


@router.get("/{minutes_id}/suggestions", response_model=list[SuggestionResponse])
async def list_suggestions(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Suggested changes: all of them for a manager, only your own otherwise

    **Authentication required**
    **Requires permission: minutes.view**
    """
    service = MinutesRecordService(db)
    can_manage = not _restricted(current_user)
    rows = ensure_found(
        await service.list_suggestions(
            minutes_id, current_user, current_user.organization_id, can_manage
        ),
        "Meeting minutes",
    )
    names = await service.member_names(
        [p for r in rows for p in (r.created_by, r.resolved_by)],
        current_user.organization_id,
    )
    return [_suggestion_response(r, names) for r in rows]


@router.post(
    "/{minutes_id}/suggestions",
    response_model=SuggestionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_suggestion(
    minutes_id: str,
    data: SuggestionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Suggest a change while the minutes are circulated for review

    Any member who can read the minutes can suggest. The minutes themselves are
    not edited; the secretary accepts or declines each suggestion.

    **Authentication required**
    **Requires permission: minutes.view**
    """
    service = MinutesRecordService(db)
    async with handle_service_errors("Failed to record the suggestion"):
        suggestion = await service.add_suggestion(
            minutes_id, current_user, data, not _restricted(current_user)
        )
    suggestion = ensure_found(suggestion, "Meeting minutes")
    await log_audit_event(
        db=db,
        event_type="minutes_suggestion_made",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "suggestion_id": suggestion.id,
            "section_key": suggestion.section_key,
        },
        user_id=str(current_user.id),
    )
    return _suggestion_response(
        suggestion,
        await service.member_names(
            [suggestion.created_by], current_user.organization_id
        ),
    )


@router.put(
    "/{minutes_id}/suggestions/{suggestion_id}", response_model=SuggestionResponse
)
async def resolve_suggestion(
    minutes_id: str,
    suggestion_id: str,
    data: SuggestionResolve,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Accept or decline a suggestion

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    service = MinutesRecordService(db)
    async with handle_service_errors("Failed to answer the suggestion"):
        suggestion = await service.resolve_suggestion(
            minutes_id,
            suggestion_id,
            current_user.organization_id,
            current_user.id,
            data,
        )
    suggestion = ensure_found(suggestion, "Suggestion")
    await log_audit_event(
        db=db,
        event_type=f"minutes_suggestion_{data.status}",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "suggestion_id": suggestion_id},
        user_id=str(current_user.id),
    )
    return _suggestion_response(
        suggestion,
        await service.member_names(
            [suggestion.created_by, suggestion.resolved_by],
            current_user.organization_id,
        ),
    )


@router.post(
    "/{minutes_id}/suggestions/{suggestion_id}/apply",
    response_model=SuggestionResponse,
)
async def apply_suggestion(
    minutes_id: str,
    suggestion_id: str,
    data: SuggestionApply,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Apply the accepted tracked changes of a suggestion to its section

    The changes named in ``accepted`` are written into the section; the rest of
    the suggestion's changes are rejected. Draft or rejected minutes only, so a
    circulating set is recalled first. If a change no longer fits the section
    (it was edited since the reviewer saw it) nothing is written and the answer
    is 409 listing the ones that do not.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    service = MinutesRecordService(db)
    try:
        suggestion = await service.apply_suggestion(
            minutes_id,
            suggestion_id,
            current_user.organization_id,
            current_user.id,
            data,
        )
    except SuggestionApplyConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": str(exc), "failed": exc.failed},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(exc)
        ) from exc
    suggestion = ensure_found(suggestion, "Suggestion")
    await log_audit_event(
        db=db,
        event_type="minutes_suggestion_applied",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "suggestion_id": suggestion_id,
            "accepted": sorted(data.accepted),
        },
        user_id=str(current_user.id),
    )
    return _suggestion_response(
        suggestion,
        await service.member_names(
            [suggestion.created_by, suggestion.resolved_by],
            current_user.organization_id,
        ),
    )


@router.post("/{minutes_id}/recall", response_model=MinutesResponse)
async def recall_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Take circulated minutes back to draft to work in suggestions

    The minutes leave members' view until they are circulated again.
    Suggestions already made are kept.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to recall the minutes"):
        minutes = await MinuteService(db).recall_minutes(
            minutes_id, current_user.organization_id
        )
    minutes = ensure_found(minutes, "Meeting minutes")
    await log_audit_event(
        db=db,
        event_type="minutes_recalled",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "title": minutes.title},
        user_id=str(current_user.id),
    )
    return _build_response(minutes)


@router.post("/{minutes_id}/apply-outline", response_model=MinutesResponse)
async def apply_outline(
    minutes_id: str,
    data: ApplyOutline,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Lay an outline over draft minutes, keeping everything already written

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to apply the outline"):
        minutes = await MinuteService(db).apply_outline(
            minutes_id, current_user.organization_id, data.template_id
        )
    minutes = ensure_found(minutes, "Meeting minutes")
    await log_audit_event(
        db=db,
        event_type="minutes_outline_applied",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "template_id": data.template_id},
        user_id=str(current_user.id),
    )
    return _build_response(minutes)


@router.get("/{minutes_id}/agenda-sync", response_model=AgendaSyncPreview)
async def preview_agenda_sync(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    What the meeting's agenda now asks of these minutes' sections

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to compare the agenda"):
        preview = await MinuteService(db).agenda_sync_preview(
            minutes_id, current_user.organization_id
        )
    return ensure_found(preview, "Meeting minutes")


@router.post("/{minutes_id}/agenda-sync", response_model=MinutesResponse)
async def apply_agenda_sync(
    minutes_id: str,
    data: AgendaSyncApply,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Apply the chosen agenda changes to draft minutes

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    async with handle_service_errors("Failed to sync the agenda"):
        minutes = await MinuteService(db).apply_agenda_sync(
            minutes_id, current_user.organization_id, data.accept
        )
    minutes = ensure_found(minutes, "Meeting minutes")
    await log_audit_event(
        db=db,
        event_type="minutes_agenda_synced",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "accepted": len(data.accept)},
        user_id=str(current_user.id),
    )
    return _build_response(minutes)


# ============================================
# PDF
# ============================================


def _parse(value: Optional[str]) -> Optional[datetime]:
    """A closed-session participant's time, stored as ISO text in JSON."""
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@router.get("/{minutes_id}/pdf")
async def download_minutes_pdf(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Printable minutes with signature lines

    Approved minutes carry the approved version's number and SHA-256 in the
    footer. Draft minutes are stamped as drafts.

    **Authentication required**
    **Requires permission: minutes.view**
    """
    organization_id = current_user.organization_id
    minutes = ensure_found(
        await MinuteService(db).get_minutes(
            minutes_id, organization_id, restricted=_restricted(current_user)
        ),
        "Meeting minutes",
    )
    records = MinutesRecordService(db)
    elections = await records.list_election_results(
        minutes.id, organization_id, restricted=_restricted(current_user)
    )
    closed_sessions = await records.list_closed_sessions(
        minutes.id, organization_id, restricted=_restricted(current_user)
    )
    attachments = await records.list_attachments(
        minutes.id, organization_id, restricted=_restricted(current_user)
    )
    revisions = await records.list_revisions(
        minutes.id, organization_id, restricted=_restricted(current_user)
    )
    org = (
        await db.execute(select(Organization).where(Organization.id == organization_id))
    ).scalar_one_or_none()
    tz = scheduling_timezone(org)

    def local(value: Optional[datetime], fmt: str) -> Optional[str]:
        stamp = _aware(value)
        return stamp.astimezone(tz).strftime(fmt) if stamp else None

    person_ids = {i for i in (minutes.submitted_by, minutes.approved_by) if i}
    names = {}
    if person_ids:
        found = await db.execute(
            select(User).where(
                User.id.in_(person_ids), User.organization_id == str(organization_id)
            )
        )
        names = {u.id: (u.display_name or u.username) for u in found.scalars().all()}

    status_value = (
        minutes.status if isinstance(minutes.status, str) else minutes.status.value
    )
    current_revision = next(
        (r for r in (revisions or []) if r.superseded_at is None), None
    )
    approval = None
    if status_value == MinutesStatus.APPROVED.value:
        approval = {
            "submitted_by": names.get(minutes.submitted_by or ""),
            "approved_by": names.get(minutes.approved_by or ""),
            "approved_at_display": local(
                minutes.approved_at, "%B %d, %Y at %I:%M %p %Z"
            ),
            "adopted_on_display": local(minutes.adopted_on, "%B %d, %Y"),
            "as_amended": minutes.adopted_as_amended,
            "moved_by": minutes.adoption_moved_by,
            "seconded_by": minutes.adoption_seconded_by,
            "adopting_title": _adopting_title(minutes),
            "version": current_revision.version if current_revision else None,
            "content_hash": current_revision.content_hash if current_revision else None,
            "signatures": [
                {
                    "title": row.slot_title,
                    "name": row.signed_name,
                    "signed_at_display": local(
                        row.signed_at, "%B %d, %Y at %I:%M %p %Z"
                    ),
                }
                for row in await MinutesSignatureService(db).for_revision(
                    minutes.id, organization_id
                )
            ],
        }

    meeting_type = (
        minutes.meeting_type
        if isinstance(minutes.meeting_type, str)
        else minutes.meeting_type.value
    )
    data = {
        "title": minutes.title,
        "meeting_type_display": meeting_type.replace("_", " ").title(),
        "meeting_date_display": local(minutes.meeting_date, "%B %d, %Y at %I:%M %p"),
        "location": minutes.location,
        "called_by": minutes.called_by,
        "called_to_order": local(minutes.called_to_order_at, "%I:%M %p"),
        "adjourned": local(minutes.adjourned_at, "%I:%M %p"),
        "status_display": status_value.title(),
        "attendees": [
            {
                "name": a.get("name"),
                "role": a.get("role"),
                "status": a.get("status")
                or ("present" if a.get("present", True) else "absent"),
                "note": a.get("note"),
            }
            for a in (minutes.attendees or [])
        ],
        "quorum_display": (
            ("Quorum met" if minutes.quorum_met else "Quorum NOT met")
            + (f" ({minutes.quorum_count} present)" if minutes.quorum_count else "")
            if minutes.quorum_met is not None
            else None
        ),
        "sections": sorted(minutes.get_sections(), key=lambda s: s.get("order", 0)),
        "motions": [
            {
                "number": index,
                "text": m.motion_text,
                "status": m.status if isinstance(m.status, str) else m.status.value,
                "moved_by": m.moved_by,
                "seconded_by": m.seconded_by,
                "notes": m.discussion_notes,
                "ballot": (
                    getattr(getattr(m, "election", None), "title", None)
                    if m.election_id
                    else None
                ),
                "vote_display": vote_summary(m),
            }
            for index, m in enumerate(minutes.motions or [], 1)
        ],
        "action_items": [
            {
                "description": a.description,
                "assignee": a.assignee_name,
                "due": local(a.due_date, "%Y-%m-%d"),
                "priority": (
                    a.priority if isinstance(a.priority, str) else a.priority.value
                ),
                "status": a.status if isinstance(a.status, str) else a.status.value,
            }
            for a in (minutes.action_items or [])
        ],
        "closed_sessions": [
            {
                "reason": c.reason,
                "legal_basis": c.legal_basis,
                "started": local(c.started_at, "%I:%M %p"),
                "ended": local(c.ended_at, "%I:%M %p"),
                "participants": [
                    {
                        "name": p.get("name"),
                        "joined": local(_parse(p.get("joined_at")), "%I:%M %p"),
                        "left": local(_parse(p.get("left_at")), "%I:%M %p"),
                    }
                    for p in (c.participants or [])
                ],
                "summary": c.summary,
            }
            for c in (closed_sessions or [])
        ],
        "election_results": [
            {
                "title": r.election_title,
                "closed_display": local(r.election_closed_at, "%B %d, %Y %I:%M %p %Z"),
                "snapshot": r.snapshot,
                "addendum": r.is_addendum,
                "filed_display": local(r.created_at, "%B %d, %Y"),
            }
            for r in (elections or [])
        ],
        "attachments": [
            {
                "title": a.title,
                "category": a.category,
                "name": a.original_name,
                "sha256": a.sha256,
            }
            for a in (attachments or [])
        ],
        "approval": approval,
        "header": minutes.get_effective_header(),
        "footer": minutes.get_effective_footer(),
    }
    pdf = render_minutes_pdf(
        data,
        {
            "org_name": org.name if org else None,
            "generated_at": local(datetime.now(timezone.utc), "%B %d, %Y %I:%M %p %Z"),
        },
    )

    await log_audit_event(
        db=db,
        event_type="minutes_pdf_exported",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "status": status_value},
        user_id=str(current_user.id),
    )
    logger.info(f"Minutes PDF exported | id={minutes_id} by={current_user.id}")

    filename = download_names.descriptive_filename(
        download_names.local_day(minutes.meeting_date, tz),
        minutes.title,
        extension=".pdf",
        fallback="meeting-minutes",
    )
    # The name is built from the minutes' title, which can hold any script; a
    # header carries only latin-1 unless the name is RFC 5987 encoded, the same
    # rule stored_file_response applies to a stored file.
    quoted = quote(filename)
    disposition = (
        f"attachment; filename*=utf-8''{quoted}"
        if quoted != filename
        else f'attachment; filename="{filename}"'
    )
    return StreamingResponse(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": disposition},
    )
