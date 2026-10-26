"""A department's Google Shared Drive as the place its files live.

Decision 32 in ``docs/FILE_STORAGE_HARDENING.md``. The server signs in as a
**service account** the department created, and stores files in a **Shared
Drive** it has added that account to (as Content manager, so it can trash
what it wrote; outright deletion would need Manager). Files belong to the department's drive, not to a person whose
access can lapse. A Shared Drive needs Google Workspace.

**A stored reference** is ``gdrive://<shared_drive_id>/<file_id>/<org>/<area>/…``.
Drive addresses a file by id, not by path, so the id rides in the reference;
the org-first key after it is what ``file_storage_service.resolve`` confines
by, exactly as for a bucket. The id is reserved at Drive
(``files.generateIds``) before the upload, so a reference is known before the
file exists and an upload that is retried replaces rather than duplicates.

**Files are encrypted before they leave the server** (``file_encryption``),
so Google and anyone with access to the drive hold only ciphertext; the drive
shows each file as ``application/octet-stream`` under a name built from its
key, and its content is useless without the installation's file key.

The Drive API is called over REST through ``google-auth``'s authorized
session rather than the discovery client: one dependency fewer at request
time, and the same streaming and Range reads the bucket backend uses. Every
host it contacts is Google's own, so there is no department-typed endpoint to
check.
"""

import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from typing import Any, Iterator, Mapping, Optional

from loguru import logger
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.core import file_encryption
from app.core.config import settings
from app.services.remote_storage import (
    RemoteBackend,
    RemoteConfig,
    RemotePlatform,
    RemoteRef,
    RemoteStorageError,
)

SCHEME = "gdrive://"
DRIVE_API = "https://www.googleapis.com/drive/v3"
UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"
# The whole-Drive scope, because a narrower one (drive.file) does not reach a
# Shared Drive the app did not create. What the account can actually touch is
# bounded by the drives it has been added to, which is the department's
# choice.
SCOPES = ("https://www.googleapis.com/auth/drive",)
# Connect, read.
_TIMEOUT = (5, 30)
# Ids Drive issues: letters, digits, hyphen and underscore.
_DRIVE_ID = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
_IDS_PER_REQUEST = 20


class GoogleDriveStorageError(RemoteStorageError):
    """Drive could not be reached, or refused the request."""


@dataclass(frozen=True)
class DriveLocation:
    drive_id: str
    file_id: str
    key: str


def parse_ref(ref: Any) -> Optional[DriveLocation]:
    if not isinstance(ref, str) or not ref.startswith(SCHEME):
        return None
    drive_id, _, rest = ref[len(SCHEME) :].partition("/")
    file_id, _, key = rest.partition("/")
    if not _DRIVE_ID.match(drive_id) or not _DRIVE_ID.match(file_id) or not key:
        return None
    return DriveLocation(drive_id, file_id, key)


def make_ref(drive_id: str, file_id: str, key: str) -> str:
    return f"{SCHEME}{drive_id}/{file_id}/{key}"


def _parse_key(raw: str) -> Mapping[str, Any]:
    try:
        info = json.loads(raw)
    except ValueError:
        raise ValueError(
            "The service account key is not valid JSON. Paste the whole key "
            "file Google downloaded."
        )
    if not isinstance(info, dict) or info.get("type") != "service_account":
        raise ValueError(
            "The key is not a service account key. Create a key for a "
            "service account (type service_account) in Google Cloud."
        )
    for field in ("client_email", "private_key", "private_key_id"):
        if not isinstance(info.get(field), str) or not info.get(field):
            raise ValueError(f"The service account key has no {field}.")
    return info


@dataclass(frozen=True)
class GoogleDriveConfig(RemoteConfig):
    """What one department's settings say about its Shared Drive."""

    shared_drive_id: str
    service_account_key: str
    folder_id: Optional[str] = None

    @property
    def container(self) -> str:
        return self.shared_drive_id

    @property
    def parent(self) -> str:
        """Where new files go: the chosen folder, else the drive's root."""
        return self.folder_id or self.shared_drive_id

    def fingerprint(self) -> str:
        """Keyed with SECRET_KEY, over the drive, the folder and the whole
        key, so a new key, a rotated key or a different drive each need a
        fresh connection test."""
        canonical = json.dumps(
            [self.shared_drive_id, self.folder_id or "", self.service_account_key],
            separators=(",", ":"),
        )
        return hmac.new(
            settings.SECRET_KEY.encode(), canonical.encode(), hashlib.sha256
        ).hexdigest()

    def describe(self) -> Mapping[str, Any]:
        try:
            account = str(_parse_key(self.service_account_key)["client_email"])
        except ValueError:
            account = None
        return {
            "shared_drive_id": self.shared_drive_id,
            "folder_id": self.folder_id,
            "service_account": account,
        }


