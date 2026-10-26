"""A department's Google Shared Drive (decision 32, step 2).

Google publishes no local stand-in for Drive the way moto stands in for S3, so
``FakeDrive`` below answers the handful of REST calls the backend makes, with
Drive's own status codes. What is pinned here:

* a ``gdrive://`` reference is confined to its organization and area like
  any other, and names the Shared Drive and the file;
* files are encrypted before upload, and come back as plaintext, whole,
  streamed or by size;
* an upload to an id that already holds a file replaces it;
* the settings: what is required, what a bad key looks like, what the
  fingerprint covers, and that the key is a secret;
* new files go to the drive only after a passed connection test, as for S3.
"""

import io
import json
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from urllib.parse import urlparse
from uuid import uuid4

import pytest

from app.core import file_encryption
from app.core.error_codes import CodedHTTPException
from app.schemas.organization import FileStorageSettings, encrypt_settings_secrets
from app.services import file_storage_service as file_storage
from app.services import google_drive_storage as gdrive
from app.services import remote_storage
from app.services.file_storage_service import ACTIVATION_KEY, StorageArea
from app.services.google_drive_storage import (
    GoogleDriveBackend,
    GoogleDriveConfig,
    GoogleDriveStorageError,
)

pytestmark = pytest.mark.unit

ORG = str(uuid4())
DRIVE = "0ADrive1234567890"
FOLDER = "1FolderAbcdef0123"
KEY = json.dumps(
    {
        "type": "service_account",
        "client_email": "logbook@dept-files.iam.gserviceaccount.com",
        "private_key": "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
        "private_key_id": "abc123",
    }
)
PDF = b"%PDF-1.4 minutes"


class FakeResponse:
    def __init__(self, status_code, body=b"", headers=None, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.raw = io.BytesIO(body)
        self.headers = headers or {}
        self.text = body.decode("latin-1") if body else json.dumps(payload or {})
        self.closed = False

    def json(self):
        return self._payload

    def close(self):
        self.closed = True


class FakeDrive:
    """The Drive v3 REST calls GoogleDriveBackend makes, in memory."""

    def __init__(self, drive_id=DRIVE, folders=(FOLDER,)):
        self.drive_id = drive_id
        self.parents = {drive_id, *folders}
        self.files: dict[str, dict] = {}
        self.calls: list[tuple[str, str, dict]] = []
        self.next_id = 0
        self.down = False
        # The service account's role on the Shared Drive. Content manager is
        # "fileOrganizer": it may move a file to the trash, but files.delete
        # (permanent) needs "organizer", the Manager role.
        self.role = "fileOrganizer"

    def _id(self):
        self.next_id += 1
        return f"fileid{self.next_id:010d}"

    def request(self, method, url, params=None, timeout=None, **kwargs):
        assert timeout is not None, "every Drive request must carry a timeout"
        params = params or {}
        self.calls.append((method, url, params))
        assert params.get("supportsAllDrives") == "true"
        if self.down:
            raise ConnectionError("network is unreachable")
        path = urlparse(url).path
        if path.endswith("/files/generateIds"):
            return FakeResponse(
                200, payload={"ids": [self._id() for _ in range(int(params["count"]))]}
            )
        if method == "POST" and path == "/upload/drive/v3/files":
            return self._create(kwargs)
        match = re.search(r"/files/([^/]+)$", path)
        assert match, url
        file_id = match.group(1)
        stored = self.files.get(file_id)
        if method == "PATCH" and path.startswith("/upload/"):
            if stored is None:
                return FakeResponse(404)
            stored["bytes"] = kwargs["data"]
            return FakeResponse(200, payload={"id": file_id})
        if method == "PATCH":
            if stored is None:
                return FakeResponse(404)
            if self.role not in ("organizer", "fileOrganizer"):
                return FakeResponse(403)
            stored["trashed"] = bool(kwargs["json"]["trashed"])
            return FakeResponse(200, payload={"id": file_id})
        if method == "DELETE":
            if stored is None:
                return FakeResponse(404)
            if self.role != "organizer":
                return FakeResponse(403)
            del self.files[file_id]
            return FakeResponse(204)
        if stored is None:
            return FakeResponse(404)
        if params.get("alt") != "media":
            return FakeResponse(
                200,
                payload={
                    "id": file_id,
                    "trashed": stored.get("trashed", False),
                    "driveId": stored["drive"],
                },
            )
        headers = kwargs.get("headers") or {}
        assert headers.get("Accept-Encoding") == "identity"
        data = stored["bytes"]
        if "Range" in headers:
            start, end = (
                int(x) for x in headers["Range"].removeprefix("bytes=").split("-")
            )
            part = data[start : end + 1]
            return FakeResponse(
                206,
                part,
                {"Content-Range": f"bytes {start}-{start + len(part) - 1}/{len(data)}"},
            )
        return FakeResponse(200, data, {"Content-Length": str(len(data))})

    def live(self) -> dict[str, dict]:
        """The files a person browsing the drive sees, outside its trash."""
        return {k: v for k, v in self.files.items() if not v.get("trashed")}

    def _create(self, kwargs):
        boundary = re.search(
            r"boundary=(\S+)", kwargs["headers"]["Content-Type"]
        ).group(1)
        parts = kwargs["data"].split(f"--{boundary}".encode())
        meta = json.loads(parts[1].split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0])
        body = parts[2].split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0]
        if meta["id"] in self.files:
            return FakeResponse(409)
        if not set(meta["parents"]) <= self.parents:
            return FakeResponse(404)
        self.files[meta["id"]] = {
            "bytes": body,
            "name": meta["name"],
            "parents": meta["parents"],
            "drive": self.drive_id,
            "mime": meta["mimeType"],
        }
        return FakeResponse(200, payload={"id": meta["id"]})


