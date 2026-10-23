"""Moving a department's existing files into its own remote store, and
keeping the files there under the current key (decision 31, step 3).

Platform-neutral: it works through ``app.services.remote_storage``, so a
bucket below means whatever container the department's platform has. The
manifest's directory and kind keep their S3-era names so a manifest written
before the rename still rolls back and finalizes.

``scripts/migrate_uploads_to_s3.py`` drives the move; ``--rewrap`` in
``scripts/encrypt_uploads.py`` drives :func:`rewrap_bucket_objects`. A
department's new uploads go to its bucket once "Test and switch to S3" passes;
files written before that stay on the uploads volume, and are served from it,
until this moves them.

The move has the relocation command's three steps, each safe to interrupt and
re-run:

1. **apply** — for every department whose new files go to its bucket, copy
   each file still on the volume into the bucket (encrypted before upload, as
   every upload is), read it back and compare its SHA-256 with the original,
   then point the rows at the bucket. The volume copies are left in place and
   a manifest is written before any row changes.
2. **rollback MANIFEST** — point the rows back at the volume copies and remove
   the bucket copies.
3. **finalize MANIFEST** — delete the volume copies, each only after its
   bucket copy is read back and matches the recorded checksum again.

Only files in the org-first layout move; one still in a module's legacy root
is reported, and ``scripts/relocate_uploads.py`` moves it first. A file several
rows share moves once, and every row is pointed at the same object.

An anonymous suggestion's screenshot keeps the noon-truncated time on the
volume, and its bucket copy is stamped with the time of the migration — not
the time of the submission.
"""

import asyncio
import hashlib
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import file_encryption
from app.models.user import Organization
from app.services import file_storage_service as file_storage
from app.services import remote_storage, upload_relocation
from app.services.remote_storage import RemoteBackend, RemoteStorageError
from app.services.upload_relocation import Reference

MANIFEST_VERSION = 1


def manifest_directory() -> str:
    """On the uploads volume, beside the files the manifest can bring back.
    A dot-directory, so the encryption survey and backups' upload walk treat
    it as housekeeping rather than an upload."""
    return os.path.join(file_storage.UPLOADS_ROOT, ".s3-migration")


@dataclass
class Copy:
    organization_id: str
    old_path: str
    #: The org-first key the file keeps in the store.
    key: str
    #: Assigned when the file is copied, not when it is planned: a platform
    #: may reserve a reference at the store (Drive), and a dry run must not.
    ref: str = ""
    sha256: str = ""


@dataclass
class MigrationReport:
    organizations: list[str] = field(default_factory=list)
    copies: list[Copy] = field(default_factory=list)
    already_in_bucket: int = 0
    needs_relocation: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    outside_storage: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    rows_updated: int = 0
    manifest_path: Optional[str] = None

    def summary(self) -> dict[str, Any]:
        return {
            "departments": len(self.organizations),
            "files_to_copy": len(self.copies),
            "already_in_bucket": self.already_in_bucket,
            "needs_relocation_first": len(self.needs_relocation),
            "missing_on_disk": len(self.missing),
            "outside_organization_storage": len(self.outside_storage),
            "failed": len(self.failed),
            "rows_updated": self.rows_updated,
            "manifest": self.manifest_path,
        }


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _departments_on_remote(
    db: AsyncSession, organization_id: Optional[str]
) -> dict[str, RemoteBackend]:
    """Each department whose new files go to a remote store, with that store.
    Naming one that has not switched is an error: copying a department's
    files somewhere it never tested would be the very thing the connection
    test exists to prevent."""
    if organization_id:
        ids = [organization_id]
    else:
        ids = [str(i) for i in (await db.execute(select(Organization.id))).scalars()]
    found: dict[str, RemoteBackend] = {}
    for org in ids:
        view = await file_storage.org_storage(org, db)
        if not view.writes_to:
            if organization_id:
                raise ValueError(
                    f"Organization {org} does not store new files remotely. "
                    "Run the connection test in its Storage settings first."
                )
            continue
        if view.writer is None:
            raise ValueError(
                f"Organization {org} is on {view.writes_to} but its store "
                f"cannot be used: {view.problems.get(view.writes_to)}"
            )
        found[org] = view.writer
    return found


def _bucket_key(real: str, ref: Reference) -> Optional[str]:
    """The object key a volume file keeps in the bucket: its path under the
    uploads root, which is already ``<org>/<area>/<record>/<name>``. None for
    a file outside the org-first layout."""
    root = os.path.realpath(file_storage.UPLOADS_ROOT)
    if not real.startswith(root + os.sep):
        return None
    parts = os.path.relpath(real, root).split(os.sep)
    areas = {area.value for area in upload_relocation.candidate_areas(ref)}
    if len(parts) < 3 or parts[0] != ref.organization_id or parts[1] not in areas:
        return None
    return "/".join(parts)


