"""
Replay a shown-once secret to a retry of the request that issued it (AUTH-7).

Recovery codes are shown exactly once and stored only as hashes. When the
server commits a new set but the response is lost in transit (a dropped
connection, a timeout, a double tap), the member is left with codes that
work and that nobody can read. Retrying does not help: the authenticator
code it carries was consumed by the first attempt, and a fresh code would
issue, and overwrite with, yet another set.

A client that sends an ``Idempotency-Key`` header gets the original
response back for the same key, for a short window. The replay is bound to:

- **the member**, so a key never crosses accounts;
- **the endpoint**, so a key from one flow cannot read another's secret;
- **a fingerprint of the request body**, so a key reused with a different
  authenticator code is refused rather than quietly answered with the codes
  issued to the first one.

The issued payload is encrypted with the application key before it is
stored, and expires after ``REPLAY_WINDOW_SECONDS``. Redis is the store when
it is connected, so a retry served by another worker still finds it; without
Redis a bounded per-process map is used, which covers a retry that lands on
the same worker and otherwise degrades to the behaviour without a key.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from collections import OrderedDict
from typing import Any

from fastapi import HTTPException
from loguru import logger

from app.core.cache import cache_manager
from app.core.security import decrypt_data, encrypt_data

# Long enough for a client retry or a member pressing the button again after
# a timeout; short enough that the plaintext set does not outlive the moment
# it was meant to be read in.
REPLAY_WINDOW_SECONDS = 600

# Clients send a UUID; the bound only stops an arbitrary header from becoming
# an unbounded cache key.
_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{8,128}$")

_REDIS_PREFIX = "issued_secret:"

# Pitfall #9: the fallback map is capped and swept of expired entries.
_LOCAL_MAX_ENTRIES = 1000
_local: OrderedDict[str, tuple[float, str]] = OrderedDict()


def validate_idempotency_key(key: str | None) -> str | None:
    """Return the key, ``None`` when absent, or raise 400 for a malformed one."""
    if key is None or key == "":
        return None
    if not _KEY_PATTERN.match(key):
        raise HTTPException(
            status_code=400,
            detail=(
                "Idempotency-Key must be 8 to 128 letters, digits, hyphens "
                "or underscores."
            ),
        )
    return key


def _slot(user_id: str, scope: str, key: str) -> str:
    return hashlib.sha256(f"{user_id}\x00{scope}\x00{key}".encode()).hexdigest()


def _fingerprint(body: str) -> str:
    return hashlib.sha256(body.encode()).hexdigest()


def _sweep_local(now: float) -> None:
    for slot in [s for s, (expires, _) in _local.items() if expires <= now]:
        del _local[slot]
    while len(_local) > _LOCAL_MAX_ENTRIES:
        _local.popitem(last=False)


async def _load(slot: str) -> str | None:
    client = cache_manager.redis_client
    if cache_manager.is_connected and client is not None:
        try:
            value = await client.get(_REDIS_PREFIX + slot)
            # The client is built with decode_responses=True; bytes would be
            # a misconfigured client, and is decoded rather than trusted.
            return value.decode() if isinstance(value, bytes) else value
        except Exception as exc:
            logger.warning(f"Issued-secret replay lookup failed in Redis: {exc}")
            return None
    now = time.monotonic()
    _sweep_local(now)
    entry = _local.get(slot)
    return entry[1] if entry else None


async def _store(slot: str, sealed: str) -> None:
    client = cache_manager.redis_client
    if cache_manager.is_connected and client is not None:
        try:
            await client.setex(_REDIS_PREFIX + slot, REPLAY_WINDOW_SECONDS, sealed)
            return
        except Exception as exc:
            logger.warning(f"Issued-secret replay store failed in Redis: {exc}")
            return
    now = time.monotonic()
    _local[slot] = (now + REPLAY_WINDOW_SECONDS, sealed)
    _local.move_to_end(slot)
    _sweep_local(now)


async def recall(
    *, user_id: str, scope: str, key: str | None, body: str
) -> dict[str, Any] | None:
    """Return the response first issued for this key, or ``None``.

    Raises 422 when the key was used with a different request body.
    """
    if key is None:
        return None
    sealed = await _load(_slot(user_id, scope, key))
    if sealed is None:
        return None
    try:
        record = json.loads(decrypt_data(sealed))
    except Exception as exc:
        # An entry that cannot be read (a rotated key, a corrupt value) is a
        # miss, not an error: the request proceeds as if it carried no key.
        logger.warning(f"Issued-secret replay entry unreadable: {exc}")
        return None
    if not hmac.compare_digest(record.get("fingerprint", ""), _fingerprint(body)):
        raise HTTPException(
            status_code=422,
            detail=(
                "This Idempotency-Key was already used for a different "
                "request. Start again."
            ),
        )
    response = record.get("response")
    return response if isinstance(response, dict) else None


async def remember(
    *,
    user_id: str,
    scope: str,
    key: str | None,
    body: str,
    response: dict[str, Any],
) -> None:
    """Keep ``response`` for a retry of this request. A no-op without a key."""
    if key is None:
        return
    sealed = encrypt_data(
        json.dumps({"fingerprint": _fingerprint(body), "response": response})
    )
    await _store(_slot(user_id, scope, key), sealed)


def reset_local_store() -> None:
    """Empty the per-process fallback (tests)."""
    _local.clear()
