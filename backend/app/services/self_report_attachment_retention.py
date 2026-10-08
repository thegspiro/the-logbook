"""Retention sweep for self-reported training certificate files.

A department sets ``SelfReportConfig.attachment_retention_days``; once a
submission has been decided (approved or rejected) for longer than that, the
certificate files it carries are deleted from storage and the references to
them are removed from the submission and from every training record of the
same member that copied them on approval. The training record itself, and the
submission row, are kept: what expires is the uploaded file, not the evidence
that the training was reported and decided.

Unset (null) means keep indefinitely, which is what every department had
before the setting existed, so an upgrade deletes nothing until a department
opts in.

Order within a submission is deliberate: the file is unlinked first and the
database is updated after. If the commit then fails, the row still names a file
that is gone, and the next run finds it again, treats the missing file as
already removed, and completes the update. Done the other way round, a failed
unlink after a committed update would orphan a file nothing points at any more,
and no later run could find it.
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.audit import log_audit_event
from app.models.training import (
    SelfReportConfig,
    SubmissionStatus,
    TrainingRecord,
    TrainingSubmission,
)
from app.services import file_storage_service as file_storage
from app.services.file_storage_service import StorageArea

# A submission is only swept once its decision is final; draft, pending and
# revision-requested submissions are still the member's to change, and their
# files are removed with the submission if it is withdrawn.
DECIDED_STATUSES = (SubmissionStatus.APPROVED, SubmissionStatus.REJECTED)

_BATCH_SIZE = 200


def _org_confined_path(attachment: Any, organization_id: str) -> str | None:
    """Real path of an attachment stored in this organization's self-reports.

    ``file_path`` round-trips through a JSON column, so a path is trusted only
    if it resolves inside the organization's own self-report storage (current
    or legacy layout). Anything else (another organization's file, a URL, a
    legacy reference) is neither deleted nor removed from the row.
    """
    if not isinstance(attachment, dict):
        return None
    return file_storage.resolve(
        attachment.get("file_path"), organization_id, StorageArea.SELF_REPORTS
    )


def _unlink(path: str) -> bool:
    """Delete one file. True when it is gone afterwards, however it went."""
    try:
        os.remove(path)
    except FileNotFoundError:
        return True
    except OSError as exc:
        logger.error(f"Self-report attachment retention could not delete {path}: {exc}")
        return False
    return True


class SelfReportAttachmentRetention:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def sweep(self, now: datetime | None = None) -> dict[str, Any]:
        """Apply every opted-in organization's retention period."""
        now = now or datetime.now(timezone.utc)
        results: dict[str, Any] = {
            "orgs_processed": 0,
            "files_deleted": 0,
            "submissions_cleared": 0,
            "errors": [],
        }

        # Plain values, read before the loop: a rollback for one organization
        # expires every ORM object in the session, and reading an expired
        # attribute afterwards would fail outside the greenlet bridge.
        configs = (
            await self.db.execute(
                select(
                    SelfReportConfig.organization_id,
                    SelfReportConfig.attachment_retention_days,
                ).where(SelfReportConfig.attachment_retention_days.isnot(None))
            )
        ).all()
        policies = [(str(org_id), int(days)) for org_id, days in configs]

        for org_id, days in policies:
            try:
                org_result = await self._sweep_org(org_id, now - timedelta(days=days))
                if org_result["files_deleted"] or org_result["submissions"]:
                    await log_audit_event(
                        db=self.db,
                        event_type="self_report_attachment_retention",
                        event_category="training",
                        severity="info",
                        event_data={
                            "retention_days": days,
                            "files_deleted": org_result["files_deleted"],
                            "submission_ids": org_result["submissions"],
                            "training_record_ids": org_result["records"],
                        },
                        organization_id=org_id,
                    )
                await self.db.commit()
                results["orgs_processed"] += 1
                results["files_deleted"] += org_result["files_deleted"]
                results["submissions_cleared"] += len(org_result["submissions"])
            except Exception as exc:
                logger.error(
                    f"Self-report attachment retention failed for org {org_id}: {exc}"
                )
                results["errors"].append({"org_id": org_id, "error": str(exc)})
                await self.db.rollback()

        if results["files_deleted"]:
            logger.info(
                f"Self-report attachment retention deleted "
                f"{results['files_deleted']} file(s) from "
                f"{results['submissions_cleared']} submission(s)"
            )
        return results

    async def _sweep_org(self, org_id: str, cutoff: datetime) -> dict[str, Any]:
        files_deleted = 0
        submissions: list[str] = []
        records: set[str] = set()
        # Keyset over the primary key: a submission whose only references are
        # ones this sweep leaves alone (a URL, a path that would not delete)
        # still matches the filter, and must not be fetched again forever.
        after_id = ""
        while True:
            batch = (
                (
                    await self.db.execute(
                        select(TrainingSubmission)
                        .where(
                            TrainingSubmission.organization_id == org_id,
                            TrainingSubmission.status.in_(DECIDED_STATUSES),
                            TrainingSubmission.reviewed_at < cutoff,
                            func.json_length(TrainingSubmission.attachments) > 0,
                            TrainingSubmission.id > after_id,
                        )
                        .order_by(TrainingSubmission.id)
                        .limit(_BATCH_SIZE)
                        # Holds off a concurrent approval reversal, which
                        # would otherwise return the submission to review
                        # with its certificate deleted underneath it.
                        .with_for_update()
                    )
                )
                .scalars()
                .all()
            )
            if not batch:
                break
            for submission in batch:
                removed = await self._expire_submission_files(submission, org_id)
                if removed:
                    files_deleted += len(removed)
                    submissions.append(str(submission.id))
                    records.update(await self._strip_records(submission, removed))
            await self.db.flush()
            after_id = str(batch[-1].id)
            if len(batch) < _BATCH_SIZE:
                break
        return {
            "files_deleted": files_deleted,
            "submissions": submissions,
            "records": sorted(records),
        }

    async def _expire_submission_files(
        self, submission: TrainingSubmission, org_id: str
    ) -> set[str]:
        """Delete this submission's stored files; return the paths now gone."""
        attachments = submission.attachments
        if not isinstance(attachments, list):
            return set()
        removed: set[str] = set()
        kept: list[Any] = []
        for attachment in attachments:
            path = _org_confined_path(attachment, org_id)
            if path is not None and await asyncio.to_thread(_unlink, path):
                removed.add(path)
                continue
            kept.append(attachment)
        if removed:
            # A new list, not an in-place edit: the JSON column does not track
            # mutation (Pitfall #12).
            submission.attachments = kept
            flag_modified(submission, "attachments")
        return removed

    async def _strip_records(
        self, submission: TrainingSubmission, removed: set[str]
    ) -> set[str]:
        """Drop the deleted files from the member's training records.

        Approval copies the attachment list onto the record verbatim, and a
        reversed approval leaves a voided record still holding it, so every
        record of this member is checked rather than only the one the
        submission links to now.
        """
        rows = (
            (
                await self.db.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == submission.organization_id,
                        TrainingRecord.user_id == submission.submitted_by,
                        func.json_length(TrainingRecord.attachments) > 0,
                    )
                )
            )
            .scalars()
            .all()
        )
        touched: set[str] = set()
        for record in rows:
            if not isinstance(record.attachments, list):
                continue
            kept = [
                attachment
                for attachment in record.attachments
                if not (
                    isinstance(attachment, dict)
                    and isinstance(attachment.get("file_path"), str)
                    and os.path.realpath(attachment["file_path"]) in removed
                )
            ]
            if len(kept) != len(record.attachments):
                record.attachments = kept
                flag_modified(record, "attachments")
                touched.add(str(record.id))
        return touched