def plan(refs: list[Reference], buckets: dict[str, RemoteBackend]) -> MigrationReport:
    """Decide what moves where. Touches nothing."""
    report = MigrationReport(organizations=sorted(buckets))
    planned: dict[str, Copy] = {}
    for ref in refs:
        backend = buckets.get(ref.organization_id)
        if backend is None:
            continue
        if remote_storage.is_remote_ref(ref.path):
            report.already_in_bucket += 1
            continue
        real = file_storage.resolve(
            ref.path, ref.organization_id, *upload_relocation.candidate_areas(ref)
        )
        if real is None:
            report.outside_storage.append(ref.path)
            continue
        if real in planned:
            continue
        key = _bucket_key(real, ref)
        if key is None:
            report.needs_relocation.append(real)
            continue
        if not os.path.isfile(real):
            report.missing.append(real)
            continue
        planned[real] = Copy(ref.organization_id, real, key)
    report.copies = list(planned.values())
    return report


def _copy_verified(backend: RemoteBackend, copy: Copy) -> str:
    """Upload one file and prove the bucket gives it back. Re-runnable: an
    object an interrupted run already wrote with the same contents is
    accepted, one with different contents is refused."""
    plaintext = file_encryption.read_plaintext(copy.old_path)
    expected = _sha256(plaintext)
    if not copy.ref:
        copy.ref = backend.ref_for(copy.key)
    if backend.exists(copy.ref):
        if _sha256(backend.read_bytes(copy.ref)) == expected:
            return expected
        raise RemoteStorageError(f"{copy.ref} exists with different contents")
    backend.put(copy.ref, plaintext)
    if _sha256(backend.read_bytes(copy.ref)) != expected:
        backend.delete(copy.ref)
        raise RemoteStorageError(f"the bucket copy of {copy.old_path} did not verify")
    return expected


