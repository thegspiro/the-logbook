"""SCH-10: every integration sender connects to the address it validated.

`assert_outbound_url_safe()` resolves a hostname and checks the answer, but
the request used to resolve the name again when it connected, so a name could
answer the check with a public address and the connection with an internal
one. `create_integration_client()` now pins its direct connections through
`SSRFSafeAsyncTransport`, and audit shipping builds its client from that
factory, so the address checked is the address connected to.

No test here reaches the network: names are answered by a patched resolver,
and the end-to-end tests connect to a throwaway server on the loopback
interface.
"""

import inspect
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

import app.services.audit_ship_service as audit_ship_module
from app.core.config import settings
from app.services.integration_services import base as base_module
from app.services.integration_services import slack_service
from app.services.integration_services.base import create_integration_client
from app.utils.ssrf_transport import UnsafeDestinationError

pytestmark = pytest.mark.unit

_PUBLIC_IP = "93.184.216.34"
_PROXY_VARS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
)


def _answers(*addresses: str):
    return [
        (
            socket.AF_INET6 if ":" in address else socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            "",
            (address, 443, 0, 0) if ":" in address else (address, 443),
        )
        for address in addresses
    ]


class _ScriptedResolver:
    """Answers `hostname` from a script, one entry per lookup.

    Address literals are passed to the real resolver, which answers them
    without any network traffic — the connection layer resolves the pinned
    address it is handed, and that lookup is not the one under test.
    """

    def __init__(self, hostname: str, *scripted: list) -> None:
        self._hostname = hostname
        self._scripted = list(scripted)
        self.lookups = 0
        self._real = socket.getaddrinfo

    def __call__(self, host, *args, **kwargs):
        if host != self._hostname:
            return self._real(host, *args, **kwargs)
        self.lookups += 1
        if not self._scripted:
            raise AssertionError(f"unexpected extra lookup of {host}")
        return self._scripted.pop(0)


@pytest.fixture(autouse=True)
def _direct_connections(monkeypatch):
    """Pinning applies to the direct transport; an ambient proxy would route
    these requests through an unpinned proxy mount instead."""
    for var in _PROXY_VARS:
        monkeypatch.delenv(var, raising=False)


class _RecordingNetwork(httpx.AsyncBaseTransport):
    """Stands in for httpx.AsyncHTTPTransport; records where it was sent."""

    requests: list[httpx.Request] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        type(self).requests.append(request)
        return httpx.Response(200, text="ok")


@pytest.fixture
def recording_network(monkeypatch):
    _RecordingNetwork.requests = []
    monkeypatch.setattr(base_module.httpx, "AsyncHTTPTransport", _RecordingNetwork)
    return _RecordingNetwork.requests


class TestFactoryPinsTheValidatedAddress:
    async def test_connection_targets_the_checked_address_not_a_later_answer(
        self, monkeypatch, recording_network
    ):
        # One public answer for the transport's own lookup; any lookup after
        # it would be a rebinding attempt and fails the test outright.
        resolver = _ScriptedResolver("hooks.example.test", _answers(_PUBLIC_IP))
        monkeypatch.setattr(socket, "getaddrinfo", resolver)

        async with create_integration_client() as client:
            response = await client.post("https://hooks.example.test/a", json={})

        assert response.status_code == 200
        assert resolver.lookups == 1
        (sent,) = recording_network
        assert sent.url.host == _PUBLIC_IP
        assert sent.headers["Host"] == "hooks.example.test"
        assert sent.extensions["sni_hostname"] == "hooks.example.test"

    @pytest.mark.parametrize(
        "forbidden", ["127.0.0.1", "10.0.0.5", "169.254.169.254", "fd00::1"]
    )
    async def test_a_private_answer_is_refused_before_connecting(
        self, monkeypatch, recording_network, forbidden
    ):
        monkeypatch.setattr(
            socket,
            "getaddrinfo",
            _ScriptedResolver("hooks.example.test", _answers(forbidden)),
        )

        async with create_integration_client() as client:
            with pytest.raises(UnsafeDestinationError, match="non-global"):
                await client.get("https://hooks.example.test/a")

        assert recording_network == []

    async def test_multicast_is_refused_although_ipaddress_calls_it_global(
        self, monkeypatch, recording_network
    ):
        monkeypatch.setattr(
            socket,
            "getaddrinfo",
            _ScriptedResolver("hooks.example.test", _answers("239.1.2.3")),
        )

        async with create_integration_client() as client:
            with pytest.raises(UnsafeDestinationError):
                await client.get("https://hooks.example.test/a")

        assert recording_network == []

    async def test_trusted_private_destination_still_refuses_metadata(
        self, monkeypatch, recording_network
    ):
        monkeypatch.setattr(
            socket,
            "getaddrinfo",
            _ScriptedResolver("siem.example.test", _answers("169.254.169.254")),
        )

        async with create_integration_client(allow_private_destinations=True) as c:
            with pytest.raises(UnsafeDestinationError, match="metadata"):
                await c.get("https://siem.example.test/ingest")

        assert recording_network == []


