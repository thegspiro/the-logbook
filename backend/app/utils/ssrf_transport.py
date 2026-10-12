"""HTTP transport that pins outbound connections to SSRF-approved addresses.

Calling ``assert_outbound_url_safe()`` before a request narrows a DNS-rebinding
window but cannot close it: the request then performs its own, independent
resolution when it connects, and a hostname can answer the check with a public
address and the connection with an internal one. This transport resolves once,
validates that answer, and connects to the validated address itself, so there
is no second resolution for an attacker to win (SCH-10).
"""

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

import httpx

from app.core.config import settings
from app.utils.url_validator import BLOCKED_HOSTNAMES


def _literal_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


# The metadata endpoints in BLOCKED_HOSTNAMES that are addresses rather than
# names. A hostname check never sees them when a name *resolves* to one, so the
# resolved answer is checked against them too — including for an
# operator-trusted private destination, which opts into a private network, not
# into the cloud instance's credential endpoint.
_BLOCKED_ADDRESSES = frozenset(
    ip for ip in (_literal_ip(host) for host in BLOCKED_HOSTNAMES) if ip is not None
)


class UnsafeDestinationError(ValueError):
    """The destination resolved to an address outbound requests may not reach.

    A ``ValueError`` so every caller that already fails closed on
    ``assert_outbound_url_safe()``'s ``ValueError`` keeps doing so; a distinct
    type so a caller can tell a refused destination from an unrelated
    ``ValueError`` raised elsewhere in the same request path.
    """


def _resolve(hostname: str, port: int) -> tuple[str, ...]:
    try:
        answers = socket.getaddrinfo(
            hostname, port, socket.AF_UNSPEC, socket.SOCK_STREAM
        )
    except socket.gaierror as exc:
        raise UnsafeDestinationError(
            f"Could not resolve hostname '{hostname}'"
        ) from exc

    # typeshed widens the sockaddr host to str | int; for the AF_INET/AF_INET6
    # answers getaddrinfo yields it is always the address string.
    addresses = tuple(dict.fromkeys(str(answer[4][0]) for answer in answers))
    if not addresses:
        raise UnsafeDestinationError(f"Could not resolve hostname '{hostname}'")
    return addresses


def resolve_public_addresses(hostname: str, port: int) -> tuple[str, ...]:
    """Resolve a host once and fail closed unless every answer is global."""
    addresses = _resolve(hostname, port)
    for address in addresses:
        ip = ipaddress.ip_address(address)
        # `is_global` alone admits multicast (239.0.0.0/8 is "global");
        # url_validator._is_private_ip rejects it, and this check must not be
        # the looser of the two now that it is the one the connection uses.
        if not ip.is_global or ip.is_multicast:
            raise UnsafeDestinationError(
                f"URL resolves to a non-global IP address ({address}); "
                "outbound destinations must be public"
            )
    return addresses


def resolve_trusted_private_addresses(hostname: str, port: int) -> tuple[str, ...]:
    """Resolve once for an operator-trusted destination; refuse metadata only."""
    addresses = _resolve(hostname, port)
    for address in addresses:
        if ipaddress.ip_address(address) in _BLOCKED_ADDRESSES:
            raise UnsafeDestinationError(
                f"URL resolves to a blocked metadata address ({address})"
            )
    return addresses


class SSRFSafeAsyncTransport(httpx.AsyncBaseTransport):
    """Resolve, approve, and connect to the same IP without following redirects.

    ``allow_private=True`` is for an operator-controlled destination that
    legitimately lives on a trusted private network (the audit-ship collector
    behind ``AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION``), mirroring
    ``assert_outbound_url_safe(allow_private=True)``. It lifts only the
    public-address requirement: the connection is still pinned to the address
    resolved here, and metadata addresses are still refused.

    Only meaningful for a *direct* connection. Through an HTTP proxy the proxy
    performs the resolution, and httpcore 1.0's tunnel takes its TLS server
    name from the tunnelled URL's host rather than the ``sni_hostname``
    extension, so rewriting that URL to an address would break certificate
    verification rather than pin anything — see ``create_integration_client()``.
    """

    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        allow_private: bool = False,
    ) -> None:
        self._transport = transport or httpx.AsyncHTTPTransport(retries=0)
        self._allow_private = allow_private

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        is_dev = getattr(settings, "ENVIRONMENT", "production") == "development"
        if url.scheme != "https" and not (url.scheme == "http" and is_dev):
            raise ValueError("Outbound URL must use HTTPS")
        if not url.host or url.username or url.password:
            raise ValueError("Outbound URL must contain a hostname without credentials")

        port = url.port or (443 if url.scheme == "https" else 80)
        resolver = (
            resolve_trusted_private_addresses
            if self._allow_private
            else resolve_public_addresses
        )
        # getaddrinfo blocks, and every integration request now passes through
        # here, so it runs in a worker thread rather than stalling the loop.
        approved_ip = (await asyncio.to_thread(resolver, url.host, port))[0]
        headers = request.headers.copy()
        host_header = url.host
        if url.port and url.port != (443 if url.scheme == "https" else 80):
            host_header = f"{host_header}:{url.port}"
        headers["Host"] = host_header

        extensions = dict(request.extensions)
        # httpcore uses this extension for TLS SNI/certificate verification even
        # though the connection URL is pinned to the approved numeric address.
        extensions["sni_hostname"] = url.host
        pinned = httpx.Request(
            request.method,
            url.copy_with(host=approved_ip),
            headers=headers,
            extensions=extensions,
        )
        # Preserve httpx's transport-level async stream object verbatim; passing
        # it as ``content`` would make Request attempt to wrap it as sync data.
        pinned.stream = request.stream
        return await self._transport.handle_async_request(pinned)

    async def aclose(self) -> None:
        await self._transport.aclose()


def relative_endpoint(value: str) -> str:
    """Accept an endpoint path, never an authority or absolute URL."""
    parsed = urlsplit(value)
    if (
        not value.startswith("/")
        or value.startswith("//")
        or parsed.scheme
        or parsed.netloc
        or parsed.fragment
    ):
        raise ValueError("Configured endpoints must be relative paths beginning with /")
    return value


def join_endpoint(base_url: str | None, endpoint: str) -> str:
    """Compose a provider URL without allowing endpoint authority replacement."""
    if not base_url:
        raise ValueError("Provider API base URL is not configured")
    return f"{base_url.rstrip('/')}{relative_endpoint(endpoint)}"