def _settings(**overrides):
    values = {
        "platform": "googledrive",
        "google_drive_service_account_key": KEY,
        "google_drive_shared_drive_id": DRIVE,
        "google_drive_folder_id": FOLDER,
    }
    values.update(overrides)
    return values


def _config(**overrides) -> GoogleDriveConfig:
    config = gdrive.config_from_settings(_settings(**overrides))
    assert config is not None
    return config


@pytest.fixture
def drive(monkeypatch):
    fake = FakeDrive()
    monkeypatch.setattr(gdrive, "_authorized_session", lambda config: fake)
    return fake


def _backend(drive) -> GoogleDriveBackend:
    return GoogleDriveBackend(_config(), session=drive)


# ---------------------------------------------------------------------------
# References
# ---------------------------------------------------------------------------


class TestReferences:
    def test_round_trip(self):
        ref = gdrive.make_ref(DRIVE, "fileid0000000001", f"{ORG}/documents/rec/a.pdf")
        assert ref == f"gdrive://{DRIVE}/fileid0000000001/{ORG}/documents/rec/a.pdf"
        parsed = remote_storage.parse_remote_ref(ref)
        assert parsed == remote_storage.RemoteRef(
            "googledrive", DRIVE, f"{ORG}/documents/rec/a.pdf"
        )
        assert remote_storage.platform_for_ref(ref) is gdrive.PLATFORM

    @pytest.mark.parametrize(
        "value",
        [
            "gdrive://",
            f"gdrive://{DRIVE}",
            f"gdrive://{DRIVE}/fileid0000000001",
            f"gdrive://bad id/fileid0000000001/{ORG}/documents/a",
            f"gdrive://{DRIVE}/bad.id/{ORG}/documents/a",
        ],
    )
    def test_not_a_reference(self, value):
        assert gdrive.parse_ref(value) is None

    def test_confined_to_its_organization_and_area(self):
        ref = gdrive.make_ref(DRIVE, "fileid0000000001", f"{ORG}/documents/rec/a.pdf")
        assert file_storage.resolve(ref, ORG, StorageArea.DOCUMENTS) == ref
        assert file_storage.resolve(ref, str(uuid4()), StorageArea.DOCUMENTS) is None
        assert file_storage.resolve(ref, ORG, StorageArea.APPLICANTS) is None
        traversal = gdrive.make_ref(
            DRIVE, "fileid0000000001", f"{ORG}/documents/../applicants/a.pdf"
        )
        assert file_storage.resolve(traversal, ORG, StorageArea.DOCUMENTS) is None


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class TestSettings:
    @pytest.mark.parametrize(
        "missing",
        ["google_drive_service_account_key", "google_drive_shared_drive_id"],
    )
    def test_incomplete_settings_name_no_drive(self, missing):
        assert gdrive.config_from_settings(_settings(**{missing: " "})) is None

    def test_the_folder_is_optional(self):
        config = _config(google_drive_folder_id=None)
        assert config.parent == DRIVE

    @pytest.mark.parametrize(
        ("key", "message"),
        [
            ("{not json", "not valid JSON"),
            (json.dumps({"type": "authorized_user"}), "not a service account key"),
            (
                json.dumps({"type": "service_account", "client_email": "a@b"}),
                "has no private_key",
            ),
        ],
    )
    def test_a_bad_key_is_explained(self, key, message):
        with pytest.raises(ValueError, match=message):
            gdrive.check_config(_config(google_drive_service_account_key=key))

    def test_a_bad_drive_id_is_explained(self):
        with pytest.raises(ValueError, match="Shared Drive ID is not valid"):
            gdrive.check_config(_config(google_drive_shared_drive_id="no spaces!"))

    def test_fingerprint_follows_drive_folder_and_key(self):
        base = _config().fingerprint()
        assert _config().fingerprint() == base
        for change in (
            {"google_drive_shared_drive_id": "0AOtherDrive12345"},
            {"google_drive_folder_id": "1OtherFolder12345"},
            {"google_drive_service_account_key": KEY.replace("abc123", "def456")},
        ):
            assert _config(**change).fingerprint() != base, change
        assert "not-a-real-key" not in base

    def test_describe_names_the_account_never_the_key(self):
        described = _config().describe()
        assert described["service_account"] == (
            "logbook@dept-files.iam.gserviceaccount.com"
        )
        assert "PRIVATE KEY" not in json.dumps(described)

    def test_the_key_is_a_secret(self):
        stored = encrypt_settings_secrets({"file_storage": _settings()})
        assert stored["file_storage"]["google_drive_service_account_key"].startswith(
            "enc:"
        )
        shown = FileStorageSettings(**_settings()).redacted()
        assert shown.google_drive_service_account_key == "••••••••"
        assert (
            FileStorageSettings(**_settings())
            .without_infrastructure()
            .model_dump()["google_drive_shared_drive_id"]
            is None
        )


