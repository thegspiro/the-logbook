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
    assert _CURRENT_HASH_VERSION == 3
    assert len(keyed) == 64
    # The default (keyed HMAC) hash must differ from the legacy unkeyed SHA-256.
    assert keyed != v1


def test_v3_includes_organization_id(monkeypatch):
    """v3 hashes bind the owning tenant; v2 must stay byte-identical for
    rows written before the column existed (backfill never breaks them)."""
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    with_org = AuditLogger.calculate_hash(
        {**_LOG_DATA, "organization_id": "org-1"}, _PREV, 3
    )
    other_org = AuditLogger.calculate_hash(
        {**_LOG_DATA, "organization_id": "org-2"}, _PREV, 3
    )
    assert with_org != other_org

    v2_without = AuditLogger.calculate_hash(_LOG_DATA, _PREV, 2)
    v2_with = AuditLogger.calculate_hash(
        {**_LOG_DATA, "organization_id": "org-1"}, _PREV, 2
    )
    assert v2_without == v2_with


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
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_LEGACY_MAX_ID", 2)
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


# --- verify_integrity: SEC-2 tail-truncation detection via checkpoint ---


class _VerifyDB:
    """Returns the log rows on the first execute() and the checkpoint on the
    second (matching verify_integrity's query order)."""

    def __init__(self, logs, checkpoint):
        self._logs = logs
        self._checkpoint = checkpoint
        self._calls = 0

    async def execute(self, _query):
        self._calls += 1
        if self._calls == 1:
            return _FakeResult(self._logs)
        return SimpleNamespace(scalar_one_or_none=lambda: self._checkpoint)


async def test_verify_detects_tail_truncation(monkeypatch):
    """A checkpoint attesting entries past the chain's end fails verification."""
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    logger = AuditLogger()
    logs = [
        _make_log(1, {"a": 1}, _CURRENT_HASH_VERSION),
        _make_log(2, {"a": 2}, _CURRENT_HASH_VERSION),
    ]
    _seal_chain(logger, logs)  # internally consistent, anchored to genesis
    # A checkpoint attests entries up to id 5, but the chain now ends at 2.
    checkpoint = SimpleNamespace(last_log_id=5, archived_at=None)

    result = await logger.verify_integrity(_VerifyDB(logs, checkpoint))

    assert result["verified"] is False
    assert any("tail truncated" in e.get("error", "") for e in result["errors"])


async def test_verify_passes_when_checkpoint_within_chain(monkeypatch):
    """A checkpoint at/behind the chain head does not trip the tail check."""
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    logger = AuditLogger()
    logs = [
        _make_log(1, {"a": 1}, _CURRENT_HASH_VERSION),
        _make_log(2, {"a": 2}, _CURRENT_HASH_VERSION),
    ]
    _seal_chain(logger, logs)
    checkpoint = SimpleNamespace(last_log_id=2, archived_at=None)

    result = await logger.verify_integrity(_VerifyDB(logs, checkpoint))

    assert result["verified"] is True
    assert result["errors"] == []


async def test_verify_rejects_whole_chain_downgrade_after_trusted_boundary(
    monkeypatch,
):
    """DB-controlled versions cannot authorize forgeable hashes on new rows."""
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_LEGACY_MAX_ID", 0)
    logger = AuditLogger()
    logs = [
        _make_log(1, {"forged": True}, _LEGACY_HASH_VERSION),
        _make_log(2, {"forged": True}, _LEGACY_HASH_VERSION),
    ]
    _seal_chain(logger, logs)

    result = await logger.verify_integrity(_VerifyDB(logs, None))

    assert result["verified"] is False
    assert len(result["errors"]) == 2
    assert all("trusted legacy" in error["error"] for error in result["errors"])


async def test_verify_accepts_legacy_rows_within_trusted_boundary(monkeypatch):
    """Upgrades retain verification by explicitly pinning the legacy range."""
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_LEGACY_MAX_ID", 2)
    logger = AuditLogger()
    logs = [
        _make_log(1, {"historical": True}, _LEGACY_HASH_VERSION),
        _make_log(2, {"historical": True}, _LEGACY_HASH_VERSION),
        _make_log(3, {"keyed": True}, _CURRENT_HASH_VERSION),
    ]
    _seal_chain(logger, logs)

    result = await logger.verify_integrity(_VerifyDB(logs, None))

    assert result["verified"] is True
    assert result["errors"] == []


async def test_rehash_rejects_downgraded_row_after_trusted_boundary(monkeypatch):
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_LEGACY_MAX_ID", 0)
    logger = AuditLogger()
    log = _make_log(1, {"forged": True}, _LEGACY_HASH_VERSION)
    _seal_chain(logger, [log])

    with pytest.raises(ValueError, match="downgrade attack"):
        await logger.rehash_chain(_FakeDB([log]))
