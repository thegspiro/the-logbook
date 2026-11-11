"""
Documents filed with attendance waiver requests.

A department's policy decides whether a member may, or must, file a document
(a doctor's note, a work schedule) with a request to be excused (owner
decisions, 2026-11-10):

- **PDF, JPEG, PNG or HEIC, up to 10 MB each, at most three per request.**
  The type is the one libmagic detects, never the name or the browser's
  claim, through ``FileStorageService``; HEIC is accepted here and nowhere
  else in the application.
- **Filed by the member**, with the request or while it is pending. Once it is
  decided, withdrawn or voided nothing more can be added.
- **Read by the member and the people who may decide the request**
  (``AttendanceWaiverService.may_decide``), and nobody else: not a former
  decider, not a training officer as such. Every download is audited by id.
- **Kept ``attachment_retention_days`` after the request closes** (a year by
  default). The retention task deletes the files and their rows; the request
  and its decision log stay. Anonymising the member deletes them at once.

The files are stored under ``<org>/attendance-waivers/<request_id>/`` and the
uploader's filename is not kept: a download is always
``waiver-attachment-<n>.<ext>``.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Any, Dict, List, Optional, Sequence

from fastapi import Response
from loguru import logger
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.utils import generate_uuid
from app.models.attendance_waiver import (
    AttendanceWaiverAttachment,
    AttendanceWaiverRequest,
    AttendanceWaiverStatus,
)
from app.models.user import User
from app.schemas.attendance_waiver import MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS
from app.services import file_storage_service as file_storage
from app.services.attendance_waiver_service import (
    TRAINING_WORKFLOW,
    AttendanceWaiverNotFound,
    AttendanceWaiverService,
    attachment_row,
)
from app.services.file_storage_service import (
    FileRules,
    FileStorageService,
    StorageArea,
    StoredFile,
)

AREA = StorageArea.ATTENDANCE_WAIVERS
UPLOAD_KIND = "attendance_waiver_attachment"

# libmagic reports an iPhone photo as image/heic, and a HEIF container whose
# major brand is the generic ``mif1`` as image/heif; both are what a phone
# hands over as "HEIC", so both are taken. Not added to the shared extension
# table in app/utils/mime_validation.py: these rules take the extension from
# the detected type, and no other upload path accepts HEIC.
ATTACHMENT_FILE_RULES = FileRules(
    allowed_types={
        "application/pdf": ".pdf",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/heic": ".heic",
        "image/heif": ".heif",
    },
    max_bytes=MAX_ATTACHMENT_BYTES,
    description="PDF, JPEG, PNG or HEIC",
)


def _now() -> datetime:
    """The current time; a seam the retention tests patch."""
    return datetime.now(dt_timezone.utc)


@dataclass(frozen=True)
class PendingUpload:
    """An upload read into memory and not yet checked or stored."""

    content: bytes
    filename: Optional[str]


class AttendanceWaiverAttachmentService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.engine = AttendanceWaiverService(db)
        self.storage = FileStorageService(db)

    # ------------------------------------------------------------------
    # Reading and storing
    # ------------------------------------------------------------------

    async def read_uploads(self, uploads: Sequence[Any]) -> List[PendingUpload]:
        """Read each ``UploadFile``, refusing one over the size limit without
        buffering past it. More than the limit is refused before any is read."""
        if len(uploads) > MAX_ATTACHMENTS:
            raise ValueError(
                f"At most {MAX_ATTACHMENTS} documents can be filed with a request."
            )
        return [
            PendingUpload(
                content=await self.storage.read_upload(upload, ATTACHMENT_FILE_RULES),
                filename=getattr(upload, "filename", None),
            )
            for upload in uploads
        ]

    async def _store(
        self,
        org_id: str,
        request_id: str,
        member: User,
        pending: Sequence[PendingUpload],
    ) -> List[StoredFile]:
        """Check, scan and write every file, or none: a refusal of the second
        removes the first."""
        stored: List[StoredFile] = []
        try:
            for upload in pending:
                stored.append(
                    await self.storage.store_bytes(
                        upload.content,
                        original_name=upload.filename,
                        organization_id=org_id,
                        area=AREA,
                        rules=ATTACHMENT_FILE_RULES,
                        user=member,
                        record_id=request_id,
                        upload_kind=UPLOAD_KIND,
                    )
                )
        except Exception:
            await _remove_files([f.path for f in stored])
            raise
        return stored

    async def _abandon(
        self, org_id: str, request_id: str, stored: Sequence[StoredFile]
    ) -> None:
        """After a failed write, remove the files no committed row names."""
        try:
            await self.db.rollback()
            kept = set(
                (
                    await self.db.execute(
                        select(AttendanceWaiverAttachment.file_path).where(
                            AttendanceWaiverAttachment.organization_id == org_id,
                            AttendanceWaiverAttachment.request_id == request_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
        except Exception:
            # Unable to tell: keep every file rather than delete one a row
            # may name. An orphan costs disk; a missing file loses evidence.
            logger.exception(
                "Could not check the documents of waiver request {}", request_id
            )
            return
        await _remove_files([f.path for f in stored if f.path not in kept])

    # ------------------------------------------------------------------
    # Submitting with documents, and adding them later
    # ------------------------------------------------------------------

    async def submit(
        self,
        organization_id: str,
        member: User,
        event_id: str,
        category: Optional[str],
        reason: Optional[str],
        uploads: Sequence[Any],
    ) -> AttendanceWaiverRequest:
        """The request and its documents, committed together."""
        org_id = str(organization_id)
        policy = await self.engine.get_policy(org_id)
        # Refused before anything is read or written; the engine checks again
        # once it has assessed the session.
        if uploads:
            AttendanceWaiverService.check_attachments(policy, len(uploads))
        pending = await self.read_uploads(uploads)
        request_id = generate_uuid()
        stored = await self._store(org_id, request_id, member, pending)
        try:
            return await self.engine.submit(
                org_id,
                member,
                event_id,
                category,
                reason,
                request_id=request_id,
                stored=stored,
            )
        except Exception:
            await self._abandon(org_id, request_id, stored)
            raise

    async def add(
        self,
        organization_id: str,
        member: User,
        request_id: str,
        uploads: Sequence[Any],
    ) -> AttendanceWaiverRequest:
        """File more documents with the member's own pending request."""
        org_id = str(organization_id)
        if not uploads:
            raise ValueError("Choose a document to attach.")
        policy = await self.engine.get_policy(org_id)
        request = await self.engine._find(org_id, request_id)
        self._require_open(await self._own(org_id, member, request), member)
        AttendanceWaiverService.check_attachments(
            policy, len(uploads), existing=await self._count(org_id, request_id)
        )
        pending = await self.read_uploads(uploads)
        stored = await self._store(org_id, str(request_id), member, pending)
        try:
            # The member's row, then the request's (the engine's lock order),
            # then a locking count: two uploads at once queue here, and the
            # second counts the first's files (pitfall #27).
            locked = await self.engine._locked_request(org_id, request_id)
            self._require_open(locked, member)
            existing = (
                (
                    await self.db.execute(
                        select(AttendanceWaiverAttachment.ordinal)
                        .where(
                            AttendanceWaiverAttachment.organization_id == org_id,
                            AttendanceWaiverAttachment.request_id == str(locked.id),
                        )
                        .with_for_update()
                    )
                )
                .scalars()
                .all()
            )
            AttendanceWaiverService.check_attachments(
                policy, len(stored), existing=len(existing)
            )
            start = max(existing, default=0) + 1
            try:
                async with self.db.begin_nested():
                    for offset, file in enumerate(stored):
                        self.db.add(
                            attachment_row(locked, start + offset, file, str(member.id))
                        )
                    await self.db.flush()
            except IntegrityError:
                # The unique (request, ordinal) key: the durable half of the
                # three-file limit.
                raise ValueError(
                    "Another document was being filed at the same time. "
                    "Reload the request and try again."
                )
            await log_audit_event(
                db=self.db,
                event_type="attendance_waiver_attachment_added",
                event_category="training",
                severity="info",
                event_data={
                    **AttendanceWaiverService._ids(locked),
                    "attachment_count": len(stored),
                },
                user_id=str(member.id),
                username=member.username,
            )
            await self.db.commit()
        except Exception:
            await self._abandon(org_id, str(request_id), stored)
            raise
        await self.db.refresh(locked)
        return locked

    async def _own(
        self, org_id: str, member: User, request: Optional[AttendanceWaiverRequest]
    ) -> AttendanceWaiverRequest:
        if request is None:
            raise AttendanceWaiverNotFound("Request not found")
        if str(request.user_id) != str(member.id):
            if await self.engine._may_view(org_id, member, request):
                raise PermissionError(
                    "Only the member who asked can file documents with it."
                )
            raise AttendanceWaiverNotFound("Request not found")
        return request

    @staticmethod
    def _require_open(request: AttendanceWaiverRequest, member: User) -> None:
        if str(request.user_id) != str(member.id):
            raise AttendanceWaiverNotFound("Request not found")
        if request.status != AttendanceWaiverStatus.PENDING:
            raise ValueError(
                "Documents can only be filed while the request is pending."
            )

    async def _count(self, org_id: str, request_id: str) -> int:
        return int(
            (
                await self.db.execute(
                    select(func.count(AttendanceWaiverAttachment.id)).where(
                        AttendanceWaiverAttachment.organization_id == org_id,
                        AttendanceWaiverAttachment.request_id == str(request_id),
                    )
                )
            ).scalar_one()
            or 0
        )

    # ------------------------------------------------------------------
    # Downloading
    # ------------------------------------------------------------------

    async def download(
        self, organization_id: str, viewer: User, request_id: str, attachment_id: str
    ) -> Response:
        """The file, for the member or someone who may decide the request.

        404 for anyone who may not see the request at all; 403 for someone who
        may see it but not open its documents (a former decider who no longer
        holds the position).
        """
        org_id = str(organization_id)
        request = await self.engine._find(org_id, request_id)
        if request is None:
            raise AttendanceWaiverNotFound("Request not found")
        own = str(request.user_id) == str(viewer.id)
        if not own:
            policy = await self.engine.get_policy(org_id)
            if not await self.engine.may_decide(viewer, request, policy):
                if await self.engine._may_view(org_id, viewer, request):
                    raise PermissionError(
                        "Only the member and the people who decide this "
                        "request can open its documents."
                    )
                raise AttendanceWaiverNotFound("Request not found")
        attachment: Optional[AttendanceWaiverAttachment] = (
            await self.db.execute(
                select(AttendanceWaiverAttachment).where(
                    AttendanceWaiverAttachment.id == str(attachment_id),
                    AttendanceWaiverAttachment.request_id == str(request.id),
                    AttendanceWaiverAttachment.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if attachment is None:
            raise AttendanceWaiverNotFound("Document not found")
        path = file_storage.resolve(attachment.file_path, org_id, AREA)
        if path is None:
            logger.warning(
                "Refused to serve waiver document {}: its stored path is "
                "outside the organization's storage",
                attachment.id,
            )
            raise AttendanceWaiverNotFound("Document not found")
        if not await file_storage.exists(path):
            raise AttendanceWaiverNotFound("Document not found")
        filename = attachment.download_name
        media_type = attachment.mime_type or "application/octet-stream"
        # Ids only: who opened which file of whose request, never its name
        # or contents (#33).
        await log_audit_event(
            db=self.db,
            event_type="attendance_waiver_attachment_downloaded",
            event_category="training",
            severity="info",
            event_data={
                "request_id": str(request.id),
                "attachment_id": str(attachment.id),
                "member_id": str(request.user_id),
            },
            user_id=str(viewer.id),
            username=viewer.username,
        )
        await self.db.commit()
        response = await file_storage.file_response(
            path, filename=filename, media_type=media_type
        )
        # Often medical: never kept by a browser or a shared proxy.
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
        return response

    # ------------------------------------------------------------------
    # Retention
    # ------------------------------------------------------------------

    async def sweep(self, now: Optional[datetime] = None) -> Dict[str, Any]:
        """Delete every department's documents past its retention period.

        A request's clock starts when it closes: its decision, or, for one
        withdrawn or voided without a decision, its last change. Pending
        requests are never swept.

        Idempotent (pitfall #36): the file is deleted first and the row after,
        and a file already missing counts as deleted. A crash between the two
        leaves a row naming a missing file, which the next run deletes; a
        file whose delete fails keeps its row, so the next run tries again.
        Nothing is written for an organization with nothing due.
        """
        now = now or _now()
        results: Dict[str, Any] = {
            "orgs_processed": 0,
            "files_deleted": 0,
            "requests_cleared": 0,
            "errors": [],
        }
        # Plain values, read before the loop: a rollback for one organization
        # expires every ORM object in the session.
        org_ids = [
            str(o)
            for o in (
                await self.db.execute(
                    select(AttendanceWaiverAttachment.organization_id).distinct()
                )
            )
            .scalars()
            .all()
        ]
        for org_id in org_ids:
            try:
                policy = await self.engine.get_policy(org_id)
                days = policy.attachment_retention_days
                outcome = await self._sweep_org(org_id, now - timedelta(days=days))
                if outcome["attachment_ids"]:
                    await log_audit_event(
                        db=self.db,
                        event_type="attendance_waiver_attachment_retention",
                        event_category="training",
                        severity="info",
                        event_data={
                            "retention_days": days,
                            "request_ids": outcome["request_ids"],
                            "attachment_ids": outcome["attachment_ids"],
                        },
                        organization_id=org_id,
                    )
                await self.db.commit()
                results["orgs_processed"] += 1
                results["files_deleted"] += len(outcome["attachment_ids"])
                results["requests_cleared"] += len(outcome["request_ids"])
                if outcome["failed"]:
                    results["errors"].append(
                        {"org_id": org_id, "files_not_deleted": outcome["failed"]}
                    )
            except Exception as exc:
                logger.error(
                    "Waiver document retention failed for org {}: {}", org_id, exc
                )
                results["errors"].append({"org_id": org_id, "error": str(exc)})
                await self.db.rollback()
        return results

    async def _sweep_org(self, org_id: str, cutoff: datetime) -> Dict[str, Any]:
        closed_at = func.coalesce(
            AttendanceWaiverRequest.decided_at,
            AttendanceWaiverRequest.updated_at,
            AttendanceWaiverRequest.submitted_at,
        )
        # Naive UTC for the comparison: MySQL DATETIME holds no zone.
        naive_cutoff = cutoff.astimezone(dt_timezone.utc).replace(tzinfo=None)
        rows = (
            await self.db.execute(
                select(
                    AttendanceWaiverAttachment.id,
                    AttendanceWaiverAttachment.request_id,
                    AttendanceWaiverAttachment.file_path,
                )
                .join(
                    AttendanceWaiverRequest,
                    AttendanceWaiverRequest.id == AttendanceWaiverAttachment.request_id,
                )
                .where(
                    AttendanceWaiverAttachment.organization_id == org_id,
                    AttendanceWaiverRequest.organization_id == org_id,
                    # The training policy's period; no other workflow files
                    # documents yet.
                    AttendanceWaiverRequest.workflow == TRAINING_WORKFLOW,
                    AttendanceWaiverRequest.status != AttendanceWaiverStatus.PENDING,
                    closed_at < naive_cutoff,
                )
                .order_by(AttendanceWaiverAttachment.id)
            )
        ).all()
        deleted: List[str] = []
        requests: set[str] = set()
        failed = 0
        for attachment_id, request_id, stored_path in rows:
            path = file_storage.resolve(stored_path, org_id, AREA)
            if path is None:
                # Not a file this area may delete: leave the row for a person
                # to look at rather than claim the file is gone.
                logger.warning(
                    "Waiver document {} names a path outside the "
                    "organization's storage; left in place",
                    attachment_id,
                )
                failed += 1
                continue
            if not await file_storage.delete(path):
                failed += 1
                continue
            await self.db.execute(
                delete(AttendanceWaiverAttachment).where(
                    AttendanceWaiverAttachment.id == attachment_id,
                    AttendanceWaiverAttachment.organization_id == org_id,
                )
            )
            deleted.append(str(attachment_id))
            requests.add(str(request_id))
        return {
            "attachment_ids": deleted,
            "request_ids": sorted(requests),
            "failed": failed,
        }


async def remove_member_attachments(db: AsyncSession, user: User) -> int:
    """Delete every document filed with the member's requests, files first.

    For anonymisation: the requests stay (they are the record that a session
    was excused, and grading reads them), the documents about the member do
    not. A file that cannot be deleted is logged and its row still goes, as
    anonymisation does with applicant documents: the member's link to it is
    what must not survive.
    """
    org_id = str(user.organization_id)
    rows = (
        await db.execute(
            select(AttendanceWaiverAttachment.id, AttendanceWaiverAttachment.file_path)
            .join(
                AttendanceWaiverRequest,
                AttendanceWaiverRequest.id == AttendanceWaiverAttachment.request_id,
            )
            .where(
                AttendanceWaiverRequest.user_id == str(user.id),
                AttendanceWaiverRequest.organization_id == org_id,
                AttendanceWaiverAttachment.organization_id == org_id,
            )
        )
    ).all()
    for _attachment_id, stored_path in rows:
        await file_storage.delete_quietly(
            file_storage.resolve(stored_path, org_id, AREA)
        )
    if rows:
        await db.execute(
            delete(AttendanceWaiverAttachment).where(
                AttendanceWaiverAttachment.organization_id == org_id,
                AttendanceWaiverAttachment.id.in_([str(r[0]) for r in rows]),
            )
        )
    return len(rows)


async def _remove_files(paths: Sequence[str]) -> None:
    for path in paths:
        await file_storage.delete_quietly(path)
