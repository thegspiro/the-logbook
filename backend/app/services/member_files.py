"""The stored files a member's rows name, and the one rule for trusting them.

Attachment lists live in JSON columns (``training_submissions.attachments``,
``training_records.attachments``), so a ``file_path`` read back from one is
only as trustworthy as the column it round-tripped through.
:func:`confined_attachment_path` is the single definition of which entries
name a file this organization may serve or delete: every reader of a
self-report or training-record attachment calls it rather than restating it
(CLAUDE.md pitfall #29).
"""

from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attendance_waiver import (
    AttendanceWaiverAttachment,
    AttendanceWaiverRequest,
)
from app.models.training import TrainingRecord, TrainingSubmission
from app.services import file_storage_service as file_storage
from app.services import upload_relocation
from app.services.file_storage_service import StorageArea


def confined_attachment_path(
    attachment: Any, organization_id: Any, *areas: StorageArea
) -> Optional[str]:
    """Real path of a stored attachment, or None if it escapes the org's areas.

    Only a dict entry with a ``file_path`` qualifies. ``file_path`` is
    server-generated, but the column round-trips through JSON: this is what
    keeps a tampered value from becoming an arbitrary file read or, on
    delete, an arbitrary unlink. Confined to the row's *own organization* in
    one of *areas* (current or legacy layout, ``..`` and symlinks resolved),
    because a root-level check would still reach another tenant's file. A
    bare string, None, a URL or a path outside those areas yields None and is
    never deleted.
    """
    if not isinstance(attachment, dict):
        return None
    return file_storage.resolve(attachment.get("file_path"), organization_id, *areas)


def confined_attachment_paths(
    attachments: Optional[Iterable[Any]], organization_id: Any, *areas: StorageArea
) -> list[str]:
    """:func:`confined_attachment_path` for each entry, dropping the Nones."""
    if not isinstance(attachments, list):
        return []
    paths = [
        confined_attachment_path(attachment, organization_id, *areas)
        for attachment in attachments
    ]
    return [path for path in paths if path]


@dataclass
class MemberFiles:
    """Every stored file a member's rows name, as plain strings.

    Plain values on purpose: the hard delete queues these in its own
    transaction and no ORM instance of the member's rows survives its commit.
    """

    submission_ids: list[str] = field(default_factory=list)
    record_ids: list[str] = field(default_factory=list)
    #: Self-report certificates named by the member's submissions.
    submission_paths: set[str] = field(default_factory=set)
    #: Self-report certificates copied onto the member's training records by
    #: approval (and still named by a voided record after a reversal).
    record_self_report_paths: set[str] = field(default_factory=set)
    #: Files uploaded to the training records themselves.
    record_own_paths: set[str] = field(default_factory=set)
    #: Documents filed with the member's attendance waiver requests.
    waiver_paths: set[str] = field(default_factory=set)

    @property
    def self_report_paths(self) -> set[str]:
        return self.submission_paths | self.record_self_report_paths

    @property
    def all_paths(self) -> set[str]:
        # Sets: an approved certificate is named by the submission and by the
        # record that copied it, and is one file.
        return self.self_report_paths | self.record_own_paths | self.waiver_paths

    def paths_by_area(self) -> dict[str, StorageArea]:
        """Every path in :attr:`all_paths` with the area it was confined to.

        Taken from the sets above, never by confining a path again: the
        legacy self-reports root sits inside the legacy training-records
        root, and the collector's SELF_REPORTS-first classification is the
        one answer. A path in two sets keeps its self-report area.
        """
        areas: dict[str, StorageArea] = {}
        for path in self.waiver_paths:
            areas[path] = StorageArea.ATTENDANCE_WAIVERS
        for path in self.record_own_paths:
            areas[path] = StorageArea.TRAINING_RECORDS
        for path in self.self_report_paths:
            areas[path] = StorageArea.SELF_REPORTS
        return areas

    @property
    def own_rows(self) -> set[tuple[str, str]]:
        """The member's submission and record rows, as ``collect_references``
        names them, for :func:`referenced_elsewhere`'s ``exclude_rows``."""
        return {("training_submissions", row) for row in self.submission_ids} | {
            ("training_records", row) for row in self.record_ids
        }