def _write_manifest(data: dict[str, Any]) -> str:
    os.makedirs(manifest_directory(), mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.join(
        manifest_directory(), f"s3-migration-{stamp}-{uuid.uuid4().hex[:8]}.json"
    )
    _save_manifest(path, data)
    return path


def _save_manifest(path: str, data: dict[str, Any]) -> None:
    partial = f"{path}.partial"
    with open(partial, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
    os.replace(partial, path)


def _load_manifest(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        data: dict[str, Any] = json.load(handle)
    if data.get("version") != MANIFEST_VERSION or data.get("kind") != "s3-migration":
        raise ValueError(f"{path} is not an S3 migration manifest")
    return data


async def apply(
    db: AsyncSession,
    *,
    organization_id: Optional[str] = None,
    dry_run: bool = True,
) -> MigrationReport:
    buckets = await _departments_on_remote(db, organization_id)
    refs = [
        ref
        for ref in await upload_relocation.collect_references(db, organization_id)
        if ref.organization_id in buckets
    ]
    report = plan(refs, buckets)
    if dry_run or not report.copies:
        return report

    copied: list[Copy] = []
    for copy in report.copies:
        try:
            copy.sha256 = await asyncio.to_thread(
                _copy_verified, buckets[copy.organization_id], copy
            )
        except (
            OSError,
            RemoteStorageError,
            file_encryption.FileDecryptionError,
        ) as exc:
            logger.error(f"S3 migration could not copy {copy.old_path}: {exc}")
            report.failed.append(copy.old_path)
            continue
        copied.append(copy)
    report.copies = copied
    if not copied:
        return report
    mapping = {copy.old_path: copy.ref for copy in copied}
    rows = sorted(
        {
            (ref.table, ref.row_id)
            for ref in refs
            if not remote_storage.is_remote_ref(ref.path)
            and upload_relocation.real_path(ref.path) in mapping
        }
    )
    # Written before any row changes, so an interrupted run always leaves
    # the record needed to undo it.
    report.manifest_path = _write_manifest(
        {
            "version": MANIFEST_VERSION,
            "kind": "s3-migration",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "organization_id": organization_id,
            "copies": [copy.__dict__ for copy in copied],
            "rows": [list(row) for row in rows],
            "finalized": False,
            "rolled_back": False,
        }
    )
    report.rows_updated = await upload_relocation.rewrite_rows(db, rows, mapping)
    return report


async def _store_for(
    db: AsyncSession, ref: str, cache: dict[str, Optional[RemoteBackend]]
) -> Optional[RemoteBackend]:
    if ref not in cache:
        try:
            cache[ref] = await file_storage.remote_store_for(ref, db)
        except ValueError:
            cache[ref] = None
    return cache[ref]


async def rollback(db: AsyncSession, manifest_path: str) -> dict[str, int]:
    data = _load_manifest(manifest_path)
    if data.get("finalized"):
        raise ValueError(
            "This migration was finalized: the copies on disk are gone, so "
            "there is nothing to roll back to."
        )
    mapping = {copy["ref"]: copy["old_path"] for copy in data["copies"]}
    rows = [tuple(row) for row in data["rows"]]
    restored = await upload_relocation.rewrite_rows(db, rows, mapping, key=str)
    removed = kept = 0
    buckets: dict[str, Optional[RemoteBackend]] = {}
    for copy in data["copies"]:
        backend = await _store_for(db, copy["ref"], buckets)
        # The bucket copy is removed only while the volume copy is there to
        # fall back on.
        if backend is None or not os.path.isfile(copy["old_path"]):
            kept += 1
            continue
        if await asyncio.to_thread(backend.delete, copy["ref"]):
            removed += 1
        else:
            kept += 1
    data["rolled_back"] = True
    _save_manifest(manifest_path, data)
    return {
        "rows_restored": restored,
        "bucket_copies_removed": removed,
        "bucket_copies_kept": kept,
    }


async def finalize(db: AsyncSession, manifest_path: str) -> dict[str, int]:
    data = _load_manifest(manifest_path)
    if data.get("rolled_back"):
        raise ValueError("This migration was rolled back; there is nothing to finalize")
    removed = kept = 0
    buckets: dict[str, Optional[RemoteBackend]] = {}
    for copy in data["copies"]:
        old = copy["old_path"]
        if not os.path.isfile(old):
            continue
        backend = await _store_for(db, copy["ref"], buckets)
        verified = False
        if backend is not None:
            try:
                data_back = await asyncio.to_thread(backend.read_bytes, copy["ref"])
                verified = _sha256(data_back) == copy["sha256"]
            except (
                FileNotFoundError,
                RemoteStorageError,
                file_encryption.FileDecryptionError,
            ) as exc:
                logger.error(f"Could not verify {copy['ref']}: {exc}")
        if not verified:
            logger.error(f"Not removing {old}: its bucket copy does not verify")
            kept += 1
            continue
        os.remove(old)
        removed += 1
    if kept == 0:
        data["finalized"] = True
        _save_manifest(manifest_path, data)
    return {"disk_copies_removed": removed, "kept_unverified": kept}


# ----------------------------------------------------------------------------
# What is in the buckets (for backups) and under which key (for rotation)
# ----------------------------------------------------------------------------


@dataclass(frozen=True)
class _RemoteObject:
    organization_id: str
    ref: str
    platform: str
    container: str


async def _remote_objects(db: AsyncSession) -> list[_RemoteObject]:
    seen: dict[str, _RemoteObject] = {}
    for ref in await upload_relocation.collect_references(db, None):
        parsed = remote_storage.parse_remote_ref(ref.path)
        if parsed is not None and ref.path not in seen:
            seen[ref.path] = _RemoteObject(
                ref.organization_id, ref.path, parsed.platform, parsed.container
            )
    return list(seen.values())


async def bucket_inventory(db: AsyncSession) -> list[dict[str, Any]]:
    """Which departments hold files in which remote store, and how many —
    what a backup of the uploads volume leaves out. ``bucket`` names the
    container on the platform (a bucket, a drive)."""
    counts: dict[tuple[str, str, str], int] = {}
    for item in await _remote_objects(db):
        key = (item.organization_id, item.platform, item.container)
        counts[key] = counts.get(key, 0) + 1
    return [
        {
            "organization_id": org,
            "platform": platform,
            "bucket": container,
            "files": files,
        }
        for (org, platform, container), files in sorted(counts.items())
    ]


def _rewrap_one(backend: RemoteBackend, ref: str, current: bytes) -> bool:
    """Re-encrypt one stored file under the current key; False when it
    already is. The file is replaced in one write, so a failure leaves the
    old ciphertext readable."""
    if backend.key_id(ref) in (None, current):
        return False
    plaintext = backend.read_bytes(ref)
    backend.put(ref, plaintext)
    if backend.key_id(ref) != current or (
        _sha256(backend.read_bytes(ref)) != _sha256(plaintext)
    ):
        raise RemoteStorageError(f"the rewrapped {ref} did not verify")
    return True


async def rewrap_bucket_objects(
    db: AsyncSession, *, dry_run: bool = True
) -> dict[str, Any]:
    """Move every referenced remote file under a retired key to the current
    one, so the retired key can leave ``ENCRYPTION_KEYS_LEGACY``."""
    current = bytes.fromhex(file_encryption.current_key_fingerprint())
    stores: dict[str, Optional[RemoteBackend]] = {}
    old_key = rewrapped = failed = unreachable = 0
    for item in await _remote_objects(db):
        backend = await _store_for(db, item.ref, stores)
        if backend is None:
            unreachable += 1
            continue
        try:
            if dry_run:
                key_id = await asyncio.to_thread(backend.key_id, item.ref)
                if key_id not in (None, current):
                    old_key += 1
                continue
            if await asyncio.to_thread(_rewrap_one, backend, item.ref, current):
                rewrapped += 1
        except (
            FileNotFoundError,
            RemoteStorageError,
            file_encryption.FileDecryptionError,
        ) as exc:
            logger.error(f"Could not rewrap {item.ref}: {exc}")
            failed += 1
    if dry_run:
        return {
            "dry_run": True,
            "bucket_objects_under_a_retired_key": old_key,
            "bucket_unreachable": unreachable,
            "failed": failed,
        }
    return {
        "dry_run": False,
        "bucket_objects_rewrapped": rewrapped,
        "bucket_unreachable": unreachable,
        "failed": failed,
    }
