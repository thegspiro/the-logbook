"""
Base HTTP client for integration services.

Shared httpx.AsyncClient with security-hardened defaults:
- Connection pooling with per-service limits
- Explicit TLS verification
- No redirect following (SSRF protection)
- Response size limits
"""

import httpx

# Shared timeout: 10s total, 5s connect
INTEGRATION_TIMEOUT = httpx.Timeout(10.0, connect=5.0)

# Connection pool limits per service type
INTEGRATION_LIMITS = httpx.Limits(
    max_connections=10,
    max_keepalive_connections=5,
)

# Maximum response body size (10 MB)
MAX_RESPONSE_SIZE = 10 * 1024 * 1024


def create_integration_client(**kwargs: object) -> httpx.AsyncClient:
    """Create a security-hardened httpx client for external API calls."""
    return httpx.AsyncClient(
        timeout=INTEGRATION_TIMEOUT,
        limits=INTEGRATION_LIMITS,
        verify=True,
        follow_redirects=False,
        **kwargs,
    )
