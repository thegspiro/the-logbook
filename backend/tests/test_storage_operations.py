"""Stored files are read, checked, served and deleted only through
``file_storage_service``'s operations.

A department's files will not always be on the local volume (the S3 backend
is being built on this interface), so a caller that reaches for ``os`` on a
resolved path would work today and break the day a department moves. The
sweep below keeps them out; the rest checks the local backend itself.
"""

import ast
from pathlib import Path

import pytest

from app.core import file_encryption
from app.services import file_storage_service as file_storage

pytestmark = pytest.mark.unit

APP = Path(__file__).resolve().parents[1] / "app"

# Calls that touch a file by path. Inside app/ only the storage layer itself,
# the encryption and relocation tooling (which walk the local volume by
# design), and files that never hold an upload may make them.
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