# ---------------------------------------------------------------------------
# The backend
# ---------------------------------------------------------------------------


class TestBackend:
    def test_round_trip_is_encrypted_in_the_drive(self, drive):
        backend = _backend(drive)
        ref = backend.ref_for(f"{ORG}/documents/rec/a.pdf")
        backend.put(ref, PDF)

        stored = next(iter(drive.files.values()))
        assert file_encryption.is_encrypted_bytes(stored["bytes"])
        assert b"%PDF" not in stored["bytes"]
        assert stored["parents"] == [FOLDER]
        assert stored["mime"] == "application/octet-stream"
        assert stored["name"] == f"{ORG}_documents_rec_a.pdf"

        assert backend.exists(ref)
        assert backend.read_bytes(ref) == PDF
        assert backend.plaintext_size(ref) == len(PDF)
        assert backend.key_id(ref) == bytes.fromhex(
            file_encryption.current_key_fingerprint()
        )

    def test_large_file_streams_in_chunks(self, drive):
        backend = _backend(drive)
        ref = backend.ref_for(f"{ORG}/documents/rec/big.bin")
        data = bytes(range(256)) * 1000
        backend.put(ref, data)
        size, chunks = backend.open_plaintext(ref)
        pieces = list(chunks)
        assert size == len(data)
        assert len(pieces) > 1
        assert b"".join(pieces) == data

    def test_an_id_that_holds_a_file_is_replaced(self, drive):
        backend = _backend(drive)
        ref = backend.ref_for(f"{ORG}/documents/rec/a.pdf")
        backend.put(ref, b"first")
        backend.put(ref, b"second")
        assert len(drive.files) == 1
        assert backend.read_bytes(ref) == b"second"
        assert [c[0] for c in drive.calls if "upload" in c[1]] == [
            "POST",
            "POST",
            "PATCH",
        ]

    def test_ids_are_reserved_in_batches(self, drive):
        backend = _backend(drive)
        refs = {backend.ref_for(f"{ORG}/documents/rec/{i}.pdf") for i in range(5)}
        assert len(refs) == 5
        assert sum(1 for c in drive.calls if c[1].endswith("generateIds")) == 1

    def test_missing_file(self, drive):
        backend = _backend(drive)
        ref = backend.ref_for(f"{ORG}/documents/rec/none.pdf")
        assert backend.exists(ref) is False
        with pytest.raises(FileNotFoundError):
            backend.read_bytes(ref)

    def test_a_file_in_another_drive_does_not_count(self, drive):
        backend = _backend(drive)
        ref = backend.ref_for(f"{ORG}/documents/rec/a.pdf")
        backend.put(ref, PDF)
        location = gdrive.parse_ref(ref)
        elsewhere = gdrive.make_ref("0AOtherDrive12345", location.file_id, location.key)
        assert backend.exists(elsewhere) is False

    def test_delete_moves_the_file_to_the_drive_trash(self, drive):
        """Content manager may trash a file but not delete it outright, so a
        delete is a move to the Shared Drive's trash, which Google empties
        after 30 days. It must still read as gone, and repeat as gone."""
        backend = _backend(drive)
        ref = backend.ref_for(f"{ORG}/documents/rec/a.pdf")
        backend.put(ref, PDF)
        file_id = gdrive.parse_ref(ref).file_id

        assert backend.delete(ref) is True
        assert backend.exists(ref) is False
        assert drive.files[file_id]["trashed"] is True
        assert drive.live() == {}
        assert backend.delete(ref) is True
        assert not [c for c in drive.calls if c[0] == "DELETE"]

    def test_delete_of_a_file_already_gone_reports_gone(self, drive):
        backend = _backend(drive)
        ref = backend.ref_for(f"{ORG}/documents/rec/a.pdf")
        assert backend.delete(ref) is True

    def test_delete_without_the_content_manager_role_reports_failure(self, drive):
        backend = _backend(drive)
        ref = backend.ref_for(f"{ORG}/documents/rec/a.pdf")
        backend.put(ref, PDF)
        drive.role = "writer"
        assert backend.delete(ref) is False
        assert backend.exists(ref) is True

    def test_an_unreachable_drive_is_a_storage_error(self, drive):
        backend = _backend(drive)
        ref = backend.ref_for(f"{ORG}/documents/rec/a.pdf")
        drive.down = True
        with pytest.raises(GoogleDriveStorageError):
            backend.put(ref, PDF)
        with pytest.raises(GoogleDriveStorageError):
            backend.exists(ref)
        with pytest.raises(GoogleDriveStorageError):
            backend.read_bytes(ref)
        assert backend.delete(ref) is False

    def test_an_unknown_parent_is_refused(self, drive):
        backend = GoogleDriveBackend(
            _config(google_drive_folder_id="1NotInTheDrive123"), session=drive
        )
        ref = backend.ref_for(f"{ORG}/documents/rec/a.pdf")
        with pytest.raises(GoogleDriveStorageError):
            backend.put(ref, PDF)


