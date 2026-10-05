"""Regression tests for tenant isolation in geo-blocking."""

from unittest.mock import AsyncMock, MagicMock

from app.core.security_middleware import IPBlockingMiddleware


async def test_pre_auth_middleware_does_not_apply_tenant_allowlists(monkeypatch):
    """A pre-auth request must not receive exceptions from an unknown tenant."""
    geoip = MagicMock()
    geoip.is_ip_blocked.return_value = (False, "allowed_country")
    geoip.lookup_ip.return_value = {"country_code": "US"}
    monkeypatch.setattr("app.core.geoip.get_geoip_service", lambda: geoip)

    downstream = AsyncMock()
    middleware = IPBlockingMiddleware(app=downstream)
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/tenant-b/public",
        "headers": [],
        "client": ("203.0.113.7", 1234),
        "scheme": "https",
        "server": ("test", 443),
        "query_string": b"",
    }

    await middleware(scope, AsyncMock(), AsyncMock())

    geoip.is_ip_blocked.assert_called_once_with("203.0.113.7", set())
    downstream.assert_awaited_once()


# INT2-28 (owner decision): an approved allowlist exception lets its exact
# address past the country block, looked up by that address alone.


def _blocked_geoip():
    geoip = MagicMock()
    geoip.is_ip_blocked.return_value = (True, "blocked_country:XX")
    geoip.lookup_ip.return_value = {"country_code": "XX"}
    return geoip


def _scope(ip="203.0.113.9"):
    return {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/auth/login",
        "headers": [],
        "client": (ip, 1234),
        "scheme": "https",
        "server": ("test", 443),
        "query_string": b"",
    }


async def _run(monkeypatch, lookup):
    from app.core import security_middleware

    security_middleware._exception_cache.clear()
    monkeypatch.setattr("app.core.geoip.get_geoip_service", _blocked_geoip)
    monkeypatch.setattr(
        "app.services.ip_security_service.ip_security_service."
        "ip_has_active_allowlist_exception",
        lookup,
    )
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr("app.core.database.async_session_factory", lambda: session)
    downstream = AsyncMock()
    send = AsyncMock()
    middleware = IPBlockingMiddleware(app=downstream, log_blocked_attempts=False)
    await middleware(_scope(), AsyncMock(), send)
    return downstream, send


async def test_an_approved_exception_lets_its_address_through(monkeypatch):
    lookup = AsyncMock(return_value=True)
    downstream, _ = await _run(monkeypatch, lookup)

    downstream.assert_awaited_once()
    assert lookup.await_args.args[1] == "203.0.113.9"


async def test_without_an_exception_the_block_stands(monkeypatch):
    downstream, send = await _run(monkeypatch, AsyncMock(return_value=False))

    downstream.assert_not_awaited()
    start = send.await_args_list[0].args[0]
    assert start["status"] == 403


async def test_a_failed_lookup_keeps_the_block(monkeypatch):
    downstream, send = await _run(
        monkeypatch, AsyncMock(side_effect=RuntimeError("db down"))
    )

    downstream.assert_not_awaited()
    assert send.await_args_list[0].args[0]["status"] == 403


async def test_the_answer_is_cached_briefly(monkeypatch):
    lookup = AsyncMock(return_value=True)
    await _run(monkeypatch, lookup)

    from app.core import security_middleware

    assert security_middleware._exception_cache.get("203.0.113.9") is True


def test_the_cache_is_bounded():
    from app.core.security_middleware import _ExceptionCache

    cache = _ExceptionCache()
    cache.MAX_ENTRIES = 3
    for i in range(5):
        cache.put(f"198.51.100.{i}", False)
    assert cache.get("198.51.100.0") is None
    assert cache.get("198.51.100.4") is False
