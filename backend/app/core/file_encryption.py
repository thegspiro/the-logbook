"""
Encryption at rest for stored files (AES-256-GCM, chunked).

Database fields have been encrypted since the AES-256-GCM migration; uploaded
files were written as plain bytes. This module encrypts file *contents* so the
uploads volume — and every backup of it — holds only ciphertext.

Format (version 1)::

    header = MAGIC(6) | VERSION(1) | KEY_ID(8) | NONCE_PREFIX(7) | CHUNK_SIZE(4, big-endian)
    body   = chunk_0 | chunk_1 | ... | chunk_n      each = AES-GCM(plaintext piece) + 16-byte tag

Files are encrypted in fixed-size chunks rather than as one GCM message so a
50 MB upload can be streamed back to the browser without holding the whole
file in memory. Chunking on its own would let an attacker with write access to
the volume drop, reorder or truncate chunks without breaking any single tag,
so each chunk's nonce binds its position and whether it is the last one
(``NONCE_PREFIX | counter(4) | final(1)``) and the header is authenticated as
associated data on every chunk. A file cut short is missing its final-flagged
chunk and fails; a swapped chunk fails its tag; an edited header fails every
tag.

Key: an HKDF-SHA256 sub-key of the same PBKDF2-derived key that encrypts
database fields, so ``ENCRYPTION_KEY`` / ``ENCRYPTION_SALT`` remain the only
secrets an operator manages and ``ENCRYPTION_KEYS_LEGACY`` covers files during
a key rotation exactly as it covers rows. The sub-key is domain-separated
(``info``) so no ciphertext produced here can ever be confused with a field
value. ``KEY_ID`` is a fingerprint of the sub-key, which lets a read pick the
right ring key directly instead of trying each one.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import BinaryIO, Dict, Iterator, Optional, Tuple

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

MAGIC = b"LBFENC"
FORMAT_VERSION = 1
KEY_ID_BYTES = 8
NONCE_PREFIX_BYTES = 7
TAG_BYTES = 16
HEADER_BYTES = len(MAGIC) + 1 + KEY_ID_BYTES + NONCE_PREFIX_BYTES + 4
DEFAULT_CHUNK_SIZE = 64 * 1024

# Never change: altering either value changes the derived key and makes every
# stored file unreadable. A new format gets a new FORMAT_VERSION instead.
_HKDF_INFO = b"the-logbook/file-encryption/v1"
_KEY_ID_LABEL = b"the-logbook/file-key-id/v1"

# (ENCRYPTION_KEY string, salt) -> (aesgcm, key_id). The PBKDF2 step behind the
# base key costs 600k iterations, so each key is derived once per process. The
# salt is part of the cache key so a changed ENCRYPTION_SALT (tests, rotation
# tooling) is picked up without an explicit reset.
_file_ciphers: Dict[Tuple[str, bytes], Tuple[AESGCM, bytes]] = {}


class FileDecryptionError(Exception):
    """The stored bytes are not a valid file for any configured key.

    Raised for a tampered or truncated file, an unknown key, or a malformed
    header. Callers must treat it as fatal for the read — never fall back to
    serving the raw bytes.
    """


def _cipher_for(key: str) -> Tuple[AESGCM, bytes]:
    # Imported lazily: app.core.security pulls in the auth stack, and this
    # module is imported by the storage service at app start.
    from app.core.security import _derive_key_bytes, get_encryption_salt

    cache_key = (key, get_encryption_salt())
    cached = _file_ciphers.get(cache_key)
    if cached is not None:
        return cached
    base_key = _derive_key_bytes(key)
    file_key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=_HKDF_INFO
    ).derive(base_key)
    key_id = hmac.new(file_key, _KEY_ID_LABEL, hashlib.sha256).digest()[:KEY_ID_BYTES]
    entry = (AESGCM(file_key), key_id)
    _file_ciphers[cache_key] = entry
    return entry


def _current_cipher() -> Tuple[AESGCM, bytes]:
    # Same key the database fields use, including its development fallback;
    # production startup refuses to run without a real ENCRYPTION_KEY.
    return _cipher_for(settings.ENCRYPTION_KEY)


def _cipher_for_key_id(key_id: bytes) -> Optional[AESGCM]:
    from app.core.security import _get_legacy_keys

    for key in [settings.ENCRYPTION_KEY, *_get_legacy_keys()]:
        cipher, candidate_id = _cipher_for(key)
        if hmac.compare_digest(candidate_id, key_id):
            return cipher
    return None


def _chunk_nonce(prefix: bytes, counter: int, final: bool) -> bytes:
    return prefix + counter.to_bytes(4, "big") + (b"\x01" if final else b"\x00")


def is_encrypted(head: bytes) -> bool:
    """Whether *head* (the first bytes of a stored file) carries our header."""
    return head.startswith(MAGIC)


def iter_encrypt(data: bytes, chunk_size: int = DEFAULT_CHUNK_SIZE) -> Iterator[bytes]:
    """Yield the encrypted file for *data*: the header, then each chunk.

    An empty input still produces one (empty) final chunk, so an encrypted
    empty file is distinguishable from a truncated one.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    cipher, key_id = _current_cipher()
    prefix = secrets.token_bytes(NONCE_PREFIX_BYTES)
    header = (
        MAGIC
        + bytes([FORMAT_VERSION])
        + key_id
        + prefix
        + chunk_size.to_bytes(4, "big")
    )
    yield header

    total = len(data)
    counter = 0
    offset = 0
    while True:
        piece = data[offset : offset + chunk_size]
        offset += len(piece)
        final = offset >= total
        yield cipher.encrypt(_chunk_nonce(prefix, counter, final), piece, header)
        if final:
            return
        counter += 1


