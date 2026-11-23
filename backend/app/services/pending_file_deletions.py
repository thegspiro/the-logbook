"""Durable removal of the stored files a committed delete left behind.

A permanent member delete cascades away the rows that named the member's
files, so the files can only go after its commit. Deleting them straight
after the commit leaves a window: a process killed, or a remote store
unreachable, between the two loses the only record of which files to remove.
So the delete queues them (:func:`enqueue`) in its own transaction, the
endpoint removes them right after the commit (:func:`process`), and the
hourly :class:`PendingFileDeletionSweep` retries whatever is left.

Safe to run twice (pitfall #36). The row id is the idempotency key: rows are
claimed ``FOR UPDATE SKIP LOCKED``, so the endpoint and a sweep, or two
sweeps in workers that both ran the scheduler (the no-Redis fallback), never
work the same row at once, and every row write is a Core statement whose
affected count says whether this run resolved it. The side effect is
idempotent too: deleting a file that is already gone counts as deleted.
"""

from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Collection, Iterable, Mapping, Optional

from loguru import logger
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.utils import generate_uuid
from app.models.pending_file_deletion import PendingDeletionReason, PendingFileDeletion
from app.services import file_storage_service as file_storage
from app.services import member_files
from app.services.file_storage_service import StorageArea
from app.services.member_files import FileRemoval
from app.utils.sql_results import rows_affected

#: A row still failing after this many hourly attempts is logged as a
#: warning on every run. It is never dropped: an orphan nobody records is the
#: failure this table exists to prevent.
WARN_AFTER_ATTEMPTS = 24

_NOT_CONFINED = "path no longer confined"
_DELETE_FAILED = "storage delete failed"


def enqueue(
    db: AsyncSession,
    organization_id: str,
    paths_by_area: Mapping[str, StorageArea],
    reason: PendingDeletionReason,
) -> list[str]:
    """Queue *paths_by_area* for removal; return the new rows' ids.

    Only adds to the session: the rows are written by the caller's commit,
    in the same transaction as the delete, so a refused or rolled-back
    delete leaves none. Ids are assigned here so they exist without a flush.
    """
    ids: list[str] = []
    for path, area in sorted(paths_by_area.items()):
        row_id = generate_uuid()
        db.add(
            PendingFileDeletion(
                id=row_id,
                organization_id=str(organization_id),
                path=path,
                area=area.value,
                reason=reason.value,
            )
        )
        ids.append(row_id)
    return ids


async def process(
    db: AsyncSession,
    organization_id: str,
    ids: Iterable[str],
    *,
    areas: Optional[Collection[StorageArea]] = None,
) -> FileRemoval:
    """Remove the files the rows *ids* name, and resolve those rows.

    Never raises ``Exception`` and never commits: the caller commits the row
    resolutions with its own audit record. The work runs in a savepoint, so a
    failure discards only this call's row writes and leaves the session
    usable for that audit record; the rows stay queued. *areas*, when given,
    must hold every area the rows lie in; it narrows the reference check as
    in :func:`member_files.referenced_elsewhere`, so a member-facing request
    does not read the department's documents, events and minutes.
    """
    wanted = [str(row_id) for row_id in ids]
    if not wanted:
        return FileRemoval()
    try:
        async with db.begin_nested():
            return await _process(db, str(organization_id), wanted, areas)
    except Exception:
        logger.exception(
            "Could not process pending file deletions for organization {}",
            organization_id,
        )
        return FileRemoval(not_deleted=len(wanted))


@dataclass(frozen=True)
class _Claimed:
    id: str
    organization_id: str
    path: str
    area: str
    attempts: int


