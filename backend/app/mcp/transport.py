"""
The pure-ASGI endpoint routed at ``/api/mcp``.

Per request: read the bearer key, authenticate it (which also checks the
department has the integration switched on), apply the per-key rate limit,
bind the principal, and hand the request to the SDK's session manager. It is
pure ASGI rather than ``BaseHTTPMiddleware`` for the reason CLAUDE.md pitfall
4 gives, and it is not a FastAPI route because the SDK owns the request body
and the response stream.

The session manager is looked up per request from ``app.state`` rather than
held here: the SDK allows ``run()`` once per manager instance, and the
application lifespan — which the test-suite enters more than once per
process — creates a fresh one each time it starts.

Registered as an exact ``Route`` rather than a ``Mount``: a mount matches
only ``/api/mcp/`` and answers ``/api/mcp`` with a redirect (or, with the
application's ``redirect_slashes=False``, a 404), and MCP clients are
configured with the bare path.
"""

import time
from collections import OrderedDict
from typing import Awaitable, Callable, Optional

from loguru import logger
from starlette.datastructures import Headers
from starlette.responses import JSONResponse, Response
from starlette.types import Receive, Scope, Send

from app.core.config import settings
from app.core.security import is_rate_limited
from app.core.security_middleware import get_client_ip
from app.mcp.constants import (
    AUTH_RATE_LIMIT_ATTEMPTS,
    RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS,
)
from app.mcp.db import open_session
from app.mcp.keys import McpAuthError, McpKeyService
from app.mcp.principal import McpPrincipal, bind_principal

Authenticator = Callable[[str, Optional[str]], Awaitable[McpPrincipal]]

# What the SDK's streamable-HTTP transport answers; anything else is refused
# here so an unauthenticated probe never reaches it.
_ALLOWED_METHODS = frozenset({"POST", "GET", "DELETE"})

# In-memory fallback limiter for when Redis is unreachable. Bounded so a
# flood of distinct keys cannot grow it without limit (pitfall 9).
_MAX_TRACKED_KEYS = 5_000


class _MemoryRateLimiter:
    def __init__(self, limit: int, window: int, max_keys: int = _MAX_TRACKED_KEYS):
        self.limit = limit
        self.window = window
        self.max_keys = max_keys
        self._hits: "OrderedDict[str, list[float]]" = OrderedDict()

    def exceeded(
        self, key: str, now: Optional[float] = None, limit: Optional[int] = None
    ) -> bool:
        limit = self.limit if limit is None else limit
        now = time.monotonic() if now is None else now
        cutoff = now - self.window
        hits = self._hits.get(key)
        if hits is None:
            if len(self._hits) >= self.max_keys:
                self._hits.popitem(last=False)
            hits = []
            self._hits[key] = hits
        else:
            self._hits.move_to_end(key)
        hits[:] = [t for t in hits if t > cutoff]
        if len(hits) >= limit:
            return True
        hits.append(now)
        return False


async def authenticate_with_database(
    presented: str, client_ip: Optional[str]
) -> McpPrincipal:
    async with open_session() as db:
        return await McpKeyService(db).authenticate(presented, client_ip=client_ip)


class McpEndpoint:
    """ASGI app: bearer auth + rate limit in front of the MCP session manager."""

    def __init__(
        self,
        *,
        authenticate: Authenticator = authenticate_with_database,
        rate_limit: int = RATE_LIMIT_REQUESTS,
        auth_rate_limit: int = AUTH_RATE_LIMIT_ATTEMPTS,
        rate_window_seconds: int = RATE_LIMIT_WINDOW_SECONDS,
        state_attr: str = "mcp_session_manager",
    ):
        self._authenticate = authenticate
        self._rate_limit = rate_limit
        self._auth_rate_limit = auth_rate_limit
        self._rate_window = rate_window_seconds
        self._state_attr = state_attr
        self._memory_limiter = _MemoryRateLimiter(rate_limit, rate_window_seconds)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            # Lifespan events for a mounted app are not forwarded by Starlette;
            # a websocket here has nowhere to go.
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1003})
            return

        if scope["method"] not in _ALLOWED_METHODS:
            await Response(
                status_code=405, headers={"Allow": ", ".join(sorted(_ALLOWED_METHODS))}
            )(scope, receive, send)
            return

        headers = Headers(scope=scope)
        presented = _bearer_token(headers.get("authorization"))
        if presented is None:
            await _reject(scope, receive, send, 401, "A bearer service key is required")
            return

        client_ip = _client_ip(scope, receive)
        # Every token-shaped value costs a database lookup, so attempts are
        # budgeted per client address before authentication, not only per
        # key after it; otherwise a stranger could guess keys at line rate.
        if await self._limited(f"auth:{client_ip or 'unknown'}", self._auth_rate_limit):
            await _reject(
                scope,
                receive,
                send,
                429,
                "Too many authentication attempts",
                headers={"Retry-After": str(self._rate_window)},
            )
            return
        try:
            principal = await self._authenticate(presented, client_ip)
        except McpAuthError as exc:
            await _reject(scope, receive, send, exc.status, str(exc))
            return
        except Exception:
            logger.exception("MCP authentication failed unexpectedly")
            await _reject(scope, receive, send, 503, "Service temporarily unavailable")
            return

        if await self._limited(principal.key_id, self._rate_limit):
            await _reject(
                scope,
                receive,
                send,
                429,
                "Rate limit exceeded for this service key",
                headers={"Retry-After": str(self._rate_window)},
            )
            return

        manager = getattr(scope["app"].state, self._state_attr, None)
        if manager is None:
            await _reject(scope, receive, send, 503, "MCP server is starting")
            return

        with bind_principal(principal):
            await manager.handle_request(scope, receive, send)

    async def _limited(self, bucket_id: str, limit: int) -> bool:
        if not settings.RATE_LIMIT_ENABLED:
            return False
        bucket = f"mcp:{bucket_id}"
        try:
            from app.core.cache import cache_manager

            if cache_manager.is_connected and cache_manager.redis_client:
                return await is_rate_limited(
                    key=bucket,
                    limit=limit,
                    window_seconds=self._rate_window,
                    fail_closed=False,
                    raise_on_error=True,
                )
        except Exception:
            logger.warning("Redis rate limit unavailable for MCP; using in-memory")
        return self._memory_limiter.exceeded(bucket, limit=limit)


def _bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def _client_ip(scope: Scope, receive: Receive) -> Optional[str]:
    try:
        from starlette.requests import Request

        return get_client_ip(Request(scope, receive))
    except Exception:
        return None


async def _reject(
    scope: Scope,
    receive: Receive,
    send: Send,
    status: int,
    message: str,
    headers: Optional[dict[str, str]] = None,
) -> None:
    extra = dict(headers or {})
    if status == 401:
        extra["WWW-Authenticate"] = "Bearer"
    await JSONResponse({"error": message}, status_code=status, headers=extra)(
        scope, receive, send
    )
