"""Malware scan of the files and images stored before upload scanning.

Upload scanning (``app.services.upload_scanning``) covered self-report
certificates from 2026-10-06 and every upload path from 2026-10-08, and it
covers nothing while an operator runs with ``CLAMAV_ENABLED=false``. Whatever
was stored outside those windows never met a scanner. The owner decided on
2026-11-01 that it should: this module scans every stored object once.

**What is scanned.** Every stored-file reference ``upload_relocation`` knows
(documents, event, training-record and self-report attachments, applicant
files, email-template attachments, suggestion screenshots, minutes
attachments, evaluation PDFs) — on the uploads volume or in a department's own
store — and the images held in the database: organization logos, member
photos, storefront product images and equipment-check photos. Imports are
parsed and discarded on upload, so nothing of them is stored to scan.

**Once, and resumable.** :class:`~app.models.stored_file_scan.StoredFileScan`
is the ledger; its unique ``scan_key`` is the idempotency key (see the model).
A run scans only objects without a ledger row and commits each verdict as it
gets it, so a crash loses at most the file in hand and a second run scans
nothing it has already recorded. It runs from the in-process scheduler
(``stored_file_malware_scan``, hourly) with a per-run budget, so a large
backlog is worked through over several runs without holding the scheduler for
hours; once the backlog is gone a run only compares references to the ledger.
Files uploaded after scanning was enabled are scanned here once more as well:
nothing records that the live path scanned them, and one extra scan is cheaper
than adding that record to every upload path.

**No verdict, no row.** With scanning disabled a run returns before touching
the database, so it starts by itself the first time scanning is enabled. An
unreachable scanner, a timeout or an unreadable file writes nothing, and the
object is tried again on the next run. After
:data:`MAX_CONSECUTIVE_UNAVAILABLE` scanner failures in a row the run stops,
rather than spending a timeout on every remaining file.

**An infected object gets the upload path's treatment.** On upload an infected
file is refused, so it is never stored, and ``upload_malware_detected`` is
audited with the signature, type, size and SHA-256. Here the object already is
stored, so the same outcome means removing it: a file is deleted from storage
and an image is cleared from its row, and the detection is audited through
the same helper (:func:`~app.services.upload_scanning.record_malware_detection`)
with the row's id added. The row itself — the document, the training record —
is kept, and its download then reports the file as not found. A file's removal
is ordered audit-then-delete (Pitfall #36, at most once for the audit): the
ledger row and audit commit first, the delete follows, and ``removed_at`` is
stamped after it; a crash between the two leaves ``removed_at`` empty and the
next run finishes the delete without auditing it again. A database-held image
is cleared in the same transaction as its audit, so there is no gap.
"""

import base64
import binascii
import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from loguru import logger
from sqlalchemy import Text, cast, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stored_file_scan import ScanVerdict, StoredFileScan
from app.models.storefront import StoreProduct, StoreProductImage
from app.models.training import ShiftEquipmentCheck, ShiftEquipmentCheckItem
from app.models.user import Organization, User
from app.services import file_storage_service as file_storage
from app.services import malware_scan_service, upload_relocation
from app.services.file_storage_service import StorageArea
from app.services.malware_scan_service import MalwareScanUnavailable, ScanResult
from app.services.upload_scanning import record_malware_detection
from app.utils.mime_validation import detect_mime_type

#: Scans per run. A run is one entry in the scheduler's sequential loop, so it
#: must not hold it for long; the backlog is finished over several runs.
MAX_SCANS_PER_RUN = 500

#: Scanner failures in a row after which a run gives up until the next one.
#: More than one, so a single file clamd refuses (one over its stream limit)
#: does not stop the scan of everything after it.
MAX_CONSECUTIVE_UNAVAILABLE = 3

#: Keys looked up in the ledger per query.
_LEDGER_BATCH = 500

#: The audit record's ``upload`` value for a detection made by this scan.
UPLOAD_KIND = "stored_file_rescan"

# The column each relocation reference was read from, for the ledger's source.
_REFERENCE_COLUMNS = {
    "training_submissions": "attachments",
    "training_records": "attachments",
    "events": "attachments",
    "email_attachments": "storage_path",
}

