"""``GET /health/detailed`` is unauthenticated, so it must be cheap and fenced.

It is served only in development; see ``TestDetailedHealthIsDevelopmentOnly``.

The route reports host load and configuration flags and carries no auth
dependency. Two properties keep that tolerable outside production:

1. **It must not block the event loop.** ``psutil.cpu_percent(interval=1)``
   sleeps synchronously, so three concurrent requests took 3.0s of wall time
   and stalled every other request on the worker for the duration. An
   anonymous client could hold an API worker down with a handful of requests.
2. **A blocked IP or country must not reach it.** It had been listed beside
   ``/health`` in the IP-blocking bypass set, which exists so a load balancer
   can probe a node, not so a blocked address can read configuration.
"""

import asyncio
import time
from unittest.mock import patch

import httpx
import pytest
from starlette.exceptions import HTTPException as StarletteHTTPException

import main
from app.core.security_middleware import IPBlockingMiddleware

pytestmark = pytest.mark.unit


class TestDetailedHealthDoesNotStallTheLoop:
    async def test_cpu_sample_does_not_sleep(self):
        with (
            patch("psutil.cpu_percent", return_value=1.0) as cpu,
            patch.object(main.settings, "ENVIRONMENT", "development"),
        ):
            body = await main.health_check_detailed()

        cpu.assert_called_once_with(interval=None)
        assert body["system"]["cpu_percent"] == 1.0

    async def test_concurrent_requests_do_not_serialize(self):
        # Three 1s blocking samples took ~3s when serialized on the loop. A
        # non-blocking sample finishes in milliseconds, so the margin is wide
        # enough that a loaded CI runner cannot turn this into a flake.
        with patch.object(main.settings, "ENVIRONMENT", "development"):
            started = time.perf_counter()
            await asyncio.gather(*(main.health_check_detailed() for _ in range(3)))
            elapsed = time.perf_counter() - started

        assert elapsed < 1.5


class TestDetailedHealthIsNotExemptFromIpBlocking:
    def test_detailed_health_is_not_in_the_bypass_set(self):
        assert "/health/detailed" not in IPBlockingMiddleware.BYPASS_PATHS

    def test_liveness_probes_still_bypass_blocking(self):
        assert {"/health", "/"} <= IPBlockingMiddleware.BYPASS_PATHS


class TestDetailedHealthIsDevelopmentOnly:
    """The route reports configuration and host load without authentication.

    Staging is often reachable from the internet, so it is not exempt: only
    ``ENVIRONMENT=development`` serves it, and every other value answers 404.
    """

    @pytest.mark.parametrize("environment", ["production", "staging", "testing", ""])
    async def test_any_other_environment_answers_404_without_sampling(
        self, environment
    ):
        with (
            patch.object(main.settings, "ENVIRONMENT", environment),
            patch("psutil.cpu_percent") as cpu,
        ):
            with pytest.raises(StarletteHTTPException) as raised:
                await main.health_check_detailed()

        assert raised.value.status_code == 404
        cpu.assert_not_called()

    async def test_development_serves_the_diagnostics(self):
        with patch.object(main.settings, "ENVIRONMENT", "development"):
            body = await main.health_check_detailed()

        assert body["status"] == "healthy"
        assert body["environment"] == "development"
        assert set(body["system"]) == {"cpu_percent", "memory_percent", "disk_percent"}

    @pytest.mark.parametrize("environment", ["production", "staging"])
    async def test_the_response_is_indistinguishable_from_an_unknown_path(
        self, environment
    ):
        transport = httpx.ASGITransport(app=main.app, client=("203.0.113.9", 5000))
        with patch.object(main.settings, "ENVIRONMENT", environment):
            async with httpx.AsyncClient(
                transport=transport, base_url="http://localhost"
            ) as client:
                hidden = await client.get("/health/detailed")
                missing = await client.get("/health/no-such-route")

        assert hidden.status_code == missing.status_code == 404
        assert hidden.json() == missing.json()
