"""app.core.file_encryption — the at-rest format for stored files."""

import os

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core import file_encryption as fe
from app.core.config import settings
from app.core.security import reset_encryption_ciphers

pytestmark = pytest.mark.unit

KEY_A = "a" * 64
KEY_B = "b" * 64


@pytest.fixture(autouse=True)
def _keys(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_A)
    monkeypatch.setattr(settings, "ENCRYPTION_SALT", "0" * 32)
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", "")
    reset_encryption_ciphers()
    yield
    reset_encryption_ciphers()


def _write(tmp_path, data: bytes, name="f.bin") -> str:
    path = tmp_path / name
    path.write_bytes(data)
    return str(path)


@pytest.mark.parametrize(
    "size",
    [0, 1, fe.CHUNK_SIZE - 1, fe.CHUNK_SIZE, fe.CHUNK_SIZE + 1, 3 * fe.CHUNK_SIZE + 7],
)
def test_round_trip_at_chunk_boundaries(tmp_path, size):
    data = os.urandom(size)
    blob = fe.encrypt_bytes(data)

    assert fe.is_encrypted_bytes(blob)
    if size >= 16:
        # Too short a run could turn up in ciphertext by chance.
        assert data not in blob
    assert fe.decrypt_bytes(blob) == data
    path = _write(tmp_path, blob)
    assert fe.read_plaintext(path) == data
    assert fe.plaintext_size(path) == size
    assert b"".join(fe.iter_plaintext(path)) == data


def test_each_file_gets_its_own_key_and_nonces():
    data = b"same bytes" * 100
    assert fe.encrypt_bytes(data) != fe.encrypt_bytes(data)


def test_a_plain_file_is_read_as_it_is(tmp_path):
    path = _write(tmp_path, b"%PDF-1.4 stored before encryption")
    assert not fe.is_encrypted(path)
    assert fe.read_plaintext(path) == b"%PDF-1.4 stored before encryption"
    assert fe.plaintext_size(path) == len(b"%PDF-1.4 stored before encryption")
    assert fe.key_id_of(path) is None


def test_a_flipped_bit_anywhere_is_refused():
    blob = bytearray(fe.encrypt_bytes(os.urandom(2 * fe.CHUNK_SIZE)))
    for offset in (10, fe.HEADER_SIZE - 1, fe.HEADER_SIZE + 5, len(blob) - 1):
        damaged = bytearray(blob)
        damaged[offset] ^= 0x01
        with pytest.raises(fe.FileDecryptionError):
            fe.decrypt_bytes(bytes(damaged))


def test_truncation_at_a_chunk_boundary_is_refused():
    blob = fe.encrypt_bytes(os.urandom(2 * fe.CHUNK_SIZE))
    one_chunk = fe.HEADER_SIZE + fe.CHUNK_SIZE + 16
    with pytest.raises(fe.FileDecryptionError):
        fe.decrypt_bytes(blob[:one_chunk])


def test_reordered_chunks_are_refused():
    blob = fe.encrypt_bytes(os.urandom(3 * fe.CHUNK_SIZE))
    sealed = fe.CHUNK_SIZE + 16
    start = fe.HEADER_SIZE
    first, second = (
        blob[start : start + sealed],
        blob[start + sealed : start + 2 * sealed],
    )
    swapped = blob[:start] + second + first + blob[start + 2 * sealed :]
    with pytest.raises(fe.FileDecryptionError):
        fe.decrypt_bytes(swapped)


def test_trailing_bytes_are_refused():
    with pytest.raises(fe.FileDecryptionError):
        fe.decrypt_bytes(fe.encrypt_bytes(b"x") + b"extra")


def test_another_key_cannot_read_it(monkeypatch):
    blob = fe.encrypt_bytes(b"secret")
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_B)
    reset_encryption_ciphers()
    with pytest.raises(fe.FileDecryptionError):
        fe.decrypt_bytes(blob)


def test_a_rotated_key_still_reads_through_the_legacy_ring(monkeypatch):
    blob = fe.encrypt_bytes(b"secret")
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_B)
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", KEY_A)
    reset_encryption_ciphers()
    assert fe.decrypt_bytes(blob) == b"secret"


