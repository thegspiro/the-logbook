"""Encryption at rest for stored files (docs/FILE_STORAGE_HARDENING.md, Phase 4).

Every file written under the uploads root is encrypted with its own random
256-bit key (the DEK). The DEK is wrapped with a file key-encryption key (the
KEK) derived from ``ENCRYPTION_KEY`` and ``ENCRYPTION_SALT``, so there is no
second secret to keep (owner decision 23). Losing the key loses every file.

Layout of an encrypted file::

    header (94 bytes)
      magic          6   b"LBENC\\x01"
      key id         8   fingerprint of the KEK that wrapped the DEK
      wrap nonce    12
      wrapped DEK   48   AES-256-GCM(KEK, DEK), AAD = magic || key id
      nonce prefix   8   random, per file
      chunk size     4   big-endian
      plain size     8   big-endian
    body
      chunk 0 .. n-1, each AES-256-GCM(DEK) over up to ``chunk size`` bytes
        nonce = nonce prefix || chunk index (4 bytes, big-endian)
        AAD   = header || chunk index || final flag

The header in every chunk's AAD binds the body to its header; the index and
final flag stop chunks being reordered, dropped or the file truncated at a
chunk boundary. Chunking is what lets a download stream a 50 MB file instead
of decrypting it whole.

A file without the magic is a file stored before Phase 4 and is read as is,
until ``scripts/encrypt_uploads.py`` encrypts it.

Rotation: the KEK for every key in ``ENCRYPTION_KEYS_LEGACY`` is tried by key
id, and :func:`rewrap` re-wraps a file's DEK under the current KEK. The DEK
itself never changes, but because each chunk's AAD covers the header, the
body is re-sealed with it.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import os
import struct
import threading
from dataclasses import dataclass
from typing import BinaryIO, Iterator

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

MAGIC = b"LBENC\x01"
CHUNK_SIZE = 64 * 1024

_KEY_ID_BYTES = 8
_NONCE_BYTES = 12
_NONCE_PREFIX_BYTES = 8
_TAG_BYTES = 16
_DEK_BYTES = 32
_WRAPPED_DEK_BYTES = _DEK_BYTES + _TAG_BYTES
_HEADER = struct.Struct(
    f">6s{_KEY_ID_BYTES}s{_NONCE_BYTES}s{_WRAPPED_DEK_BYTES}s{_NONCE_PREFIX_BYTES}sIQ"
)
HEADER_SIZE = _HEADER.size

_HKDF_SALT = b"the-logbook file encryption"
_HKDF_INFO = b"file key-encryption key v1"
_KEY_ID_LABEL = b"the-logbook file key id"


class FileDecryptionError(Exception):
    """A stored file failed to decrypt: wrong key, or damaged or altered."""


@dataclass(frozen=True)
class _Kek:
    key_id: bytes
    aead: AESGCM


@dataclass(frozen=True)
class _Header:
    key_id: bytes
    wrap_nonce: bytes
    wrapped_dek: bytes
    nonce_prefix: bytes
    chunk_size: int
    plain_size: int
    raw: bytes


_lock = threading.Lock()
# Keyed by (key, salt): the derivation depends on both.
_keks: dict[tuple[str, str], _Kek] = {}


def _kek_for(master_key: str) -> _Kek:
    """The file KEK for one ENCRYPTION_KEY value, cached.

    Built on the same PBKDF2 derivation the database fields use (600k
    iterations, the installation salt) and separated from it by HKDF, so the
    file key is never the field key itself.
    """
    cache_key = (master_key, settings.ENCRYPTION_SALT or "")
    with _lock:
        cached = _keks.get(cache_key)
        if cached is not None:
            return cached
    # Imported here: security imports this module to reset its cache.
    from app.core.security import _derive_key_bytes

    base = _derive_key_bytes(master_key)
    kek_bytes = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=_HKDF_SALT, info=_HKDF_INFO
    ).derive(base)
    key_id = hmac.new(kek_bytes, _KEY_ID_LABEL, hashlib.sha256).digest()[:_KEY_ID_BYTES]
    kek = _Kek(key_id=key_id, aead=AESGCM(kek_bytes))
    with _lock:
        _keks[cache_key] = kek
    return kek


def _current_kek() -> _Kek:
    if not settings.ENCRYPTION_KEY:
        raise RuntimeError("ENCRYPTION_KEY must be set to store files")
    return _kek_for(settings.ENCRYPTION_KEY)


def _kek_by_id(key_id: bytes) -> _Kek:
    current = _current_kek()
    if hmac.compare_digest(current.key_id, key_id):
        return current
    raw = getattr(settings, "ENCRYPTION_KEYS_LEGACY", "") or ""
    for legacy in (k.strip() for k in raw.split(",") if k.strip()):
        kek = _kek_for(legacy)
        if hmac.compare_digest(kek.key_id, key_id):
            return kek
    raise FileDecryptionError(
        "The file was encrypted with a key that is neither ENCRYPTION_KEY nor "
        "listed in ENCRYPTION_KEYS_LEGACY"
    )


def reset_file_keys() -> None:
    """Forget derived keys (after settings change, and in tests)."""
    with _lock:
        _keks.clear()


def current_key_fingerprint() -> str:
    """Hex fingerprint of the current file key. Identifies it, reveals nothing."""
    return _current_kek().key_id.hex()


def _chunk_nonce(prefix: bytes, index: int) -> bytes:
    return prefix + struct.pack(">I", index)


def _chunk_aad(header: bytes, index: int, final: bool) -> bytes:
    return header + struct.pack(">I?", index, final)


def _chunk_count(plain_size: int, chunk_size: int) -> int:
    return max(1, -(-plain_size // chunk_size))


def _wrap_aad(key_id: bytes) -> bytes:
    return MAGIC + key_id


def is_encrypted_bytes(head: bytes) -> bool:
    return head[: len(MAGIC)] == MAGIC


def is_encrypted(path: str) -> bool:
    with open(path, "rb") as handle:
        return is_encrypted_bytes(handle.read(len(MAGIC)))


def _parse_header(raw: bytes) -> _Header:
    if len(raw) != HEADER_SIZE or not is_encrypted_bytes(raw):
        raise FileDecryptionError("Not an encrypted file")
    _magic, key_id, wrap_nonce, wrapped, prefix, chunk_size, plain_size = (
        _HEADER.unpack(raw)
    )
    if chunk_size <= 0 or chunk_size > 16 * 1024 * 1024:
        raise FileDecryptionError("Damaged file header")
    return _Header(key_id, wrap_nonce, wrapped, prefix, chunk_size, plain_size, raw)


def _unwrap(header: _Header) -> AESGCM:
    kek = _kek_by_id(header.key_id)
    try:
        dek = kek.aead.decrypt(
            header.wrap_nonce, header.wrapped_dek, _wrap_aad(header.key_id)
        )
    except InvalidTag as exc:
        raise FileDecryptionError("The file key does not unwrap") from exc
    return AESGCM(dek)


def encrypt_bytes(data: bytes, *, chunk_size: int = CHUNK_SIZE) -> bytes:
    """``data`` as an encrypted file's full contents."""
    kek = _current_kek()
    dek = AESGCM.generate_key(bit_length=256)
    wrap_nonce = os.urandom(_NONCE_BYTES)
    wrapped = kek.aead.encrypt(wrap_nonce, dek, _wrap_aad(kek.key_id))
    prefix = os.urandom(_NONCE_PREFIX_BYTES)
    header = _HEADER.pack(
        MAGIC, kek.key_id, wrap_nonce, wrapped, prefix, chunk_size, len(data)
    )
    aead = AESGCM(dek)
    count = _chunk_count(len(data), chunk_size)
    parts = [header]
    for index in range(count):
        chunk = data[index * chunk_size : (index + 1) * chunk_size]
        final = index == count - 1
        parts.append(
            aead.encrypt(
                _chunk_nonce(prefix, index), chunk, _chunk_aad(header, index, final)
            )
        )
    return b"".join(parts)


