"""
Suggestion box endpoints (communications module).

Four audiences, grouped by path so the access rule for each is in one place:

* ``/boxes`` — any signed-in member: list open boxes and submit to one.
* ``/mine`` and ``/follow-up`` — the submitter: named submitters by their own
  session, anonymous ones by the follow-up key alone.
* ``/review`` — a box's reviewers, plus anyone a single suggestion was
  forwarded to (for that suggestion only). Authorization is resolved from
  ``suggestion_box_reviewers`` and ``suggestion_forwards``, not from a
  permission; only a box's own reviewers forward or withdraw.
* ``/admin`` — ``suggestions.manage``: configure boxes and reviewers. That
  grant never reads submissions (see ``app/models/suggestion.py``).

Anonymous submissions write no audit entry: an audit row carries the actor,
and one without an actor would still record the exact moment of the
submission, which is the timing the service otherwise refuses to keep.
"""

import asyncio
import os
from typing import List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams, get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.core.utils import ensure_found, handle_service_errors
from app.models.notification import NotificationTrigger
from app.models.suggestion import Suggestion
from app.models.user import User
from app.schemas.suggestion import (
    DispositionUpdate,
    FollowUpKeyRequest,
    FollowUpMessageCreate,
    ForwardCreate,
    MessageCreate,
    MySuggestionSummary,
    ReviewerOptions,
    ReviewSuggestionDetail,
    ReviewSuggestionList,
    ReviewSummary,
    SubmissionReceipt,
    SubmitterSuggestionDetail,
    SuggestionBoxAdminResponse,
    SuggestionBoxPublic,
    SuggestionBoxWrite,
)
from app.services.notification_rules import NotificationRuleResolver
from app.services.suggestion_service import (
    MAX_SCREENSHOT_BYTES,
    MAX_SCREENSHOTS,
    SuggestionService,
    forward_notice,
    process_screenshot,
    reviewer_notice,
    send_suggestion_notice,
    submitter_notice,
    watcher_notice,
)
from app.utils.upload_limits import read_upload_limited

router = APIRouter()

_NOT_FOUND = "Submission not found"


async def _read_screenshots(files: List[UploadFile]) -> List[bytes]:
    if len(files) > MAX_SCREENSHOTS:
        raise HTTPException(
            status_code=400,
            detail=f"At most {MAX_SCREENSHOTS} screenshots may be attached.",
        )
    processed: List[bytes] = []
    for upload in files:
        try:
            raw = await read_upload_limited(upload, MAX_SCREENSHOT_BYTES)
        except ValueError:
            raise CodedHTTPException(
                status_code=400,
                detail="Screenshot too large. Maximum size is 10MB each.",
                error_code=ErrorCode.UPLD_TOO_LARGE,
            )
        if not raw:
            continue
        try:
            processed.append(await asyncio.to_thread(process_screenshot, raw))
        except RuntimeError:
            raise CodedHTTPException(
                status_code=503,
                detail="File validation is unavailable. Please try again later.",
                error_code=ErrorCode.UPLD_VALIDATION_UNAVAILABLE,
            )
        except ValueError as exc:
            raise CodedHTTPException(
                status_code=400,
                detail=str(exc),
                error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
            )
    return processed