def test_rewrap_moves_a_file_to_the_current_key(tmp_path, monkeypatch):
    data = os.urandom(fe.CHUNK_SIZE + 3)
    path = _write(tmp_path, fe.encrypt_bytes(data))
    old_id = fe.key_id_of(path)
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_B)
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", KEY_A)
    reset_encryption_ciphers()

    assert fe.rewrap(path) is True
    assert fe.key_id_of(path) != old_id
    assert fe.rewrap(path) is False

    # Once rewrapped, the old key can be retired.
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", "")
    reset_encryption_ciphers()
    assert fe.read_plaintext(path) == data
    assert not [p for p in os.listdir(tmp_path) if p.endswith(".rewrap")]


def test_the_fingerprint_identifies_the_key_without_revealing_it(monkeypatch):
    first = fe.current_key_fingerprint()
    assert len(first) == 16
    assert KEY_A[:16] not in first
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_B)
    reset_encryption_ciphers()
    assert fe.current_key_fingerprint() != first


def test_the_file_key_is_not_the_field_key():
    from app.core.security import _derive_key_bytes

    field_key = _derive_key_bytes(KEY_A)
    blob = fe.encrypt_bytes(b"x")
    # The DEK wrap must not open with the database-field key.
    header = fe._parse_header(blob[: fe.HEADER_SIZE])
    with pytest.raises(InvalidTag):
        AESGCM(field_key).decrypt(
            header.wrap_nonce, header.wrapped_dek, fe.MAGIC + header.key_id
        )


def test_no_key_refuses_to_write(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")
    reset_encryption_ciphers()
    with pytest.raises(RuntimeError):
        fe.encrypt_bytes(b"x")


class TestStoredFileResponse:
    async def _body(self, response):
        return b"".join([chunk async for chunk in response.body_iterator])

    async def test_an_encrypted_file_streams_its_plaintext(self, tmp_path):
        from app.services.file_storage_service import stored_file_response

        data = os.urandom(fe.CHUNK_SIZE * 2 + 9)
        path = _write(tmp_path, fe.encrypt_bytes(data))

        response = stored_file_response(
            path, filename="2026-10-09_Engine-1.pdf", media_type="application/pdf"
        )

        assert response.headers["content-length"] == str(len(data))
        assert response.headers["content-disposition"] == (
            'attachment; filename="2026-10-09_Engine-1.pdf"'
        )
        assert await self._body(response) == data

    async def test_a_non_ascii_name_uses_the_utf8_form(self, tmp_path):
        from app.services.file_storage_service import stored_file_response

        path = _write(tmp_path, fe.encrypt_bytes(b"x"))
        response = stored_file_response(
            path,
            filename="Camión.png",
            media_type="image/png",
            content_disposition_type="inline",
        )
        assert response.headers["content-disposition"] == (
            "inline; filename*=utf-8''Cami%C3%B3n.png"
        )

    def test_a_plain_file_is_still_served_from_disk(self, tmp_path):
        from fastapi.responses import FileResponse

        from app.services.file_storage_service import stored_file_response

        path = _write(tmp_path, b"stored before encryption")
        response = stored_file_response(path, filename="a.txt", media_type="text/plain")
        assert isinstance(response, FileResponse)

    def test_a_file_under_an_unknown_key_fails_before_the_response(
        self, tmp_path, monkeypatch
    ):
        from app.services.file_storage_service import stored_file_response

        path = _write(tmp_path, fe.encrypt_bytes(b"x"))
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_B)
        reset_encryption_ciphers()
        with pytest.raises(fe.FileDecryptionError):
            stored_file_response(path, filename="a", media_type="text/plain")


def test_no_endpoint_serves_a_stored_file_without_decrypting_it():
    """Every download goes through stored_file_response.

    A bare FileResponse over a stored path would send the ciphertext.
    """
    from pathlib import Path

    app_dir = Path(__file__).resolve().parents[1] / "app"
    offenders = [
        str(path.relative_to(app_dir))
        for path in app_dir.rglob("*.py")
        if "FileResponse(" in path.read_text(encoding="utf-8")
        and path.name != "file_storage_service.py"
    ]
    assert offenders == []
