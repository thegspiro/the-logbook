"""
Tests for the geo-blocking middleware's allowlist loading
(app/core/security_middleware.py :: IPBlockingMiddleware._get_allowed_ips).

Regression: this previously returned an empty set unconditionally, so an
approved IP exception never actually bypassed a country block. It now loads
the global approved-allowlist from the DB (behind an in-process TTL cache)
and fails closed on error. DB/cache stubbed; no MySQL/Redis.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.security_middleware import IPBlockingMiddleware


class _FakeSessionCtx:
    async def __aenter__(self):
        return MagicMock()

    async def __aexit__(self, *args):
        return False


@pytest.fixture
def _no_redis(monkeypatch):
    # Force the DB path: pretend Redis is not connected.
    monkeypatch.setattr(
        "app.core.cache.cache_manager", SimpleNamespace(is_connected=False)
    )
    monkeypatch.setattr(
        "app.core.database.async_session_factory", lambda: _FakeSessionCtx()
    )


def _patch_global(monkeypatch, value):
    mock = (
        AsyncMock(return_value=value)
        if not isinstance(value, Exception)
        else (AsyncMock(side_effect=value))
    )
    monkeypatch.setattr(
        "app.services.ip_security_service.ip_security_service"
        ".get_all_active_allowed_ips_global",
        mock,
    )
    return mock


def _mw():
    return IPBlockingMiddleware(app=MagicMock())


@pytest.mark.usefixtures("_no_redis")
class TestGetAllowedIps:
    async def test_loads_allowlist_from_db(self, monkeypatch):
        _patch_global(monkeypatch, {"203.0.113.7"})
        out = await _mw()._get_allowed_ips()
        assert out == {"203.0.113.7"}

    async def test_in_process_cache_avoids_second_db_load(self, monkeypatch):
        mock = _patch_global(monkeypatch, {"203.0.113.7"})
        mw = _mw()
        await mw._get_allowed_ips()
        await mw._get_allowed_ips()
        # Second call is served from the in-process TTL cache.
        assert mock.await_count == 1

    async def test_fails_closed_on_error(self, monkeypatch):
        _patch_global(monkeypatch, RuntimeError("db down"))
        out = await _mw()._get_allowed_ips()
        assert out == set()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
