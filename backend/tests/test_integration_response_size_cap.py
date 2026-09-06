"""Guard tests for INT-7: MAX_RESPONSE_SIZE is enforced centrally.

`create_integration_client()` wraps its transport with
`_SizeLimitedTransport`, which aborts a response mid-read once it exceeds
`MAX_RESPONSE_SIZE` bytes — before httpx's non-streaming `.get()`/`.request()`
calls can fully buffer an oversized body into memory. See
docs/security-review/INT-27-integrations.md (INT-7) and base.py's docstrings
for why this single-file, transport-level fix covers every connector without
each one changing its call site.

Response bodies must be handed to `httpx.Response(..., stream=...)`, not
`content=...`, to exercise this: `content=` eagerly materializes
`Response._content` inside `httpx.MockTransport`'s dispatch call, which is
how a synthetic Response differs from a real transport's (real transports
build `Response(..., stream=AsyncResponseStream(...))`, so `_content` is not
set until something actually reads the stream) — with `content=`, the
wrapping transport never gets a chance to intercept anything.
"""

import gzip
import os
from unittest.mock import patch

import httpx
import pytest

from app.services.integration_services import base as base_module
from app.services.integration_services.base import (
    MAX_RESPONSE_SIZE,
    ResponseTooLargeError,
    UnsupportedContentEncodingError,
    _environment_proxy_mounts,
    _SizeLimitedTransport,
    create_integration_client,
)
from app.services.integration_services.calcom_service import CalcomService


class _ChunkedStream(httpx.AsyncByteStream):
    """Simulates a real transport's streamed response body."""

    def __init__(self, body: bytes, chunk_size: int = 1000) -> None:
        self._body = body
        self._chunk_size = chunk_size

    async def __aiter__(self):
        for i in range(0, len(self._body), self._chunk_size):
            yield self._body[i : i + self._chunk_size]


def _streaming_dispatch(body: bytes):
    def dispatch(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=_ChunkedStream(body))

    return dispatch


async def test_oversized_response_aborts_before_full_buffering():
    body = b"x" * 6000
    transport = _SizeLimitedTransport(
        httpx.MockTransport(_streaming_dispatch(body)), max_bytes=5000
    )
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(ResponseTooLargeError):
            await client.get("https://example.test/big")


async def test_response_at_or_under_the_limit_is_unaffected():
    body = b"y" * 5000
    transport = _SizeLimitedTransport(
        httpx.MockTransport(_streaming_dispatch(body)), max_bytes=5000
    )
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.get("https://example.test/ok")
        assert response.content == body


async def test_create_integration_client_wires_the_size_limited_transport():
    """Structural guard: if create_integration_client() ever stops wrapping
    its transport, this fails even though the two tests above (which build
    their own _SizeLimitedTransport directly) would still pass."""
    client = create_integration_client()
    try:
        assert isinstance(client._transport, _SizeLimitedTransport)
        assert client._transport._max_bytes == MAX_RESPONSE_SIZE
    finally:
        await client.aclose()


def _mock_public_dns():
    """Mock DNS resolution to a public IP the way test_integrations_security.py
    does — assert_outbound_url_safe() (called by every connector's
    _assert_base_url_safe()) resolves the configured hostname before the
    patched transport is ever reached, so a test running with no outbound
    network access needs this or it fails on `Could not resolve hostname`
    rather than on anything this file is testing."""
    return patch(
        "app.utils.url_validator.socket.getaddrinfo",
        return_value=[(2, 1, 6, "", ("104.18.0.62", 0))],
    )


async def test_real_connector_call_aborts_on_an_oversized_response():
    """End-to-end through an actual connector (CalcomService), with only the
    network-facing httpx.AsyncHTTPTransport replaced — proving the cap is
    enforced along the real code path a connector call takes, not just in
    the transport unit tests above."""
    oversized_body = b"z" * (MAX_RESPONSE_SIZE + 1024)

    class _FakeNetworkTransport(httpx.AsyncBaseTransport):
        def __init__(self, *args: object, **kwargs: object) -> None:
            self._inner = httpx.MockTransport(_streaming_dispatch(oversized_body))

        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            return await self._inner.handle_async_request(request)

    service = CalcomService({"api_base_url": "https://api.cal.com/v1", "api_key": "k"})
    with _mock_public_dns():
        with patch.object(
            base_module.httpx, "AsyncHTTPTransport", _FakeNetworkTransport
        ):
            with pytest.raises(ResponseTooLargeError):
                await service.test_connection()