def _iter_chunks(handle: BinaryIO) -> Iterator[bytes]:
    header = _parse_header(handle.read(HEADER_SIZE))
    aead = _unwrap(header)
    count = _chunk_count(header.plain_size, header.chunk_size)
    produced = 0
    for index in range(count):
        final = index == count - 1
        expected = (
            header.plain_size - index * header.chunk_size
            if final
            else header.chunk_size
        )
        sealed = handle.read(expected + _TAG_BYTES)
        if len(sealed) != expected + _TAG_BYTES:
            raise FileDecryptionError("The file is truncated")
        try:
            plain = aead.decrypt(
                _chunk_nonce(header.nonce_prefix, index),
                sealed,
                _chunk_aad(header.raw, index, final),
            )
        except InvalidTag as exc:
            raise FileDecryptionError("The file is damaged or altered") from exc
        produced += len(plain)
        yield plain
    if handle.read(1):
        raise FileDecryptionError("The file has trailing data")
    if produced != header.plain_size:
        raise FileDecryptionError("The file is truncated")


def decrypt_bytes(blob: bytes) -> bytes:
    return b"".join(_iter_chunks(io.BytesIO(blob)))


def iter_plaintext(path: str, chunk_size: int = CHUNK_SIZE) -> Iterator[bytes]:
    """The stored file's plaintext, a chunk at a time; plain files as they are.

    A decryption failure raises mid-stream, after a download response has
    started: the client sees a truncated transfer, never wrong bytes.
    """
    with open(path, "rb") as handle:
        head = handle.read(len(MAGIC))
        handle.seek(0)
        if is_encrypted_bytes(head):
            yield from _iter_chunks(handle)
            return
        while True:
            block = handle.read(chunk_size)
            if not block:
                return
            yield block


