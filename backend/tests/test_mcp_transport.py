"""The ASGI endpoint in front of the MCP session manager.

Drives raw JSON-RPC through ``httpx.ASGITransport`` against a small
Starlette app that routes the real ``McpEndpoint`` and runs the real SDK
session manager, with the authenticator swapped for a table of fake keys.
The property that matters most is the last class: the principal bound by
the endpoint is the one the tool sees, on every dispatch path the SDK has.
"""

import contextlib

import httpx
import pytest
from starlette.applications import Starlette
from starlette.routing import Route

from app.mcp.keys import McpAuthError
from app.mcp.principal import McpPrincipal, NoPrincipalError, current_principal
from app.mcp.server import LogbookMcpServer, create_session_manager
from app.mcp.transport import McpEndpoint, _MemoryRateLimiter

GOOD = "logbook_mcp_good"
DISABLED = "logbook_mcp_disabled"


def _principal(org: str) -> McpPrincipal:
    return McpPrincipal(
        organization_id=org,
        key_id=f"key-{org}",
        key_prefix="logbook_mcp_",
        issued_by_user_id=None,
        access_mode="read_only",
        expose_finance=False,
        expose_medical_screening=False,
    )


async def fake_authenticate(presented: str, client_ip):
    if presented == GOOD:
        return _principal("org-a")
    if presented == DISABLED:
        raise McpAuthError("not enabled", status=403)
    raise McpAuthError("Invalid service key")


def _server() -> LogbookMcpServer:
    server = LogbookMcpServer(name="test")

    @server.tool()
    async def whoami() -> dict:
        return {"organization_id": current_principal().organization_id}

    return server


@contextlib.asynccontextmanager
async def running_client(rate_limit=None, rate_window_seconds=60, auth_rate_limit=None):
    """A client against a routed endpoint with the SDK session manager running.

    A context manager rather than an async fixture: the manager's ``run()``
    owns an anyio task group, which must be entered and exited in the same
    task, and pytest-asyncio tears async fixtures down in a different one.
    """
    server = _server()
    manager = create_session_manager(server)
    kwargs = {"authenticate": fake_authenticate}
    if rate_limit is not None:
        kwargs.update(rate_limit=rate_limit, rate_window_seconds=rate_window_seconds)
    if auth_rate_limit is not None:
        kwargs.update(auth_rate_limit=auth_rate_limit)
    endpoint = McpEndpoint(**kwargs)
    app = Starlette(routes=[Route("/api/mcp", endpoint), Route("/api/mcp/", endpoint)])
    app.state.mcp_session_manager = manager
    async with manager.run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c, app


@pytest.fixture
def _no_rate_limit(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", False)


def _headers(token=GOOD, protocol=None, **extra):
    h = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if token is not None:
        h["Authorization"] = f"Bearer {token}"
    if protocol:
        h["MCP-Protocol-Version"] = protocol
    h.update(extra)
    return h


def _call(name, protocol=None, request_id=2):
    body = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "tools/call",
        "params": {"name": name, "arguments": {}},
    }
    if protocol == "2026-07-28":
        body["params"]["_meta"] = {
            "io.modelcontextprotocol/protocolVersion": protocol,
            "io.modelcontextprotocol/clientCapabilities": {},
        }
    return body


class TestGatekeeping:
    @pytest.mark.usefixtures("_no_rate_limit")
    async def test_no_bearer_is_401_with_challenge(self):
        async with running_client() as (client, _):
            r = await client.post(
                "/api/mcp", json=_call("whoami"), headers=_headers(token=None)
            )
        assert r.status_code == 401
        assert r.headers["www-authenticate"] == "Bearer"
        assert r.json() == {"error": "A bearer service key is required"}

    @pytest.mark.usefixtures("_no_rate_limit")
    async def test_basic_scheme_is_401(self):
        async with running_client() as (client, _):
            r = await client.post(
                "/api/mcp",
                json=_call("whoami"),
                headers=_headers(token=None, Authorization="Basic abc"),
            )
        assert r.status_code == 401

    @pytest.mark.usefixtures("_no_rate_limit")
    async def test_bad_key_is_401(self):
        async with running_client() as (client, _):
            r = await client.post(
                "/api/mcp",
                json=_call("whoami"),
                headers=_headers(token="logbook_mcp_nope"),
            )
        assert r.status_code == 401
        assert r.json()["error"] == "Invalid service key"

    @pytest.mark.usefixtures("_no_rate_limit")
    async def test_integration_off_is_403(self):
        async with running_client() as (client, _):
            r = await client.post(
                "/api/mcp", json=_call("whoami"), headers=_headers(token=DISABLED)
            )
        assert r.status_code == 403

    @pytest.mark.usefixtures("_no_rate_limit")
    async def test_unsupported_method_is_405_before_auth(self):
        async with running_client() as (client, _):
            r = await client.put("/api/mcp", json={}, headers=_headers(token=None))
        assert r.status_code == 405
        assert "POST" in r.headers["allow"]

    @pytest.mark.usefixtures("_no_rate_limit")
    async def test_trailing_slash_also_answers(self):
        async with running_client() as (client, _):
            r = await client.post("/api/mcp/", json=_call("whoami"), headers=_headers())
        assert r.status_code == 200

    @pytest.mark.usefixtures("_no_rate_limit")
    async def test_missing_session_manager_is_503(self):
        async with running_client() as (client, app):
            app.state.mcp_session_manager = None
            r = await client.post("/api/mcp", json=_call("whoami"), headers=_headers())
        assert r.status_code == 503


