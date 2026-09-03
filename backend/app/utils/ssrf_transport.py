"""HTTP transport that pins outbound connections to SSRF-approved addresses."""

import ipaddress
import socket
from urllib.parse import urlsplit

import httpx

from app.core.config import settings


def resolve_public_addresses(hostname: str, port: int) -> tuple[str, ...]:
    """Resolve a host once and fail closed unless every answer is global."""
    try:
        answers = socket.getaddrinfo(
            hostname, port, socket.AF_UNSPEC, socket.SOCK_STREAM
        )
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve hostname '{hostname}'") from exc

    addresses = tuple(dict.fromkeys(answer[4][0] for answer in answers))
    if not addresses:
        raise ValueError(f"Could not resolve hostname '{hostname}'")
    for address in addresses:
        if not ipaddress.ip_address(address).is_global:
            raise ValueError(
                f"URL resolves to a non-global IP address ({address}); "
                "outbound destinations must be public"
            )
    return addresses


class SSRFSafeAsyncTransport(httpx.AsyncBaseTransport):
    """Resolve, approve, and connect to the same IP without following redirects."""

    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport or httpx.AsyncHTTPTransport(retries=0)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        is_dev = getattr(settings, "ENVIRONMENT", "production") == "development"
        if url.scheme != "https" and not (url.scheme == "http" and is_dev):
            raise ValueError("Outbound URL must use HTTPS")
        if not url.host or url.username or url.password:
            raise ValueError("Outbound URL must contain a hostname without credentials")

        port = url.port or (443 if url.scheme == "https" else 80)
        approved_ip = resolve_public_addresses(url.host, port)[0]
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