async def test_gzip_bomb_is_rejected_before_expansion():
    """INT-27/Codex, 2026-09-06: _SizeLimitedAsyncStream counts wire bytes,
    which are the *compressed* bytes for an encoded response — httpx only
    decompresses afterward in Response.aiter_bytes(). A small gzip body that
    decodes to far more than MAX_RESPONSE_SIZE must never reach
    response.content: it must be rejected for its Content-Encoding before
    any decoding happens, not silently allowed through because the wire size
    is under the cap."""
    decoded = b"0" * (MAX_RESPONSE_SIZE + (1024 * 1024))  # decodes to >10MB
    compressed = gzip.compress(decoded)
    assert len(compressed) < 20_000  # wire size is nowhere near the cap

    def dispatch(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-encoding": "gzip"},
            stream=_ChunkedStream(compressed),
        )

    transport = _SizeLimitedTransport(
        httpx.MockTransport(dispatch), max_bytes=MAX_RESPONSE_SIZE
    )
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(UnsupportedContentEncodingError):
            await client.get("https://example.test/bomb")


async def test_identity_content_encoding_is_not_rejected():
    """A response that explicitly declares Content-Encoding: identity (a
    no-op encoding) must still be served — only a real compression scheme is
    refused."""
    body = b"y" * 100

    def dispatch(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-encoding": "identity"}, stream=_ChunkedStream(body)
        )

    transport = _SizeLimitedTransport(
        httpx.MockTransport(dispatch), max_bytes=MAX_RESPONSE_SIZE
    )
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.get("https://example.test/ok")
        assert response.content == body


async def test_create_integration_client_requests_identity_encoding():
    """create_integration_client() asks servers not to compress at all, so a
    well-behaved API never triggers the Content-Encoding rejection above."""
    client = create_integration_client()
    try:
        assert client.headers.get("accept-encoding") == "identity"
    finally:
        await client.aclose()


async def test_real_connector_call_aborts_on_a_gzip_bomb():
    """Same end-to-end shape as
    test_real_connector_call_aborts_on_an_oversized_response, but for a
    compressed body whose wire size is under the cap and whose decoded size
    is not."""
    decoded = b"z" * (MAX_RESPONSE_SIZE + (1024 * 1024))
    compressed = gzip.compress(decoded)
    assert len(compressed) < 20_000

    def dispatch(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-encoding": "gzip"},
            stream=_ChunkedStream(compressed),
        )

    class _FakeNetworkTransport(httpx.AsyncBaseTransport):
        def __init__(self, *args: object, **kwargs: object) -> None:
            self._inner = httpx.MockTransport(dispatch)

        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            return await self._inner.handle_async_request(request)

    service = CalcomService({"api_base_url": "https://api.cal.com/v1", "api_key": "k"})
    with _mock_public_dns():
        with patch.object(
            base_module.httpx, "AsyncHTTPTransport", _FakeNetworkTransport
        ):
            with pytest.raises(UnsupportedContentEncodingError):
                await service.test_connection()


async def test_environment_proxy_mounts_wraps_the_proxy_transport():
    """INT-27/Codex, 2026-09-06: create_integration_client() passes an
    explicit transport=, which makes httpx.AsyncClient skip its own
    HTTP_PROXY/HTTPS_PROXY resolution (allow_env_proxies = trust_env and
    transport is None). _environment_proxy_mounts() must replay that
    resolution itself so a deployment relying on an egress proxy still gets
    one — and the replayed proxy transport must still be size-limited."""
    with patch.dict(
        os.environ,
        {"HTTP_PROXY": "http://proxy.example:8080", "HTTPS_PROXY": ""},
        clear=False,
    ):
        # HTTPS_PROXY="" would be falsy to getproxies() for the https scheme,
        # so only assert on the http:// mount to avoid depending on how the
        # test runner's own ambient proxy env (if any) affects https://.
        mounts = _environment_proxy_mounts(MAX_RESPONSE_SIZE)
        http_transport = mounts.get("http://")
        assert isinstance(http_transport, _SizeLimitedTransport)
        assert http_transport._max_bytes == MAX_RESPONSE_SIZE
        assert isinstance(http_transport._transport, httpx.AsyncHTTPTransport)


