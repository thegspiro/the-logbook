"""
Base HTTP client for integration services.

Shared httpx.AsyncClient with security-hardened defaults:
- Connection pooling with per-service limits
- Explicit TLS verification
- No redirect following (SSRF protection)
"""

import httpx

# Shared timeout: 10s total, 5s connect
INTEGRATION_TIMEOUT = httpx.Timeout(10.0, connect=5.0)

# Connection pool limits per service type
INTEGRATION_LIMITS = httpx.Limits(
    max_connections=10,
    max_keepalive_connections=5,
)

# INT-7 (security-review, 2026-09-06): intended as a maximum response body
# size, but nothing in this module or any connector currently enforces it —
# httpx's non-streaming .get()/.request() buffers the full body into memory
# before a caller ever sees a Response to check against this constant.
# Enforcing it means every connector switching from `client.get(url).json()`
# to `client.stream(...)` and aborting once this many bytes have arrived,
# which is a call-site-by-call-site change across every connector, not a
# base.py-only fix — flagged rather than silently done here. See INT-27
# (docs/security-review/INT-27-integrations.md) and KNOWN_LIMITATIONS.md.
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