LOGO = "organizations.logo"
MEMBER_PHOTO = "users.photo_url"
PRODUCT_IMAGE = "store_product_images.data"
CHECK_PHOTOS = "shift_equipment_check_items.photo_urls"


@dataclass
class _Candidate:
    scan_key: str
    organization_id: str
    source: str
    row_id: str
    #: Confined storage reference of a file; None for a database value.
    reference: Optional[str] = None


@dataclass
class _Report:
    scanned: int = 0
    clean: int = 0
    infected: int = 0
    missing: int = 0
    unreadable: int = 0
    read_failed: int = 0
    outside_storage: int = 0
    removals_finished: int = 0
    scanner_unavailable: bool = False
    pending: int = 0
    recorded: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        return {
            "task": "stored_file_malware_scan",
            "scanned": self.scanned,
            "clean": self.clean,
            "infected": self.infected,
            "missing": self.missing,
            "unreadable": self.unreadable,
            "read_failed": self.read_failed,
            "outside_storage": self.outside_storage,
            "removals_finished": self.removals_finished,
            "scanner_unavailable": self.scanner_unavailable,
            "remaining": max(self.pending - self.recorded, 0),
            "total_processed": self.scanned + self.removals_finished,
            "errors": self.errors,
        }


def _key(*parts: str) -> str:
    return hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()


def _sha2(column: Any) -> Any:
    """SHA-256 of a stored value, computed by the database, so finding what
    is unscanned never loads every image into memory."""
    return func.sha2(column, 256)


def _decode_data_uri(value: Any) -> Optional[bytes]:
    """The file bytes of a ``data:<type>;base64,<payload>`` value, else None."""
    if not isinstance(value, str) or not value.startswith("data:"):
        return None
    header, sep, payload = value.partition(",")
    if not sep or not header.endswith(";base64"):
        return None
    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return None


def _mime_of(content: bytes) -> Optional[str]:
    try:
        return detect_mime_type(content)
    except RuntimeError:
        return None


