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

**Every read, existence check, delete and download goes through the
operations at the bottom of this module** (:func:`exists`, :func:`read_bytes`,
:func:`plaintext_size`, :func:`delete` / :func:`delete_quietly`,
:func:`file_response`), never
through ``os`` on a resolved path. A stored reference is the string a row
holds: a local path, or ``s3://<bucket>/<org>/<area>/…`` for a file in the
department's own bucket (``app.services.s3_storage``). :func:`_backend_for`
picks the backend from the reference, so a file is always read from where it
was written whatever the department has chosen since.
``tests/test_storage_operations.py`` keeps callers off the filesystem.

**Where new files go** is the department's choice, but only once proven: a
department whose File Storage platform is S3 writes there only after
:func:`activate_s3` has written, read back and removed a test object with
exactly the settings now saved (decision 31). Until then, and again after
anyone edits those settings, new files go to the uploads volume. Once a
department is on S3, a bucket that cannot be reached refuses the upload
(``LB-UPLD-006``) rather than putting the file somewhere the department did
not choose.
"""

import asyncio
import copy
import hashlib
import os
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Iterator, Mapping, Optional, Union
from urllib.parse import quote

from fastapi import Response
from fastapi.responses import FileResponse, StreamingResponse
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import iterate_in_threadpool

from app.core import file_encryption
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.services import s3_storage
from app.services.s3_storage import S3Backend, S3Location, S3StorageError
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
    MINUTES_ATTACHMENTS = "minutes-attachments"


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
    # Born under the org-first layout, so there is no older root to honour.
    StorageArea.MINUTES_ATTACHMENTS: (),
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
    if s3_storage.is_ref(file_path):
        return _resolve_s3(file_path, org, areas)
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


def _s3_key_parts(ref: str) -> Optional[list[str]]:
    location = s3_storage.parse_ref(ref)
    if location is None:
        return None
    parts = location.key.split("/")
    if any(_valid_segment(part) != part for part in parts):
        return None
    return parts


def _resolve_s3(ref: str, org: str, areas: tuple[StorageArea, ...]) -> Optional[str]:
    """The bucket equivalent of the directory check: the key must begin
    ``<org>/<area>/`` and contain no segment that could mean anything other
    than itself. There is no symlink to follow in a bucket, so the reference
    is its own canonical form."""
    parts = _s3_key_parts(ref)
    if parts is None or len(parts) < 3 or parts[0] != org:
        return None
    if parts[1] not in {area.value for area in areas}:
        return None
    return ref


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
    return _streaming_response(
        size,
        chunks,
        filename=filename,
        media_type=media_type,
        content_disposition_type=content_disposition_type,
    )


def _streaming_response(
    size: int,
    chunks: Iterator[bytes],
    *,
    filename: str,
    media_type: str,
    content_disposition_type: str,
) -> Response:
    # Starlette's FileResponse rule for the filename, so every branch sends
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
        name = f"{uuid.uuid4().hex}{extension}"
        path = await write_file(
            organization_id, area, record_id, name, content, db=self.db
        )
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


# ----------------------------------------------------------------------------
# Where a department's files go
# ----------------------------------------------------------------------------

#: Key in ``organizations.settings`` recording a passed connection test. Not
#: part of ``FileStorageSettings``: only :func:`activate_s3` writes it, and the
#: settings update path refuses it from a client.
ACTIVATION_KEY = "file_storage_activation"

# Settings are re-read at most this often per worker. Long enough that a
# download does not cost a settings query; short enough that a change saved
# in another worker takes effect within a minute.
_ORG_STORAGE_TTL_SECONDS = 30.0
_ORG_STORAGE_MAX_ENTRIES = 256


@dataclass(frozen=True)
class OrgStorage:
    """What one department's settings decide about its files."""

    #: Its bucket, when the settings name one with credentials and the
    #: endpoint passes the address check.
    s3: Optional[S3Backend]
    #: Why the bucket is unusable although credentials are saved.
    s3_problem: Optional[str]
    #: New files go to the bucket: the platform is S3 and a connection test
    #: passed with exactly these settings.
    writes_to_s3: bool
    #: The settings were edited after the last passed test.
    changed_since_test: bool
    activation: Optional[Mapping[str, Any]]


_org_storage_cache: "OrderedDict[str, tuple[float, OrgStorage]]" = OrderedDict()


def forget_org_storage(organization_id: Any = None) -> None:
    """Drop the cached view of one department's settings (all, with None).
    Called after this worker changes them; other workers catch up within
    the cache's lifetime."""
    if organization_id is None:
        _org_storage_cache.clear()
    else:
        _org_storage_cache.pop(str(organization_id), None)


