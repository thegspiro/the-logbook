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
