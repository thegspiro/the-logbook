"""Move stored files from the per-module layout into the org-first layout.

Before ``FileStorageService`` each module wrote to its own root
(``documents/<org>/…``, ``event-attachments/<org>/<event>/…``). New uploads
now go to ``<org>/<area>/<record>/…``; files already on disk stay readable
where they are (``file_storage.resolve`` accepts both) until an operator runs
``scripts/relocate_uploads.py``, which drives this module.

Three explicit steps, each safe to interrupt and re-run:

1. **apply** — copy every referenced legacy file to its new location,
   checksum-verify the copy, rewrite the stored paths, and write a manifest.
   The old files are left in place, so nothing can be lost by this step and
   undoing it is only a matter of pointing the rows back.
2. **rollback MANIFEST** — point the rows back at the old paths and remove the
   new copies.
3. **finalize MANIFEST** — delete the old files, each only after its new copy
   is re-verified against the recorded checksum.

Only paths inside the *row's own organization's* legacy subtree are moved; a
stored path anywhere else is reported and left alone. A file referenced by
several rows (recurring-event copies, an approved certificate referenced by
both the submission and the training record) is moved once and every
reference is rewritten to the same new path.
"""

import copy
import hashlib
import json
import os
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.document import Document
from app.models.email_template import EmailAttachment, EmailTemplate
from app.models.event import Event
from app.models.membership_pipeline import ProspectDocument, ProspectiveMember
from app.models.suggestion import SuggestionAttachment
from app.models.training import TrainingRecord, TrainingSubmission
from app.services import file_storage_service as file_storage
from app.services.file_storage_service import StorageArea

MANIFEST_VERSION = 1


def manifest_directory() -> str:
    """Manifests live on the uploads volume, beside what they describe, so
    they survive a container rebuild and are included in its backups."""
    return os.path.join(file_storage.UPLOADS_ROOT, ".relocation")


@dataclass
class Reference:
    """One stored path in one row (a JSON column may hold several)."""

    table: str
    row_id: str
    organization_id: str
    area: StorageArea
    record_id: Optional[str]
    path: str


@dataclass
class Move:
    organization_id: str
    area: StorageArea
    old_path: str
    new_path: str
    sha256: str = ""


@dataclass
class RelocationReport:
    moves: list[Move] = field(default_factory=list)
    already_current: int = 0
    missing: list[str] = field(default_factory=list)
    outside_storage: list[str] = field(default_factory=list)
    rows_updated: int = 0
    manifest_path: Optional[str] = None

    def summary(self) -> dict[str, Any]:
        return {
            "files_to_move": len(self.moves),
            "already_in_new_layout": self.already_current,
            "missing_on_disk": len(self.missing),
            "outside_organization_storage": len(self.outside_storage),
            "rows_updated": self.rows_updated,
            "manifest": self.manifest_path,
        }


def _real(path: str) -> str:
    """Real path of a stored value, anchoring a relative one the way
    ``file_storage.resolve`` does (only pre-2026-10-08 email attachments were
    stored relative)."""
    if not os.path.isabs(path):
        path = os.path.join(file_storage.APP_ROOT, path)
    return os.path.realpath(path)


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_current_layout(path: str, organization_id: str, area: StorageArea) -> bool:
    current = os.path.realpath(
        os.path.join(file_storage.UPLOADS_ROOT, organization_id, area.value)
    )
    return _real(path).startswith(current + os.sep)


def _legacy_area_for(
    path: str, organization_id: str, areas: Iterable[StorageArea]
) -> Optional[StorageArea]:
    """The area whose legacy tree holds *path* for this organization.

    The self-reports legacy root sits inside the training-records one, so
    SELF_REPORTS must be listed first wherever both are possible."""
    for area in areas:
        if file_storage.resolve(path, organization_id, area) and not (
            _is_current_layout(path, organization_id, area)
        ):
            return area
    return None


def _copy_verified(source: str, destination: str) -> str:
    """Copy with a checksum check; returns the checksum. Re-runnable: an
    identical destination from an interrupted run is accepted."""
    expected = _sha256(source)
    if os.path.isfile(destination):
        if _sha256(destination) == expected:
            return expected
        raise OSError(f"{destination} exists with different contents")
    directory = os.path.dirname(destination)
    os.makedirs(directory, mode=0o750, exist_ok=True)
    partial = os.path.join(directory, f".{os.path.basename(destination)}.partial")
    shutil.copy2(source, partial)  # copy2 keeps mtimes (anonymous suggestions)
    if _sha256(partial) != expected:
        os.remove(partial)
        raise OSError(f"copy of {source} did not verify")
    os.replace(partial, destination)
    return expected


# ---------------------------------------------------------------------------
# Finding every stored reference
# ---------------------------------------------------------------------------