class TestRateLimit:
    def test_memory_limiter_windows_and_bounds(self):
        limiter = _MemoryRateLimiter(limit=2, window=60, max_keys=2)
        assert limiter.exceeded("a", now=0) is False
        assert limiter.exceeded("a", now=1) is False
        assert limiter.exceeded("a", now=2) is True
        assert limiter.exceeded("a", now=62) is False  # window rolled
        limiter.exceeded("b", now=62)
        limiter.exceeded("c", now=62)  # evicts the oldest tracked key
        assert len(limiter._hits) == 2

    async def test_bad_keys_are_limited_per_address_before_the_lookup(
        self, monkeypatch
    ):
        """Guessing keys must cost the guesser a bucket, not the database a
        lookup per attempt: the per-address budget runs before authentication."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
        attempts: list[str] = []

        async def counting_authenticate(presented, client_ip):
            attempts.append(presented)
            raise McpAuthError("Invalid service key")

        server = _server()
        manager = create_session_manager(server)
        endpoint = McpEndpoint(authenticate=counting_authenticate, auth_rate_limit=2)
        app = Starlette(routes=[Route("/api/mcp", endpoint)])
        app.state.mcp_session_manager = manager
        async with manager.run():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as c:
                codes = [
                    (
                        await c.post(
                            "/api/mcp",
                            json=_call("whoami"),
                            headers=_headers(token=f"logbook_mcp_guess{i}"),
                        )
                    ).status_code
                    for i in range(4)
                ]
        assert codes == [401, 401, 429, 429]
        assert len(attempts) == 2

    async def test_valid_calls_never_consume_the_attempt_budget(self, monkeypatch):
        """The per-address budget is for failed attempts: a client making
        many valid calls, or several valid keys behind one proxy, must reach
        the per-key limit, not this smaller one."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
        async with running_client(auth_rate_limit=1) as (client, _):
            codes = [
                (
                    await client.post(
                        "/api/mcp", json=_call("whoami"), headers=_headers()
                    )
                ).status_code
                for _ in range(3)
            ]
            bad = [
                (
                    await client.post(
                        "/api/mcp",
                        json=_call("whoami"),
                        headers=_headers(token="logbook_mcp_wrong"),
                    )
                ).status_code
                for _ in range(2)
            ]
            after = await client.post(
                "/api/mcp", json=_call("whoami"), headers=_headers()
            )
        assert codes == [200, 200, 200]
        assert bad == [401, 429]
        # Once the failures fill the bucket, even a valid key waits it out:
        # the lookup is what the budget protects.
        assert after.status_code == 429

    async def test_endpoint_returns_429_when_over_budget(self, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
        async with running_client(rate_limit=1) as (client, _):
            first = await client.post(
                "/api/mcp", json=_call("whoami"), headers=_headers()
            )
            second = await client.post(
                "/api/mcp", json=_call("whoami"), headers=_headers()
            )
        assert first.status_code == 200
        assert second.status_code == 429
        assert second.headers["retry-after"] == "60"


class TestPrincipalReachesTheTool:
    """The SDK has three ways in: no version header, a 2025 handshake
    version, and the 2026-07-28 single-exchange entry that needs an
    envelope. The tool must see the endpoint's principal on all three."""

    @pytest.mark.parametrize("protocol", [None, "2025-06-18", "2026-07-28"])
    @pytest.mark.usefixtures("_no_rate_limit")
    async def test_tool_sees_the_bound_principal(self, protocol):
        extra = {}
        if protocol == "2026-07-28":
            extra = {"MCP-Method": "tools/call", "MCP-Name": "whoami"}
        async with running_client() as (client, _):
            r = await client.post(
                "/api/mcp",
                json=_call("whoami", protocol),
                headers=_headers(protocol=protocol, **extra),
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["result"]["isError"] is False
        assert '"organization_id": "org-a"' in body["result"]["content"][0]["text"]

    @pytest.mark.usefixtures("_no_rate_limit")
    async def test_principal_does_not_leak_between_requests(self):
        async with running_client() as (client, _):
            await client.post("/api/mcp", json=_call("whoami"), headers=_headers())
        with pytest.raises(NoPrincipalError):
            current_principal()
