"""Unit tests for the keyed (HMAC) audit hash chain.

These cover ``AuditLogger.calculate_hash`` — a pure function — verifying that
the version-2 chain is keyed with the signing key (so it cannot be forged
without the key) and remains distinct from the legacy unkeyed version-1 scheme.
"""

from app.core import audit as audit_module
from app.core.audit import (
    _CURRENT_HASH_VERSION,
    _LEGACY_HASH_VERSION,
    AuditLogger,
)

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