async def _process(
    db: AsyncSession,
    org_id: str,
    ids: list[str],
    areas: Optional[Collection[StorageArea]] = None,
) -> FileRemoval:
    rows = [
        _Claimed(r.id, r.organization_id, r.path, r.area, r.attempts)
        for r in (
            await db.execute(
                select(
                    PendingFileDeletion.id,
                    PendingFileDeletion.organization_id,
                    PendingFileDeletion.path,
                    PendingFileDeletion.area,
                    PendingFileDeletion.attempts,
                ).where(
                    PendingFileDeletion.id.in_(ids),
                    PendingFileDeletion.organization_id == org_id,
                )
                # Another run holding a row is working it; skip rather than
                # wait, and leave it to that run.
                .with_for_update(skip_locked=True)
            )
        ).all()
    ]
    if not rows:
        return FileRemoval()

    try:
        # Looked up on the module at call time, so a test patching
        # member_files.referenced_elsewhere reaches this caller too.
        shared = await member_files.referenced_elsewhere(
            db, org_id, {row.path for row in rows}, set(), areas=areas
        )
    except Exception:
        # Unable to tell, keep every file: an orphan costs disk, while a
        # deleted file another record needs loses evidence. The rows stay.
        logger.exception(
            "Could not check file references for pending deletions in {}", org_id
        )
        return FileRemoval(not_deleted=len(rows))

    deleted = not_deleted = shared_kept = 0
    for row in rows:
        try:
            confined = file_storage.resolve(
                row.path, row.organization_id, StorageArea(row.area)
            )
        except ValueError:
            confined = None
        if confined is None:
            # Never delete what no longer confines to its organization's
            # area (a moved uploads root, a tampered row). Left for an
            # operator, with the reason.
            await _record_failure(db, row, _NOT_CONFINED)
            not_deleted += 1
            continue
        if confined in shared:
            if await _resolve(db, row):
                shared_kept += 1
            continue
        try:
            gone = await file_storage.delete(confined)
        except Exception:
            # delete() reports rather than raises, but a remote store's
            # client is not this module's to vouch for.
            logger.exception("Could not remove the file of pending deletion {}", row.id)
            gone = False
        if not gone:
            await _record_failure(db, row, _DELETE_FAILED)
            not_deleted += 1
            continue
        # File first, then its row: at least once. A crash between the two
        # leaves a row whose next run finds the file gone, which counts as
        # deleted, and resolves it.
        if await _resolve(db, row):
            deleted += 1
    return FileRemoval(
        deleted=deleted, not_deleted=not_deleted, shared_kept=shared_kept
    )


async def _resolve(db: AsyncSession, row: _Claimed) -> bool:
    result = await db.execute(
        delete(PendingFileDeletion).where(
            PendingFileDeletion.id == row.id,
            PendingFileDeletion.organization_id == row.organization_id,
        )
    )
    # 0 means an earlier run already resolved it; that run counted it.
    return (rows_affected(result) or 0) == 1


async def _record_failure(db: AsyncSession, row: _Claimed, reason: str) -> None:
    await db.execute(
        update(PendingFileDeletion)
        .where(
            PendingFileDeletion.id == row.id,
            PendingFileDeletion.organization_id == row.organization_id,
        )
        .values(
            attempts=PendingFileDeletion.attempts + 1,
            last_attempt_at=func.now(),
            last_error=reason,
        )
    )
    if row.attempts + 1 >= WARN_AFTER_ATTEMPTS:
        logger.warning(
            "Pending file deletion {} has failed {} times ({})",
            row.id,
            row.attempts + 1,
            reason,
        )


class PendingFileDeletionSweep:
    """The hourly retry of every row a crash or a failed delete left."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def run(
        self, *, max_rows: int = 500, grace_seconds: int = 600
    ) -> dict[str, Any]:
        """Process up to *max_rows* rows older than *grace_seconds*.

        The grace keeps the sweep off rows the endpoint is about to process
        right after its commit; the row lock is what makes an overlap safe.
        Departments are swept whether active or not: this is deletion the
        department already decided, not a notification.
        """
        results: dict[str, Any] = {
            "task": "pending_file_deletions",
            "deleted": 0,
            "shared_kept": 0,
            "still_pending": 0,
            "errors": [],
        }
        # Age measured by the database, against the same clock that stamped
        # created_at; the grace is a bound parameter.
        age = func.timestampdiff(
            text("SECOND"), PendingFileDeletion.created_at, func.now()
        )
        # Plain values, read before the loop: a rollback for one organization
        # expires every ORM object in the session.
        due = (
            await self.db.execute(
                select(PendingFileDeletion.id, PendingFileDeletion.organization_id)
                .where(age >= int(grace_seconds))
                # Never-attempted rows first: MySQL sorts NULL first in an
                # ascending order, and has no NULLS FIRST syntax.
                .order_by(
                    PendingFileDeletion.last_attempt_at.asc(),
                    PendingFileDeletion.created_at.asc(),
                )
                .limit(int(max_rows))
            )
        ).all()
        by_org: dict[str, list[str]] = defaultdict(list)
        for row_id, org_id in due:
            by_org[str(org_id)].append(str(row_id))

        for org_id, ids in by_org.items():
            try:
                removal = await process(self.db, org_id, ids)
                if removal.deleted or removal.shared_kept:
                    await log_audit_event(
                        db=self.db,
                        event_type="pending_file_deletions_completed",
                        event_category="user_management",
                        severity="info",
                        event_data={
                            "files_deleted": removal.deleted,
                            "files_shared_kept": removal.shared_kept,
                            "files_still_pending": removal.not_deleted,
                        },
                        organization_id=org_id,
                    )
                # One commit for the row resolutions and their audit record.
                await self.db.commit()
                results["deleted"] += removal.deleted
                results["shared_kept"] += removal.shared_kept
                results["still_pending"] += removal.not_deleted
            except Exception:
                logger.exception(
                    "Pending file deletion sweep failed for organization {}", org_id
                )
                results["errors"].append({"org_id": org_id})
                await self.db.rollback()
        return results
