"""
Shared storage for uploaded files.

Every feature that keeps an uploaded file — documents, event attachments,
training certificates, prospect documents, suggestion screenshots, email
template attachments — stores it through this service rather than with its
own ``open(path, "wb")``. Three guarantees follow from having one writer:

* **One layout.** A file lives at
  ``{UPLOAD_DIR}/{organization_id}/{area}/{entity_id}/{random}.enc`` and the
  database records only that *relative* key. The organization is the first
  path segment, so one organization's files are a single subtree; the area is
  the second, so one module's files never sit beside another's; the entity
  (the event, prospect, submission, ...) is the third, so a record's files can
  be found, moved or purged together.
* **Encrypted at rest.** Contents are AES-256-GCM encrypted before they touch
  the disk (``app.core.file_encryption``); the ``.enc`` name is random and
  says nothing about the original file. The original name lives only in the
  database, next to the key.
* **Reads are confined.** A read names the organization and area it expects,
  and a key outside ``{organization_id}/{area}/`` is refused before the disk is
  touched. Access to one area therefore never reaches another: holding a key
  to a training certificate does not open a document, and a key belonging to
  another organization does not open at all.

Files written before this service existed are recorded as absolute paths in
each module's old directory and are plaintext. They stay readable: a caller
passes that module's old per-organization directories as ``legacy_dirs`` and the
read is confined to them, exactly as the module's own check did before. Until
those files are moved into the new layout the two coexist, and the key format
tells them apart.

The backend is local disk. ``STORAGE_TYPE`` names it so a later object-store
backend can be selected without touching any caller — callers only ever see
keys, never paths.
"""

from __future__ import annotations

import itertools
import os
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Iterator, Optional, Sequence
from urllib.parse import quote

from loguru import logger
from starlette.responses import StreamingResponse

from app.core.config import settings
from app.core.file_encryption import (
    HEADER_BYTES,
    FileDecryptionError,
    is_encrypted,
    iter_decrypt,
    iter_encrypt,
    plaintext_size,
)


class StorageArea(str, Enum):
    """The module a stored file belongs to — the second segment of its key."""

    DOCUMENTS = "documents"
    EVENTS = "events"
    TRAINING = "training"
    # Self-reported certificates, filed per submitting member. A separate area
    # from TRAINING because the retention sweep deletes these and only these.
    TRAINING_SUBMISSIONS = "training-submissions"
    PROSPECTS = "prospects"
    SUGGESTIONS = "suggestions"
    EMAIL_TEMPLATES = "email-templates"


class FileStorageError(Exception):
    """Base class for storage failures."""


class StoredFileNotFound(FileStorageError):
    """The reference is valid but no file exists for it."""


class StorageAccessDenied(FileStorageError):
    """The reference points outside the organization/area the caller named.

    Always a sign of a tampered or corrupted reference (the service writes
    every key itself), so callers log it and answer 403/404 without echoing
    the reference back.
    """


# org / area / entity / random.enc — every segment from a closed alphabet, so a
# key can contain no "..", no separator tricks and no absolute component.
_SEGMENT = r"[A-Za-z0-9_-]{1,64}"
_KEY_RE = re.compile(
    rf"^(?P<org>{_SEGMENT})/(?P<area>[a-z-]{{1,32}})/(?P<entity>{_SEGMENT})"
    r"/(?P<name>[0-9a-f]{32})\.enc$"
)
_SEGMENT_RE = re.compile(rf"^{_SEGMENT}$")
_READ_CHUNK = 64 * 1024
# Unsupported STORAGE_TYPE values already reported, so the warning is logged
# once per process rather than on every upload.
_warned_storage_types: set[str] = set()


@dataclass(frozen=True)
class StoredFile:
    """What a caller records after a save: the key and the plaintext size."""

    key: str
    size: int


@dataclass
class OpenedFile:
    """A readable stored file: its plaintext size and a chunk iterator.

    The iterator owns the open file handle and closes it when exhausted or
    garbage collected.
    """

    size: int
    chunks: Iterator[bytes]

    def read_all(self) -> bytes:
        return b"".join(self.chunks)


def is_storage_key(ref: Any) -> bool:
    """Whether *ref* is a key written by this service (vs. a legacy path)."""
    return isinstance(ref, str) and _KEY_RE.match(ref) is not None


def _check_segment(value: Any, label: str) -> str:
    text = str(value) if value is not None else ""
    if not _SEGMENT_RE.match(text):
        raise ValueError(f"Invalid {label} for file storage")
    return text


def _within(path: str, root: str) -> bool:
    return path == root or path.startswith(root + os.sep)


