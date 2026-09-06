"""
Base HTTP client for integration services.

Shared httpx.AsyncClient with security-hardened defaults:
- Connection pooling with per-service limits
- Explicit TLS verification
- No redirect following (SSRF protection)
- Response body size cap, enforced centrally via a wrapping transport
"""

import typing

import httpx

# INT-7 (security-review, 2026-09-06 pass 3): httpx.Timeout(10.0, connect=5.0)
# sets a 5s *connect* timeout and a 10s *read* timeout that applies to each
# individual socket read, not a 10s wall-clock cap on the whole request
# (httpx._config.Timeout has no "total" concept at all — every positional/
# keyword value it accepts maps to one of connect/read/write/pool). A remote
# server that trickles one chunk per 9 seconds resets the read timer on every
# chunk and can hold the connection open indefinitely while this client
# accumulates data, well past any "10s total" reading of this constant. See
# docs/security-review/INT-27-integrations.md and KNOWN_LIMITATIONS.md.
INTEGRATION_TIMEOUT = httpx.Timeout(10.0, connect=5.0)

# Connection pool limits per service type
INTEGRATION_LIMITS = httpx.Limits(
    max_connections=10,
    max_keepalive_connections=5,
)

# INT-7 (security-review, 2026-09-06): maximum response body size, enforced
# by _SizeLimitedTransport below. httpx's non-streaming .get()/.request()
# still fully drains response.stream via Response.aread() before .json()/
# .text become available (AsyncClient.send() awaits response.aread() when
# stream=False), so a transport-level stream wrapper that raises once this
# many bytes have been read aborts the buffering before an oversized body is
# ever fully materialized in memory — with no change needed at any
# connector's call site. See docs/security-review/INT-27-integrations.md.
MAX_RESPONSE_SIZE = 10 * 1024 * 1024


class ResponseTooLargeError(httpx.TransportError):
    """Raised when a response body exceeds MAX_RESPONSE_SIZE.

    Subclassing httpx.TransportError (rather than a bespoke exception type)
    means this is caught by every existing `except httpx.TransportError`
    retry/handling path the same way a connection or timeout failure already
    is, and sanitize_connector_error (INT-6) treats it as an unvetted infra
    failure rather than a hand-authored, safe-to-display message.
    """


class _SizeLimitedAsyncStream(httpx.AsyncByteStream):
    """Wraps a response's AsyncByteStream and aborts once max_bytes is read."""

    def __init__(self, stream: httpx.AsyncByteStream, max_bytes: int) -> None:
        self._stream = stream
        self._max_bytes = max_bytes

    async def __aiter__(self) -> typing.AsyncIterator[bytes]:
        total = 0
        async for chunk in self._stream:
            total += len(chunk)
            if total > self._max_bytes:
                await self._stream.aclose()
                raise ResponseTooLargeError(
                    f"response exceeded the {self._max_bytes}-byte integration "
                    "response size limit"
                )
            yield chunk

    async def aclose(self) -> None:
        await self._stream.aclose()


class _SizeLimitedTransport(httpx.AsyncBaseTransport):
    """Wraps an AsyncBaseTransport, capping every response body it returns.

    This is the single interception point that makes MAX_RESPONSE_SIZE a
    real, always-on control instead of a declared-but-unread constant: it
    wraps `response.stream` before returning the response to httpx's client
    machinery, so it applies uniformly to every connector's `.get()`,
    `.post()`, and `.request()` calls without any of them changing.
    """

    def __init__(self, transport: httpx.AsyncBaseTransport, max_bytes: int) -> None:
        self._transport = transport
        self._max_bytes = max_bytes

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._transport.handle_async_request(request)
        response.stream = _SizeLimitedAsyncStream(response.stream, self._max_bytes)
        return response

    async def aclose(self) -> None:
        await self._transport.aclose()


def create_integration_client(**kwargs: object) -> httpx.AsyncClient:
    """Create a security-hardened httpx client for external API calls.

    `verify`/`limits` are applied to the transport explicitly (rather than
    passed to `httpx.AsyncClient`) because passing an explicit `transport=`
    makes httpx.AsyncClient ignore both — see `AsyncClient._init_transport`,
    which only builds a transport from `verify`/`limits` when `transport` is
    None. No current caller passes its own `transport=` (this function
    already supplies one, so doing so raises TypeError on the duplicate
    keyword rather than silently bypassing the cap); a future caller that
    needs a custom transport should wrap it with `_SizeLimitedTransport`
    itself rather than reaching for `**kwargs`.
    """
    transport = _SizeLimitedTransport(
        httpx.AsyncHTTPTransport(verify=True, limits=INTEGRATION_LIMITS),
        MAX_RESPONSE_SIZE,
    )
    return httpx.AsyncClient(
        timeout=INTEGRATION_TIMEOUT,
        follow_redirects=False,
        transport=transport,
        **kwargs,
    )
