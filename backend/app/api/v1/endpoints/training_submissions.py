"""
Training Submissions API Endpoints

Handles self-reported training from members, officer review/approval,
and self-report configuration management.
"""

import asyncio
import os
import uuid as uuid_lib
from datetime import datetime, timezone

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
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_permission,
)
from app.api.v1.endpoints.training_enhancements import TRAINING_ATTACHMENT_DIR
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.core.utils import ensure_found, handle_service_errors, safe_error_detail
from app.models.training import SubmissionStatus, TrainingSubmission
from app.models.user import User
from app.schemas.training_submission import (
    SelfReportConfigResponse,
    SelfReportConfigUpdate,
    SubmissionReviewRequest,
    TrainingSubmissionCreate,
    TrainingSubmissionResponse,
    TrainingSubmissionUpdate,
    sanitize_attachments,
)
from app.services.training_submission_service import TrainingSubmissionService
from app.utils.mime_validation import detect_mime_type
from app.utils.upload_limits import read_upload_limited

router = APIRouter()


# ==================== Self-Report Configuration ====================


@router.get("/config", response_model=SelfReportConfigResponse)
async def get_self_report_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get self-report configuration for the organization."""
    service = TrainingSubmissionService(db)
    config = await service.get_config(current_user.organization_id)
    return config


@router.put("/config", response_model=SelfReportConfigResponse)
async def update_self_report_config(
    updates: SelfReportConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Update self-report configuration (training officers only)."""
    service = TrainingSubmissionService(db)
    config = await service.update_config(
        organization_id=current_user.organization_id,
        updated_by=current_user.id,
        **updates.model_dump(exclude_unset=True),
    )
    return config


# ==================== Member Submissions ====================