class FileStorageService:
    """Local-disk storage, encrypted at rest. See the module docstring."""

    def __init__(self, root: Optional[str] = None):
        storage_type = (settings.STORAGE_TYPE or "local").lower()
        if storage_type != "local" and storage_type not in _warned_storage_types:
            _warned_storage_types.add(storage_type)
            # STORAGE_TYPE was read by nothing before this service, so an
            # install may carry a non-local value that has always meant local
            # disk. Refusing would break every upload on upgrade; say so
            # instead and keep the behaviour the install already has.
            logger.warning(
                "STORAGE_TYPE={!r} is not implemented; storing files on local "
                "disk under UPLOAD_DIR",
                settings.STORAGE_TYPE,
            )
        self.root = os.path.realpath(root or settings.UPLOAD_DIR)

    # ------------------------------------------------------------------
    # Keys and paths
    # ------------------------------------------------------------------

    def _area_root(self, organization_id: Any, area: StorageArea) -> str:
        org = _check_segment(organization_id, "organization id")
        return os.path.join(self.root, org, area.value)

    def resolve(
        self,
        ref: Any,
        *,
        organization_id: Any,
        area: StorageArea,
        legacy_dirs: Sequence[str] = (),
        entity_id: Any = None,
    ) -> str:
        """Absolute path for *ref*, confined to the caller's org and area.

        *ref* is either a key this service wrote, or — for files stored before
        it existed — a legacy path, which is accepted only inside one of
        *legacy_dirs* (that module's old per-organization directories). When
        *entity_id* is given, a key must also belong to that entity, so a
        record can only reach the files stored for it. Raises
        ``StorageAccessDenied`` for anything else.
        """
        if not isinstance(ref, str) or not ref:
            raise StorageAccessDenied("Empty or non-string file reference")

        match = _KEY_RE.match(ref)
        if match:
            org = _check_segment(organization_id, "organization id")
            if match.group("org") != org or match.group("area") != area.value:
                raise StorageAccessDenied("File key belongs to another org or area")
            if entity_id is not None and match.group("entity") != str(entity_id):
                raise StorageAccessDenied("File key belongs to another record")
            area_root = os.path.realpath(self._area_root(org, area))
            path = os.path.realpath(os.path.join(self.root, ref))
            # Defence in depth against a symlink planted inside the volume:
            # the regex already excludes traversal in the key itself.
            if not _within(path, area_root):
                raise StorageAccessDenied("File key resolves outside its area")
            return path

        path = os.path.realpath(ref)
        for legacy_dir in legacy_dirs:
            legacy_root = os.path.realpath(legacy_dir)
            if path != legacy_root and _within(path, legacy_root):
                return path
        raise StorageAccessDenied("File reference is outside the permitted area")

    # ------------------------------------------------------------------
    # Writing
    # ------------------------------------------------------------------

    def save(
        self,
        content: bytes,
        *,
        organization_id: Any,
        area: StorageArea,
        entity_id: Any,
        mtime: Optional[datetime] = None,
    ) -> StoredFile:
        """Encrypt *content* and store it; returns the key to record.

        The write goes to a temporary name and is renamed into place, so a
        crash mid-write never leaves a truncated file under a real key.
        *mtime* overrides the timestamps of the file and of its record's
        directory (anonymous suggestions use it so the filesystem does not keep
        the upload time the row withholds).
        """
        org = _check_segment(organization_id, "organization id")
        entity = _check_segment(entity_id, "entity id")
        key = f"{org}/{area.value}/{entity}/{uuid.uuid4().hex}.enc"
        path = os.path.join(self.root, key)
        directory = os.path.dirname(path)
        os.makedirs(directory, exist_ok=True)

        temp_path = f"{path}.tmp-{secrets.token_hex(8)}"
        try:
            with open(temp_path, "wb") as handle:
                for piece in iter_encrypt(content):
                    handle.write(piece)
                handle.flush()
                os.fsync(handle.fileno())
            if mtime is not None:
                seconds = mtime.timestamp()
                os.utime(temp_path, (seconds, seconds))
            os.replace(temp_path, path)
            if mtime is not None:
                # The entity directory is per-record, so its own modification
                # time would otherwise keep the exact time the file arrived.
                os.utime(directory, (seconds, seconds))
        except BaseException:
            try:
                os.remove(temp_path)
            except OSError:
                pass
            raise
        return StoredFile(key=key, size=len(content))

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------

    def open(
        self,
        ref: Any,
        *,
        organization_id: Any,
        area: StorageArea,
        legacy_dirs: Sequence[str] = (),
        entity_id: Any = None,
    ) -> OpenedFile:
        """Open a stored file for reading, decrypting as it streams.

        The first chunk is decrypted before this returns, so a wrong key or a
        corrupted header surfaces as ``FileDecryptionError`` here — while the
        caller can still answer with an error status — rather than as a
        broken stream after a 200 has been sent.
        """
        path = self.resolve(
            ref,
            organization_id=organization_id,
            area=area,
            legacy_dirs=legacy_dirs,
            entity_id=entity_id,
        )
        try:
            handle = open(path, "rb")
        except FileNotFoundError as exc:
            raise StoredFileNotFound("Stored file not found") from exc
        except IsADirectoryError as exc:
            raise StoredFileNotFound("Stored file not found") from exc

        try:
            head = handle.read(HEADER_BYTES)
            total = os.fstat(handle.fileno()).st_size
            if is_encrypted(head):
                size = plaintext_size(total, head)
                handle.seek(0)
                chunks = _closing(iter_decrypt(handle), handle.close)
            elif is_storage_key(ref):
                # Every key is written encrypted; plaintext under a key means
                # the file was replaced behind the service's back.
                raise FileDecryptionError("Stored file is not encrypted")
            else:
                size = total
                handle.seek(0)
                chunks = _closing(_iter_plain(handle), handle.close)
            first = next(chunks, b"")
        except BaseException:
            handle.close()
            raise
        return OpenedFile(size=size, chunks=itertools.chain([first], chunks))

    def read_bytes(
        self,
        ref: Any,
        *,
        organization_id: Any,
        area: StorageArea,
        legacy_dirs: Sequence[str] = (),
        entity_id: Any = None,
    ) -> bytes:
        return self.open(
            ref,
            organization_id=organization_id,
            area=area,
            legacy_dirs=legacy_dirs,
            entity_id=entity_id,
        ).read_all()

    # ------------------------------------------------------------------
    # Deleting
    # ------------------------------------------------------------------

    def delete(
        self,
        ref: Any,
        *,
        organization_id: Any,
        area: StorageArea,
        legacy_dirs: Sequence[str] = (),
        entity_id: Any = None,
    ) -> bool:
        """Remove a stored file. False if it was already gone.

        Other ``OSError``s propagate: callers decide whether a failed unlink
        is fatal (email templates keep the row so a retry can finish the job)
        or merely logged.
        """
        path = self.resolve(
            ref,
            organization_id=organization_id,
            area=area,
            legacy_dirs=legacy_dirs,
            entity_id=entity_id,
        )
        try:
            os.remove(path)
        except FileNotFoundError:
            return False
        return True

    def delete_quietly(
        self,
        ref: Any,
        *,
        organization_id: Any,
        area: StorageArea,
        legacy_dirs: Sequence[str] = (),
        entity_id: Any = None,
    ) -> None:
        """Best-effort delete for cleanup paths; logs instead of raising."""
        try:
            self.delete(
                ref,
                organization_id=organization_id,
                area=area,
                legacy_dirs=legacy_dirs,
                entity_id=entity_id,
            )
        except (FileStorageError, OSError) as exc:
            logger.warning(
                "Stored file cleanup failed in area {} for org {}: {}",
                area.value,
                organization_id,
                type(exc).__name__,
            )