async def test_create_integration_client_timeout_override_preserves_hardening():
    """A caller-supplied timeout= (e.g. paypal_service.py's vendor-tuned
    Timeout(15.0, connect=10.0)) must not bypass any other hardening —
    the size-limited transport, redirect suppression, and identity encoding
    request must all still apply."""
    custom_timeout = httpx.Timeout(15.0, connect=10.0)
    client = create_integration_client(timeout=custom_timeout)
    try:
        assert client.timeout == custom_timeout
        assert isinstance(client._transport, _SizeLimitedTransport)
        assert client.follow_redirects is False
        assert client.headers.get("accept-encoding") == "identity"
    finally:
        await client.aclose()


async def test_environment_proxy_mounts_trust_env_false_returns_no_mounts():
    """INT-27/Codex follow-up, 2026-09-06: trust_env=False must skip the env
    lookup outright, mirroring stock httpx's `allow_env_proxies = trust_env
    and transport is None` — trust_env alone short-circuits that expression
    regardless of transport."""
    with patch.dict(
        os.environ,
        {
            "HTTP_PROXY": "http://proxy.example:8080",
            "HTTPS_PROXY": "http://proxy.example:8080",
        },
        clear=False,
    ):
        assert _environment_proxy_mounts(MAX_RESPONSE_SIZE, trust_env=False) == {}


async def test_create_integration_client_trust_env_false_ignores_env_proxies():
    """A caller opting out of ambient proxy env vars via trust_env=False must
    get a client with no env-derived proxy mounts at all."""
    with patch.dict(
        os.environ,
        {
            "HTTP_PROXY": "http://proxy.example:8080",
            "HTTPS_PROXY": "http://proxy.example:8080",
        },
        clear=False,
    ):
        client = create_integration_client(trust_env=False)
        try:
            assert client._mounts == {}
        finally:
            await client.aclose()


async def test_create_integration_client_explicit_proxy_wins_over_env_proxies():
    """INT-27/Codex follow-up, 2026-09-06: an explicit proxy= must take
    effect and must not be shadowed by more-specific environment-derived
    scheme mounts (http://, https://) — matching stock httpx's
    _get_proxy_map, which never consults env vars once proxy is given."""
    with patch.dict(
        os.environ,
        {"HTTP_PROXY": "http://env-proxy.example:8080"},
        clear=False,
    ):
        client = create_integration_client(proxy="http://explicit-proxy.example:9000")
        try:
            patterns = {str(p.pattern) for p in client._mounts}
            assert patterns == {"all://"}
            (mount,) = client._mounts.values()
            assert isinstance(mount, _SizeLimitedTransport)
            assert mount._max_bytes == MAX_RESPONSE_SIZE
            pool = mount._transport._pool
            assert pool._proxy_url.host == b"explicit-proxy.example"
            assert pool._proxy_url.port == 9000
        finally:
            await client.aclose()


async def test_paypal_service_uses_shared_integration_client():
    """Structural guard (INT-27/Codex follow-up, 2026-09-06): paypal_service.py's
    two outbound calls must go through create_integration_client(), not a bare
    httpx.AsyncClient() — otherwise they silently stop inheriting the
    response-size cap and other hardening centralized there, the exact gap
    this follow-up closes."""
    import inspect

    from app.services.integration_services import paypal_service

    source = inspect.getsource(paypal_service)
    assert "httpx.AsyncClient(" not in source
    assert source.count("create_integration_client(") == 2


async def test_paypal_get_access_token_enforces_response_size_cap():
    """End-to-end: PayPal's get_access_token now routes through
    create_integration_client() and must inherit the same response-size cap
    as every other connector, with only the network-facing
    httpx.AsyncHTTPTransport replaced (same shape as
    test_real_connector_call_aborts_on_an_oversized_response)."""
    from app.services.integration_services.paypal_service import get_access_token

    oversized_body = b"z" * (MAX_RESPONSE_SIZE + 1024)

    class _FakeNetworkTransport(httpx.AsyncBaseTransport):
        def __init__(self, *args: object, **kwargs: object) -> None:
            self._inner = httpx.MockTransport(_streaming_dispatch(oversized_body))

        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            return await self._inner.handle_async_request(request)

    with patch.object(base_module.httpx, "AsyncHTTPTransport", _FakeNetworkTransport):
        with pytest.raises(ResponseTooLargeError):
            await get_access_token(
                "https://api-m.sandbox.paypal.com", "client-id", "client-secret"
            )


