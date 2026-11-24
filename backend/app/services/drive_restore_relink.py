"""Point references back at Drive files a person restored from a copy.

The Logbook finds a Shared Drive file by its id (``gdrive://<drive>/<id>/<key>``).
A file put back from a copy, after the drive's 30-day trash has let go of
the original, is a new file with a new id, so the rows that named it still
name the old one and every download reports it missing. Each stored file is
named after its key (``google_drive_storage.file_name_for``), and that name
is what this matches on.

For each department with Google Drive settings saved, and each ``gdrive://``
reference its rows hold:

* a reference whose file is still there is left alone, which is what makes a
  second run change nothing;
* otherwise the department's drive is searched, in every folder, for files
  carrying the reference's name. Exactly one, and it reads back and decrypts
  with this installation's file key: the rows are repointed at it, in the
  department's configured drive. None, or more than one: reported, and the
  rows are left as they are, because choosing between two copies is not a
  guess this should make.

A dry run (the default) reports and writes nothing. Rows are rewritten under
a row lock from their current value, keyed by the exact old reference, so a
row changed since the scan keeps that change.
"""

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import file_encryption
from app.models.user import Organization
from app.services import file_storage_service as file_storage
from app.services import upload_relocation
from app.services.google_drive_storage import (
    PLATFORM,
    GoogleDriveBackend,
    file_name_for,
    make_ref,
    parse_ref,
)
from app.services.remote_storage import RemoteStorageError
from app.services.upload_relocation import Reference


@dataclass
class Relink:
    organization_id: str
    old_ref: str
    new_ref: str


@dataclass
class RelinkReport:
    organizations: list[str] = field(default_factory=list)
    references_checked: int = 0
    present: int = 0
    relinks: list[Relink] = field(default_factory=list)
    #: No file in the drive carries the name.
    not_found: list[str] = field(default_factory=list)
    #: More than one file carries the name.
    ambiguous: list[str] = field(default_factory=list)
    #: The one candidate could not be read, or did not decrypt.
    unreadable: list[str] = field(default_factory=list)
    #: The key does not confine to the row's organization and area.
    outside_storage: list[str] = field(default_factory=list)
    rows_updated: int = 0

    def summary(self) -> dict[str, Any]:
        return {
            "organizations": self.organizations,
            "drive_references_checked": self.references_checked,
            "files_present": self.present,
            "references_to_relink": len(self.relinks),
            "not_found_in_drive": len(self.not_found),
            "more_than_one_match": len(self.ambiguous),
            "match_unreadable": len(self.unreadable),
            "outside_organization_storage": len(self.outside_storage),
            "rows_updated": self.rows_updated,
        }

    @property
    def problems(self) -> bool:
        return bool(
            self.not_found or self.ambiguous or self.unreadable or self.outside_storage
        )


async def _drive_departments(
    db: AsyncSession, organization_id: Optional[str]
) -> dict[str, GoogleDriveBackend]:
    """Each department with usable Google Drive settings, with its drive.
    Settings, not the current write target: a department that has since
    moved to another store still reads its old Drive files through them."""
    if organization_id:
        ids = [organization_id]
    else:
        ids = [str(i) for i in (await db.execute(select(Organization.id))).scalars()]
    found: dict[str, GoogleDriveBackend] = {}
    for org in ids:
        view = await file_storage.org_storage(org, db)
        backend = view.backends.get(PLATFORM.name)
        if isinstance(backend, GoogleDriveBackend):
            found[org] = backend
        elif organization_id:
            problem = view.problems.get(PLATFORM.name)
            raise ValueError(
                f"Organization {org} has no usable Google Drive settings"
                + (f": {problem}" if problem else ".")
            )
    return found


def _verified(backend: GoogleDriveBackend, ref: str) -> bool:
    """The candidate is one of this installation's files: it carries the
    file-encryption header, and reads back whole and decrypts with the file
    key. Blocking.

    The header check is the load-bearing half: a read passes an unencrypted
    file straight through (for files stored before encryption), so a
    decrypted copy uploaded under the stored name would otherwise be
    accepted, and the Logbook never writes a Drive file unencrypted."""
    try:
        if backend.key_id(ref) is None:
            logger.warning("Drive relink refused {}: not an encrypted file", ref)
            return False
        backend.read_bytes(ref)
    except (
        OSError,
        RemoteStorageError,
        file_encryption.FileDecryptionError,
    ) as exc:
        logger.warning("Drive relink could not verify {}: {}", ref, exc)
        return False
    return True


def _plan_department(
    organization_id: str,
    backend: GoogleDriveBackend,
    refs: list[Reference],
    report: RelinkReport,
) -> None:
    """Decide each of one department's references. Blocking (Drive calls):
    run through ``asyncio.to_thread``."""
    paths: dict[str, Reference] = {}
    for ref in refs:
        paths.setdefault(ref.path, ref)
    if not paths:
        return
    drive_id = backend.config.container
    listing = backend.list_files()
    live_ids = {file_id for file_id, _name in listing}
    by_name: dict[str, list[str]] = defaultdict(list)
    for file_id, name in listing:
        by_name[name].append(file_id)

    for path, ref in paths.items():
        report.references_checked += 1
        location = parse_ref(path)
        if location is None:
            continue
        if (
            file_storage.resolve(
                path, organization_id, *upload_relocation.candidate_areas(ref)
            )
            is None
        ):
            report.outside_storage.append(path)
            continue
        # A reference naming another drive (the department changed drives)
        # is not in this listing; ask for it directly before calling it lost.
        if (location.drive_id == drive_id and location.file_id in live_ids) or (
            location.drive_id != drive_id and backend.exists(path)
        ):
            report.present += 1
            continue
        candidates = [
            i
            for i in by_name.get(file_name_for(location.key), [])
            if i != location.file_id
        ]
        if not candidates:
            report.not_found.append(path)
            continue
        if len(candidates) > 1:
            report.ambiguous.append(path)
            continue
        new_ref = make_ref(drive_id, candidates[0], location.key)
        if not _verified(backend, new_ref):
            report.unreadable.append(path)
            continue
        report.relinks.append(Relink(organization_id, path, new_ref))


async def apply(
    db: AsyncSession,
    *,
    organization_id: Optional[str] = None,
    dry_run: bool = True,
) -> RelinkReport:
    drives = await _drive_departments(db, organization_id)
    report = RelinkReport(organizations=sorted(drives))
    refs_by_org: dict[str, list[Reference]] = defaultdict(list)
    for ref in await upload_relocation.collect_references(db, organization_id):
        if ref.organization_id in drives and parse_ref(ref.path) is not None:
            refs_by_org[ref.organization_id].append(ref)
    # Rows locked by nothing yet: end the read transaction before the Drive
    # calls, which can take minutes on a large drive.
    await db.commit()

    for org in sorted(refs_by_org):
        await asyncio.to_thread(
            _plan_department, org, drives[org], refs_by_org[org], report
        )
    if dry_run or not report.relinks:
        return report

    mapping = {relink.old_ref: relink.new_ref for relink in report.relinks}
    rows = sorted(
        {
            (ref.table, ref.row_id)
            for refs in refs_by_org.values()
            for ref in refs
            if ref.path in mapping
        }
    )
    report.rows_updated = await upload_relocation.rewrite_rows(
        db, rows, mapping, key=str
    )
    logger.info(
        "Drive relink repointed {} references in {} rows",
        len(mapping),
        report.rows_updated,
    )
    return report
