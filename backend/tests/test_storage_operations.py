"""Stored files are read, checked, served and deleted only through
``file_storage_service``'s operations.

A department's files are not always on the local volume (a department may
keep them in its own S3 bucket), so a caller that reaches for ``os`` on a
resolved path works for one department and breaks for the next. The sweeps
below keep callers off the filesystem and off the write helpers that bypass
the department's choice; the rest checks the local backend itself.
"""

import ast
from pathlib import Path

import pytest

from app.core import file_encryption
from app.services import file_storage_service as file_storage

pytestmark = pytest.mark.unit

APP = Path(__file__).resolve().parents[1] / "app"

# Calls that touch a file by path. Inside app/ only the storage layer itself,
# the encryption, relocation and bucket-migration tooling (which work on the
# local volume by design), and files that never hold an upload may make them.
FILESYSTEM_CALLS = {
    "os.remove",
    "os.unlink",
    "os.path.exists",
    "os.path.isfile",
    "file_encryption.read_plaintext",
    "file_encryption.plaintext_size",
    "file_encryption.iter_plaintext",
    "file_encryption.open_plaintext_stream",
}

ALLOWED = {
    # The storage layer and its tooling.
    "services/file_storage_service.py",
    "core/file_encryption.py",
    "services/upload_encryption.py",
    "services/upload_relocation.py",
    "services/s3_migration.py",
    # Not uploads: the log file, and a temporary PDF an election email is
    # built from and removes again.
    "core/logging.py",
    "services/election_service.py",
}


def _offenders() -> list[str]:
    found = []
    for path in APP.rglob("*.py"):
        relative = path.relative_to(APP).as_posix()
        if relative in ALLOWED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(
                node.func, ast.Attribute
            ):
                continue
            dotted = ast.unparse(node.func)
            if dotted in FILESYSTEM_CALLS:
                found.append(f"{relative}:{node.lineno} {dotted}")
    return found


def test_no_caller_touches_a_stored_file_through_os():
    assert _offenders() == []


# Writing straight to a directory skips the department's choice of storage:
# new files must go through FileStorageService or file_storage.write_file.
DIRECT_WRITES = {
    "file_storage.write_atomically",
    "file_storage.area_directory",
    "file_storage_service.write_atomically",
    "file_storage_service.area_directory",
}
# Relocation moves files that are already on the local volume, by design.
DIRECT_WRITE_ALLOWED = {
    "services/file_storage_service.py",
    "services/upload_relocation.py",
}


def test_no_caller_writes_around_the_departments_storage_choice():
    found = []
    for path in APP.rglob("*.py"):
        relative = path.relative_to(APP).as_posix()
        if relative in DIRECT_WRITE_ALLOWED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                dotted = ast.unparse(node.func)
                if dotted in DIRECT_WRITES:
                    found.append(f"{relative}:{node.lineno} {dotted}")
            if isinstance(node, ast.ImportFrom) and node.module == (
                "app.services.file_storage_service"
            ):
                for alias in node.names:
                    if alias.name in ("write_atomically", "area_directory"):
                        found.append(f"{relative}:{node.lineno} {alias.name}")
    assert found == []


def test_only_the_s3_backend_talks_to_a_bucket():
    found = []
    for path in APP.rglob("*.py"):
        relative = path.relative_to(APP).as_posix()
        if relative == "services/s3_storage.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for name in names:
                if name.split(".")[0] in ("boto3", "botocore"):
                    found.append(f"{relative}:{node.lineno} {name}")
    assert found == []


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


def _stored(uploads, data: bytes = b"hello") -> str:
    directory = file_storage.area_directory(
        "org-1", file_storage.StorageArea.DOCUMENTS, "doc-1"
    )
    return file_storage.write_atomically(directory, "a.txt", data)


class TestLocalOperations:
    async def test_a_stored_file_exists_and_reads_back_as_plaintext(self, uploads):
        ref = _stored(uploads, b"plaintext")
        assert file_encryption.is_encrypted(ref)
        assert await file_storage.exists(ref)
        assert await file_storage.read_bytes(ref) == b"plaintext"
        assert await file_storage.plaintext_size(ref) == len(b"plaintext")

    async def test_an_empty_or_missing_reference_does_not_exist(self, uploads):
        assert not await file_storage.exists(None)
        assert not await file_storage.exists("")
        assert not await file_storage.exists(str(uploads / "nothing"))

    async def test_delete_reports_gone_and_a_missing_file_counts(self, uploads):
        ref = _stored(uploads)
        assert await file_storage.delete(ref)
        assert not await file_storage.exists(ref)
        assert await file_storage.delete(ref)

    async def test_delete_reports_a_failure_without_raising(self, uploads, monkeypatch):
        ref = _stored(uploads)

        def refuse(_path):
            raise PermissionError("read-only volume")

        monkeypatch.setattr(file_storage.os, "remove", refuse)
        assert await file_storage.delete(ref) is False
        await file_storage.delete_quietly(ref)

    async def test_delete_quietly_accepts_nothing(self, uploads):
        await file_storage.delete_quietly(None)
        await file_storage.delete_quietly("")

    async def test_the_response_streams_the_plaintext(self, uploads):
        ref = _stored(uploads, b"0123456789")
        response = await file_storage.file_response(
            ref, filename="notes.txt", media_type="text/plain"
        )
        assert response.headers["content-length"] == "10"
        assert 'filename="notes.txt"' in response.headers["content-disposition"]
        body = b"".join([chunk async for chunk in response.body_iterator])
        assert body == b"0123456789"