class StoredFileRescan:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def run(
        self,
        organization_id: Optional[str] = None,
        max_scans: Optional[int] = MAX_SCANS_PER_RUN,
    ) -> dict[str, Any]:
        """Scan up to *max_scans* stored objects without a verdict yet.

        *organization_id* limits the run to one department; the scheduler
        passes none and covers every department.
        """
        if not malware_scan_service.is_malware_scan_enabled():
            # Records nothing: a ledger row here would claim a scan that never
            # happened, and the first run with scanning on must find every
            # object still pending.
            return {
                "task": "stored_file_malware_scan",
                "skipped": "malware scanning is disabled",
                "total_processed": 0,
            }

        report = _Report()
        await self._finish_removals(organization_id, report)
        candidates = await self._candidates(organization_id, report)
        pending = await self._unrecorded(candidates)
        report.pending = len(pending)

        consecutive_unavailable = 0
        for candidate in pending:
            if max_scans is not None and report.scanned >= max_scans:
                break
            try:
                outcome = await self._process(candidate, report)
            except Exception as exc:  # one object must not end the run
                await self.db.rollback()
                report.read_failed += 1
                report.errors.append(candidate.scan_key)
                logger.error(
                    "Stored-file scan of {} row {} failed: {}",
                    candidate.source,
                    candidate.row_id,
                    type(exc).__name__,
                )
                continue
            if outcome == "recorded":
                report.recorded += 1
            if outcome == "unavailable":
                consecutive_unavailable += 1
                if consecutive_unavailable >= MAX_CONSECUTIVE_UNAVAILABLE:
                    report.scanner_unavailable = True
                    logger.warning(
                        "Stored-file malware scan paused: the scanner gave no "
                        "verdict {} times in a row; {} object(s) wait for the "
                        "next run",
                        consecutive_unavailable,
                        report.pending - report.recorded,
                    )
                    break
            else:
                consecutive_unavailable = 0

        summary = report.summary()
        if report.scanned or report.infected or report.removals_finished:
            logger.info(
                "Stored-file malware scan: {} scanned, {} infected, {} remaining",
                report.scanned,
                report.infected,
                summary["remaining"],
            )
        return summary

    # ------------------------------------------------------------------
    # What is stored
    # ------------------------------------------------------------------

    async def _candidates(
        self, organization_id: Optional[str], report: _Report
    ) -> list[_Candidate]:
        found: dict[str, _Candidate] = {}

        for ref in await upload_relocation.collect_references(self.db, organization_id):
            # Confined to the row's own organization and area, as every read
            # is: a stored path pointing anywhere else is never opened.
            real = file_storage.resolve(
                ref.path,
                ref.organization_id,
                *upload_relocation.candidate_areas(ref),
            )
            if real is None:
                report.outside_storage += 1
                continue
            key = _key("file", real)
            if key in found:
                continue
            column = _REFERENCE_COLUMNS.get(ref.table, "file_path")
            found[key] = _Candidate(
                key, ref.organization_id, f"{ref.table}.{column}", ref.row_id, real
            )

        def scoped(query: Any, column: Any) -> Any:
            return query.where(column == organization_id) if organization_id else query

        logo_text = Organization.logo
        queries = [
            (
                LOGO,
                scoped(
                    select(Organization.id, Organization.id, _sha2(logo_text)).where(
                        func.left(logo_text, 5) == "data:"
                    ),
                    Organization.id,
                ),
            ),
            (
                MEMBER_PHOTO,
                scoped(
                    select(User.id, User.organization_id, _sha2(User.photo_url)).where(
                        func.left(User.photo_url, 5) == "data:"
                    ),
                    User.organization_id,
                ),
            ),
            (
                PRODUCT_IMAGE,
                scoped(
                    select(
                        StoreProductImage.id,
                        StoreProductImage.organization_id,
                        _sha2(StoreProductImage.data),
                    ),
                    StoreProductImage.organization_id,
                ),
            ),
            (
                CHECK_PHOTOS,
                scoped(
                    select(
                        ShiftEquipmentCheckItem.id,
                        ShiftEquipmentCheck.organization_id,
                        _sha2(cast(ShiftEquipmentCheckItem.photo_urls, Text)),
                    )
                    .join(
                        ShiftEquipmentCheck,
                        ShiftEquipmentCheck.id == ShiftEquipmentCheckItem.check_id,
                    )
                    .where(
                        func.instr(
                            cast(ShiftEquipmentCheckItem.photo_urls, Text), '"data:'
                        )
                        > 0
                    ),
                    ShiftEquipmentCheck.organization_id,
                ),
            ),
        ]
        for source, query in queries:
            for row_id, org_id, digest in (await self.db.execute(query)).all():
                if digest is None:
                    continue
                key = _key("db", source, str(row_id), str(digest))
                found.setdefault(key, _Candidate(key, str(org_id), source, str(row_id)))
        return list(found.values())

    async def _unrecorded(self, candidates: list[_Candidate]) -> list[_Candidate]:
        pending: list[_Candidate] = []
        for start in range(0, len(candidates), _LEDGER_BATCH):
            batch = candidates[start : start + _LEDGER_BATCH]
            recorded = set(
                (
                    await self.db.execute(
                        select(StoredFileScan.scan_key).where(
                            StoredFileScan.scan_key.in_([c.scan_key for c in batch])
                        )
                    )
                ).scalars()
            )
            pending.extend(c for c in batch if c.scan_key not in recorded)
        return pending

    # ------------------------------------------------------------------
    # One object
    # ------------------------------------------------------------------

    async def _process(self, candidate: _Candidate, report: _Report) -> str:
        if candidate.reference is not None:
            if not await file_storage.exists(candidate.reference):
                await self._record(candidate, ScanVerdict.MISSING)
                report.missing += 1
                return "recorded"
            contents = [await file_storage.read_bytes(candidate.reference)]
            fingerprint = None
        else:
            loaded = await self._load_db_value(candidate)
            if loaded is None:
                # Changed or removed since it was listed; the next run lists
                # whatever is there now.
                return "skipped"
            contents, fingerprint = loaded
            if not contents:
                await self._record(candidate, ScanVerdict.UNREADABLE)
                report.unreadable += 1
                return "recorded"

        infected: list[tuple[bytes, ScanResult]] = []
        for content in contents:
            try:
                result = await malware_scan_service.scan_bytes(content)
            except MalwareScanUnavailable:
                return "unavailable"
            if result.infected:
                infected.append((content, result))
        report.scanned += 1

        if not infected:
            await self._record(candidate, ScanVerdict.CLEAN, fingerprint=fingerprint)
            report.clean += 1
            return "recorded"
        await self._quarantine(candidate, fingerprint, infected, report)
        return "recorded"

    async def _load_db_value(
        self, candidate: _Candidate
    ) -> Optional[tuple[list[bytes], str]]:
        """The decoded file bytes a database row holds now, with the value's
        current fingerprint. Loaded one row at a time."""
        org = candidate.organization_id
        if candidate.source == LOGO:
            query = select(Organization.logo, _sha2(Organization.logo)).where(
                Organization.id == candidate.row_id
            )
        elif candidate.source == MEMBER_PHOTO:
            query = select(User.photo_url, _sha2(User.photo_url)).where(
                User.id == candidate.row_id, User.organization_id == org
            )
        elif candidate.source == PRODUCT_IMAGE:
            query = select(StoreProductImage.data, _sha2(StoreProductImage.data)).where(
                StoreProductImage.id == candidate.row_id,
                StoreProductImage.organization_id == org,
            )
        else:
            query = (
                select(
                    ShiftEquipmentCheckItem.photo_urls,
                    _sha2(cast(ShiftEquipmentCheckItem.photo_urls, Text)),
                )
                .join(
                    ShiftEquipmentCheck,
                    ShiftEquipmentCheck.id == ShiftEquipmentCheckItem.check_id,
                )
                .where(
                    ShiftEquipmentCheckItem.id == candidate.row_id,
                    ShiftEquipmentCheck.organization_id == org,
                )
            )
        row = (await self.db.execute(query)).first()
        if row is None or row[1] is None:
            return None
        value, digest = row[0], str(row[1])
        current = _key("db", candidate.source, candidate.row_id, digest)
        if current != candidate.scan_key:
            return None
        if candidate.source == PRODUCT_IMAGE:
            contents = [bytes(value)] if value else []
        elif candidate.source == CHECK_PHOTOS:
            entries = value if isinstance(value, list) else []
            contents = [c for c in map(_decode_data_uri, entries) if c is not None]
        else:
            decoded = _decode_data_uri(value)
            contents = [decoded] if decoded is not None else []
        return contents, digest

    async def _record(
        self,
        candidate: _Candidate,
        verdict: ScanVerdict,
        *,
        fingerprint: Optional[str] = None,
        signature: Optional[str] = None,
        removed: bool = False,
    ) -> Optional[StoredFileScan]:
        row = StoredFileScan(
            organization_id=candidate.organization_id,
            scan_key=candidate.scan_key,
            source=candidate.source,
            row_id=candidate.row_id,
            reference=candidate.reference,
            fingerprint=fingerprint,
            verdict=verdict.value,
            signature=signature,
            removed_at=datetime.now(timezone.utc) if removed else None,
        )
        self.db.add(row)
        try:
            await self.db.commit()
        except IntegrityError:
            # Another run (the scheduler and a manual trigger) recorded the
            # same key first; its verdict, audit and removal stand, and this
            # run's audit row goes with the rollback.
            await self.db.rollback()
            return None
        return row

    # ------------------------------------------------------------------
    # Infected
    # ------------------------------------------------------------------

    async def _quarantine(
        self,
        candidate: _Candidate,
        fingerprint: Optional[str],
        infected: list[tuple[bytes, ScanResult]],
        report: _Report,
    ) -> None:
        report.infected += 1
        signature = infected[0][1].signature
        is_file = candidate.reference is not None
        for content, result in infected:
            await record_malware_detection(
                self.db,
                content,
                result,
                upload_kind=UPLOAD_KIND,
                detected_mime=_mime_of(content),
                organization_id=candidate.organization_id,
                extra={
                    "record": candidate.source,
                    "record_id": candidate.row_id,
                    "action": "file_deleted" if is_file else "image_cleared",
                },
            )
        logger.warning(
            "Stored-file malware scan found {} in {} row {}",
            signature,
            candidate.source,
            candidate.row_id,
        )

        if not is_file:
            # Cleared in the same transaction as the audit and the ledger row.
            await self._clear_db_value(
                candidate, fingerprint, {content for content, _ in infected}
            )
            await self._record(
                candidate,
                ScanVerdict.INFECTED,
                fingerprint=fingerprint,
                signature=signature,
                removed=True,
            )
            return

        # Audit first, delete second: a crash in between leaves removed_at
        # empty, and _finish_removals deletes it on the next run without a
        # second audit row. Deleting first would risk a removed file with no
        # record of why.
        ledger = await self._record(
            candidate, ScanVerdict.INFECTED, signature=signature
        )
        if ledger is not None:
            await self._delete_file(ledger)

    async def _delete_file(self, ledger: StoredFileScan) -> bool:
        reference = ledger.reference
        # Re-confined before deleting, against every area of the ledger row's
        # own organization: the reference was confined when recorded, and a
        # delete is the one operation here that cannot be taken back.
        confined = file_storage.resolve(
            reference, ledger.organization_id, *tuple(StorageArea)
        )
        if confined is None or not await file_storage.delete(confined):
            logger.warning(
                "Infected stored file {} could not be removed yet; retrying "
                "on the next run",
                ledger.id,
            )
            return False
        ledger.removed_at = datetime.now(timezone.utc)
        await self.db.commit()
        return True

    async def _clear_db_value(
        self, candidate: _Candidate, fingerprint: Optional[str], infected: set[bytes]
    ) -> None:
        """Remove an infected image from its row — only if the row still holds
        the value that was scanned, so a replacement uploaded meanwhile is
        never wiped."""
        org = candidate.organization_id
        if candidate.source == LOGO:
            await self.db.execute(
                update(Organization)
                .where(
                    Organization.id == candidate.row_id,
                    _sha2(Organization.logo) == fingerprint,
                )
                .values(logo=None)
            )
        elif candidate.source == MEMBER_PHOTO:
            await self.db.execute(
                update(User)
                .where(
                    User.id == candidate.row_id,
                    User.organization_id == org,
                    _sha2(User.photo_url) == fingerprint,
                )
                .values(photo_url=None)
            )
        elif candidate.source == PRODUCT_IMAGE:
            product_id = (
                await self.db.execute(
                    select(StoreProductImage.product_id).where(
                        StoreProductImage.id == candidate.row_id,
                        StoreProductImage.organization_id == org,
                    )
                )
            ).scalar_one_or_none()
            await self.db.execute(
                delete(StoreProductImage).where(
                    StoreProductImage.id == candidate.row_id,
                    StoreProductImage.organization_id == org,
                    _sha2(StoreProductImage.data) == fingerprint,
                )
            )
            if product_id is not None:
                # As StorefrontService.delete_product_image does: the image
                # URL carries the product's updated_at, so touching it stops
                # clients serving the removed photo from their cache.
                await self.db.execute(
                    update(StoreProduct)
                    .where(
                        StoreProduct.id == product_id,
                        StoreProduct.organization_id == org,
                    )
                    .values(updated_at=datetime.now(timezone.utc))
                )
        else:
            value = (
                await self.db.execute(
                    select(ShiftEquipmentCheckItem.photo_urls).where(
                        ShiftEquipmentCheckItem.id == candidate.row_id
                    )
                )
            ).scalar_one_or_none()
            entries = value if isinstance(value, list) else []
            kept = [
                entry for entry in entries if _decode_data_uri(entry) not in infected
            ]
            await self.db.execute(
                update(ShiftEquipmentCheckItem)
                .where(
                    ShiftEquipmentCheckItem.id == candidate.row_id,
                    _sha2(cast(ShiftEquipmentCheckItem.photo_urls, Text))
                    == fingerprint,
                )
                .values(photo_urls=kept)
            )

    async def _finish_removals(
        self, organization_id: Optional[str], report: _Report
    ) -> None:
        """Delete infected files whose removal an earlier run did not finish."""
        query = select(StoredFileScan).where(
            StoredFileScan.verdict == ScanVerdict.INFECTED.value,
            StoredFileScan.removed_at.is_(None),
            StoredFileScan.reference.isnot(None),
        )
        if organization_id:
            query = query.where(StoredFileScan.organization_id == organization_id)
        for ledger in (await self.db.execute(query)).scalars().all():
            if await self._delete_file(ledger):
                report.removals_finished += 1