async def _load_settings(
    organization_id: str, db: Optional[AsyncSession] = None
) -> dict[str, Any]:
    """The department's settings, through the caller's session when it has
    one, else a session of its own: a stored file is reached from code that
    holds none (downloads, email delivery, scheduled tasks)."""
    from app.core.database import async_session_factory
    from app.models.user import Organization

    query = select(Organization.settings).where(Organization.id == organization_id)
    if db is not None:
        value = (await db.execute(query)).scalar_one_or_none()
    else:
        async with async_session_factory() as own:
            value = (await own.execute(query)).scalar_one_or_none()
    return copy.deepcopy(value) if isinstance(value, dict) else {}


def _org_storage_from(settings_dict: Mapping[str, Any]) -> OrgStorage:
    """Blocking (endpoint DNS check): run through ``asyncio.to_thread``."""
    from app.schemas.organization import decrypt_settings_secrets

    decrypted = decrypt_settings_secrets(dict(settings_dict))
    file_storage = decrypted.get("file_storage")
    if not isinstance(file_storage, Mapping):
        file_storage = {}
    activation = decrypted.get(ACTIVATION_KEY)
    if not isinstance(activation, Mapping):
        activation = None
    config = s3_storage.config_from_settings(file_storage)

    backend: Optional[S3Backend] = None
    problem: Optional[str] = None
    if config is not None:
        try:
            s3_storage.check_config(config)
            backend = S3Backend(config)
        except ValueError as exc:
            problem = str(exc)

    tested = (
        activation is not None
        and activation.get("platform") == "s3"
        and isinstance(activation.get("fingerprint"), str)
    )
    matches = (
        tested
        and config is not None
        and activation is not None
        and activation.get("fingerprint") == config.fingerprint()
    )
    return OrgStorage(
        s3=backend,
        s3_problem=problem,
        writes_to_s3=bool(matches and file_storage.get("platform") == "s3"),
        changed_since_test=bool(tested and not matches),
        activation=activation,
    )


async def org_storage(
    organization_id: Any, db: Optional[AsyncSession] = None
) -> OrgStorage:
    org = _valid_segment(organization_id)
    if org is None:
        raise ValueError("A stored file needs an organization")
    now = time.monotonic()
    cached = _org_storage_cache.get(org)
    if cached is not None and cached[0] > now:
        _org_storage_cache.move_to_end(org)
        return cached[1]
    raw = await _load_settings(org, db)
    view = await asyncio.to_thread(_org_storage_from, raw)
    _org_storage_cache[org] = (now + _ORG_STORAGE_TTL_SECONDS, view)
    _org_storage_cache.move_to_end(org)
    while len(_org_storage_cache) > _ORG_STORAGE_MAX_ENTRIES:
        _org_storage_cache.popitem(last=False)
    return view


def _unavailable() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=503,
        detail=(
            "The department's file storage cannot be reached right now, so "
            "nothing was saved or read. Please try again in a few minutes."
        ),
        error_code=ErrorCode.UPLD_STORAGE_UNAVAILABLE,
        headers={"Retry-After": "60"},
    )


def _s3_key(organization_id: Any, area: StorageArea, record_id: Any, name: str) -> str:
    org = _valid_segment(organization_id)
    if org is None:
        raise ValueError("A stored file needs an organization")
    parts = [org, area.value]
    if record_id is not None:
        record = _valid_segment(record_id)
        if record is None:
            raise ValueError("Invalid record id for a stored file")
        parts.append(record)
    leaf = _valid_segment(name)
    if leaf is None:
        raise ValueError("Invalid stored file name")
    parts.append(leaf)
    return "/".join(parts)


async def write_file(
    organization_id: Any,
    area: StorageArea,
    record_id: Any,
    name: str,
    content: bytes,
    *,
    db: Optional[AsyncSession] = None,
    local_mtime: Optional[datetime] = None,
) -> str:
    """Encrypt and store already-checked bytes where the department keeps its
    files; return the reference to save on the row.

    *local_mtime* sets the file's modification time on the uploads volume.
    A bucket stamps its own upload time and offers no way to change it.
    """
    storage = await org_storage(organization_id, db)
    if storage.writes_to_s3:
        if storage.s3 is None:
            logger.error(
                f"Organization {organization_id} is on S3 but its bucket is "
                f"unusable: {storage.s3_problem}"
            )
            raise _unavailable()
        location = S3Location(
            storage.s3.config.bucket,
            _s3_key(organization_id, area, record_id, name),
        )
        try:
            await asyncio.to_thread(storage.s3.put, location, content)
        except S3StorageError:
            raise _unavailable()
        return s3_storage.make_ref(location.bucket, location.key)

    directory = area_directory(organization_id, area, record_id)

    def _write() -> str:
        path = write_atomically(directory, name, content)
        if local_mtime is not None:
            seconds = local_mtime.timestamp()
            os.utime(path, (seconds, seconds))
        return path

    return await asyncio.to_thread(_write)


