"""INT-9: Google Calendar's httplib2 transport has a byte cap and timeouts.

The connector reaches Google through googleapiclient -> google_auth_httplib2
-> httplib2, not httpx, so `create_integration_client()`'s limits never
applied to it. `_build_service()` now hands googleapiclient an
`AuthorizedHttp` over `_BoundedHttp`, whose connections read with
MAX_RESPONSE_SIZE and INTEGRATION_TIMEOUT's budgets.

Every test drives real sockets against a throwaway server on the loopback
interface: a size cap is only proven by a body that actually streams past it.
"""

import functools
import gzip
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.services.integration_services import google_calendar_service as gcal
from app.services.integration_services.base import (
    INTEGRATION_TIMEOUT,
    MAX_RESPONSE_SIZE,
    ResponseTooLargeError,
)
from app.services.integration_services.google_calendar_service import (
    GoogleCalendarService,
    _BoundedHttp,
    _build_service,
)

pytestmark = pytest.mark.unit

_PROXY_VARS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)
_CHUNK = 64 * 1024
_STREAM_TOTAL = MAX_RESPONSE_SIZE * 4
_OK_BODY = json.dumps({"items": [{"id": "primary"}]}).encode()


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        server = self.server
        server.paths.append(self.path)
        getattr(self, f"_{server.mode}")()

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.do_GET()

    def _ok(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(_OK_BODY)))
        self.end_headers()
        self.wfile.write(_OK_BODY)

    def _stream(self, declared: int | None):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        if declared is None:
            self.send_header("Transfer-Encoding", "chunked")
        else:
            self.send_header("Content-Length", str(declared))
        self.end_headers()
        chunk = b"x" * _CHUNK
        try:
            while self.server.sent < _STREAM_TOTAL:
                if declared is None:
                    self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                else:
                    self.wfile.write(chunk)
                self.server.sent += len(chunk)
            if declared is None:
                self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True

    def _chunked_oversize(self):
        self._stream(declared=None)

    def _declared_oversize(self):
        self._stream(declared=_STREAM_TOTAL)

    def _gzip_bomb(self):
        body = gzip.compress(b"0" * (MAX_RESPONSE_SIZE + 1024 * 1024))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _stall_before_headers(self):
        self.server.release.wait(10)
        self.close_connection = True

    def _stall_mid_body(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", "100")
        self.end_headers()
        self.wfile.write(b'{"items": [')
        self.wfile.flush()
        self.server.release.wait(10)
        self.close_connection = True

    def log_message(self, *args):
        pass


@pytest.fixture
def server(monkeypatch):
    for var in _PROXY_VARS:
        monkeypatch.delenv(var, raising=False)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    httpd.daemon_threads = True
    httpd.mode = "ok"
    httpd.sent = 0
    httpd.paths = []
    httpd.release = threading.Event()
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd
    finally:
        httpd.release.set()
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def _url(httpd, path="/calendar"):
    return f"http://127.0.0.1:{httpd.server_address[1]}{path}"


class TestTheLimitsAreTheSharedOnes:
    def test_budgets_come_from_the_httpx_connectors_constants(self):
        assert gcal._CONNECT_TIMEOUT == INTEGRATION_TIMEOUT.connect
        assert gcal._READ_TIMEOUT == INTEGRATION_TIMEOUT.read
        assert _BoundedHttp().timeout == INTEGRATION_TIMEOUT.read
        assert _BoundedHttp().limit_kwargs["hard_limit"] == MAX_RESPONSE_SIZE

    def test_build_service_uses_the_bounded_transport(self):
        service = _build_service({"token": "t"})
        assert isinstance(service._http.http, _BoundedHttp)


class TestBoundedHttpAgainstARealSocket:
    def test_a_normal_response_succeeds(self, server):
        response, content = _BoundedHttp().request(_url(server))
        assert response.status == 200
        assert content == _OK_BODY

    @pytest.mark.parametrize("mode", ["chunked_oversize", "declared_oversize"])
    def test_an_oversized_stream_is_refused_without_being_drained(self, server, mode):
        server.mode = mode
        with pytest.raises(ResponseTooLargeError):
            _BoundedHttp().request(_url(server))
        # The client stopped reading at the cap: the server could not push
        # the whole stream into a peer that had closed the connection.
        time.sleep(0.2)
        assert server.sent < _STREAM_TOTAL

    def test_a_gzip_body_that_inflates_past_the_cap_is_refused(self, server):
        server.mode = "gzip_bomb"
        with pytest.raises(ResponseTooLargeError, match="decompressed"):
            _BoundedHttp().request(_url(server))

    @pytest.mark.parametrize("mode", ["stall_before_headers", "stall_mid_body"])
    def test_a_stalled_response_times_out(self, server, monkeypatch, mode):
        monkeypatch.setattr(gcal, "_READ_TIMEOUT", 0.5)
        server.mode = mode
        started = time.monotonic()
        with pytest.raises(TimeoutError):
            _BoundedHttp().request(_url(server))
        assert time.monotonic() - started < 5

    def test_the_connection_is_usable_after_a_refused_body(self, server):
        """The refused body's unread bytes must not be read as the next
        response: the pooled connection is dropped, not reused."""
        http = _BoundedHttp()
        server.mode = "chunked_oversize"
        with pytest.raises(ResponseTooLargeError):
            http.request(_url(server))
        server.mode = "ok"
        response, content = http.request(_url(server))
        assert response.status == 200
        assert content == _OK_BODY


class TestThroughTheGoogleClient:
    """The whole stack the connector runs — googleapiclient, the
    AuthorizedHttp carrying the token, and the bounded transport — with only
    the API endpoint pointed at the loopback server."""

    @pytest.fixture
    def local_google(self, server, monkeypatch):
        import googleapiclient.discovery

        monkeypatch.setattr(
            googleapiclient.discovery,
            "build",
            functools.partial(
                googleapiclient.discovery.build,
                client_options={"api_endpoint": _url(server, "/")},
            ),
        )
        return server

    async def test_connection_succeeds_on_a_normal_response(self, local_google):
        message = await GoogleCalendarService({"token": "t"}).test_connection()
        assert message == "Connected to Google Calendar (1+ calendars accessible)"
        assert local_google.paths[0].startswith("/users/me/calendarList")

    async def test_an_oversized_response_fails_the_call_cleanly(self, local_google):
        local_google.mode = "chunked_oversize"
        with pytest.raises(Exception, match="Google Calendar connection failed"):
            await GoogleCalendarService({"token": "t"}).test_connection()
        time.sleep(0.2)
        assert local_google.sent < _STREAM_TOTAL

    async def test_a_push_against_a_stalled_api_returns_none(
        self, local_google, monkeypatch
    ):
        monkeypatch.setattr(gcal, "_READ_TIMEOUT", 0.5)
        local_google.mode = "stall_before_headers"
        result = await GoogleCalendarService({"token": "t"}).push_event(
            {"title": "Drill"}
        )
        assert result is None