def _json_paths(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [
        item["file_path"]
        for item in value
        if isinstance(item, dict) and isinstance(item.get("file_path"), str)
    ]


async def _collect(db: AsyncSession, organization_id: Optional[str]) -> list[Reference]:
    refs: list[Reference] = []

    def scoped(query, column):
        return query.where(column == organization_id) if organization_id else query

    # Self-report submissions before training records: an approved
    # certificate is referenced by both, and should move under its submission.
    for row in (
        await db.execute(
            scoped(
                select(
                    TrainingSubmission.id,
                    TrainingSubmission.organization_id,
                    TrainingSubmission.attachments,
                ),
                TrainingSubmission.organization_id,
            )
        )
    ).all():
        for path in _json_paths(row.attachments):
            refs.append(
                Reference(
                    "training_submissions",
                    str(row.id),
                    str(row.organization_id),
                    StorageArea.SELF_REPORTS,
                    str(row.id),
                    path,
                )
            )
    for row in (
        await db.execute(
            scoped(
                select(
                    TrainingRecord.id,
                    TrainingRecord.organization_id,
                    TrainingRecord.attachments,
                ),
                TrainingRecord.organization_id,
            )
        )
    ).all():
        for path in _json_paths(row.attachments):
            refs.append(
                Reference(
                    "training_records",
                    str(row.id),
                    str(row.organization_id),
                    StorageArea.TRAINING_RECORDS,
                    str(row.id),
                    path,
                )
            )
    for row in (
        await db.execute(
            scoped(
                select(Event.id, Event.organization_id, Event.attachments),
                Event.organization_id,
            )
        )
    ).all():
        for path in _json_paths(row.attachments):
            refs.append(
                Reference(
                    "events",
                    str(row.id),
                    str(row.organization_id),
                    StorageArea.EVENT_ATTACHMENTS,
                    str(row.id),
                    path,
                )
            )
    for row in (
        await db.execute(
            scoped(
                select(Document.id, Document.organization_id, Document.file_path),
                Document.organization_id,
            ).where(Document.file_path.isnot(None))
        )
    ).all():
        refs.append(
            Reference(
                "documents",
                str(row.id),
                str(row.organization_id),
                StorageArea.DOCUMENTS,
                None,
                row.file_path,
            )
        )
    for row in (
        await db.execute(
            scoped(
                select(
                    ProspectDocument.id,
                    ProspectDocument.prospect_id,
                    ProspectiveMember.organization_id,
                    ProspectDocument.file_path,
                ).join(
                    ProspectiveMember,
                    ProspectiveMember.id == ProspectDocument.prospect_id,
                ),
                ProspectiveMember.organization_id,
            )
        )
    ).all():
        refs.append(
            Reference(
                "prospect_documents",
                str(row.id),
                str(row.organization_id),
                StorageArea.APPLICANTS,
                str(row.prospect_id),
                row.file_path,
            )
        )
    for row in (
        await db.execute(
            scoped(
                select(
                    SuggestionAttachment.id,
                    SuggestionAttachment.organization_id,
                    SuggestionAttachment.suggestion_id,
                    SuggestionAttachment.file_path,
                ),
                SuggestionAttachment.organization_id,
            )
        )
    ).all():
        refs.append(
            Reference(
                "suggestion_attachments",
                str(row.id),
                str(row.organization_id),
                StorageArea.SUGGESTIONS,
                str(row.suggestion_id),
                row.file_path,
            )
        )
    for row in (
        await db.execute(
            scoped(
                select(
                    EmailAttachment.id,
                    EmailAttachment.template_id,
                    EmailTemplate.organization_id,
                    EmailAttachment.storage_path,
                ).join(EmailTemplate, EmailTemplate.id == EmailAttachment.template_id),
                EmailTemplate.organization_id,
            )
        )
    ).all():
        refs.append(
            Reference(
                "email_attachments",
                str(row.id),
                str(row.organization_id),
                StorageArea.EMAIL_ATTACHMENTS,
                str(row.template_id),
                row.storage_path,
            )
        )
    return refs


def _candidate_areas(ref: Reference) -> tuple[StorageArea, ...]:
    # A training record can hold an approved self-report certificate, which
    # lives in the self-reports tree; that tree is nested in the records one,
    # so it is checked first.
    if ref.area is StorageArea.TRAINING_RECORDS:
        return (StorageArea.SELF_REPORTS, StorageArea.TRAINING_RECORDS)
    return (ref.area,)


def plan(refs: list[Reference]) -> RelocationReport:
    """Decide where each legacy file goes. Touches nothing."""
    report = RelocationReport()
    planned: dict[str, Move] = {}
    for ref in refs:
        real = file_storage.resolve(
            ref.path, ref.organization_id, *_candidate_areas(ref)
        )
        if real is None:
            report.outside_storage.append(ref.path)
            continue
        if real in planned:
            continue
        area = _legacy_area_for(ref.path, ref.organization_id, _candidate_areas(ref))
        if area is None:
            report.already_current += 1
            continue
        if not os.path.isfile(real):
            report.missing.append(real)
            continue
        record = ref.record_id if area is ref.area else None
        directory = file_storage.area_directory(ref.organization_id, area, record)
        planned[real] = Move(
            ref.organization_id,
            area,
            real,
            os.path.join(directory, os.path.basename(real)),
        )
    report.moves = list(planned.values())
    return report


# ---------------------------------------------------------------------------
# Rewriting stored paths
# ---------------------------------------------------------------------------


def _rewrite_json(value: Any, mapping: dict[str, str]) -> tuple[Any, bool]:
    if not isinstance(value, list):
        return value, False
    updated = copy.deepcopy(value)
    changed = False
    for item in updated:
        if isinstance(item, dict) and isinstance(item.get("file_path"), str):
            new = mapping.get(_real(item["file_path"]))
            if new and new != item["file_path"]:
                item["file_path"] = new
                changed = True
    return updated, changed


_JSON_TABLES = {
    "training_submissions": (TrainingSubmission, "attachments"),
    "training_records": (TrainingRecord, "attachments"),
    "events": (Event, "attachments"),
}
_SCALAR_TABLES = {
    "documents": (Document, "file_path"),
    "prospect_documents": (ProspectDocument, "file_path"),
    "suggestion_attachments": (SuggestionAttachment, "file_path"),
    "email_attachments": (EmailAttachment, "storage_path"),
}


async def _rewrite_rows(
    db: AsyncSession, rows: Iterable[tuple[str, str]], mapping: dict[str, str]
) -> int:
    """Rewrite each (table, row_id) through *mapping* (real old path -> new).

    Each row is re-read under a row lock and rewritten from its current
    value, so an attachment added since the scan is kept rather than
    overwritten."""
    updated = 0
    for table, row_id in sorted(set(rows)):
        if table in _JSON_TABLES:
            model, column = _JSON_TABLES[table]
        else:
            model, column = _SCALAR_TABLES[table]
        row = (
            await db.execute(select(model).where(model.id == row_id).with_for_update())
        ).scalar_one_or_none()
        if row is None:
            continue
        current = getattr(row, column)
        if table in _JSON_TABLES:
            new_value, changed = _rewrite_json(current, mapping)
            if changed:
                setattr(row, column, new_value)
                flag_modified(row, column)
        else:
            if not isinstance(current, str):
                continue
            new_value = mapping.get(_real(current))
            changed = bool(new_value) and new_value != current
            if changed:
                setattr(row, column, new_value)
        if changed:
            updated += 1
    await db.commit()
    return updated


# ---------------------------------------------------------------------------
# The three steps
# ---------------------------------------------------------------------------


async def apply(
    db: AsyncSession,
    *,
    organization_id: Optional[str] = None,
    dry_run: bool = True,
) -> RelocationReport:
    refs = await _collect(db, organization_id)
    report = plan(refs)
    if dry_run or not report.moves:
        return report

    moved: list[Move] = []
    for move in report.moves:
        try:
            move.sha256 = _copy_verified(move.old_path, move.new_path)
        except OSError as exc:
            logger.error(f"Relocation could not copy {move.old_path}: {exc}")
            continue
        moved.append(move)
    report.moves = moved
    mapping = {move.old_path: move.new_path for move in moved}

    # The manifest is written before any row changes, so an interrupted run
    # always leaves the record needed to undo it.
    os.makedirs(manifest_directory(), mode=0o750, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    manifest_path = os.path.join(
        manifest_directory(), f"relocation-{stamp}-{uuid.uuid4().hex[:8]}.json"
    )
    rows = sorted(
        {(ref.table, ref.row_id) for ref in refs if _real(ref.path) in mapping}
    )
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "version": MANIFEST_VERSION,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "organization_id": organization_id,
                "moves": [move.__dict__ | {"area": move.area.value} for move in moved],
                "rows": [list(row) for row in rows],
                "finalized": False,
            },
            handle,
            indent=2,
        )
    report.manifest_path = manifest_path
    report.rows_updated = await _rewrite_rows(db, rows, mapping)
    return report


