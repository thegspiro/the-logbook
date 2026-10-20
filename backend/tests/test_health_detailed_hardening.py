"""``GET /health/detailed`` reports host load, so it must be cheap and fenced.

The route reports host load and configuration flags. It requires
``settings.manage`` (pinned in ``test_health_detailed_auth.py``); independently
of who may call it, two properties must hold:

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

import pytest

import main
from app.core.security_middleware import IPBlockingMiddleware

pytestmark = pytest.mark.unit


class TestDetailedHealthDoesNotStallTheLoop:
    async def test_cpu_sample_does_not_sleep(self):
        with patch("psutil.cpu_percent", return_value=1.0) as cpu, patch.object(
            main.settings, "ENVIRONMENT", "development"
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

    async def test_production_returns_no_diagnostics(self):
        with patch.object(main.settings, "ENVIRONMENT", "production"):
            body = await main.health_check_detailed()

        assert body == {"error": "Detailed health check not available in production"}


class TestDetailedHealthIsNotExemptFromIpBlocking:
    def test_detailed_health_is_not_in_the_bypass_set(self):
        assert "/health/detailed" not in IPBlockingMiddleware.BYPASS_PATHS

    def test_liveness_probes_still_bypass_blocking(self):
        assert {"/health", "/"} <= IPBlockingMiddleware.BYPASS_PATHS