# ---------------------------------------------------------------------------
# Where new files go, and the connection test
# ---------------------------------------------------------------------------


def _org_settings(*, activated: bool, **overrides):
    stored = {"file_storage": _settings(**overrides)}
    if activated:
        stored[ACTIVATION_KEY] = {
            "platform": "googledrive",
            "fingerprint": _config().fingerprint(),
            "container": DRIVE,
            "activated_at": "2026-10-23T12:00:00+00:00",
        }
    return encrypt_settings_secrets(stored)


def _saved(monkeypatch, settings_dict):
    monkeypatch.setattr(
        file_storage, "_load_settings", AsyncMock(return_value=settings_dict)
    )


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


class TestWhereNewFilesGo:
    async def test_untested_settings_keep_files_on_disk(self, drive, root, monkeypatch):
        _saved(monkeypatch, _org_settings(activated=False))
        ref = await file_storage.write_file(
            ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
        )
        assert ref.startswith(str(root))
        assert drive.files == {}

    async def test_tested_settings_send_files_to_the_drive(
        self, drive, root, monkeypatch
    ):
        _saved(monkeypatch, _org_settings(activated=True))
        ref = await file_storage.write_file(
            ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
        )
        assert ref.startswith(f"gdrive://{DRIVE}/")
        assert ref.endswith(f"/{ORG}/documents/rec/a.pdf")
        assert file_storage.resolve(ref, ORG, StorageArea.DOCUMENTS) == ref
        assert await file_storage.read_bytes(ref) == PDF
        response = await file_storage.file_response(
            ref, filename="Minutes.pdf", media_type="application/pdf"
        )
        body = b"".join([chunk async for chunk in response.body_iterator])
        assert body == PDF
        assert await file_storage.delete(ref) is True
        assert drive.live() == {}

    async def test_a_changed_key_goes_back_to_disk(self, drive, root, monkeypatch):
        _saved(
            monkeypatch,
            _org_settings(
                activated=True,
                google_drive_service_account_key=KEY.replace("abc123", "zzz999"),
            ),
        )
        view = await file_storage.org_storage(ORG)
        assert view.writes_to is None
        assert view.changed_since_test is True

    async def test_an_unreachable_drive_refuses_the_upload(
        self, drive, root, monkeypatch
    ):
        _saved(monkeypatch, _org_settings(activated=True))
        drive.down = True
        with pytest.raises(CodedHTTPException) as caught:
            await file_storage.write_file(
                ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
            )
        assert caught.value.status_code == 503
        assert not any(root.rglob("*.pdf"))

    async def test_a_bad_key_is_reported_on_the_status(self, drive, monkeypatch):
        _saved(
            monkeypatch,
            _org_settings(activated=False, google_drive_service_account_key="{bad"),
        )
        view = await file_storage.org_storage(ORG)
        assert "not valid JSON" in view.problems["googledrive"]