def _iter_plain(handle) -> Iterator[bytes]:
    while True:
        piece = handle.read(_READ_CHUNK)
        if not piece:
            return
        yield piece


def _closing(chunks: Iterator[bytes], close: Callable[[], None]) -> Iterator[bytes]:
    try:
        yield from chunks
    finally:
        close()


def get_file_storage() -> FileStorageService:
    """The configured storage service. Cheap; built per use so tests and
    settings changes take effect without a process restart."""
    return FileStorageService()


def content_disposition(filename: str, disposition: str = "attachment") -> str:
    """A ``Content-Disposition`` value safe for any filename.

    Matches Starlette's ``FileResponse`` encoding (plain quoted form for ASCII
    names, RFC 5987 ``filename*`` otherwise), with CR/LF and quotes removed
    first so a stored name can never split or extend the header.
    """
    cleaned = "".join(ch for ch in filename if ch not in '\r\n"\\') or "download"
    quoted = quote(cleaned)
    if quoted != cleaned:
        return f"{disposition}; filename*=utf-8''{quoted}"
    return f'{disposition}; filename="{cleaned}"'


def stored_file_response(
    opened: OpenedFile, *, filename: str, media_type: Optional[str]
) -> StreamingResponse:
    """Stream a decrypted stored file to the client as a download."""
    return StreamingResponse(
        opened.chunks,
        media_type=media_type or "application/octet-stream",
        headers={
            "Content-Disposition": content_disposition(filename),
            "Content-Length": str(opened.size),
            # Decrypted bytes must not be kept by shared caches or the browser
            # cache; the API is NetworkOnly in the service worker already.
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
