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
from httpx._utils import get_environment_proxies

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


class UnsupportedContentEncodingError(httpx.TransportError):
    """Raised when a response declares a Content-Encoding we refuse to decode.

    Same rationale as ResponseTooLargeError for subclassing
    httpx.TransportError — see its docstring.
    """


class _SizeLimitedAsyncStream(httpx.AsyncByteStream):
    """Wraps a response's AsyncByteStream and aborts once max_bytes is read.

    This counts *wire* bytes — the stream as delivered by the transport,
    before httpx's own `Response.aiter_bytes()`/`.aread()` apply any
    Content-Encoding decompression on top of it. That is only safe to rely on
    because `_SizeLimitedTransport` rejects any response carrying a
    Content-Encoding header outright (see its docstring): with decompression
    never reaching a materialized body, wire bytes and decoded bytes are the
    same number. Counting here after decompression instead would require
    duplicating httpx's private `Response._get_content_decoder()` machinery
    for no benefit, since the transport already refuses to hand this class a
    compressed stream.
    """

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

    It also rejects any response that declares a Content-Encoding
    (INT-27/Codex, 2026-09-06): `_SizeLimitedAsyncStream` below counts bytes
    read off this transport's raw stream, which are the *compressed* wire
    bytes for an encoded response — httpx only decompresses them afterward,
    inside `Response.aiter_bytes()`. A small gzip body can decode to many
    times its wire size (a 12KB gzip body expanding to 12MB+ was confirmed
    locally), so counting wire bytes alone lets a gzip bomb sail through this
    cap while `Response.aread()` still buffers the fully-decoded body in
    memory. `create_integration_client()` already asks servers for
    `Accept-Encoding: identity` so this should never trigger for a
    well-behaved API — this is the backstop for one that compresses anyway.
    """

    def __init__(self, transport: httpx.AsyncBaseTransport, max_bytes: int) -> None:
        self._transport = transport
        self._max_bytes = max_bytes

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._transport.handle_async_request(request)
        content_encoding = response.headers.get("content-encoding", "").strip().lower()
        if content_encoding and content_encoding != "identity":
            await response.aclose()
            raise UnsupportedContentEncodingError(
                f"response used unsupported Content-Encoding {content_encoding!r} "
                "— integration responses must be uncompressed so the response "
                "size cap cannot be bypassed by a compressed body that expands "
                "on decode"
            )
        response.stream = _SizeLimitedAsyncStream(response.stream, self._max_bytes)
        return response

    async def aclose(self) -> None:
        await self._transport.aclose()


def _environment_proxy_mounts(
    max_bytes: int,
    *,
    trust_env: bool = True,
    http1: bool = True,
    http2: bool = False,
    cert: str | tuple[str, str] | tuple[str, str, str] | None = None,
) -> dict[str, httpx.AsyncBaseTransport | None]:
    """Rebuild the proxy mounts httpx.AsyncClient would have built itself.

    INT-27/Codex, 2026-09-06: in pinned httpx 0.28.1,
    `AsyncClient.__init__` only resolves HTTP_PROXY/HTTPS_PROXY/NO_PROXY into
    proxy mounts when it receives no explicit `transport=`:
    `allow_env_proxies = trust_env and transport is None`, and with that
    False `_get_proxy_map()` returns `{}` regardless of `trust_env`.
    `create_integration_client()` always supplies an explicit `transport=`
    (the size-limiting wrapper), so without this, every integration request
    would silently stop honoring env-based proxy routing — a deployment that
    requires an egress proxy would have its integration calls attempt direct
    connections and fail.

    `get_environment_proxies()` is the exact parser httpx's own
    `_get_proxy_map()` calls for this case, so replaying it here and wrapping
    each resulting proxy transport with `_SizeLimitedTransport` reproduces
    httpx's default proxy behavior without reimplementing NO_PROXY parsing.
    A `None` entry (a NO_PROXY host pattern) is passed through as `None` —
    `Client._transport_for_url` already treats a `None` mount as "use the
    client's own `self._transport`", which here is the size-limited transport
    with no proxy, the correct behavior for a NO_PROXY match.

    `trust_env` mirrors the same flag on stock `httpx.AsyncClient`: when a
    caller explicitly passes `trust_env=False`, `_get_proxy_map()` would
    return `{}` regardless of what `transport=` was given (`allow_env_proxies
    = trust_env and transport is None` is short-circuited by `trust_env`
    alone). Skip the environment lookup entirely in that case — an opt-out of
    ambient proxy env vars must not be defeated by this replay existing only
    to work around the *other* half of that expression.

    `http1`/`http2`/`cert` are forwarded to each proxy `AsyncHTTPTransport`
    for the same reason `create_integration_client()` now forwards them to
    its own transports — see that function's docstring (Codex, 2026-09-06).
    """
    if not trust_env:
        return {}
    mounts: dict[str, httpx.AsyncBaseTransport | None] = {}
    for pattern, proxy_url in get_environment_proxies().items():
        if proxy_url is None:
            mounts[pattern] = None
            continue
        mounts[pattern] = _SizeLimitedTransport(
            httpx.AsyncHTTPTransport(
                verify=True,
                cert=cert,
                limits=INTEGRATION_LIMITS,
                proxy=httpx.Proxy(url=proxy_url),
                # trust_env is always True here (the `if not trust_env`
                # guard above already returned {} otherwise), but passed
                # explicitly rather than relying on AsyncHTTPTransport's own
                # default — see create_integration_client's docstring for
                # why every transport this module builds takes trust_env
                # explicitly instead of trusting httpx's default of True.
                trust_env=trust_env,
                http1=http1,
                http2=http2,
            ),
            max_bytes,
        )
    return mounts


def create_integration_client(
    *,
    trust_env: bool = True,
    proxy: httpx.Proxy | httpx.URL | str | None = None,
    timeout: httpx.Timeout = INTEGRATION_TIMEOUT,
    headers: typing.Mapping[str, str] | None = None,
    http1: bool = True,
    http2: bool = False,
    cert: str | tuple[str, str] | tuple[str, str, str] | None = None,
    **kwargs: object,
) -> httpx.AsyncClient:
    """Create a security-hardened httpx client for external API calls.

    `timeout` defaults to the shared `INTEGRATION_TIMEOUT`, but can be
    overridden per call site (e.g. `paypal_service.py` passes its own
    vendor-tuned `Timeout(15.0, connect=10.0)`) without losing any of the
    other hardening this function applies — the response-size cap, redirect
    suppression, TLS verification, and proxy handling are all independent of
    which timeout is in effect.

    `verify`/`limits` are applied to the transport explicitly (rather than
    passed to `httpx.AsyncClient`) because passing an explicit `transport=`
    makes httpx.AsyncClient ignore both — see `AsyncClient._init_transport`,
    which only builds a transport from `verify`/`limits` when `transport` is
    None. No current caller passes its own `transport=` (this function
    already supplies one, so doing so raises TypeError on the duplicate
    keyword rather than silently bypassing the cap); a future caller that
    needs a custom transport should wrap it with `_SizeLimitedTransport`
    itself rather than reaching for `**kwargs`.

    Passing an explicit `transport=` also makes httpx.AsyncClient skip its
    own environment-proxy resolution (see `_environment_proxy_mounts`'s
    docstring), so `mounts=` is supplied explicitly here to restore it.

    `trust_env` and `proxy` are pulled out as named parameters (rather than
    left to flow through `**kwargs` to `httpx.AsyncClient`) so this function
    can honor them the same way stock `httpx.AsyncClient.__init__` does
    (INT-27/Codex, 2026-09-06):

    - `trust_env=False` disables env-based proxy resolution outright —
      `_environment_proxy_mounts()` is not even called in that case (see its
      docstring). Passed through to `httpx.AsyncClient` too, so it also
      governs the other things `trust_env` controls there (e.g. `.netrc`).
      It is *also* passed to every `httpx.AsyncHTTPTransport(...)` this
      function constructs (the default transport below and the explicit-
      `proxy=` mount) — not just used to gate the `_environment_proxy_mounts`
      decision (Codex, 2026-09-06). `AsyncHTTPTransport.__init__` defaults
      its own `trust_env` to `True` independently of the client it's mounted
      on; in pinned httpx 0.28.1 that default is what reads
      `SSL_CERT_FILE`/`SSL_CERT_DIR` from the environment at construction
      time. Passing `transport=` to `AsyncClient` (as this function always
      does) does not propagate the client's `trust_env` down to that
      transport — they're independent constructor arguments — so a caller
      that opted out via `trust_env=False` was still getting an
      environment-trusting transport underneath: `SSL_CERT_FILE` pointing at
      a missing file made this factory raise `FileNotFoundError` even with
      `trust_env=False`, while stock `httpx.AsyncClient(trust_env=False)`
      initializes fine in the same environment. See
      `test_create_integration_client_trust_env_false_transport_ignores_env_ssl_vars`.
    - An explicit `proxy=` is converted straight into an `{"all://": ...}`
      mount, exactly like stock httpx's `_get_proxy_map` — it is not merged
      with any env-derived mounts. Doing so as a `mounts=` merge instead (the
      naive approach) would leave HTTP_PROXY/HTTPS_PROXY-derived scheme
      mounts (`"http://"`, `"https://"`) in place alongside it, and those are
      more specific than `"all://"` in httpx's URL-pattern matching — so the
      explicit proxy would silently lose to the environment one on every
      real request even though it appears in `self._mounts`. Ignoring env
      vars entirely once a proxy is given (rather than trust_env-gating it)
      also matches stock httpx: `_get_proxy_map` never calls
      `get_environment_proxies()` when `proxy is not None`.

    No current caller passes either kwarg (`create_integration_client(`
    has no call sites under `integration_services/` that supply them), but
    this is a shared, security-relevant helper — a future caller must be
    able to opt out of, or override, ambient proxy env vars rather than
    silently inheriting them regardless of what it asked for.

    `Accept-Encoding: identity` asks the remote server not to compress its
    response at all. It is a request, not an enforced guarantee — a
    malicious or misconfigured server can send a compressed body regardless
    — but `_SizeLimitedTransport` rejects any response that does anyway (see
    its docstring), so this exists only to avoid that rejection firing
    against a well-behaved API that would otherwise compress by default.

    `headers` is a named parameter (rather than left to flow through
    `**kwargs`) because that mandatory `Accept-Encoding: identity` is passed
    to `httpx.AsyncClient` as this function's own `headers=` — a caller that
    also supplied `headers=` via `**kwargs` would collide with it as a
    duplicate keyword argument and raise `TypeError` before any request is
    made (Codex, 2026-09-06). The two are merged instead, case-insensitively
    (`httpx.Headers` normalizes keys), with the mandatory identity encoding
    always winning: a caller-supplied `Accept-Encoding` (of any casing) is
    overwritten, every other caller header passes through unchanged.

    `http1`, `http2` and `cert` are pulled out as named parameters, for the
    same reason `trust_env` is (Codex, 2026-09-06): `AsyncClient._init_transport`
    (pinned httpx 0.28.1) returns whatever `transport=` it was given
    immediately, without ever applying `verify`/`cert`/`trust_env`/`http1`/
    `http2`/`limits` to it —

    ```
    def _init_transport(self, ..., transport=None):
        if transport is not None:
            return transport
        return AsyncHTTPTransport(verify=..., cert=..., http1=..., http2=..., ...)
    ```

    — and this factory always supplies an explicit `transport=` (the size-
    limiting wrapper). So a caller passing `http2=True` or `cert=...` through
    `**kwargs` to `httpx.AsyncClient` had it silently swallowed: the resulting
    client's connection pool kept HTTP/2 disabled and no client certificate,
    with no error, no warning, and `client._transport` reporting nothing about
    it (protocol selection and mTLS are inner-transport concerns; nothing on
    `AsyncClient` itself reflects them). The same applies to the proxy mount
    `AsyncHTTPTransport` this function builds when `proxy=`/env-proxy
    resolution is in play — a proxied request would otherwise negotiate
    HTTP/1 and no client cert even when the caller asked the direct-connection
    transport for HTTP/2 or mTLS. Passing all three into every
    `AsyncHTTPTransport(...)` this function constructs is what makes the
    option actually take effect, matching what stock `httpx.AsyncClient`
    would have done had it built its own transport.
    """
    transport = _SizeLimitedTransport(
        httpx.AsyncHTTPTransport(
            verify=True,
            cert=cert,
            trust_env=trust_env,
            http1=http1,
            http2=http2,
            limits=INTEGRATION_LIMITS,
        ),
        MAX_RESPONSE_SIZE,
    )
    if proxy is not None:
        proxy_obj = (
            httpx.Proxy(url=proxy) if isinstance(proxy, (str, httpx.URL)) else proxy
        )
        mounts: dict[str, httpx.AsyncBaseTransport | None] = {
            "all://": _SizeLimitedTransport(
                httpx.AsyncHTTPTransport(
                    verify=True,
                    cert=cert,
                    limits=INTEGRATION_LIMITS,
                    proxy=proxy_obj,
                    trust_env=trust_env,
                    http1=http1,
                    http2=http2,
                ),
                MAX_RESPONSE_SIZE,
            )
        }
    else:
        mounts = _environment_proxy_mounts(
            MAX_RESPONSE_SIZE,
            trust_env=trust_env,
            http1=http1,
            http2=http2,
            cert=cert,
        )

    merged_headers = httpx.Headers(headers) if headers else httpx.Headers()
    merged_headers["Accept-Encoding"] = "identity"

    return httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=False,
        transport=transport,
        mounts=mounts,
        headers=merged_headers,
        trust_env=trust_env,
        http1=http1,
        http2=http2,
        cert=cert,
        **kwargs,
    )