def _load_manifest(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if data.get("version") != MANIFEST_VERSION:
        raise ValueError(f"Unsupported manifest version in {path}")
    return data


async def rollback(db: AsyncSession, manifest_path: str) -> dict[str, int]:
    data = _load_manifest(manifest_path)
    if data.get("finalized"):
        raise ValueError(
            "This relocation was finalized: the old files are gone, so there is "
            "nothing to roll back to."
        )
    mapping = {_real(m["new_path"]): m["old_path"] for m in data["moves"]}
    rows = [tuple(row) for row in data["rows"]]
    updated = await _rewrite_rows(db, rows, mapping)
    removed = 0
    for move in data["moves"]:
        if os.path.isfile(move["old_path"]) and os.path.isfile(move["new_path"]):
            os.remove(move["new_path"])
            removed += 1
    return {"rows_restored": updated, "copies_removed": removed}


def finalize(
    manifest_path: str, remove: Callable[[str], None] = os.remove
) -> dict[str, int]:
    data = _load_manifest(manifest_path)
    removed = skipped = 0
    for move in data["moves"]:
        old, new = move["old_path"], move["new_path"]
        if not os.path.isfile(old):
            continue
        if not os.path.isfile(new) or _sha256(new) != move["sha256"]:
            logger.error(f"Not removing {old}: its new copy {new} does not verify")
            skipped += 1
            continue
        remove(old)
        removed += 1
    if skipped == 0:
        data["finalized"] = True
        with open(manifest_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
    return {"old_files_removed": removed, "kept_unverified": skipped}