def config_from_settings(
    file_storage: Optional[Mapping[str, Any]],
) -> Optional[GoogleDriveConfig]:
    """The Drive configuration in a department's decrypted ``file_storage``
    settings, or None when the key or the Shared Drive is missing. Whether
    the key parses is :func:`check_config`'s question, so a bad key is
    reported on the Storage screen rather than silently ignored."""
    if not isinstance(file_storage, Mapping):
        return None

    def text(name: str) -> Optional[str]:
        value = file_storage.get(name)
        return value.strip() if isinstance(value, str) and value.strip() else None

    drive_id = text("google_drive_shared_drive_id")
    key = text("google_drive_service_account_key")
    if not drive_id or not key:
        return None
    return GoogleDriveConfig(
        shared_drive_id=drive_id,
        service_account_key=key,
        folder_id=text("google_drive_folder_id"),
    )


def check_config(config: GoogleDriveConfig) -> None:
    if not _DRIVE_ID.match(config.shared_drive_id):
        raise ValueError(
            "The Shared Drive ID is not valid. Copy it from the drive's "
            "address: drive.google.com/drive/folders/<ID>."
        )
    if config.folder_id and not _DRIVE_ID.match(config.folder_id):
        raise ValueError("The folder ID is not valid.")
    _parse_key(config.service_account_key)


def _authorized_session(config: GoogleDriveConfig) -> Any:
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    credentials = service_account.Credentials.from_service_account_info(
        dict(_parse_key(config.service_account_key)), scopes=list(SCOPES)
    )
    session = AuthorizedSession(credentials)
    retries = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        # Every request here is safe to repeat: an upload names a reserved
        # id, so a retried create meets the file it already made.
        allowed_methods=None,
        raise_on_status=False,
    )
    session.mount("https://", HTTPAdapter(max_retries=retries))
    return session


