"""``REDIS_REQUIRED=true`` stops the backend starting when Redis is unreachable.

``cache_manager.connect()`` already raised once its retries were spent with
``REDIS_REQUIRED`` set, but startup swallowed the error twice: the wrapper in
``lifespan`` caught every exception and logged a warning, and the
``asyncio.gather(..., return_exceptions=True)`` around it would have turned it
into a value anyway. The setting was documented as "refuses to start" and did
nothing, so a deployment with a misconfigured managed Redis ran indefinitely on
per-process rate limiting with caching off.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import main

pytestmark = pytest.mark.unit


def _cache_manager(connect: AsyncMock, connected: bool = False) -> MagicMock:
    manager = MagicMock()
    manager.connect = connect
    manager.is_connected = connected
    return manager


class TestConnectRedisAtStartup:
    async def test_required_and_unreachable_raises(self):
        failure = ConnectionError("Failed to connect to Redis")
        manager = _cache_manager(AsyncMock(side_effect=failure))

        with (
            patch.object(main, "cache_manager", manager),
            patch.object(main.settings, "REDIS_REQUIRED", True),
        ):
            with pytest.raises(ConnectionError) as raised:
                await main.connect_redis_at_startup()

        assert raised.value is failure

    async def test_not_required_and_unreachable_degrades_without_raising(self):
        manager = _cache_manager(AsyncMock(side_effect=ConnectionError("down")))

        with (
            patch.object(main, "cache_manager", manager),
            patch.object(main.settings, "REDIS_REQUIRED", False),
        ):
            assert await main.connect_redis_at_startup() is None

        manager.connect.assert_awaited_once()

    async def test_not_required_and_connect_returns_disconnected_does_not_raise(self):
        # With REDIS_REQUIRED false, cache_manager.connect() returns normally
        # after its retries and leaves is_connected False.
        manager = _cache_manager(AsyncMock(return_value=None), connected=False)

        with (
            patch.object(main, "cache_manager", manager),
            patch.object(main.settings, "REDIS_REQUIRED", False),
        ):
            assert await main.connect_redis_at_startup() is None

    async def test_required_and_reachable_does_not_raise(self):
        manager = _cache_manager(AsyncMock(return_value=None), connected=True)

        with (
            patch.object(main, "cache_manager", manager),
            patch.object(main.settings, "REDIS_REQUIRED", True),
        ):
            assert await main.connect_redis_at_startup() is None


async def _run_startup() -> None:
    async with main.lifespan(main.app):
        pytest.fail("startup completed without Redis")


class TestLifespanRefusesToStart:
    async def test_required_and_unreachable_fails_startup(self):
        failure = ConnectionError("Failed to connect to Redis")
        manager = _cache_manager(AsyncMock(side_effect=failure))
        database = MagicMock()
        database.connect = AsyncMock(return_value=None)
        start_listener = AsyncMock()

        with (
            patch.object(main, "validate_security_configuration"),
            patch.object(main, "database_manager", database),
            patch.object(main, "run_migrations"),
            patch.object(main, "cache_manager", manager),
            patch.object(main.settings, "REDIS_REQUIRED", True),
            patch.object(main.settings, "GEOIP_ENABLED", False),
            patch(
                "app.utils.enum_normalization.normalize_legacy_enum_case",
                AsyncMock(return_value=None),
            ),
            patch(
                "app.utils.startup_validators.run_startup_validations",
                AsyncMock(return_value=None),
            ),
            patch(
                "app.core.websocket_manager.ws_manager.start_listener",
                start_listener,
            ),
        ):
            with pytest.raises(ConnectionError) as raised:
                await _run_startup()

        assert raised.value is failure
        # Nothing after the parallel service step ran.
        start_listener.assert_not_awaited()
