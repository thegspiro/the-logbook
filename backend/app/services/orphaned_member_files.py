"""Find, and on request remove, member files no row names any more.

Owner decision 2026-11-21, item (c). A stored file in a member-owned area —
self-report certificates, training-record uploads, attendance-waiver
documents — is orphaned when no collected reference names it. They exist
because permanent deletes before D11 (2026-11-16) removed the rows and left
the files, and they still accrue: ``historical_import_undo`` and the
onboarding reset delete members without queueing their files, and a process
killed between a commit and its file delete leaves one behind. So this is
re-runnable, not one-off.

The rules, each the owner's or the scope check's:

* **Dry run by default.** :func:`sweep` with ``apply=False`` counts and
  changes nothing.
* **Counts only, never paths**, in the report, the logs and the audit event:
  a path carries a record id, which identifies the member.
* **Old files only.** A file younger than ``min_age_days`` (default 30, never
  under 1) is skipped, measured from the later of its mtime and ctime: a
  relocation copies with ``shutil.copy2``, which keeps the source's mtime,
  and ``write_file`` can set an old one, but nothing short of a new inode
  resets the ctime. That also covers an upload stored and not yet committed.
* **Refuses while a relocation or remote migration is unfinished**: any
  manifest under ``.relocation/`` or ``.s3-migration/`` whose ``finalized``
  is not true. Its copies are unreferenced by design until it is finalized.
* **References are re-read immediately before deleting**, and if that read
  fails nothing is deleted (``remove_unreferenced_files``' rule: an orphan
  costs disk, a deleted file another record needs loses evidence).
* **The local volume only.** A remote store has no listing, so files a
  department keeps there are not reached; the report counts the remote
  references it saw so the operator knows.

A file is orphaned only when no reference in its own department names it,
read from every table ``collect_references`` knows (not just the member
areas'), resolved by the same rule ``referenced_elsewhere`` uses.
"""

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.models.user import Organization
from app.services import file_storage_service as file_storage
from app.services import remote_storage, upload_relocation
from app.services.file_storage_service import StorageArea

#: The member-owned areas. Self-reports first: its legacy tree is nested
#: inside the legacy training-records tree, so a file there is classified as
#: a certificate, as the member-file collector does.
AREAS = (
    StorageArea.SELF_REPORTS,
    StorageArea.TRAINING_RECORDS,
    StorageArea.ATTENDANCE_WAIVERS,
)

DEFAULT_MIN_AGE_DAYS = 30
_DAY = 86400
_MANIFEST_DIRECTORIES = (".relocation", ".s3-migration")


class UnfinalisedManifestError(Exception):
    """A relocation or remote migration has not been finalized."""

    def __init__(self, manifests: list[str]):
        self.manifests = manifests
        super().__init__(
            f"{len(manifests)} upload relocation or remote-migration run(s) "
            "are not finalized; finalize them (or, for a run that was rolled "
            "back, move its manifest out of the uploads volume) and run again"
        )


@dataclass
class AreaCounts:
    files: int = 0
    referenced: int = 0
    young: int = 0
    orphaned: int = 0
    orphaned_bytes: int = 0


@dataclass
class OrganizationReport:
    areas: dict[str, AreaCounts] = field(
        default_factory=lambda: {area.value: AreaCounts() for area in AREAS}
    )
    remote_references: int = 0
    deleted: int = 0
    failed: int = 0
    errors: int = 0


@dataclass
class SweepReport:
    applied: bool
    min_age_days: int
    organizations: dict[str, OrganizationReport] = field(default_factory=dict)
    unknown_organization_directories: int = 0

    def as_dict(self) -> dict[str, Any]:
        """Counts only. The keys are department ids, which name no member."""
        return {
            "applied": self.applied,
            "min_age_days": self.min_age_days,
            "unknown_organization_directories": self.unknown_organization_directories,
            "organizations": {
                org_id: {
                    "areas": {
                        name: vars(counts) for name, counts in report.areas.items()
                    },
                    "remote_references": report.remote_references,
                    "deleted": report.deleted,
                    "failed": report.failed,
                    "errors": report.errors,
                }
                for org_id, report in self.organizations.items()
            },
        }


def is_old_enough(path: str, *, min_age_days: int, now: float) -> bool:
    stat = os.stat(path)
    return now - max(stat.st_mtime, stat.st_ctime) >= min_age_days * _DAY


def unfinalised_manifests(uploads_root: str) -> list[str]:
    """Manifests under the volume's relocation and migration directories whose
    run is not finalized. One that cannot be read counts as unfinalized."""
    found: list[str] = []
    for directory in _MANIFEST_DIRECTORIES:
        base = os.path.join(uploads_root, directory)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            path = os.path.join(base, name)
            if not name.endswith(".json") or not os.path.isfile(path):
                continue
            try:
                with open(path, encoding="utf-8") as handle:
                    finalized = json.load(handle).get("finalized") is True
            except (OSError, ValueError, AttributeError):
                finalized = False
            if not finalized:
                found.append(path)
    return found