def read_plaintext(path: str) -> bytes:
    """The whole stored file, decrypted (for email attachments)."""
    return b"".join(iter_plaintext(path))


def plaintext_size(path: str) -> int:
    """Size of what a reader receives: the header's size, or the file's."""
    with open(path, "rb") as handle:
        head = handle.read(HEADER_SIZE)
    if is_encrypted_bytes(head):
        return _parse_header(head).plain_size
    return os.path.getsize(path)


def key_id_of(path: str) -> bytes | None:
    """The key id an encrypted file was wrapped with; None for a plain file."""
    with open(path, "rb") as handle:
        head = handle.read(HEADER_SIZE)
    if not is_encrypted_bytes(head):
        return None
    return _parse_header(head).key_id


def rewrap(path: str) -> bool:
    """Re-wrap a file's key under the current ENCRYPTION_KEY, in place.

    The file keeps its DEK; the header gets the new wrap and the body is
    re-sealed against it. Written to a temporary file and swapped in, so a
    crash leaves the old file intact. Returns False when the file is plain or
    already current.
    """
    with open(path, "rb") as handle:
        head = handle.read(HEADER_SIZE)
    if not is_encrypted_bytes(head):
        return False
    header = _parse_header(head)
    current = _current_kek()
    if hmac.compare_digest(header.key_id, current.key_id):
        return False
    old = _kek_by_id(header.key_id)
    try:
        dek = old.aead.decrypt(
            header.wrap_nonce, header.wrapped_dek, _wrap_aad(header.key_id)
        )
    except InvalidTag as exc:
        raise FileDecryptionError("The file key does not unwrap") from exc
    # The body's AAD includes the whole header, so a new header means new
    # chunk tags: re-seal the body under the same DEK and a fresh prefix.
    with open(path, "rb") as handle:
        plain = b"".join(_iter_chunks(handle))
    wrap_nonce = os.urandom(_NONCE_BYTES)
    wrapped = current.aead.encrypt(wrap_nonce, dek, _wrap_aad(current.key_id))
    prefix = os.urandom(_NONCE_PREFIX_BYTES)
    new_header = _HEADER.pack(
        MAGIC,
        current.key_id,
        wrap_nonce,
        wrapped,
        prefix,
        header.chunk_size,
        header.plain_size,
    )
    aead = AESGCM(dek)
    count = _chunk_count(len(plain), header.chunk_size)
    parts = [new_header]
    for index in range(count):
        chunk = plain[index * header.chunk_size : (index + 1) * header.chunk_size]
        parts.append(
            aead.encrypt(
                _chunk_nonce(prefix, index),
                chunk,
                _chunk_aad(new_header, index, index == count - 1),
            )
        )
    directory, name = os.path.split(path)
    partial = os.path.join(directory, f".{name}.rewrap")
    fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
    with os.fdopen(fd, "wb") as out:
        out.write(b"".join(parts))
        out.flush()
        os.fsync(out.fileno())
    os.replace(partial, path)
    return True


def open_plaintext_stream(path: str) -> tuple[int, Iterator[bytes]]:
    """``(plaintext size, chunk iterator)`` for an encrypted file.

    The header is parsed and the key unwrapped before this returns, so a file
    under an unknown key fails before a download response has started rather
    than part-way through it.
    """
    with open(path, "rb") as handle:
        header = _parse_header(handle.read(HEADER_SIZE))
    _unwrap(header)

    def chunks() -> Iterator[bytes]:
        with open(path, "rb") as handle:
            yield from _iter_chunks(handle)

    return header.plain_size, chunks()
