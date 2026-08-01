"""
API contract tests using Schemathesis.

Schemathesis auto-generates test cases from the FastAPI OpenAPI schema
to find responses that don't match declared schemas, unhandled edge
cases, and server errors.

Run with: pytest tests/test_api_contract.py -v --timeout=300

These tests are marked 'slow' since they generate many requests.

WHY A REAL SERVER INSTEAD OF THE ASGI TRANSPORT
-----------------------------------------------
This module used to build the schema with ``from_asgi(app=app)``. That
looked cheaper — no socket, no port — but schemathesis's ASGI transport
constructs a fresh ``starlette_testclient.TestClient`` for *every generated
case*, and entering that client runs the application's lifespan startup.
This app's startup waits on MySQL and applies Alembic migrations, so each
individual generated request paid a full boot, and without a reachable
database it blocked in ``portal.call(self.wait_startup)`` and never
returned. A single endpoint's test ran past ten minutes with no result and
pytest-timeout could not interrupt it, which is why the whole module sat
excluded from CI.

Starting one server for the module and addressing it over HTTP pays that
cost exactly once. It also matches what the contract actually describes:
the responses a deployed instance returns, not what an in-process harness
synthesises.
"""

import socket
import threading
import time
from contextlib import closing

import httpx
import pytest
import schemathesis

# Mark all tests in this module as slow + integration
pytestmark = [pytest.mark.slow, pytest.mark.integration]

# How long to wait for the module's server to report itself ready. Startup
# waits on MySQL and walks the Alembic chain, which is minutes on a cold
# database and seconds once it is at head.
_SERVER_BOOT_TIMEOUT_S = 600


def _free_port() -> int:
    """Reserve an ephemeral port, then hand it to uvicorn."""
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _start_server() -> str:
    """
    Run the app on a background thread and return its base URL.

    Lifespan stays enabled. The public endpoints query the database, and the
    connection pool is opened during startup — with lifespan off they answer
    500 "Database not initialized". It must also run on uvicorn's own event
    loop: the pool's aiomysql connections are loop-bound, and driving them
    from a loop other than the one that created them fails chaotically.
    Startup is paid once for the module rather than once per generated case,
    and where migrations are already at head it is a no-op check.
    """
    import uvicorn

    from main import app

    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            lifespan="on",
            access_log=False,
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + _SERVER_BOOT_TIMEOUT_S
    last_state = "no response yet"
    while time.monotonic() < deadline:
        if not thread.is_alive():
            raise RuntimeError("Contract-test server thread exited during startup")
        try:
            # Wait for `ready`, not merely for a reply. /health answers well
            # before the connection pool is open, and every database-backed
            # public endpoint returns 500 "Database not initialized" until it
            # is — which reads as a contract violation rather than a race.
            body = httpx.get(f"{base_url}/health", timeout=5.0).json()
            if body.get("ready"):
                return base_url
            last_state = str(body.get("startup") or body.get("status"))
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(0.5)

    raise RuntimeError(
        f"Contract-test server was not ready within {_SERVER_BOOT_TIMEOUT_S}s "
        f"(last state: {last_state})"
    )


# The schema has to exist at import time — schemathesis's pytest integration
# generates the test functions from decorators. Anything that goes wrong here
# skips the module rather than failing collection for every other suite.
try:
    BASE_URL = _start_server()
    schema = schemathesis.openapi.from_url(f"{BASE_URL}/openapi.json")
    SCHEMA_AVAILABLE = True
    SKIP_REASON = ""
except Exception as exc:  # pragma: no cover - environment-dependent
    BASE_URL = ""
    schema = None
    SCHEMA_AVAILABLE = False
    SKIP_REASON = f"Contract-test server unavailable: {exc}"


@pytest.mark.skipif(not SCHEMA_AVAILABLE, reason=SKIP_REASON or "server unavailable")
class TestAPIContract:
    """
    Auto-generated API contract tests.

    Schemathesis generates random valid requests for each endpoint
    defined in the OpenAPI schema and checks that:
    - The response status code matches declared responses
    - The response body matches the declared schema
    - No 500 errors occur
    """

    # Only test public/unauthenticated endpoints to start.
    # Authenticated endpoints need token injection (add later).
    if SCHEMA_AVAILABLE and schema is not None:

        @schema.include(path_regex=r"^/api/public/").parametrize()
        def test_public_endpoints(self, case):
            """Public endpoints should return valid responses."""
            response = case.call_and_validate()
            # Ensure no server errors
            assert response.status_code < 500

        # NOTE: the LB health check lives at /health (root, not under
        # /api/v1). The old pattern matched nothing — schemathesis 3.x
        # silently generated zero tests; 4.x fails collection on it.
        @schema.include(path_regex=r"^/health$").parametrize()
        def test_health_endpoints(self, case):
            """Health check endpoints should always respond."""
            response = case.call_and_validate()
            assert response.status_code < 500
