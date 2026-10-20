"""
``GET /health/detailed`` is an administrator diagnostic, not a public probe.

It reports the version, the environment name and the debug / docs switches. It
used to take no dependency at all, so on ``staging`` or ``development`` anyone
could read that, and its one-second ``cpu_percent`` sample stalled the event
loop on every anonymous request. ``/health`` is the public probe and is not
touched here.
"""

import asyncio
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

pytestmark = [pytest.mark.unit, pytest.mark.timeout(120)]


@pytest.fixture(scope="module")
def app():
    from main import app as application

    return application


def _detailed_route(app):
    for route in app.routes:
        if getattr(route, "path", None) == "/health/detailed":
            return route
    raise AssertionError("/health/detailed is not registered")


def _permission_checker(app):
    for dependency in _detailed_route(app).dependencies:
        checker = dependency.dependency
        if type(checker).__name__ == "PermissionChecker":
            return checker
    raise AssertionError("/health/detailed has no permission dependency")


def test_route_requires_settings_manage(app):
    checker = _permission_checker(app)

    assert list(checker.required_permissions) == ["settings.manage"]


def test_anonymous_request_is_refused(app):
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/health/detailed")

    assert response.status_code in (401, 403)
    assert "environment" not in response.text
    assert "cpu_percent" not in response.text


def test_public_health_probe_stays_public(app):
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/health")

    assert response.status_code in (200, 503)
    assert "environment" not in response.json()


def test_authorised_caller_gets_diagnostics(app):
    checker = _permission_checker(app)
    app.dependency_overrides[checker] = lambda: None
    try:
        with TestClient(app) as client:
            response = client.get("/health/detailed")
    finally:
        app.dependency_overrides.pop(checker, None)

    assert response.status_code == 200
    body = response.json()
    assert set(body["system"]) == {"cpu_percent", "memory_percent", "disk_percent"}
    assert set(body["configuration"]) == {
        "debug",
        "enable_docs",
        "email_enabled",
        "redis_enabled",
    }


def test_production_refuses_even_an_authorised_caller(app):
    from app.core.config import settings

    checker = _permission_checker(app)
    app.dependency_overrides[checker] = lambda: None
    try:
        # Patched after startup: the lifespan refuses to boot as production
        # with this test environment's defaults.
        with TestClient(app) as client:
            with patch.object(settings, "ENVIRONMENT", "production"):
                response = client.get("/health/detailed")
    finally:
        app.dependency_overrides.pop(checker, None)

    assert response.json() == {
        "error": "Detailed health check not available in production"
    }


async def test_cpu_sample_does_not_block_the_event_loop():
    """Another coroutine must keep running during the one-second CPU sample."""
    import main

    checker = None
    for route in main.app.routes:
        if getattr(route, "path", None) == "/health/detailed":
            checker = route
    assert checker is not None

    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.05)
            ticks += 1

    task = asyncio.create_task(ticker())
    started = time.monotonic()
    try:
        with patch.object(main.settings, "ENVIRONMENT", "development"):
            await main.health_check_detailed()
    finally:
        task.cancel()

    assert time.monotonic() - started >= 0.9
    # A blocked loop would let the ticker run roughly once; a free one ~20 times.
    assert ticks >= 10