async def test_paypal_verify_webhook_signature_fails_closed_on_oversized_response():
    """verify_webhook_signature must not let an oversized response propagate
    as an unhandled exception — like any other transport failure, it must be
    treated as "do not trust this payload" and return False."""
    from app.services.integration_services.paypal_service import (
        verify_webhook_signature,
    )

    oversized_body = b"z" * (MAX_RESPONSE_SIZE + 1024)

    class _FakeNetworkTransport(httpx.AsyncBaseTransport):
        def __init__(self, *args: object, **kwargs: object) -> None:
            self._inner = httpx.MockTransport(_streaming_dispatch(oversized_body))

        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            return await self._inner.handle_async_request(request)

    class _Integration:
        config = {"environment": "sandbox", "webhook_id": "WH-1"}

        def get_secret(self, key):
            return {"client_id": "cid", "client_secret": "csec"}.get(key)

    headers = {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api-m.paypal.com/cert",
        "paypal-transmission-id": "tid",
        "paypal-transmission-sig": "sig",
        "paypal-transmission-time": "2026-09-06T00:00:00Z",
    }

    with patch.object(base_module.httpx, "AsyncHTTPTransport", _FakeNetworkTransport):
        # get_access_token itself hits the oversized response first; either
        # way the surrounding try/except in verify_webhook_signature must
        # catch it and fail closed rather than raising past the caller.
        result = await verify_webhook_signature(_Integration(), headers, {})
    assert result is False


async def test_create_integration_client_trust_env_false_transport_ignores_env_ssl_vars():
    """Codex, 2026-09-06: trust_env=False must reach the transport(s) too,
    not just gate the _environment_proxy_mounts() decision. In pinned httpx
    0.28.1, AsyncHTTPTransport.__init__ defaults its own trust_env to True
    independently of the client it's mounted on, and that default is what
    reads SSL_CERT_FILE/SSL_CERT_DIR at construction time — so an
    unreachable SSL_CERT_FILE must not break a client built with
    trust_env=False, exactly like stock httpx.AsyncClient(trust_env=False)."""
    with patch.dict(
        os.environ, {"SSL_CERT_FILE": "/nonexistent/path/to/cert.pem"}, clear=False
    ):
        # Sanity check: stock httpx.AsyncClient(trust_env=False) is
        # unaffected by the bogus SSL_CERT_FILE, proving the environment is
        # actually exercising the bug this test guards against.
        stock_client = httpx.AsyncClient(trust_env=False)
        await stock_client.aclose()

        client = create_integration_client(trust_env=False)
        try:
            assert isinstance(client._transport, _SizeLimitedTransport)
        finally:
            await client.aclose()


async def test_create_integration_client_headers_merge_with_caller_headers():
    """Codex, 2026-09-06: an explicit headers= kwarg used to collide with
    the mandatory Accept-Encoding: identity header this function passes to
    httpx.AsyncClient, raising 'got multiple values for keyword argument
    headers' before any request was made. A caller-supplied header mapping
    must merge with, not collide with, the mandatory identity encoding."""
    client = create_integration_client(headers={"Authorization": "Bearer token"})
    try:
        assert client.headers.get("authorization") == "Bearer token"
        assert client.headers.get("accept-encoding") == "identity"
    finally:
        await client.aclose()


async def test_create_integration_client_headers_identity_wins_on_collision():
    """A caller-supplied Accept-Encoding (any casing) must not defeat the
    gzip-bomb backstop — the mandatory identity value always wins."""
    client = create_integration_client(headers={"Accept-Encoding": "gzip"})
    try:
        assert client.headers.get("accept-encoding") == "identity"
    finally:
        await client.aclose()


async def test_create_integration_client_mounts_match_stock_httpx_resolution():
    """Parity check: given the same environment, the mounts
    create_integration_client() builds via _environment_proxy_mounts() must
    resolve the same URL patterns httpx.AsyncClient() would have resolved on
    its own with no transport= override — proving the replay doesn't miss or
    add any NO_PROXY/HTTP_PROXY/HTTPS_PROXY pattern."""
    with patch.dict(
        os.environ,
        {
            "HTTP_PROXY": "http://proxy.example:8080",
            "HTTPS_PROXY": "http://proxy.example:8080",
            "NO_PROXY": "internal.example.com",
        },
        clear=False,
    ):
        stock_client = httpx.AsyncClient()
        mine = create_integration_client()
        try:
            stock_patterns = {str(p.pattern) for p in stock_client._mounts}
            mine_patterns = {str(p.pattern) for p in mine._mounts}
            assert mine_patterns == stock_patterns
        finally:
            await stock_client.aclose()
            await mine.aclose()