async def activate_s3(
    db: AsyncSession, organization_id: Any, user_id: Any
) -> OrgStorage:
    """Prove the department's saved S3 settings work, then record that they
    do, so new files go to its bucket.

    Writes a small test object, reads it back, compares and removes it — the
    three things every upload, download and delete will do. Raises ValueError
    with a message for the administrator when anything is missing or fails,
    having changed nothing. Commits *db* on success.
    """
    from app.schemas.organization import decrypt_settings_secrets

    org = _valid_segment(organization_id)
    if org is None:
        raise ValueError("A stored file needs an organization")
    raw = await _load_settings(org, db)
    decrypted = decrypt_settings_secrets(raw)
    file_storage = decrypted.get("file_storage")
    if not isinstance(file_storage, Mapping) or file_storage.get("platform") != "s3":
        raise ValueError(
            "Choose Amazon S3 as the storage platform and save it before "
            "testing the connection."
        )
    config = s3_storage.config_from_settings(file_storage)
    if config is None:
        raise ValueError(
            "Save the bucket name, access key ID and secret access key "
            "before testing the connection."
        )
    await asyncio.to_thread(s3_storage.check_config, config)

    backend = S3Backend(config)
    probe = os.urandom(32)
    location = S3Location(config.bucket, f"{org}/.storage-check/{uuid.uuid4().hex}.bin")

    def _round_trip() -> None:
        backend.put(location, probe)
        try:
            if backend.read_bytes(location) != probe:
                raise S3StorageError("read back different bytes")
        finally:
            if not backend.delete(location):
                raise S3StorageError("could not remove the test object")

    try:
        await asyncio.to_thread(_round_trip)
    except (S3StorageError, FileNotFoundError, file_encryption.FileDecryptionError):
        raise ValueError(
            "The connection test failed: the bucket could not be written, "
            "read back and cleaned up with these settings. Check the bucket "
            "name, region, endpoint and that the keys may put, get and delete "
            "objects in it. Nothing was changed."
        )

    record = {
        "platform": "s3",
        "fingerprint": config.fingerprint(),
        "bucket": config.bucket,
        "endpoint_url": config.endpoint_url,
        "region": config.region,
        "activated_at": datetime.now(timezone.utc).isoformat(),
        "activated_by": str(user_id) if user_id is not None else None,
    }
    # The settings are re-read under the row lock: if somebody saved
    # different S3 settings while the test ran, the record would vouch for
    # credentials nobody tested.
    organization = await _lock_organization(db, org)
    current = s3_storage.config_from_settings(
        decrypt_settings_secrets(copy.deepcopy(organization.settings or {})).get(
            "file_storage"
        )
    )
    if current is None or current.fingerprint() != record["fingerprint"]:
        await db.rollback()
        raise ValueError(
            "The S3 settings changed while the connection was being tested. "
            "Test again."
        )
    updated = copy.deepcopy(organization.settings or {})
    updated[ACTIVATION_KEY] = record
    organization.settings = updated
    await db.commit()
    forget_org_storage(org)
    return await org_storage(org, db)


async def _lock_organization(db: AsyncSession, org: str) -> Any:
    from app.models.user import Organization

    result = await db.execute(
        select(Organization).where(Organization.id == org).with_for_update()
    )
    organization = result.scalar_one_or_none()
    if organization is None:
        raise ValueError("Organization not found")
    return organization


async def deactivate_s3(db: AsyncSession, organization_id: Any) -> OrgStorage:
    """Send new files back to the uploads volume. Files already in the
    bucket stay there and are still served from it. Commits *db*."""
    org = _valid_segment(organization_id)
    if org is None:
        raise ValueError("A stored file needs an organization")
    organization = await _lock_organization(db, org)
    updated = copy.deepcopy(organization.settings or {})
    if updated.pop(ACTIVATION_KEY, None) is not None:
        organization.settings = updated
    await db.commit()
    forget_org_storage(org)
    return await org_storage(org, db)


# ----------------------------------------------------------------------------
# Operations on a stored file
# ----------------------------------------------------------------------------
#
# Callers pass the reference :func:`resolve` returned (or one they wrote
# themselves), already confined to the right organization and area. These do
# not confine again; they only do the I/O, off the event loop.


