"""Revoking an IP exception clears the edge middleware's cached allow.

``IPBlockingMiddleware`` memoizes "this address holds an approved exception"
for up to 60 seconds per worker (``_ExceptionCache``). Revoking the exception
committed the new status but left that entry in place, so the revoked address
kept passing the country block until the entry aged out — in every worker
that had cached it. The revoke now clears this worker's cache and publishes an
invalidation on the GeoIP channel that every worker's listener applies.
DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core import security_middleware
from app.core.geoip_sync import (
    GEOIP_INVALIDATION_CHANNEL,
    IP_EXCEPTION_INVALIDATION,
    GeoIPInvalidationListener,
)
from app.core.security_middleware import IPBlockingMiddleware
from app.models.ip_security import IPExceptionApprovalStatus
from app.services.ip_security_service import IPSecurityService

pytestmark = [pytest.mark.unit]

REVOKED_IP = "203.0.113.7"


def _approved_exception() -> SimpleNamespace:
    return SimpleNamespace(
        id="exc-1",
        organization_id="org-A",
        user_id="user-1",
        ip_address=REVOKED_IP,
        approval_status=IPExceptionApprovalStatus.APPROVED,
        revoked_by=None,
        revoked_at=None,
        revoke_reason=None,
        days_remaining=lambda: 5,
    )


def _db(found: SimpleNamespace | None) -> MagicMock:
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = found
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


@pytest.fixture(autouse=True)
def _empty_cache():
    security_middleware._exception_cache.clear()
    yield
    security_middleware._exception_cache.clear()


@pytest.fixture
def redis_client(monkeypatch) -> MagicMock:
    from app.core.cache import cache_manager

    client = MagicMock()
    client.publish = AsyncMock()
    monkeypatch.setattr(cache_manager, "redis_client", client)
    monkeypatch.setattr(cache_manager, "_connected", True)
    return client


async def _revoke() -> None:
    await IPSecurityService().revoke_exception(
        db=_db(_approved_exception()),
        exception_id="exc-1",
        admin_id="admin-A",
        organization_id="org-A",
        revoke_reason="travel ended",
    )


class TestRevokeInvalidatesTheCache:
    async def test_revoke_clears_the_cached_allow(self, redis_client):
        security_middleware._exception_cache.put(REVOKED_IP, True)

        await _revoke()

        assert security_middleware._exception_cache.get(REVOKED_IP) is None

    async def test_revoke_tells_the_other_workers(self, redis_client):
        await _revoke()

        redis_client.publish.assert_awaited_once_with(
            GEOIP_INVALIDATION_CHANNEL, IP_EXCEPTION_INVALIDATION
        )

    async def test_a_refused_revoke_leaves_the_cache_alone(self, redis_client):
        security_middleware._exception_cache.put(REVOKED_IP, True)

        with pytest.raises(ValueError, match="Exception not found"):
            await IPSecurityService().revoke_exception(
                db=_db(None),
                exception_id="exc-1",
                admin_id="admin-B",
                organization_id="org-B",
                revoke_reason="x",
            )

        assert security_middleware._exception_cache.get(REVOKED_IP) is True
        redis_client.publish.assert_not_awaited()

    async def test_the_revoked_address_is_blocked_on_its_next_request(
        self, monkeypatch, redis_client
    ):
        geoip = MagicMock()
        geoip.is_ip_blocked.return_value = (True, "blocked_country:XX")
        geoip.lookup_ip.return_value = {"country_code": "XX"}
        monkeypatch.setattr("app.core.geoip.get_geoip_service", lambda: geoip)
        lookup = AsyncMock(return_value=False)
        monkeypatch.setattr(
            "app.services.ip_security_service.ip_security_service."
            "ip_has_active_allowlist_exception",
            lookup,
        )
        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        monkeypatch.setattr("app.core.database.async_session_factory", lambda: session)
        security_middleware._exception_cache.put(REVOKED_IP, True)

        await _revoke()

        downstream = AsyncMock()
        send = AsyncMock()
        middleware = IPBlockingMiddleware(app=downstream, log_blocked_attempts=False)
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/auth/login",
            "headers": [],
            "client": (REVOKED_IP, 1234),
            "scheme": "https",
            "server": ("test", 443),
            "query_string": b"",
        }
        await middleware(scope, AsyncMock(), send)

        downstream.assert_not_awaited()
        assert send.await_args_list[0].args[0]["status"] == 403
        lookup.assert_awaited_once()


class TestListenerAppliesTheInvalidation:
    async def test_ip_exception_message_clears_the_cache_only(self, monkeypatch):
        listener = GeoIPInvalidationListener()
        refresh = AsyncMock()
        monkeypatch.setattr(listener, "_refresh", refresh)
        security_middleware._exception_cache.put(REVOKED_IP, True)

        await listener._handle({"type": "message", "data": IP_EXCEPTION_INVALIDATION})

        assert security_middleware._exception_cache.get(REVOKED_IP) is None
        refresh.assert_not_awaited()

    async def test_a_country_message_still_refreshes_countries(self, monkeypatch):
        listener = GeoIPInvalidationListener()
        refresh = AsyncMock()
        monkeypatch.setattr(listener, "_refresh", refresh)
        security_middleware._exception_cache.put(REVOKED_IP, True)

        await listener._handle({"type": "message", "data": "1"})

        refresh.assert_awaited_once()
        assert security_middleware._exception_cache.get(REVOKED_IP) is True
