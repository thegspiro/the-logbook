"""One place where uploaded files are checked, scanned, stored and found again.

Layout — organization first, then the area of the application, then the record
the file belongs to::

    /app/uploads/<organization_id>/<area>/<record_id>/<uuid><ext>

Organization first keeps a department's files in one subtree, so one
department can be backed up, exported or deleted without walking every
module, and a stored path can be checked against a single prefix. Most
installations hold one department; the extra level costs them nothing.

The name on disk is always a server-generated UUID with an extension derived
from the file's detected contents. The uploader's filename is metadata only:
it never becomes a path component. What a person sees when they download is
built separately, from the record (``app.utils.download_names``).

Every stored file passes, in this order: a bounded read (an oversized upload is
refused without buffering all of it), content-type detection by magic bytes,
the area's allowlist, an extension/content consistency check, and the malware
scan. Only then is it written — to a temporary name in the destination
directory, flushed, and renamed into place, so a reader never sees half a file.

**Reading and deleting are confined to the owning organization.** Before the
org-first layout each module had its own root (``documents/<org>/…``,
``event-attachments/<org>/…``); files written there remain valid until
``scripts/relocate_uploads.py`` moves them, so :func:`resolve` accepts an
area's legacy root as well — still only inside that organization's
subdirectory.
"""

import asyncio
import hashlib
import os
import uuid
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.parse import quote

from fastapi import Response
from fastapi.responses import FileResponse, StreamingResponse
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import iterate_in_threadpool

from app.core import file_encryption
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.services.upload_scanning import reject_if_malicious
from app.utils.mime_validation import detect_mime_type, extension_matches_mime
from app.utils.upload_limits import read_upload_limited
from app.utils.upload_paths import resolve_in_org, safe_download_filename

# The uploads volume mount point in every compose file. Read at call time, so
# a test can point it at a temporary directory.
UPLOADS_ROOT = "/app/uploads"

# The backend's own directory (``/app`` in the container). Email attachments
# were once written to the relative path ``storage/email_attachments/``, which
# the process resolved against this directory — off the uploads volume.
# Migration 2be075025403 moved them; any it could not move are still read
# from here.
APP_ROOT = str(Path(__file__).resolve().parents[2])
LEGACY_EMAIL_ATTACHMENT_DIR = os.path.join(APP_ROOT, "storage", "email_attachments")

# Directories are created group-readable only, files owner/group read-write
# only: nothing else on the host needs to read department files.
_DIR_MODE = 0o750
_FILE_MODE = 0o640


class StorageArea(str, Enum):
    """The part of the application a stored file belongs to."""

    DOCUMENTS = "documents"
    EVENT_ATTACHMENTS = "event-attachments"
    TRAINING_RECORDS = "training-records"
    SELF_REPORTS = "self-reports"
    APPLICANTS = "applicants"
    EMAIL_ATTACHMENTS = "email-attachments"
    SUGGESTIONS = "suggestions"


# Where each area wrote files before the org-first layout, relative to
# UPLOADS_ROOT. Each held ``<root>/<organization_id>/…``.
_LEGACY_ROOTS: Mapping[StorageArea, tuple[str, ...]] = {
    StorageArea.DOCUMENTS: ("documents",),
    StorageArea.EVENT_ATTACHMENTS: ("event-attachments",),
    StorageArea.TRAINING_RECORDS: ("training_attachments",),
    StorageArea.SELF_REPORTS: ("training_attachments/self_reported_submissions",),
    StorageArea.APPLICANTS: ("prospect-documents",),
    StorageArea.EMAIL_ATTACHMENTS: ("email-attachments",),
    StorageArea.SUGGESTIONS: ("suggestions",),
}


@dataclass(frozen=True)
class FileRules:
    """What one upload path accepts."""

    #: Detected MIME type -> extension to store the file under.
    allowed_types: Mapping[str, str]
    max_bytes: int
    #: Human-readable list for the refusal message ("PDF, Word or image").
    description: str
    #: Keep the uploader's extension when it is consistent with the detected
    #: content (``.csv`` stays ``.csv`` though libmagic says text/plain).
    #: Otherwise the extension always comes from ``allowed_types``.
    keep_consistent_extension: bool = False
    #: With ``keep_consistent_extension``: the extensions accepted at all. A
    #: name outside this set, or with no extension, is refused.
    allowed_extensions: Optional[frozenset[str]] = None


@dataclass(frozen=True)
class StoredFile:
    path: str
    mime_type: str
    size: int
    sha256: str
    #: The uploader's filename, cleaned for display. Never a path component.
    original_name: str
    extension: str


