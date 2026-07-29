"""Unit tests for the keyed (HMAC) audit hash chain.

These cover ``AuditLogger.calculate_hash`` — a pure function — verifying that
the version-2 chain is keyed with the signing key (so it cannot be forged
without the key) and remains distinct from the legacy unkeyed version-1 scheme.
"""

from types import SimpleNamespace

import pytest

from app.core import audit as audit_module
from app.core.audit import _CURRENT_HASH_VERSION, _LEGACY_HASH_VERSION, AuditLogger

_LOG_DATA = {
    "timestamp": "2026-07-21T00:00:00.000000+00:00",
    "timestamp_nanos": 1,
    "event_type": "user_login",
    "user_id": "user-123",
    "ip_address": "203.0.113.9",
    "event_data": {"b": 2, "a": 1},
}
_PREV = "0" * 64


def test_default_version_is_keyed(monkeypatch):
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    keyed = AuditLogger.calculate_hash(_LOG_DATA, _PREV)
    v1 = AuditLogger.calculate_hash(_LOG_DATA, _PREV, _LEGACY_HASH_VERSION)
    assert _CURRENT_HASH_VERSION == 2
    assert len(keyed) == 64
    # The default (keyed HMAC) hash must differ from the legacy unkeyed SHA-256.
    assert keyed != v1


def test_hash_depends_on_signing_key(monkeypatch):
    """An attacker who cannot read the key cannot reproduce the chain hash."""
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    with_key_a = AuditLogger.calculate_hash(_LOG_DATA, _PREV, _CURRENT_HASH_VERSION)
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-B")
    with_key_b = AuditLogger.calculate_hash(_LOG_DATA, _PREV, _CURRENT_HASH_VERSION)
    assert with_key_a != with_key_b


def test_tampering_changes_hash(monkeypatch):
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    original = AuditLogger.calculate_hash(_LOG_DATA, _PREV, _CURRENT_HASH_VERSION)
    tampered = AuditLogger.calculate_hash(
        {**_LOG_DATA, "event_data": {"b": 2, "a": 999}},
        _PREV,
        _CURRENT_HASH_VERSION,
    )
    assert original != tampered


def test_signing_key_falls_back_to_secret_key(monkeypatch):
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "")
    monkeypatch.setattr(audit_module.settings, "SECRET_KEY", "the-secret-key-value")
    assert audit_module._get_audit_signing_key() == "the-secret-key-value"
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "dedicated")
    assert audit_module._get_audit_signing_key() == "dedicated"


# --- rehash_chain: must repair legacy rows but never launder a keyed tamper ---


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeDB:
    """Minimal async stand-in: returns preset rows and records flush()."""

    def __init__(self, rows):
        self._rows = rows
        self.flushed = False

    async def execute(self, _query):
        return _FakeResult(self._rows)

    async def flush(self):
        self.flushed = True


def _make_log(log_id, event_data, version):
    return SimpleNamespace(
        id=log_id,
        timestamp="2026-07-21T00:00:00.000000+00:00",
        timestamp_nanos=log_id,
        event_type="user_login",
        event_category="auth",
        severity="info",
        user_id=f"user-{log_id}",
        ip_address="203.0.113.9",
        event_data=event_data,
        previous_hash=None,
        current_hash=None,
        hash_version=version,
    )


def _seal_chain(logger, logs):
    """Compute each row's correct previous/current hash under its own version."""
    prev = "0" * 64
    for log in logs:
        data = logger._build_hash_data(log)
        log.previous_hash = prev
        log.current_hash = logger.calculate_hash(data, prev, log.hash_version)
        prev = log.current_hash


async def test_rehash_repairs_legacy_rows(monkeypatch):
    """Legacy (v1) rows with a wrong stored hash are repaired."""
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    logger = AuditLogger()
    logs = [
        _make_log(1, {"a": 1}, _LEGACY_HASH_VERSION),
        _make_log(2, {"a": 2}, _LEGACY_HASH_VERSION),
    ]
    _seal_chain(logger, logs)
    # Corrupt the stored hashes as the historical computation bug would have.
    logs[0].current_hash = "deadbeef"
    logs[1].previous_hash = "deadbeef"

    db = _FakeDB(logs)
    count = await logger.rehash_chain(db)

    assert count == 2
    assert db.flushed is True
    # Chain is now internally consistent again.
    assert logs[0].previous_hash == "0" * 64
    assert logs[1].previous_hash == logs[0].current_hash


async def test_rehash_refuses_to_launder_keyed_tamper(monkeypatch):
    """A tampered keyed (v2) row makes rehash fail closed, not overwrite it."""
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    logger = AuditLogger()
    logs = [
        _make_log(1, {"a": 1}, _CURRENT_HASH_VERSION),
        _make_log(2, {"amount": 100}, _CURRENT_HASH_VERSION),
    ]
    _seal_chain(logger, logs)
    original_hash = logs[1].current_hash
    # Tamper with the row's data in the DB, leaving the stored (keyed) hash.
    logs[1].event_data = {"amount": 1_000_000}

    db = _FakeDB(logs)
    with pytest.raises(ValueError, match="keyed audit entry"):
        await logger.rehash_chain(db)

    # The stored keyed hash was NOT rewritten to match the tampered data.
    assert logs[1].current_hash == original_hash
    assert db.flushed is False


async def test_rehash_noop_on_clean_keyed_chain(monkeypatch):
    """A consistent keyed chain is left untouched (nothing to repair)."""
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    logger = AuditLogger()
    logs = [
        _make_log(1, {"a": 1}, _CURRENT_HASH_VERSION),
        _make_log(2, {"a": 2}, _CURRENT_HASH_VERSION),
    ]
    _seal_chain(logger, logs)
    sealed = [(log.previous_hash, log.current_hash) for log in logs]

    db = _FakeDB(logs)
    count = await logger.rehash_chain(db)

    assert count == 0
    assert db.flushed is False
    assert [(log.previous_hash, log.current_hash) for log in logs] == sealed