def encrypted_size(plaintext_size: int, chunk_size: int = DEFAULT_CHUNK_SIZE) -> int:
    """Size on disk of a file holding *plaintext_size* bytes."""
    chunks = max(1, -(-plaintext_size // chunk_size))
    return HEADER_BYTES + plaintext_size + chunks * TAG_BYTES


def _parse_header(header: bytes) -> Tuple[AESGCM, bytes, int]:
    if len(header) != HEADER_BYTES or not header.startswith(MAGIC):
        raise FileDecryptionError("Not an encrypted file")
    pos = len(MAGIC)
    if header[pos] != FORMAT_VERSION:
        raise FileDecryptionError(f"Unsupported file format version {header[pos]}")
    pos += 1
    key_id = header[pos : pos + KEY_ID_BYTES]
    pos += KEY_ID_BYTES
    prefix = header[pos : pos + NONCE_PREFIX_BYTES]
    pos += NONCE_PREFIX_BYTES
    chunk_size = int.from_bytes(header[pos : pos + 4], "big")
    if chunk_size <= 0:
        raise FileDecryptionError("Invalid chunk size")
    cipher = _cipher_for_key_id(key_id)
    if cipher is None:
        raise FileDecryptionError(
            "File was encrypted with a key that is not configured "
            "(check ENCRYPTION_KEY / ENCRYPTION_KEYS_LEGACY)"
        )
    return cipher, prefix, chunk_size


def plaintext_size(ciphertext_size: int, header: bytes) -> int:
    """Plaintext length of an encrypted file, from its size and header."""
    if len(header) != HEADER_BYTES or not header.startswith(MAGIC):
        raise FileDecryptionError("Not an encrypted file")
    chunk_size = int.from_bytes(header[-4:], "big")
    if chunk_size <= 0:
        raise FileDecryptionError("Invalid chunk size")
    body = ciphertext_size - HEADER_BYTES
    block = chunk_size + TAG_BYTES
    if body < TAG_BYTES:
        raise FileDecryptionError("Encrypted file is truncated")
    chunks = body // block if body % block == 0 else body // block + 1
    return body - chunks * TAG_BYTES


def iter_decrypt(handle: BinaryIO) -> Iterator[bytes]:
    """Yield verified plaintext chunks from an open encrypted file.

    Every chunk is authenticated before it is yielded, so a consumer never
    receives a byte that failed verification. A failure part-way through
    raises ``FileDecryptionError`` after the chunks before it have been
    yielded — those chunks were themselves verified, so nothing unverified
    escapes even then.
    """
    header = handle.read(HEADER_BYTES)
    cipher, prefix, chunk_size = _parse_header(header)
    block = chunk_size + TAG_BYTES

    current = handle.read(block)
    counter = 0
    while True:
        if len(current) < TAG_BYTES:
            raise FileDecryptionError("Encrypted file is truncated")
        upcoming = handle.read(block) if len(current) == block else b""
        final = not upcoming
        try:
            yield cipher.decrypt(_chunk_nonce(prefix, counter, final), current, header)
        except InvalidTag as exc:
            raise FileDecryptionError(
                "Encrypted file failed its integrity check"
            ) from exc
        if final:
            return
        current = upcoming
        counter += 1