def _root() -> str:
    return os.path.realpath(UPLOADS_ROOT)


def _valid_segment(value: Any) -> Optional[str]:
    """A single safe path segment, or None. Ids are UUID strings in practice;
    anything that could widen or escape a directory is refused."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in (".", "..") or "/" in text or "\\" in text or "\0" in text:
        return None
    return text


def area_directory(
    organization_id: Any, area: StorageArea, record_id: Any = None
) -> str:
    """Directory new files for this organization/area/record are written to."""
    org = _valid_segment(organization_id)
    if org is None:
        raise ValueError("A stored file needs an organization")
    parts = [_root(), org, area.value]
    if record_id is not None:
        record = _valid_segment(record_id)
        if record is None:
            raise ValueError("Invalid record id for a stored file")
        parts.append(record)
    return os.path.join(*parts)


def _legacy_bases(area: StorageArea) -> list[str]:
    bases = [os.path.join(_root(), root) for root in _LEGACY_ROOTS[area]]
    if area is StorageArea.EMAIL_ATTACHMENTS:
        bases.append(LEGACY_EMAIL_ATTACHMENT_DIR)
    return bases


def resolve(file_path: Any, organization_id: Any, *areas: StorageArea) -> Optional[str]:
    """Real path of a stored file if it belongs to *organization_id* in one of
    *areas*, else None.

    Fails closed on a missing organization, a non-string path, and anything
    resolving outside ``<UPLOADS_ROOT>/<org>/<area>/`` or the area's legacy
    ``<root>/<org>/`` (``..`` and symlinks included — the comparison is on the
    real path). Never raises for a malformed stored value.
    """
    if not isinstance(file_path, str) or not file_path:
        return None
    org = _valid_segment(organization_id)
    if org is None:
        return None
    if not os.path.isabs(file_path):
        # Only the pre-2026-10-08 email attachments were stored relative
        # (``storage/email_attachments/...``), resolved against APP_ROOT.
        file_path = os.path.join(APP_ROOT, file_path)
    resolved: str = os.path.realpath(file_path)
    for area in areas:
        current = os.path.realpath(os.path.join(_root(), org, area.value))
        if resolved.startswith(current + os.sep):
            return resolved
        for base in _legacy_bases(area):
            legacy = resolve_in_org(file_path, base, org)
            if legacy:
                return legacy
    return None


def write_atomically(directory: str, name: str, data: bytes) -> str:
    """Encrypt *data* and write it to ``directory/name`` via a temporary name
    and a rename, creating the directory with restricted permissions.
    Blocking: call it through ``asyncio.to_thread``.

    Every stored file is encrypted at rest (owner decision 26: always on).
    Callers hand over plaintext; :func:`stored_file_response` and
    ``file_encryption.read_plaintext`` give it back.
    """
    data = file_encryption.encrypt_bytes(data)
    os.makedirs(directory, mode=_DIR_MODE, exist_ok=True)
    final_path = os.path.join(directory, name)
    partial = os.path.join(directory, f".{name}.partial")
    fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, _FILE_MODE)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(partial, final_path)
    except BaseException:
        try:
            os.remove(partial)
        except OSError:
            pass
        raise
    return final_path


def stored_file_response(
    path: str,
    *,
    filename: str,
    media_type: str,
    content_disposition_type: str = "attachment",
) -> Response:
    """The response that hands a stored file to its reader.

    An encrypted file is decrypted as it streams; a file stored before
    encryption (no header) is served from disk as before. Either way the
    reader gets the plaintext with its true length.
    """
    if not file_encryption.is_encrypted(path):
        return FileResponse(
            path=path,
            filename=filename,
            media_type=media_type,
            content_disposition_type=content_disposition_type,
        )
    size, chunks = file_encryption.open_plaintext_stream(path)
    # Starlette's FileResponse rule for the filename, so both branches send
    # the same header for the same name.
    quoted = quote(filename)
    if quoted != filename:
        disposition = f"{content_disposition_type}; filename*=utf-8''{quoted}"
    else:
        disposition = f'{content_disposition_type}; filename="{filename}"'
    return StreamingResponse(
        iterate_in_threadpool(chunks),
        media_type=media_type,
        headers={
            "content-disposition": disposition,
            "content-length": str(size),
        },
    )


def remove_quietly(path: Optional[str]) -> None:
    """Best-effort unlink of a path already confined by :func:`resolve`."""
    if not path:
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning(f"Could not remove stored file {path}: {exc}")


class FileStorageService:
    """Validates, scans and stores uploads; see the module docstring."""

    def __init__(self, db: Optional[AsyncSession]):
        self.db = db

    async def read_upload(self, upload: Any, rules: FileRules) -> bytes:
        """Read an UploadFile without buffering more than the limit allows."""
        try:
            content = await read_upload_limited(upload, rules.max_bytes)
        except ValueError:
            limit_mb = rules.max_bytes // (1024 * 1024)
            raise CodedHTTPException(
                status_code=400,
                detail=f"File too large. Maximum size is {limit_mb}MB.",
                error_code=ErrorCode.UPLD_TOO_LARGE,
            )
        return content

    def inspect(
        self, content: bytes, original_name: Optional[str], rules: FileRules
    ) -> tuple[str, str]:
        """Return ``(detected_mime, extension)`` or refuse the file."""
        if not content:
            raise CodedHTTPException(
                status_code=400,
                detail="The uploaded file is empty.",
                error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
            )
        try:
            detected = detect_mime_type(content)
        except RuntimeError:
            logger.error("Upload validation unavailable: libmagic missing")
            raise CodedHTTPException(
                status_code=503,
                detail="File validation is temporarily unavailable.",
                error_code=ErrorCode.UPLD_VALIDATION_UNAVAILABLE,
            )
        extension = rules.allowed_types.get(detected)
        if extension is None:
            logger.warning(f"Upload rejected: detected type {detected!r} not allowed")
            raise CodedHTTPException(
                status_code=400,
                detail=(
                    f"File type not allowed (detected: {detected}). "
                    f"Allowed: {rules.description}."
                ),
                error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
            )
        if rules.keep_consistent_extension:
            claimed = os.path.splitext(original_name or "")[1].lower()
            if (
                rules.allowed_extensions is not None
                and claimed not in rules.allowed_extensions
            ):
                allowed = ", ".join(sorted(rules.allowed_extensions))
                raise CodedHTTPException(
                    status_code=400,
                    detail=f"File type '{claimed}' not allowed. Allowed: {allowed}",
                    error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
                )
            if claimed and not extension_matches_mime(claimed, detected):
                raise CodedHTTPException(
                    status_code=400,
                    detail=(
                        f"File extension '{claimed}' does not match the "
                        "file's contents."
                    ),
                    error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
                )
            if claimed:
                extension = claimed
        return detected, extension

    async def check(
        self,
        content: bytes,
        original_name: Optional[str],
        rules: FileRules,
        *,
        upload_kind: str,
        user: Any,
    ) -> tuple[str, str]:
        """Inspect and malware-scan bytes that will not be written to disk
        (re-encoded images, parsed imports). Returns ``(mime, extension)``."""
        detected, extension = self.inspect(content, original_name, rules)
        await reject_if_malicious(
            self.db,
            content,
            upload_kind=upload_kind,
            detected_mime=detected,
            user=user,
        )
        return detected, extension

    async def store_bytes(
        self,
        content: bytes,
        *,
        original_name: Optional[str],
        organization_id: Any,
        area: StorageArea,
        rules: FileRules,
        user: Any,
        record_id: Any = None,
        upload_kind: Optional[str] = None,
    ) -> StoredFile:
        """Inspect, scan and write *content*; return where it went."""
        if len(content) > rules.max_bytes:
            limit_mb = rules.max_bytes // (1024 * 1024)
            raise CodedHTTPException(
                status_code=400,
                detail=f"File too large. Maximum size is {limit_mb}MB.",
                error_code=ErrorCode.UPLD_TOO_LARGE,
            )
        detected, extension = await self.check(
            content,
            original_name,
            rules,
            upload_kind=upload_kind or area.value,
            user=user,
        )
        directory = area_directory(organization_id, area, record_id)
        name = f"{uuid.uuid4().hex}{extension}"
        path = await asyncio.to_thread(write_atomically, directory, name, content)
        return StoredFile(
            path=path,
            mime_type=detected,
            size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
            original_name=safe_download_filename(original_name, name),
            extension=extension,
        )

    async def store_upload(
        self,
        upload: Any,
        *,
        organization_id: Any,
        area: StorageArea,
        rules: FileRules,
        user: Any,
        record_id: Any = None,
        upload_kind: Optional[str] = None,
    ) -> StoredFile:
        """:meth:`store_bytes` for a FastAPI ``UploadFile``."""
        content = await self.read_upload(upload, rules)
        return await self.store_bytes(
            content,
            original_name=getattr(upload, "filename", None),
            organization_id=organization_id,
            area=area,
            rules=rules,
            user=user,
            record_id=record_id,
            upload_kind=upload_kind,
        )