def _walk(base: str) -> Iterator[str]:
    """Regular files under *base*, skipping symlinks and every dot-prefixed
    name (``.partial`` copies, the manifest directories)."""
    if not os.path.isdir(base) or os.path.islink(base):
        return
    for directory, subdirectories, names in os.walk(base):
        subdirectories[:] = [
            d
            for d in subdirectories
            if not d.startswith(".") and not os.path.islink(os.path.join(directory, d))
        ]
        for name in names:
            path = os.path.join(directory, name)
            if name.startswith(".") or os.path.islink(path):
                continue
            if os.path.isfile(path):
                yield path


def _area_bases(org_id: str) -> list[str]:
    root = file_storage.UPLOADS_ROOT
    bases = [os.path.join(root, org_id, area.value) for area in AREAS]
    for area in AREAS:
        bases.extend(
            os.path.join(base, org_id) for base in file_storage._legacy_bases(area)
        )
    return bases


def _candidate_files(org_id: str) -> dict[str, StorageArea]:
    """Every file in the department's member areas, by real path, with the
    first area it confines to."""
    files: dict[str, StorageArea] = {}
    for base in _area_bases(org_id):
        for path in _walk(base):
            real = os.path.realpath(path)
            if real in files:
                continue
            for area in AREAS:
                if file_storage.resolve(real, org_id, area):
                    files[real] = area
                    break
    return files


def _directory_org_ids() -> set[str]:
    """Department ids that have a member-area directory on the volume, in the
    current or a legacy layout."""
    root = file_storage.UPLOADS_ROOT
    ids: set[str] = set()
    if os.path.isdir(root):
        for name in os.listdir(root):
            if name.startswith("."):
                continue
            if any(os.path.isdir(os.path.join(root, name, a.value)) for a in AREAS):
                ids.add(name)
    for area in AREAS:
        for base in file_storage._legacy_bases(area):
            if os.path.isdir(base):
                ids.update(
                    name
                    for name in os.listdir(base)
                    if not name.startswith(".")
                    and os.path.isdir(os.path.join(base, name))
                    and file_storage._valid_segment(name)
                )
    return ids


async def _referenced(db: AsyncSession, org_id: str) -> tuple[set[str], int]:
    """Real local paths the department's rows name, and how many of its
    references point at a remote store."""
    referenced: set[str] = set()
    remote = 0
    for ref in await upload_relocation.collect_references(db, org_id):
        if remote_storage.is_remote_ref(ref.path):
            remote += 1
            continue
        real = file_storage.resolve(
            ref.path, ref.organization_id, *upload_relocation.candidate_areas(ref)
        )
        if real is not None:
            referenced.add(real)
    return referenced, remote


async def sweep(
    db: AsyncSession,
    *,
    apply: bool,
    org_id: Optional[str] = None,
    min_age_days: int = DEFAULT_MIN_AGE_DAYS,
    now: Optional[float] = None,
) -> SweepReport:
    """Count, and with *apply* delete, each department's orphaned member files.

    Raises :class:`UnfinalisedManifestError` before touching anything while a
    relocation or remote migration is unfinished, and ``ValueError`` for a
    minimum age under one day.
    """
    if min_age_days < 1:
        raise ValueError("The minimum file age must be at least 1 day")
    manifests = unfinalised_manifests(file_storage.UPLOADS_ROOT)
    if manifests:
        raise UnfinalisedManifestError(manifests)
    clock = time.time() if now is None else now

    report = SweepReport(applied=apply, min_age_days=min_age_days)
    on_disk = _directory_org_ids()
    known = set(
        str(i)
        for i in (
            await db.execute(
                select(Organization.id).where(Organization.id.in_(on_disk))
            )
        )
        .scalars()
        .all()
    )
    targets = sorted(known if org_id is None else known & {str(org_id)})
    report.unknown_organization_directories = len(
        on_disk - known if org_id is None else set()
    )

    for org in targets:
        mine = OrganizationReport()
        report.organizations[org] = mine
        files = _candidate_files(org)
        if not files:
            continue
        referenced, mine.remote_references = await _referenced(db, org)
        orphans: list[str] = []
        for path, area in files.items():
            counts = mine.areas[area.value]
            counts.files += 1
            if path in referenced:
                counts.referenced += 1
            elif not is_old_enough(path, min_age_days=min_age_days, now=clock):
                counts.young += 1
            else:
                counts.orphaned += 1
                counts.orphaned_bytes += os.path.getsize(path)
                orphans.append(path)
        if not apply or not orphans:
            continue

        try:
            # Read again immediately before deleting: a row written since the
            # first read may name one of these now.
            still_named, _ = await _referenced(db, org)
        except Exception:
            logger.exception(
                "Orphaned-file sweep could not re-check references for {}; "
                "nothing deleted",
                org,
            )
            mine.errors += 1
            continue
        for path in orphans:
            if path in still_named:
                continue
            if await file_storage.delete(path):
                mine.deleted += 1
            else:
                mine.failed += 1
        await log_audit_event(
            db=db,
            event_type="orphaned_member_files_removed",
            event_category="training",
            severity="warning",
            event_data={
                "files_deleted": mine.deleted,
                "files_not_deleted": mine.failed,
                "min_age_days": min_age_days,
                **{
                    f"{area.value.replace('-', '_')}_orphaned": mine.areas[
                        area.value
                    ].orphaned
                    for area in AREAS
                },
            },
            organization_id=org,
        )
        await db.commit()
        logger.info(
            "Orphaned-file sweep removed {} file(s) for {} ({} not removed)",
            mine.deleted,
            org,
            mine.failed,
        )
    return report