@router.post("", response_model=TrainingSubmissionResponse, status_code=201)
async def create_submission(
    data: TrainingSubmissionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit self-reported training. Any authenticated member can submit."""
    service = TrainingSubmissionService(db)
    async with handle_service_errors("Failed to create submission"):
        submission = await service.create_submission(
            organization_id=current_user.organization_id,
            submitted_by=current_user.id,
            **data.model_dump(exclude_unset=True),
        )
        return submission


@router.post(
    "/with-attachment",
    response_model=TrainingSubmissionResponse,
    status_code=201,
)
async def create_submission_with_attachment(
    payload: str = Form(..., description="TrainingSubmissionCreate as a JSON string"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a submission with its certificate in one step.

    Uploading after the fact cannot work for a submission the department
    auto-approves: it is frozen the moment it exists, and its training record
    has already been copied from it. Attaching here means the evidence is part
    of the row that routing and record creation see, in the same transaction.
    """
    try:
        data = TrainingSubmissionCreate.model_validate_json(payload)
    except ValidationError as e:
        # Re-raised as the framework's own error rather than answered here: a
        # custom validator's ctx carries the raw ValueError, which the JSON
        # response cannot serialize — the 422 would render as a 500. Going
        # through RequestValidationError also gives this endpoint the same
        # {field, message} body as every other validation failure in the app.
        raise RequestValidationError(e.errors()) from e

    stored = await _store_attachment_file(file, current_user)

    service = TrainingSubmissionService(db)
    async with handle_service_errors("Failed to create submission"):
        try:
            submission = await service.create_submission(
                organization_id=current_user.organization_id,
                submitted_by=current_user.id,
                attachments=[stored],
                **data.model_dump(exclude_unset=True, exclude={"attachments"}),
            )
        except (ValueError, PermissionError):
            # The service raises these before it writes anything — hours out of
            # range, a training type the department disallows — so the row
            # never landed and the bytes on disk belong to nothing.
            #
            # Deliberately narrow. Anything else may have failed *after* the
            # commit (a refresh that trips on a dropped connection), where the
            # submission — and for an auto-approved one its training record —
            # durably references this path. An orphaned file is recoverable;
            # a record whose evidence was deleted out from under it is not.
            await asyncio.to_thread(_remove_quietly, stored["file_path"])
            raise
        return submission


@router.get("/my", response_model=list[TrainingSubmissionResponse])
async def get_my_submissions(
    status: str | None = Query(None, description="Filter by status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's training submissions."""
    service = TrainingSubmissionService(db)
    submissions = await service.get_submissions(
        organization_id=current_user.organization_id,
        user_id=current_user.id,
        status=status,
    )
    return submissions


@router.get("/pending", response_model=list[TrainingSubmissionResponse])
async def get_pending_submissions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get all pending submissions for review (training officers only)."""
    service = TrainingSubmissionService(db)
    submissions = await service.get_submissions(
        organization_id=current_user.organization_id,
        status="pending_review",
    )
    return submissions


@router.get("/pending/count")
async def get_pending_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get count of pending submissions (for badge/notification)."""
    service = TrainingSubmissionService(db)
    count = await service.get_pending_count(current_user.organization_id)
    return {"pending_count": count}


@router.get("/all", response_model=list[TrainingSubmissionResponse])
async def get_all_submissions(
    status: str | None = Query(None, description="Filter by status"),
    user_id: str | None = Query(None, description="Filter by user"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Get all submissions (training officers only)."""
    service = TrainingSubmissionService(db)
    submissions = await service.get_submissions(
        organization_id=current_user.organization_id,
        user_id=user_id,
        status=status,
        limit=limit,
        offset=offset,
        # A draft is a member's unfinished note to themselves, not something
        # they have handed to the department — it stays out of the officer
        # queue unless an officer explicitly asks for that status.
        exclude_statuses=None if status else [SubmissionStatus.DRAFT.value],
    )
    return submissions


@router.get("/{submission_id}", response_model=TrainingSubmissionResponse)
async def get_submission(
    submission_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific submission. Members can see their own; officers can see all."""
    service = TrainingSubmissionService(db)
    # Org boundary enforced in the service query (404 hides cross-org
    # existence), then authorization: members may see only their own
    # submission; officers (training.manage) may see any in their org.
    # A same-org non-owner without the permission must be rejected —
    # submissions can carry PHI.
    submission = ensure_found(
        await service.get_submission(submission_id, current_user.organization_id),
        "Submission",
    )

    if submission.submitted_by != current_user.id and not _has_permission(
        "training.manage", _collect_user_permissions(current_user)
    ):
        raise HTTPException(
            status_code=403, detail="Not authorized to view this submission"
        )

    return submission


@router.patch("/{submission_id}", response_model=TrainingSubmissionResponse)
async def update_submission(
    submission_id: str,
    updates: TrainingSubmissionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a submission (only by submitter, before approval)."""
    service = TrainingSubmissionService(db)
    async with handle_service_errors("Failed to update submission"):
        submission = await service.update_submission(
            submission_id=submission_id,
            user_id=current_user.id,
            organization_id=current_user.organization_id,
            **updates.model_dump(exclude_unset=True),
        )
        return submission


@router.delete("/{submission_id}", status_code=204)
async def delete_submission(
    submission_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a submission (only by submitter, before approval)."""
    service = TrainingSubmissionService(db)
    async with handle_service_errors("Failed to delete submission"):
        # Collected before the row goes: a withdrawn submission's certificate
        # can carry PHI, and deleting only the row leaves the file in the
        # uploads volume — and in its backups — indefinitely.
        #
        # Safe only because a submission is deletable in draft, pending_review
        # and revision_requested alone — never after approval, the one state
        # where a TrainingRecord also points at these files. Widen that guard
        # in the service and this unlink has to go, or an approved member's
        # evidence vanishes from their training record.
        submission = await service.get_submission(
            submission_id, current_user.organization_id
        )
        stored_paths = (
            _confined_attachment_paths(submission.attachments) if submission else []
        )

        await service.delete_submission(
            submission_id, current_user.id, current_user.organization_id
        )

        for path in stored_paths:
            await asyncio.to_thread(_remove_quietly, path)


# ==================== Officer Review ====================


@router.post("/{submission_id}/review", response_model=TrainingSubmissionResponse)
async def review_submission(
    submission_id: str,
    review: SubmissionReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Review a submission: approve, reject, or request revision."""
    service = TrainingSubmissionService(db)
    wants_apply = bool(
        review.action == "approve"
        and review.apply_to_program_id
        and review.apply_to_requirement_id
    )

    async with handle_service_errors("Failed to review submission"):
        from app.services.training_program_service import TrainingProgramService

        program_service = TrainingProgramService(db)

        # Validate the pipeline target BEFORE approving, so an invalid choice is
        # rejected up front with nothing changed — never "approved but couldn't
        # apply". get_submission gives us the member without mutating anything.
        if wants_apply:
            preview = await service.get_submission(
                submission_id, current_user.organization_id
            )
            if not preview:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found"
                )
            ok, apply_error = await program_service.validate_apply_target(
                user_id=preview.submitted_by,
                organization_id=current_user.organization_id,
                program_id=review.apply_to_program_id,
                requirement_id=review.apply_to_requirement_id,
                completed_on=preview.completion_date,
            )
            if not ok:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=apply_error
                )

        submission = await service.review_submission(
            submission_id=submission_id,
            reviewer_id=current_user.id,
            organization_id=current_user.organization_id,
            action=review.action,
            reviewer_notes=review.reviewer_notes,
            override_hours=review.override_hours,
            override_credit_hours=review.override_credit_hours,
            override_training_type=review.override_training_type,
        )

        # Re-check the result of the actual apply: the target can change after
        # the pre-flight validation (for example, if an enrollment is removed).
        if wants_apply:
            applied, apply_error = await program_service.apply_training_to_requirement(
                user_id=submission.submitted_by,
                organization_id=current_user.organization_id,
                program_id=review.apply_to_program_id,
                requirement_id=review.apply_to_requirement_id,
                hours=float(submission.hours_completed or 0),
                verified_by=current_user.id,
                source_id=str(submission_id),
                completed_on=submission.completion_date,
            )
            if not applied:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=apply_error
                )
            await log_audit_event(
                db=db,
                event_type="training_submission_applied_to_requirement",
                event_category="training",
                severity="info",
                event_data={
                    "submission_id": str(submission_id),
                    "target_user_id": str(submission.submitted_by),
                    "program_id": str(review.apply_to_program_id),
                    "requirement_id": str(review.apply_to_requirement_id),
                },
                user_id=str(current_user.id),
                username=current_user.username,
            )

        return submission


@router.post(
    "/{submission_id}/reverse-approval",
    response_model=TrainingSubmissionResponse,
)
async def reverse_submission_approval(
    submission_id: str,
    reason: str | None = Query(
        default=None, description="Why the approval is being reversed (audit trail)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Reverse a mistaken approval: void the spawned record, un-apply any
    pipeline credit, and return the submission to pending review."""
    service = TrainingSubmissionService(db)
    async with handle_service_errors("Failed to reverse submission approval"):
        submission = await service.reverse_approval(
            submission_id=submission_id,
            reviewer_id=current_user.id,
            organization_id=current_user.organization_id,
            reason=reason,
        )
        await log_audit_event(
            db=db,
            event_type="training_submission_approval_reversed",
            event_category="training",
            severity="warning",
            event_data={"submission_id": str(submission_id), "reason": reason},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return submission


# ==================== Draft Submission ====================


@router.post("/{submission_id}/submit", response_model=TrainingSubmissionResponse)
async def submit_draft(
    submission_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hand a saved draft to the department (submitter only)."""
    service = TrainingSubmissionService(db)
    async with handle_service_errors("Failed to submit draft"):
        submission = await service.submit_draft(
            submission_id=submission_id,
            user_id=current_user.id,
            organization_id=current_user.organization_id,
        )
        return submission


# ==================== Certificate Attachments ====================


# A member attaches proof of the training they are reporting — a certificate
# PDF or, far more often, a phone photo of a paper card. MIME type is verified
# from the file's magic bytes, never the client-supplied Content-Type.
#
# Nested *inside* the training-record attachment root on purpose: approval
# copies these attachment dicts verbatim onto the TrainingRecord, and the
# record download route confines paths to TRAINING_ATTACHMENT_DIR. A sibling
# directory would leave every approved member's certificate 404ing from their
# own training history. tests/test_training_submission_drafts_attachments.py
# asserts the nesting so a later tidy-up cannot quietly break it.
SUBMISSION_ATTACHMENT_DIR = os.path.join(
    TRAINING_ATTACHMENT_DIR, "self_reported_submissions"
)
ALLOWED_SUBMISSION_ATTACHMENT_MIME = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}
MAX_SUBMISSION_ATTACHMENT_BYTES = 10 * 1024 * 1024
# Statuses in which the submitter may still change what they sent. Mirrors the
# service's edit/delete guard: once an officer has ruled, the evidence is
# frozen with the decision.
EDITABLE_SUBMISSION_STATUSES = (
    SubmissionStatus.DRAFT,
    SubmissionStatus.PENDING_REVIEW,
    SubmissionStatus.REVISION_REQUESTED,
)


async def _load_submission_for_attachment(
    db: AsyncSession,
    submission_id: str,
    current_user: User,
) -> TrainingSubmission:
    """Fetch a submission in the caller's org, enforcing attachment access.

    The submitter may read their own attachments; everyone else needs
    ``training.manage`` — a certificate can carry PHI, so a same-org member
    without the permission is refused like any other reader.
    """
    service = TrainingSubmissionService(db)
    submission = ensure_found(
        await service.get_submission(submission_id, current_user.organization_id),
        "Submission",
    )

    if str(submission.submitted_by) != str(current_user.id) and not _has_permission(
        "training.manage", _collect_user_permissions(current_user)
    ):
        raise HTTPException(
            status_code=403,
            detail="Not authorized to access this submission's attachments.",
        )
    return submission


def _remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _confined_path(attachment) -> str | None:
    """Real path of a stored attachment, or None if it escapes the root.

    file_path is server-generated, but the column is client-writable through
    the create/update schemas — this is what keeps that from becoming an
    arbitrary file read (or, on delete, an arbitrary unlink).
    """
    if not isinstance(attachment, dict) or not attachment.get("file_path"):
        return None
    real_path = os.path.realpath(attachment["file_path"])
    attachment_root = os.path.realpath(SUBMISSION_ATTACHMENT_DIR)
    if not real_path.startswith(attachment_root + os.sep):
        return None
    return real_path


def _confined_attachment_paths(attachments) -> list[str]:
    paths = [_confined_path(a) for a in attachments or []]
    return [path for path in paths if path]


async def _store_attachment_file(file: UploadFile, current_user: User) -> dict:
    """Validate an upload and write it under the org's attachment directory.

    MIME type comes from the file's magic bytes, never the client-supplied
    Content-Type, and the stored name is server-generated with a magic-derived
    extension so a double extension (cert.pdf.exe) cannot survive the trip.
    """
    try:
        content = await read_upload_limited(file, MAX_SUBMISSION_ATTACHMENT_BYTES)
    except ValueError:
        raise CodedHTTPException(
            status_code=400,
            detail="File too large. Maximum size is 10MB.",
            error_code=ErrorCode.UPLD_TOO_LARGE,
        )

    try:
        detected_mime = detect_mime_type(content)
    except RuntimeError:
        raise CodedHTTPException(
            status_code=503,
            detail="File validation is unavailable. Please try again later.",
            error_code=ErrorCode.UPLD_VALIDATION_UNAVAILABLE,
        )

    ext = ALLOWED_SUBMISSION_ATTACHMENT_MIME.get(detected_mime)
    if not ext:
        raise CodedHTTPException(
            status_code=400,
            detail=(
                f"File type not allowed (detected: {detected_mime}). "
                "Allowed: PDF, JPG, or PNG."
            ),
            error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
        )

    org_dir = os.path.join(SUBMISSION_ATTACHMENT_DIR, str(current_user.organization_id))
    await asyncio.to_thread(os.makedirs, org_dir, exist_ok=True)
    stored_name = f"{uuid_lib.uuid4().hex}{ext}"
    file_path = os.path.join(org_dir, stored_name)

    def _write_file(path: str, data: bytes) -> None:
        with open(path, "wb") as handle:
            handle.write(data)

    await asyncio.to_thread(_write_file, file_path, content)

    return {
        "file_name": file.filename or stored_name,
        "file_path": file_path,
        "file_type": detected_mime,
        "file_size": len(content),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": str(current_user.id),
    }


@router.post("/{submission_id}/attachments")
async def upload_submission_attachment(
    submission_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Attach a certificate or photo to a submission (submitter only)."""
    submission = await _load_submission_for_attachment(db, submission_id, current_user)

    if str(submission.submitted_by) != str(current_user.id):
        raise HTTPException(
            status_code=403,
            detail="Only the submitter can attach a certificate.",
        )

    if submission.status not in EDITABLE_SUBMISSION_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Cannot attach to a submission that has been approved or rejected.",
        )

    attachment = await _store_attachment_file(file, current_user)

    # Plain JSON column — reassign rather than append in place so SQLAlchemy
    # detects the change (CLAUDE.md pitfall #12).
    submission.attachments = list(submission.attachments or []) + [attachment]
    flag_modified(submission, "attachments")

    try:
        await db.commit()
        await db.refresh(submission)
    except Exception as e:
        await asyncio.to_thread(_remove_quietly, attachment["file_path"])
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    return {
        "submission_id": submission_id,
        "attachments": sanitize_attachments(submission.attachments),
    }


@router.get("/{submission_id}/attachments")
async def get_submission_attachments(
    submission_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List a submission's attachments (metadata only, no file paths)."""
    submission = await _load_submission_for_attachment(db, submission_id, current_user)
    return {
        "submission_id": submission_id,
        "attachments": sanitize_attachments(submission.attachments),
    }


@router.get("/{submission_id}/attachments/{index}/download")
async def download_submission_attachment(
    submission_id: str,
    index: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream one stored attachment by its index."""
    from fastapi.responses import FileResponse

    submission = await _load_submission_for_attachment(db, submission_id, current_user)
    attachments = submission.attachments or []
    if index < 0 or index >= len(attachments):
        raise HTTPException(status_code=404, detail="Attachment not found")

    attachment = attachments[index]
    real_path = _confined_path(attachment)
    if not real_path:
        raise HTTPException(status_code=404, detail="Attachment file not found")

    if not await asyncio.to_thread(os.path.isfile, real_path):
        raise HTTPException(status_code=404, detail="Attachment file not found")

    return FileResponse(
        real_path,
        media_type=attachment.get("file_type") or "application/octet-stream",
        filename=attachment.get("file_name") or os.path.basename(real_path),
    )


@router.delete("/{submission_id}/attachments/{index}", status_code=204)
async def delete_submission_attachment(
    submission_id: str,
    index: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove an attachment the member added (submitter only, before a ruling)."""
    submission = await _load_submission_for_attachment(db, submission_id, current_user)

    if str(submission.submitted_by) != str(current_user.id):
        raise HTTPException(
            status_code=403,
            detail="Only the submitter can remove an attachment.",
        )

    if submission.status not in EDITABLE_SUBMISSION_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Cannot change attachments after a decision has been made.",
        )

    attachments = list(submission.attachments or [])
    if index < 0 or index >= len(attachments):
        raise HTTPException(status_code=404, detail="Attachment not found")

    removed = attachments.pop(index)

    # Removing the last one would leave a filed submission sitting in the
    # review queue with no evidence behind it, which is the state the
    # department's `attachments: required` setting exists to prevent. A draft
    # is not in front of anybody yet, so it may be emptied freely.
    if submission.status != SubmissionStatus.DRAFT:
        try:
            await TrainingSubmissionService(db).assert_evidence_requirement(
                current_user.organization_id, attachments
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    submission.attachments = attachments
    flag_modified(submission, "attachments")
    await db.commit()

    removed_path = _confined_path(removed)
    if removed_path:
        await asyncio.to_thread(_remove_quietly, removed_path)