class TestARebindAfterTheSenderCheckCannotLand:
    async def test_slack_check_passes_then_rebind_is_refused(
        self, monkeypatch, recording_network
    ):
        """The sender's own check sees a public address; the name then
        answers 127.0.0.1. Before SCH-10 the connection re-resolved and
        followed it; now the only resolution the connection uses is the one
        the transport validates, which refuses it."""
        resolver = _ScriptedResolver(
            "hooks.slack.com", _answers(_PUBLIC_IP), _answers("127.0.0.1")
        )
        monkeypatch.setattr(socket, "getaddrinfo", resolver)

        with pytest.raises(UnsafeDestinationError):
            await slack_service.send_slack_notification(
                "https://hooks.slack.com/services/T/B/x", "hello"
            )

        assert resolver.lookups == 2
        assert recording_network == []


class _Collector(BaseHTTPRequestHandler):
    received: list[tuple[str, str]] = []

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        type(self).received.append((self.headers["Host"], self.path))
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


@pytest.fixture
def loopback_collector():
    _Collector.received = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Collector)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1], _Collector.received
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


class TestAuditShippingUsesThePinnedFactory:
    def test_no_bare_async_client_remains(self):
        source = inspect.getsource(audit_ship_module)
        assert "httpx.AsyncClient(" not in source
        assert "create_integration_client(" in source

    @staticmethod
    def _fake_db(rows):
        state_result = MagicMock()
        state_result.scalar_one_or_none.return_value = SimpleNamespace(
            last_shipped_id=0, last_shipped_at=None
        )
        batches = []
        for batch in (rows, []):
            result = MagicMock()
            result.scalars.return_value.all.return_value = batch
            batches.append(result)
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[state_result, *batches])
        db.commit = AsyncMock()
        return db

    @pytest.fixture
    def _shipping(self, monkeypatch):
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        monkeypatch.setattr(settings, "AUDIT_SHIP_BATCH_SIZE", 1)
        monkeypatch.setattr(
            audit_ship_module, "_get_audit_signing_key", lambda: "unit-test-key"
        )
        monkeypatch.setattr(
            audit_ship_module.audit_logger,
            "serialize_row",
            lambda row: {"id": row.id},
        )

    @pytest.mark.usefixtures("_shipping")
    async def test_a_real_socket_reaches_the_pinned_address(
        self, monkeypatch, loopback_collector
    ):
        """End to end with real sockets: the collector name is resolved once,
        to the loopback server (permitted only by the operator's
        private-destination opt-in), and the request arrives there still
        addressed to the collector's name."""
        port, received = loopback_collector
        monkeypatch.setattr(
            settings,
            "AUDIT_SHIP_WEBHOOK_URL",
            f"http://collector.example.test:{port}/ingest",
        )
        monkeypatch.setattr(settings, "AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION", True)
        resolver = _ScriptedResolver("collector.example.test", _answers("127.0.0.1"))
        monkeypatch.setattr(socket, "getaddrinfo", resolver)

        result = await audit_ship_module.ship_new_audit_logs(
            self._fake_db([SimpleNamespace(id=1)])
        )

        assert result["error"] is None
        assert result["shipped_entries"] == 1
        assert received == [(f"collector.example.test:{port}", "/ingest")]
        # The URL guard skips DNS under the opt-in; this one lookup is the
        # transport's, and nothing resolved the name again to connect.
        assert resolver.lookups == 1

    @pytest.mark.usefixtures("_shipping")
    async def test_a_rebind_between_check_and_connect_is_reported_as_the_url(
        self, monkeypatch, loopback_collector
    ):
        port, received = loopback_collector
        monkeypatch.setattr(
            settings,
            "AUDIT_SHIP_WEBHOOK_URL",
            f"http://collector.example.test:{port}/ingest",
        )
        monkeypatch.setattr(settings, "AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION", False)
        resolver = _ScriptedResolver(
            "collector.example.test", _answers(_PUBLIC_IP), _answers("127.0.0.1")
        )
        monkeypatch.setattr(socket, "getaddrinfo", resolver)

        result = await audit_ship_module.ship_new_audit_logs(
            self._fake_db([SimpleNamespace(id=1)])
        )

        assert result["shipped_entries"] == 0
        assert result["error"].startswith("unsafe collector URL:")
        assert received == []
        assert resolver.lookups == 2
