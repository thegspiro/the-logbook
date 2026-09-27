"""What the app relies on from Starlette's Host and CORS middleware.

Both run in front of every request and are configured in main.py rather than
written here, so a Starlette upgrade can change their behaviour without any
of this repository's code changing. These tests pin the behaviour the app
depends on, using the exact CORS arguments main.py registers and the Host
allowlist Settings.get_trusted_hosts() derives, so an upgrade that alters
either is caught here rather than in production.
"""

import subprocess
import sys

import pytest
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

import main
from app.core.config import Settings

pytestmark = pytest.mark.unit

PUBLIC_ORIGIN = "https://logbook.example.org"


def _ok(request):
    return PlainTextResponse("ok")


def _client(*middleware: Middleware) -> TestClient:
    app = Starlette(
        routes=[Route("/", _ok, methods=["GET", "POST"])], middleware=list(middleware)
    )
    return TestClient(app)


def _app_cors_kwargs() -> dict:
    registered = [m for m in main.app.user_middleware if m.cls is CORSMiddleware]
    assert len(registered) == 1, "main.py should register CORSMiddleware exactly once"
    kwargs = dict(registered[0].kwargs)
    kwargs["allow_origins"] = [PUBLIC_ORIGIN]
    return kwargs


class TestTrustedHost:
    @pytest.fixture
    def client(self) -> TestClient:
        hosts = Settings(ALLOWED_ORIGINS=[PUBLIC_ORIGIN]).get_trusted_hosts()
        return _client(Middleware(TrustedHostMiddleware, allowed_hosts=hosts))

    @pytest.mark.parametrize(
        "host",
        [
            "logbook.example.org",
            "logbook.example.org:443",
            "localhost",
            "127.0.0.1:3001",
        ],
    )
    def test_the_public_host_and_health_check_hosts_are_served(self, client, host):
        assert client.get("/", headers={"host": host}).status_code == 200

    @pytest.mark.parametrize(
        "host",
        [
            "evil.example.com",
            "logbook.example.org.evil.com",
            # A garbage port used to pass: the host was taken as everything
            # before the first ":" without validating what followed.
            "logbook.example.org:abc",
            "logbook.example.org/evil",
            "logbook.example.org@evil.com",
        ],
    )
    def test_spoofed_or_malformed_hosts_are_rejected(self, client, host):
        assert client.get("/", headers={"host": host}).status_code == 400


class TestCors:
    @pytest.fixture
    def client(self) -> TestClient:
        return _client(Middleware(CORSMiddleware, **_app_cors_kwargs()))

    def test_allowed_origin_is_mirrored_with_credentials(self, client):
        response = client.get("/", headers={"origin": PUBLIC_ORIGIN})
        assert response.headers["access-control-allow-origin"] == PUBLIC_ORIGIN
        assert response.headers["access-control-allow-credentials"] == "true"
        assert "Origin" in response.headers["vary"]

    def test_other_origins_are_not_granted_access(self, client):
        response = client.get("/", headers={"origin": "https://evil.example.com"})
        assert "access-control-allow-origin" not in response.headers

    def test_preflight_allows_the_configured_methods(self, client):
        response = client.options(
            "/",
            headers={
                "origin": PUBLIC_ORIGIN,
                "access-control-request-method": "PATCH",
                "access-control-request-headers": "X-CSRF-Token",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == PUBLIC_ORIGIN

    @pytest.mark.parametrize("method", ["QUERY", "TRACE", "CONNECT"])
    def test_preflight_refuses_methods_outside_the_list(self, client, method):
        # The app lists its methods explicitly, so Starlette widening its
        # "*" set (1.7.0 added QUERY) must not widen what the app allows.
        response = client.options(
            "/",
            headers={"origin": PUBLIC_ORIGIN, "access-control-request-method": method},
        )
        assert response.status_code == 400

    def test_preflight_from_other_origin_is_refused(self, client):
        response = client.options(
            "/",
            headers={
                "origin": "https://evil.example.com",
                "access-control-request-method": "POST",
            },
        )
        assert response.status_code == 400
        assert "access-control-allow-origin" not in response.headers


def test_starlette_testclient_imports_without_deprecation_warning():
    # A fresh interpreter, because the module is already imported here and
    # reloading it in-process would swap the TestClient class under other tests.
    result = subprocess.run(
        [
            sys.executable,
            "-W",
            "error::DeprecationWarning",
            "-c",
            "import starlette.testclient",
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
