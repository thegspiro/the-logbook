"""
``GET /health/detailed`` is an administrator diagnostic, not a public probe.

It reports the version, the environment name and the debug / docs switches. It
used to take no dependency at all, so on ``staging`` or ``development`` anyone
could read that. ``/health`` is the public probe and is not touched here. That
the CPU sample does not stall the event loop is pinned separately in
``test_health_detailed_hardening.py``.
"""

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
    from app.core.database import get_db

    # No cookie means the dependency refuses before it touches the session; the
    # stub only satisfies dependency resolution, as no database is connected.
    app.dependency_overrides[get_db] = lambda: None
    try:
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/health/detailed")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code in (401, 403)
    assert "environment" not in response.text
    assert "cpu_percent" not in response.text


def test_public_health_probe_stays_public(app):
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/health")

    assert response.status_code in (200, 503)
    assert "environment" not in response.json()


def test_authorised_caller_gets_diagnostics(app):
    checker = _permission_checker(app)
    app.dependency_overrides[checker] = lambda: None
    try:
        response = TestClient(app).get("/health/detailed")
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
        # The client is not entered as a context manager, so the lifespan (which
        # refuses to boot as production on this test environment's defaults)
        # never runs.
        with patch.object(settings, "ENVIRONMENT", "production"):
            response = TestClient(app).get("/health/detailed")
    finally:
        app.dependency_overrides.pop(checker, None)

    assert response.json() == {
        "error": "Detailed health check not available in production"
    }