class _Db:
    def __init__(self):
        self.commit = AsyncMock()
        self.rollback = AsyncMock()


class TestActivate:
    async def test_passes_records_and_leaves_no_test_file(self, drive, monkeypatch):
        saved = _org_settings(activated=False)
        _saved(monkeypatch, saved)
        organization = SimpleNamespace(settings=saved)
        monkeypatch.setattr(
            file_storage, "_lock_organization", AsyncMock(return_value=organization)
        )
        db = _Db()

        view = await file_storage.activate_remote(db, ORG, "admin-id")

        record = organization.settings[ACTIVATION_KEY]
        assert record["platform"] == "googledrive"
        assert record["fingerprint"] == _config().fingerprint()
        assert record["container"] == DRIVE
        assert record["service_account"] == (
            "logbook@dept-files.iam.gserviceaccount.com"
        )
        assert "PRIVATE KEY" not in json.dumps(record)
        db.commit.assert_awaited_once()
        assert drive.live() == {}
        assert view is not None

    async def test_a_drive_the_account_cannot_reach_fails_cleanly(
        self, drive, monkeypatch
    ):
        _saved(
            monkeypatch,
            _org_settings(activated=False, google_drive_folder_id="1NotInTheDrive123"),
        )
        lock = AsyncMock()
        monkeypatch.setattr(file_storage, "_lock_organization", lock)
        with pytest.raises(ValueError, match="Content manager"):
            await file_storage.activate_remote(_Db(), ORG, "admin-id")
        lock.assert_not_awaited()

    async def test_needs_the_key_and_drive(self, monkeypatch):
        _saved(monkeypatch, {"file_storage": {"platform": "googledrive"}})
        with pytest.raises(ValueError, match="service account key"):
            await file_storage.activate_remote(_Db(), ORG, "admin-id")


class TestStatus:
    async def test_the_status_names_google_drive(self, drive, monkeypatch):
        from app.api.v1.endpoints import organizations

        _saved(monkeypatch, _org_settings(activated=True))
        user = SimpleNamespace(id="admin-id", username="chief", organization_id=ORG)
        status_view = await organizations.get_file_storage_status(
            db=MagicMock(), current_user=user
        )
        assert status_view.platform_label == "Google Drive"
        assert status_view.container_noun == "shared drive"
        assert status_view.container == DRIVE
        assert status_view.new_files_go_to == "googledrive"


class TestAuthorizedSession:
    def test_the_real_session_is_scoped_and_retries(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        key = json.dumps(
            {
                "type": "service_account",
                "client_email": "logbook@dept-files.iam.gserviceaccount.com",
                "private_key": pem,
                "private_key_id": "abc123",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        )
        session = gdrive._authorized_session(
            _config(google_drive_service_account_key=key)
        )
        assert tuple(session.credentials.scopes) == gdrive.SCOPES
        adapter = session.get_adapter("https://www.googleapis.com/drive/v3/files")
        assert adapter.max_retries.total == 3
        assert 503 in adapter.max_retries.status_forcelist


class TestMigrationOntoDrive:
    def test_a_dry_run_reserves_nothing_and_the_copy_does(self, drive, root):
        from app.services import remote_migration
        from app.services.upload_relocation import Reference

        path = file_storage.write_atomically(
            file_storage.area_directory(ORG, StorageArea.DOCUMENTS, "rec"),
            "a.pdf",
            PDF,
        )
        backend = _backend(drive)
        report = remote_migration.plan(
            [Reference("documents", "row-1", ORG, StorageArea.DOCUMENTS, "rec", path)],
            {ORG: backend},
        )
        assert [c.key for c in report.copies] == [f"{ORG}/documents/rec/a.pdf"]
        assert report.copies[0].ref == ""
        assert drive.calls == []

        copy = report.copies[0]
        digest = remote_migration._copy_verified(backend, copy)
        assert copy.ref.startswith(f"gdrive://{DRIVE}/")
        assert backend.read_bytes(copy.ref) == PDF
        assert digest == remote_migration._sha256(PDF)