async def _serve_attachment(suggestion: Suggestion, attachment_id: str) -> FileResponse:
    attachment = SuggestionService.find_attachment(suggestion, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    real_path = SuggestionService.confined_path(attachment)
    if not real_path or not await asyncio.to_thread(os.path.isfile, real_path):
        raise HTTPException(status_code=404, detail="Attachment file not found")
    return FileResponse(
        real_path, media_type=attachment.content_type, filename=attachment.file_name
    )


# ---------------------------------------------------------------------------
# Submitting
# ---------------------------------------------------------------------------


@router.get("/boxes", response_model=List[SuggestionBoxPublic])
async def list_open_boxes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Boxes currently accepting submissions."""
    return await SuggestionService(db).list_open_boxes(current_user.organization_id)


@router.post(
    "/boxes/{box_id}/submissions",
    response_model=SubmissionReceipt,
    status_code=201,
)
async def submit_suggestion(
    box_id: str,
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    details: str = Form(...),
    anonymous: bool = Form(False),
    screenshots: List[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit to a box, named or anonymously as the box allows.

    Screenshots travel in the same request so an anonymous submission is one
    act, not a submission plus uploads a later request could be tied to.
    """
    service = SuggestionService(db)
    box = ensure_found(
        await service.get_open_box(current_user.organization_id, box_id),
        "Suggestion box",
    )
    processed = await _read_screenshots(screenshots)
    async with handle_service_errors("Failed to submit"):
        suggestion, key = await service.submit(
            box=box,
            user_id=str(current_user.id),
            title=title,
            details=details,
            anonymous=anonymous,
            screenshots=processed,
        )
    if not suggestion.is_anonymous:
        await log_audit_event(
            db=db,
            event_type="suggestion_submitted",
            event_category="suggestions",
            severity="info",
            event_data={"suggestion_id": suggestion.id, "box_id": box.id},
            user_id=str(current_user.id),
            username=current_user.username,
        )
    if await NotificationRuleResolver(db).is_enabled(
        box.organization_id, NotificationTrigger.SUGGESTION_SUBMITTED
    ):
        reviewers = await service.reviewer_recipient_ids(box.organization_id, box.id)
        watchers = await service.watcher_recipient_ids(box.organization_id, box.id)
        background_tasks.add_task(
            send_suggestion_notice,
            box.organization_id,
            reviewers,
            reviewer_notice(box.name, suggestion.id, reply=False),
        )
        if watchers:
            background_tasks.add_task(
                send_suggestion_notice,
                box.organization_id,
                watchers,
                watcher_notice(box.name),
            )
    return {
        "id": None if suggestion.is_anonymous else suggestion.id,
        "is_anonymous": bool(suggestion.is_anonymous),
        "follow_up_key": key,
    }


# ---------------------------------------------------------------------------
# The submitter's own submissions
# ---------------------------------------------------------------------------


@router.get("/mine", response_model=List[MySuggestionSummary])
async def list_my_suggestions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The caller's named submissions. Anonymous ones are, by design, not
    theirs to list — nothing records that they wrote them."""
    return await SuggestionService(db).list_mine(
        current_user.organization_id, str(current_user.id)
    )


@router.get("/mine/{suggestion_id}", response_model=SubmitterSuggestionDetail)
async def get_my_suggestion(
    suggestion_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SuggestionService(db)
    suggestion = ensure_found(
        await service.get_mine(
            current_user.organization_id, str(current_user.id), suggestion_id
        ),
        _NOT_FOUND,
    )
    return await service.submitter_view(suggestion, str(current_user.id))


@router.post(
    "/mine/{suggestion_id}/messages",
    response_model=SubmitterSuggestionDetail,
)
async def reply_to_my_suggestion(
    suggestion_id: str,
    data: MessageCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SuggestionService(db)
    org_id = current_user.organization_id
    suggestion = ensure_found(
        await service.get_mine(org_id, str(current_user.id), suggestion_id),
        _NOT_FOUND,
    )
    async with handle_service_errors("Failed to send reply"):
        await service.add_submitter_message(suggestion, str(current_user.id), data.body)
    await _notify_reviewers_of_reply(service, background_tasks, suggestion)
    refreshed = ensure_found(
        await service.get_mine(org_id, str(current_user.id), suggestion_id), _NOT_FOUND
    )
    return await service.submitter_view(refreshed, str(current_user.id))


@router.get("/mine/{suggestion_id}/attachments/{attachment_id}")
async def download_my_attachment(
    suggestion_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    suggestion = ensure_found(
        await SuggestionService(db).get_mine(
            current_user.organization_id, str(current_user.id), suggestion_id
        ),
        _NOT_FOUND,
    )
    return await _serve_attachment(suggestion, attachment_id)


# ---------------------------------------------------------------------------
# Anonymous follow-up by key
#
# Still behind a session: the key proves authorship, the session proves the
# caller is a member of the department. The key is sent in the body, never
# the URL, and the caller's identity is not written anywhere by these routes.
# ---------------------------------------------------------------------------


async def _by_key(
    service: SuggestionService, current_user: User, key: str
) -> Suggestion:
    return ensure_found(
        await service.get_by_key(current_user.organization_id, key), _NOT_FOUND
    )


@router.post("/follow-up/lookup", response_model=SubmitterSuggestionDetail)
async def lookup_by_key(
    data: FollowUpKeyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SuggestionService(db)
    suggestion = await _by_key(service, current_user, data.key)
    return await service.submitter_view(suggestion, None)


@router.post("/follow-up/messages", response_model=SubmitterSuggestionDetail)
async def reply_by_key(
    data: FollowUpMessageCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SuggestionService(db)
    suggestion = await _by_key(service, current_user, data.key)
    async with handle_service_errors("Failed to send reply"):
        await service.add_submitter_message(suggestion, None, data.body)
    await _notify_reviewers_of_reply(service, background_tasks, suggestion)
    refreshed = await _by_key(service, current_user, data.key)
    return await service.submitter_view(refreshed, None)


@router.post("/follow-up/attachments/{attachment_id}")
async def download_attachment_by_key(
    attachment_id: str,
    data: FollowUpKeyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    suggestion = await _by_key(SuggestionService(db), current_user, data.key)
    return await _serve_attachment(suggestion, attachment_id)


async def _notify_reviewers_of_reply(
    service: SuggestionService,
    background_tasks: BackgroundTasks,
    suggestion: Suggestion,
) -> None:
    recipients = await service.suggestion_recipient_ids(suggestion)
    background_tasks.add_task(
        send_suggestion_notice,
        suggestion.organization_id,
        recipients,
        reviewer_notice(suggestion.box.name, suggestion.id, reply=True),
    )


# ---------------------------------------------------------------------------
# Reviewing
# ---------------------------------------------------------------------------


@router.get("/review/summary", response_model=ReviewSummary)
async def review_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Whether the caller reviews any box, and how many submissions are open."""
    return await SuggestionService(db).review_summary(
        current_user.organization_id, str(current_user.id)
    )


@router.get("/review", response_model=ReviewSuggestionList)
async def list_for_review(
    box_id: Optional[str] = Query(None),
    disposition: Optional[str] = Query(
        None,
        pattern="^(open|new|under_review|accepted|implemented|declined|duplicate)$",
    ),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items, total = await SuggestionService(db).list_for_review(
        current_user.organization_id,
        str(current_user.id),
        box_id=box_id,
        disposition=disposition,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return {"items": items, "total": total}


async def _for_review(
    service: SuggestionService, current_user: User, suggestion_id: str
) -> Suggestion:
    return ensure_found(
        await service.get_for_review(
            current_user.organization_id, str(current_user.id), suggestion_id
        ),
        _NOT_FOUND,
    )


@router.get("/review/forward-options", response_model=ReviewerOptions)
async def forward_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Positions and members a box reviewer can forward to."""
    service = SuggestionService(db)
    if not await service.reviewer_box_ids(
        current_user.organization_id, str(current_user.id)
    ):
        raise HTTPException(
            status_code=403, detail="Only a box's reviewers can forward suggestions."
        )
    return await service.reviewer_options(current_user.organization_id)


@router.get("/review/{suggestion_id}", response_model=ReviewSuggestionDetail)
async def get_for_review(
    suggestion_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SuggestionService(db)
    suggestion = await _for_review(service, current_user, suggestion_id)
    return await service.reviewer_view(suggestion, str(current_user.id))


@router.patch("/review/{suggestion_id}", response_model=ReviewSuggestionDetail)
async def update_disposition(
    suggestion_id: str,
    data: DispositionUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SuggestionService(db)
    suggestion = await _for_review(service, current_user, suggestion_id)
    fields = data.model_dump(exclude_unset=True)
    async with handle_service_errors("Failed to update submission"):
        previous = await service.update_disposition(
            suggestion, str(current_user.id), fields
        )
    refreshed = await _for_review(service, current_user, suggestion_id)
    if previous is not None:
        await log_audit_event(
            db=db,
            event_type="suggestion_disposition_changed",
            event_category="suggestions",
            severity="info",
            event_data={
                "suggestion_id": refreshed.id,
                "box_id": refreshed.box_id,
                "from": previous,
                "to": refreshed.disposition,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        # Only a named submitter in a follow-up box is told: a one-way box
        # reports nothing back, and an anonymous submitter has no address.
        if refreshed.box.follow_up_enabled and refreshed.submitted_by:
            background_tasks.add_task(
                send_suggestion_notice,
                refreshed.organization_id,
                [refreshed.submitted_by],
                submitter_notice(
                    refreshed.box.name, refreshed.id, disposition=refreshed.disposition
                ),
            )
    return await service.reviewer_view(refreshed, str(current_user.id))


@router.post(
    "/review/{suggestion_id}/messages",
    response_model=ReviewSuggestionDetail,
)
async def reply_as_reviewer(
    suggestion_id: str,
    data: MessageCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SuggestionService(db)
    suggestion = await _for_review(service, current_user, suggestion_id)
    async with handle_service_errors("Failed to send reply"):
        await service.add_reviewer_message(suggestion, str(current_user.id), data.body)
    refreshed = await _for_review(service, current_user, suggestion_id)
    if refreshed.submitted_by:
        background_tasks.add_task(
            send_suggestion_notice,
            refreshed.organization_id,
            [refreshed.submitted_by],
            submitter_notice(refreshed.box.name, refreshed.id, disposition=None),
        )
    return await service.reviewer_view(refreshed, str(current_user.id))


async def _for_forwarding(
    service: SuggestionService, current_user: User, suggestion_id: str
) -> Suggestion:
    suggestion = await _for_review(service, current_user, suggestion_id)
    if not await service.is_box_reviewer(
        current_user.organization_id, str(current_user.id), suggestion.box_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Only the box's reviewers can forward or withdraw a forward.",
        )
    return suggestion


@router.post(
    "/review/{suggestion_id}/forwards",
    response_model=ReviewSuggestionDetail,
)
async def forward_suggestion(
    suggestion_id: str,
    data: ForwardCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Make members or positions reviewers of this one suggestion."""
    service = SuggestionService(db)
    suggestion = await _for_forwarding(service, current_user, suggestion_id)
    async with handle_service_errors("Failed to forward submission"):
        new_positions, new_members = await service.add_forwards(
            suggestion, str(current_user.id), data.position_ids, data.member_ids
        )
    if new_positions or new_members:
        await log_audit_event(
            db=db,
            event_type="suggestion_forwarded",
            event_category="suggestions",
            severity="info",
            event_data={
                "suggestion_id": suggestion.id,
                "box_id": suggestion.box_id,
                "position_ids": new_positions,
                "member_ids": new_members,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        recipients = await service.active_member_ids(
            suggestion.organization_id, new_members, new_positions
        )
        background_tasks.add_task(
            send_suggestion_notice,
            suggestion.organization_id,
            [r for r in recipients if r != str(current_user.id)],
            forward_notice(suggestion.box.name, suggestion.id),
        )
    refreshed = await _for_review(service, current_user, suggestion_id)
    return await service.reviewer_view(refreshed, str(current_user.id))


@router.delete(
    "/review/{suggestion_id}/forwards/{forward_id}",
    response_model=ReviewSuggestionDetail,
)
async def withdraw_forward(
    suggestion_id: str,
    forward_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SuggestionService(db)
    suggestion = await _for_forwarding(service, current_user, suggestion_id)
    removed = ensure_found(
        await service.remove_forward(suggestion, forward_id), "Forward"
    )
    await log_audit_event(
        db=db,
        event_type="suggestion_forward_withdrawn",
        event_category="suggestions",
        severity="info",
        event_data={
            "suggestion_id": suggestion.id,
            "box_id": suggestion.box_id,
            "position_id": removed["position_id"],
            "member_id": removed["user_id"],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    refreshed = await _for_review(service, current_user, suggestion_id)
    return await service.reviewer_view(refreshed, str(current_user.id))


@router.get("/review/{suggestion_id}/attachments/{attachment_id}")
async def download_attachment_for_review(
    suggestion_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    suggestion = await _for_review(SuggestionService(db), current_user, suggestion_id)
    return await _serve_attachment(suggestion, attachment_id)


# ---------------------------------------------------------------------------
# Box administration
# ---------------------------------------------------------------------------


@router.get("/admin/boxes", response_model=List[SuggestionBoxAdminResponse])
async def list_boxes_for_admin(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("suggestions.manage")),
):
    return await SuggestionService(db).list_boxes_for_admin(
        current_user.organization_id
    )


@router.get("/admin/reviewer-options", response_model=ReviewerOptions)
async def reviewer_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("suggestions.manage")),
):
    return await SuggestionService(db).reviewer_options(current_user.organization_id)


@router.post("/admin/boxes", response_model=SuggestionBoxAdminResponse, status_code=201)
async def create_box(
    data: SuggestionBoxWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("suggestions.manage")),
):
    async with handle_service_errors("Failed to create suggestion box"):
        box = await SuggestionService(db).create_box(
            current_user.organization_id, data, str(current_user.id)
        )
    await _audit_box(db, current_user, "suggestion_box_created", box)
    return box


@router.put("/admin/boxes/{box_id}", response_model=SuggestionBoxAdminResponse)
async def update_box(
    box_id: str,
    data: SuggestionBoxWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("suggestions.manage")),
):
    async with handle_service_errors("Failed to update suggestion box"):
        box = await SuggestionService(db).update_box(
            current_user.organization_id, box_id, data
        )
    box = ensure_found(box, "Suggestion box")
    await _audit_box(db, current_user, "suggestion_box_updated", box)
    return box


@router.delete("/admin/boxes/{box_id}", status_code=204)
async def delete_box(
    box_id: str,
    confirm_name: Optional[str] = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("suggestions.manage")),
):
    """Delete a box. One holding submissions needs ``confirm_name`` equal to
    its name, and takes every submission with it."""
    service = SuggestionService(db)
    box = ensure_found(
        await service.get_box(current_user.organization_id, box_id), "Suggestion box"
    )
    name = box.name
    try:
        deleted = await service.delete_box(box, confirm_name)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await log_audit_event(
        db=db,
        event_type="suggestion_box_deleted",
        event_category="suggestions",
        # Deleting submissions destroys records; flag it so it stands out.
        severity="warning" if deleted else "info",
        event_data={
            "box_id": box_id,
            "name": name,
            "submissions_deleted": deleted,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )


async def _audit_box(
    db: AsyncSession, current_user: User, event_type: str, box: dict
) -> None:
    # Reviewer changes decide who can read complaints, so the audit entry
    # records the full reviewer set, not just that something changed.
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="suggestions",
        severity="info",
        event_data={
            "box_id": box["id"],
            "name": box["name"],
            "anonymity_mode": box["anonymity_mode"],
            "follow_up_enabled": box["follow_up_enabled"],
            "is_active": box["is_active"],
            "reviewer_position_ids": [p["id"] for p in box["reviewer_positions"]],
            "reviewer_member_ids": [m["id"] for m in box["reviewer_members"]],
            "watcher_position_ids": [p["id"] for p in box["watcher_positions"]],
            "watcher_member_ids": [m["id"] for m in box["watcher_members"]],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