class _LocalBackend:
    """Files on the uploads volume."""

    @staticmethod
    def exists(ref: str) -> bool:
        return os.path.isfile(ref)

    @staticmethod
    def read_bytes(ref: str) -> bytes:
        return file_encryption.read_plaintext(ref)

    @staticmethod
    def plaintext_size(ref: str) -> int:
        return file_encryption.plaintext_size(ref)

    @staticmethod
    def delete(ref: str) -> bool:
        try:
            os.remove(ref)
        except FileNotFoundError:
            return True
        except OSError as exc:
            logger.warning(f"Could not remove stored file {ref}: {exc}")
            return False
        return True

    @staticmethod
    def response(
        ref: str, filename: str, media_type: str, content_disposition_type: str
    ) -> Response:
        return stored_file_response(
            ref,
            filename=filename,
            media_type=media_type,
            content_disposition_type=content_disposition_type,
        )


class _BucketBackend:
    """Files in a department's bucket, through :class:`S3Backend`. A bucket
    that cannot be reached is a 503, as on upload; a delete reports False."""

    def __init__(self, s3: Optional[S3Backend]):
        self._s3 = s3

    def _backend(self) -> S3Backend:
        if self._s3 is None:
            raise _unavailable()
        return self._s3

    @staticmethod
    def _location(ref: str) -> S3Location:
        location = s3_storage.parse_ref(ref)
        if location is None:
            raise ValueError("Not an S3 reference")
        return location

    def exists(self, ref: str) -> bool:
        try:
            return self._backend().exists(self._location(ref))
        except S3StorageError:
            raise _unavailable()

    def read_bytes(self, ref: str) -> bytes:
        try:
            return self._backend().read_bytes(self._location(ref))
        except S3StorageError:
            raise _unavailable()

    def plaintext_size(self, ref: str) -> int:
        try:
            return self._backend().plaintext_size(self._location(ref))
        except S3StorageError:
            raise _unavailable()

    def delete(self, ref: str) -> bool:
        if self._s3 is None:
            logger.warning(f"Could not remove {ref}: the bucket is not configured")
            return False
        return self._s3.delete(self._location(ref))

    def response(
        self, ref: str, filename: str, media_type: str, content_disposition_type: str
    ) -> Response:
        try:
            size, chunks = self._backend().open_plaintext(self._location(ref))
        except S3StorageError:
            raise _unavailable()
        return _streaming_response(
            size,
            chunks,
            filename=filename,
            media_type=media_type,
            content_disposition_type=content_disposition_type,
        )


_LOCAL = _LocalBackend()


async def _backend_for(ref: str) -> Union[_LocalBackend, _BucketBackend]:
    """The backend that holds *ref*: decided by the reference, never by what
    the department now writes to, so switching never strands a file."""
    if not s3_storage.is_ref(ref):
        return _LOCAL
    parts = _s3_key_parts(ref)
    if parts is None:
        raise ValueError("Malformed S3 reference")
    storage = await org_storage(parts[0])
    if storage.s3 is None and storage.s3_problem:
        logger.error(f"Cannot reach {ref}: {storage.s3_problem}")
    return _BucketBackend(storage.s3)


async def exists(ref: Optional[str]) -> bool:
    """Whether the stored file is there. False for an empty reference."""
    if not ref:
        return False
    backend = await _backend_for(ref)
    return await asyncio.to_thread(backend.exists, ref)


async def read_bytes(ref: str) -> bytes:
    """The stored file's plaintext, decrypted if it was stored encrypted."""
    backend = await _backend_for(ref)
    return await asyncio.to_thread(backend.read_bytes, ref)


async def plaintext_size(ref: str) -> int:
    """The size of the stored file's plaintext, without reading all of it."""
    backend = await _backend_for(ref)
    return await asyncio.to_thread(backend.plaintext_size, ref)


async def delete(ref: str) -> bool:
    """Remove the stored file. True when it is gone afterwards, however it
    went (already missing counts); a failure is logged, never raised."""
    try:
        backend = await _backend_for(ref)
    except Exception as exc:
        logger.warning(f"Could not remove stored file {ref}: {exc}")
        return False
    return await asyncio.to_thread(backend.delete, ref)


async def delete_quietly(ref: Optional[str]) -> None:
    """:func:`delete` for callers that only need best effort, so a row can
    always be deleted whatever happens to its file."""
    if ref:
        await delete(ref)


async def file_response(
    ref: str,
    *,
    filename: str,
    media_type: str,
    content_disposition_type: str = "attachment",
) -> Response:
    """The response that hands a stored file to its reader, as plaintext."""
    backend = await _backend_for(ref)
    return await asyncio.to_thread(
        backend.response,
        ref,
        filename,
        media_type,
        content_disposition_type,
    )
