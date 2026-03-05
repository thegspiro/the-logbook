"""
URL Validation Utilities

SSRF-safe URL validation for integration endpoints.
Prevents administrators from configuring integrations to point at
internal services, cloud metadata endpoints, or plaintext HTTP URLs.
"""

import ipaddress
import socket
from urllib.parse import urlparse

from app.core.config import settings

# Known-safe webhook domains (user-provided URLs must match for specific integrations)
KNOWN_WEBHOOK_DOMAINS = frozenset(
    {
        "hooks.slack.com",
        "discord.com",
        "discordapp.com",
        "webhook.office.com",  # Teams incoming webhooks
        "outlook.office.com",
    }
)

# Metadata endpoints that must always be blocked
BLOCKED_HOSTNAMES = frozenset(
    {
        "metadata.google.internal",
        "metadata.goog",
        "169.254.169.254",
        "fd00:ec2::254",
    }
)


def _is_private_ip(ip_str: str) -> bool:
    """Check if an IP address is in a private/reserved range."""
    try:
        addr = ipaddress.ip_address(ip_str)
        return (
            addr.is_private
            or addr.is_reserved
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
        )
    except ValueError:
        return False


def validate_integration_url(url: str, *, allow_known_only: bool = False) -> str:
    """
    Validate a URL for use in an integration configuration.

    Args:
        url: The URL to validate.
        allow_known_only: If True, only allow URLs on KNOWN_WEBHOOK_DOMAINS.

    Returns:
        The validated URL (unchanged).

    Raises:
        ValueError: If the URL fails any security check.
    """
    if not url or not url.strip():
        raise ValueError("URL must not be empty")

    parsed = urlparse(url.strip())

    # 1. Enforce HTTPS (allow HTTP only in development)
    is_dev = getattr(settings, "ENVIRONMENT", "production") == "development"
    if parsed.scheme != "https":
        if parsed.scheme == "http" and is_dev:
            pass  # Allow HTTP in development only
        else:
            raise ValueError(
                f"URL must use HTTPS (got {parsed.scheme}://). "
                "HTTP is only allowed in development environments."
            )

    # 2. Must have a hostname
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL must contain a valid hostname")

    # 3. Block known metadata endpoints
    if hostname in BLOCKED_HOSTNAMES:
        raise ValueError(f"URL hostname '{hostname}' is not allowed")

    # 4. If allow_known_only, verify the domain
    if allow_known_only:
        if hostname not in KNOWN_WEBHOOK_DOMAINS and not any(
            hostname.endswith(f".{d}") for d in KNOWN_WEBHOOK_DOMAINS
        ):
            raise ValueError(
                f"URL hostname '{hostname}' is not a recognized webhook domain. "
                f"Allowed: {', '.join(sorted(KNOWN_WEBHOOK_DOMAINS))}"
            )

    # 5. Resolve hostname and check for private IPs
    try:
        resolved = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC)
        for family, _type, _proto, _canonname, sockaddr in resolved:
            ip_str = sockaddr[0]
            if _is_private_ip(ip_str):
                raise ValueError(
                    f"URL resolves to a private/internal IP address ({ip_str}). "
                    "Integration URLs must point to public endpoints."
                )
    except socket.gaierror:
        raise ValueError(f"Could not resolve hostname '{hostname}'")

    return url.strip()
