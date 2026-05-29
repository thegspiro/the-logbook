"""
Unit tests for IP-security hardening.

Covers the security-critical, DB-independent logic:
- get_client_ip() spoof resistance (right-most-untrusted X-Forwarded-For)
- GeoIPService.is_ip_blocked() decision matrix
- IPSecurityService.sync_blocked_countries_to_geoip() DB overlay

These are pure-logic tests that do not require MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.geoip import GeoIPService, init_geoip_service
from app.core.security_middleware import get_client_ip
from app.services.ip_security_service import ip_security_service


class _FakeRequest:
    """Minimal stand-in for a Starlette Request used by get_client_ip()."""

    def __init__(self, peer, headers=None):
        self.client = SimpleNamespace(host=peer) if peer else None
        self.headers = headers or {}


def _set_trusted_proxies(monkeypatch, ips):
    from app.core.config import settings

    monkeypatch.setattr(settings, "get_trusted_proxy_ips", lambda: set(ips))


# ---------------------------------------------------------------------------
# get_client_ip — X-Forwarded-For spoof resistance
# ---------------------------------------------------------------------------


def test_client_ip_ignores_xff_when_no_trusted_proxies(monkeypatch):
    # Secure default: no proxies configured -> never trust forwarded headers.
    _set_trusted_proxies(monkeypatch, set())
    req = _FakeRequest("203.0.113.7", {"X-Forwarded-For": "8.8.8.8"})
    assert get_client_ip(req) == "203.0.113.7"


def test_client_ip_ignores_xff_from_untrusted_peer(monkeypatch):
    # Peer is not a known proxy -> forwarded headers are not trusted.
    _set_trusted_proxies(monkeypatch, {"10.0.0.5"})
    req = _FakeRequest("203.0.113.7", {"X-Forwarded-For": "8.8.8.8"})
    assert get_client_ip(req) == "203.0.113.7"


def test_client_ip_rejects_spoofed_leftmost_xff(monkeypatch):
    # Attacker sends a forged left-most IP; the trusted proxy appends the real
    # client. The right-most untrusted hop (the real client) must win.
    _set_trusted_proxies(monkeypatch, {"10.0.0.5"})
    req = _FakeRequest("10.0.0.5", {"X-Forwarded-For": "8.8.8.8, 198.51.100.23"})
    assert get_client_ip(req) == "198.51.100.23"


def test_client_ip_skips_chained_trusted_proxies(monkeypatch):
    # Two trusted hops (LB + nginx); the first untrusted-from-the-right is real.
    _set_trusted_proxies(monkeypatch, {"10.0.0.5", "10.0.0.6"})
    req = _FakeRequest(
        "10.0.0.5",
        {"X-Forwarded-For": "8.8.8.8, 198.51.100.23, 10.0.0.6"},
    )
    assert get_client_ip(req) == "198.51.100.23"


def test_client_ip_falls_back_to_real_ip_header(monkeypatch):
    # No XFF but a trusted peer -> use X-Real-IP (set by nginx to $remote_addr).
    _set_trusted_proxies(monkeypatch, {"10.0.0.5"})
    req = _FakeRequest("10.0.0.5", {"X-Real-IP": "198.51.100.23"})
    assert get_client_ip(req) == "198.51.100.23"


# ---------------------------------------------------------------------------
# GeoIPService.is_ip_blocked — decision matrix
# ---------------------------------------------------------------------------


def _service(blocked=None, enabled=True):
    return GeoIPService(
        geoip_db_path=None, blocked_countries=set(blocked or []), enabled=enabled
    )


def test_is_ip_blocked_allows_private_ip():
    svc = _service(blocked={"RU"})
    assert svc.is_ip_blocked("10.1.2.3") == (False, "private_ip")


def test_is_ip_blocked_disabled_allows_everything():
    svc = _service(blocked={"RU"}, enabled=False)
    assert svc.is_ip_blocked("8.8.8.8")[0] is False


def test_is_ip_blocked_allowlist_bypasses_block(monkeypatch):
    svc = _service(blocked={"RU"})
    # Even if this public IP resolved to a blocked country, the allowlist wins.
    monkeypatch.setattr(
        svc, "lookup_ip", lambda ip: {"country_code": "RU", "is_blocked": True}
    )
    assert svc.is_ip_blocked("8.8.8.8", allowed_ips={"8.8.8.8"}) == (
        False,
        "ip_allowlisted",
    )


def test_is_ip_blocked_blocks_blocked_country(monkeypatch):
    svc = _service(blocked={"RU"})
    monkeypatch.setattr(
        svc, "lookup_ip", lambda ip: {"country_code": "RU", "is_blocked": True}
    )
    blocked, reason = svc.is_ip_blocked("8.8.8.8")
    assert blocked is True
    assert reason == "blocked_country:RU"


def test_is_ip_blocked_fails_open_on_unknown_country(monkeypatch):
    svc = _service(blocked={"RU"})
    monkeypatch.setattr(
        svc, "lookup_ip", lambda ip: {"country_code": None, "is_blocked": False}
    )
    assert svc.is_ip_blocked("8.8.8.8") == (False, "country_unknown")


# ---------------------------------------------------------------------------
# IPSecurityService.sync_blocked_countries_to_geoip — DB overlay
# ---------------------------------------------------------------------------


async def test_sync_overlays_db_rules_onto_geoip():
    # Start with a config default of {"RU"} in the running GeoIP service.
    init_geoip_service(geoip_db_path=None, blocked_countries={"RU"}, enabled=True)

    # DB says: block BY, and explicitly unblock the config-default RU.
    rules = [
        SimpleNamespace(country_code="BY", is_blocked=True),
        SimpleNamespace(country_code="RU", is_blocked=False),
    ]
    scalars = MagicMock()
    scalars.all.return_value = rules
    result = MagicMock()
    result.scalars.return_value = scalars
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)

    effective = await ip_security_service.sync_blocked_countries_to_geoip(db)

    assert "BY" in effective
    assert "RU" not in effective


async def test_sync_no_geoip_service_returns_empty(monkeypatch):
    monkeypatch.setattr(
        "app.services.ip_security_service.get_geoip_service", lambda: None
    )
    db = MagicMock()
    db.execute = AsyncMock()
    assert await ip_security_service.sync_blocked_countries_to_geoip(db) == set()
    db.execute.assert_not_called()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