class GoogleDriveBackend(RemoteBackend):
    """One department's Shared Drive. Every method blocks: callers run it
    through ``asyncio.to_thread``. Failures raise
    :class:`GoogleDriveStorageError` with the cause logged; a missing file
    raises ``FileNotFoundError``."""

    def __init__(self, config: GoogleDriveConfig, session: Any = None):
        self.config = config
        # The same object, typed for the Drive-only fields.
        self._drive = config
        self._session = session or _authorized_session(config)
        self._spare_ids: list[str] = []

    # -- plumbing ------------------------------------------------------------

    def _request(self, method: str, url: str, action: str, **kwargs: Any) -> Any:
        params = dict(kwargs.pop("params", {}) or {})
        params["supportsAllDrives"] = "true"
        try:
            response = self._session.request(
                method, url, params=params, timeout=_TIMEOUT, **kwargs
            )
        except Exception as exc:
            # requests, urllib3 and google-auth (token refresh) each raise
            # their own types; all of them mean Drive could not be asked.
            logger.error(f"Google Drive {action} failed: {type(exc).__name__}: {exc}")
            raise GoogleDriveStorageError(f"Google Drive {action} failed") from exc
        return response

    def _fail(self, action: str, response: Any) -> GoogleDriveStorageError:
        logger.error(
            f"Google Drive {action} failed: HTTP {response.status_code} "
            f"{str(getattr(response, 'text', ''))[:300]}"
        )
        return GoogleDriveStorageError(f"Google Drive {action} failed")

    @staticmethod
    def _location(ref: str) -> DriveLocation:
        location = parse_ref(ref)
        if location is None:
            raise ValueError("Not a Google Drive reference")
        return location

    def _reserve_id(self) -> str:
        if not self._spare_ids:
            response = self._request(
                "GET",
                f"{DRIVE_API}/files/generateIds",
                "id reservation",
                params={"count": _IDS_PER_REQUEST, "space": "drive", "type": "files"},
            )
            if response.status_code != 200:
                raise self._fail("id reservation", response)
            ids = [i for i in response.json().get("ids", []) if _DRIVE_ID.match(i)]
            if not ids:
                raise self._fail("id reservation", response)
            self._spare_ids = ids
        return self._spare_ids.pop()

    # -- the interface -------------------------------------------------------

    def ref_for(self, key: str) -> str:
        return make_ref(self._drive.shared_drive_id, self._reserve_id(), key)

    def put(self, ref: str, plaintext: bytes) -> None:
        location = self._location(ref)
        body = file_encryption.encrypt_bytes(plaintext)
        metadata = {
            "id": location.file_id,
            "name": location.key.replace("/", "_"),
            "parents": [self._drive.parent],
            "mimeType": "application/octet-stream",
        }
        boundary = "logbook-" + hashlib.sha256(body).hexdigest()[:24]
        multipart = (
            (
                f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                f"{json.dumps(metadata)}\r\n--{boundary}\r\n"
                "Content-Type: application/octet-stream\r\n\r\n"
            ).encode()
            + body
            + f"\r\n--{boundary}--\r\n".encode()
        )
        response = self._request(
            "POST",
            f"{UPLOAD_API}/files",
            "upload",
            params={"uploadType": "multipart", "fields": "id"},
            data=multipart,
            headers={"Content-Type": f"multipart/related; boundary={boundary}"},
        )
        if response.status_code == 200:
            return
        if response.status_code != 409:
            raise self._fail("upload", response)
        # The id is already a file: a retried upload, a migration re-run or a
        # rewrap. Replace its content, which Drive does in one write.
        response = self._request(
            "PATCH",
            f"{UPLOAD_API}/files/{location.file_id}",
            "upload",
            params={"uploadType": "media", "fields": "id"},
            data=body,
            headers={"Content-Type": "application/octet-stream"},
        )
        if response.status_code != 200:
            raise self._fail("upload", response)

    def exists(self, ref: str) -> bool:
        location = self._location(ref)
        response = self._request(
            "GET",
            f"{DRIVE_API}/files/{location.file_id}",
            "existence check",
            params={"fields": "id,trashed,driveId"},
        )
        if response.status_code == 404:
            return False
        if response.status_code != 200:
            raise self._fail("existence check", response)
        meta = response.json()
        return not meta.get("trashed") and meta.get("driveId") == location.drive_id

    def _download(self, location: DriveLocation, **headers: str) -> Any:
        # The stream is read raw, so it must be the stored bytes: requests
        # asks for gzip by default, and a compressed body would be neither
        # the ciphertext nor the length a Range read expects.
        response = self._request(
            "GET",
            f"{DRIVE_API}/files/{location.file_id}",
            "read",
            params={"alt": "media"},
            headers={**headers, "Accept-Encoding": "identity"},
            stream=True,
        )
        if response.status_code == 404:
            response.close()
            raise FileNotFoundError(
                make_ref(location.drive_id, location.file_id, location.key)
            )
        if response.status_code not in (200, 206):
            response.close()
            raise self._fail("read", response)
        return response

    def _head(self, location: DriveLocation) -> tuple[bytes, int]:
        response = self._download(
            location, Range=f"bytes=0-{file_encryption.HEADER_SIZE - 1}"
        )
        try:
            head: bytes = response.raw.read(file_encryption.HEADER_SIZE)
        finally:
            response.close()
        content_range = str(response.headers.get("Content-Range") or "")
        _, _, total = content_range.rpartition("/")
        return head, int(total) if total.isdigit() else len(head)

    def open_plaintext(self, ref: str) -> tuple[int, Iterator[bytes]]:
        location = self._location(ref)
        response = self._download(location)
        try:
            size, chunks = file_encryption.open_plaintext_reader(
                response.raw, int(response.headers.get("Content-Length") or 0)
            )
        except BaseException:
            response.close()
            raise

        def closing() -> Iterator[bytes]:
            try:
                yield from chunks
            except OSError as exc:
                logger.error(f"Google Drive read failed: {exc}")
                raise GoogleDriveStorageError("Google Drive read failed") from exc
            finally:
                response.close()

        return size, closing()

    def read_bytes(self, ref: str) -> bytes:
        size, chunks = self.open_plaintext(ref)
        data = b"".join(chunks)
        if len(data) != size:
            raise file_encryption.FileDecryptionError("The file is truncated")
        return data

    def plaintext_size(self, ref: str) -> int:
        head, stored = self._head(self._location(ref))
        return file_encryption.plaintext_size_from_head(head, stored)

    def key_id(self, ref: str) -> Optional[bytes]:
        head, _stored = self._head(self._location(ref))
        return file_encryption.key_id_from_head(head)

    def delete(self, ref: str) -> bool:
        """Move the file to the Shared Drive's trash, which Google empties
        after 30 days. files.delete would remove it outright, but on a Shared
        Drive that needs the Manager role, and the Content manager role this
        account is given may only trash. A trashed file reads as gone to
        ``exists``, and it is ciphertext like every stored file."""
        location = self._location(ref)
        try:
            response = self._request(
                "PATCH",
                f"{DRIVE_API}/files/{location.file_id}",
                "delete",
                params={"fields": "id"},
                json={"trashed": True},
            )
        except GoogleDriveStorageError:
            return False
        if response.status_code in (200, 404):
            return True
        logger.warning(
            f"Could not remove {ref}: HTTP {response.status_code}. The service "
            "account needs the Content manager role on the Shared Drive."
        )
        return False


class GoogleDrivePlatform(RemotePlatform):
    name = "googledrive"
    label = "Google Drive"
    short_label = "Google Drive"
    container_noun = "shared drive"
    scheme = SCHEME
    test_failure_hint = (
        "Check the Shared Drive ID, that the service account has been added "
        "to the drive as a Content manager, and that the Google Drive API is "
        "enabled for its Google Cloud project."
    )
    incomplete_hint = "Save the service account key and the Shared Drive ID first."

    def parse_ref(self, ref: Any) -> Optional[RemoteRef]:
        location = parse_ref(ref)
        if location is None:
            return None
        return RemoteRef(self.name, location.drive_id, location.key)

    def config_from_settings(
        self, file_storage: Optional[Mapping[str, Any]]
    ) -> Optional[RemoteConfig]:
        return config_from_settings(file_storage)

    def check_config(self, config: RemoteConfig) -> None:
        if not isinstance(config, GoogleDriveConfig):
            raise TypeError("Not a Google Drive configuration")
        check_config(config)

    def backend(self, config: RemoteConfig) -> RemoteBackend:
        if not isinstance(config, GoogleDriveConfig):
            raise TypeError("Not a Google Drive configuration")
        return GoogleDriveBackend(config)


PLATFORM = GoogleDrivePlatform()