async def collect_member_files(
    db: AsyncSession, user_id: str, organization_id: str, *, lock: bool = False
) -> MemberFiles:
    """The files the member's submissions, training records and waiver
    documents name, each confined to its own area of this organization.

    With *lock*, the member's submissions and records are read ``FOR
    UPDATE``: held until the transaction ends, so a concurrent approval or
    reversal, or an officer appending to a record's attachments, cannot write
    back an entry naming a file the caller is about to delete.
    """
    files = MemberFiles()
    org_id = str(organization_id)
    member = str(user_id)

    submissions = select(TrainingSubmission).where(
        TrainingSubmission.submitted_by == member,
        TrainingSubmission.organization_id == org_id,
    )
    records = select(TrainingRecord).where(
        TrainingRecord.user_id == member,
        TrainingRecord.organization_id == org_id,
    )
    if lock:
        submissions = submissions.with_for_update()
        records = records.with_for_update()

    for submission in (await db.execute(submissions)).scalars().all():
        files.submission_ids.append(str(submission.id))
        files.submission_paths.update(
            confined_attachment_paths(
                submission.attachments, org_id, StorageArea.SELF_REPORTS
            )
        )

    for record in (await db.execute(records)).scalars().all():
        files.record_ids.append(str(record.id))
        attachments = record.attachments if isinstance(record.attachments, list) else []
        # The order upload_relocation.candidate_areas gives a record's
        # references: an approved certificate lives in the self-reports area.
        for attachment in attachments:
            certificate = confined_attachment_path(
                attachment, org_id, StorageArea.SELF_REPORTS
            )
            if certificate:
                files.record_self_report_paths.add(certificate)
                continue
            own = confined_attachment_path(
                attachment, org_id, StorageArea.TRAINING_RECORDS
            )
            if own:
                files.record_own_paths.add(own)

    # The join remove_member_attachments uses: the attachment row carries no
    # member, its request does.
    waiver_rows = (
        await db.execute(
            select(AttendanceWaiverAttachment.file_path)
            .join(
                AttendanceWaiverRequest,
                AttendanceWaiverRequest.id == AttendanceWaiverAttachment.request_id,
            )
            .where(
                AttendanceWaiverRequest.user_id == member,
                AttendanceWaiverRequest.organization_id == org_id,
                AttendanceWaiverAttachment.organization_id == org_id,
            )
        )
    ).scalars()
    for stored_path in waiver_rows:
        path = file_storage.resolve(stored_path, org_id, StorageArea.ATTENDANCE_WAIVERS)
        if path:
            files.waiver_paths.add(path)
    return files


async def referenced_elsewhere(
    db: AsyncSession,
    organization_id: str,
    paths: set[str],
    exclude_rows: set[tuple[str, str]],
) -> set[str]:
    """Which of *paths* a row other than *exclude_rows* still names.

    ``collect_references`` covers every writer of the SELF_REPORTS,
    TRAINING_RECORDS and ATTENDANCE_WAIVERS areas, but not every file column
    in the schema, so this answers "does another row of those kinds point at
    it" rather than "is it referenced anywhere at all". It reads the whole
    organization's references, which is acceptable for a rare, step-up-gated
    action; call it once per operation, never per path.
    """
    if not paths:
        return set()
    shared: set[str] = set()
    for ref in await upload_relocation.collect_references(db, str(organization_id)):
        if (ref.table, ref.row_id) in exclude_rows:
            continue
        real = file_storage.resolve(
            ref.path, ref.organization_id, *upload_relocation.candidate_areas(ref)
        )
        if real is not None and real in paths:
            shared.add(real)
    return shared


@dataclass(frozen=True)
class FileRemoval:
    """What a removal pass did: files deleted, files it could not delete
    (left queued), and files kept because another row still names them."""

    deleted: int = 0
    not_deleted: int = 0
    shared_kept: int = 0
