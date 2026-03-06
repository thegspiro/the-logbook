"""
Security Middleware and Utilities for FastAPI

Implements rate limiting, CSRF protection, security headers,
input sanitization, and other security features.
"""

import html
import re
import secrets
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, HTTPException, Request, status

# BaseHTTPMiddleware intentionally NOT imported — all middleware in this
# module uses the pure ASGI pattern to avoid stripping Set-Cookie headers.
from starlette.requests import HTTPConnection
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# ============================================
# Rate Limiting
# ============================================


class RateLimiter:
    """
    In-memory rate limiter for API endpoints

    In production, use Redis for distributed rate limiting.

    Includes periodic eviction of stale entries to prevent unbounded
    memory growth under sustained traffic.
    """

    # Maximum number of tracked keys before forced eviction
    _MAX_KEYS = 10_000

    # Minimum interval between eviction scans (seconds)
    _EVICTION_INTERVAL = 60

    def __init__(self):
        self.requests: dict[str, list[float]] = defaultdict(list)
        self.lockouts: dict[str, float] = {}
        self._last_eviction: float = 0.0

    def _evict_stale(self, now: float, window_seconds: int) -> None:
        """Remove entries that have no recent requests and expired lockouts.

        Also enforces ``_MAX_KEYS`` by force-evicting the oldest entries
        when the key count exceeds the limit (prevents unbounded memory
        growth under DDoS with many unique source IPs).
        """
        # Only run eviction at most once per _EVICTION_INTERVAL to avoid overhead,
        # unless the key count exceeds the safety limit.
        over_limit = len(self.requests) > self._MAX_KEYS
        if not over_limit and now - self._last_eviction < self._EVICTION_INTERVAL:
            return
        self._last_eviction = now

        # Evict expired lockouts
        expired_lockouts = [k for k, v in self.lockouts.items() if now >= v]
        for k in expired_lockouts:
            del self.lockouts[k]

        # Evict request entries with no recent activity
        stale_keys = [
            k
            for k, timestamps in self.requests.items()
            if not timestamps or (now - timestamps[-1]) > window_seconds
        ]
        for k in stale_keys:
            del self.requests[k]

        # Enforce _MAX_KEYS: if still over the limit after removing stale
        # entries, force-evict the keys with the oldest last-request time.
        if len(self.requests) > self._MAX_KEYS:
            by_recency = sorted(
                self.requests.items(),
                key=lambda kv: kv[1][-1] if kv[1] else 0.0,
            )
            to_remove = len(self.requests) - self._MAX_KEYS
            for key, _ in by_recency[:to_remove]:
                del self.requests[key]
                self.lockouts.pop(key, None)

    def is_rate_limited(
        self,
        key: str,
        max_requests: int = 5,
        window_seconds: int = 60,
        lockout_seconds: int = 1800,  # 30 minutes
    ) -> tuple[bool, str | None]:
        """
        Check if a request should be rate limited

        Args:
            key: Unique identifier (IP address, user ID, etc.)
            max_requests: Maximum requests allowed in window
            window_seconds: Time window in seconds
            lockout_seconds: Lockout duration after exceeding limits

        Returns:
            (is_limited, reason)
        """
        current_time = time.time()

        # Periodic eviction to bound memory usage
        self._evict_stale(current_time, window_seconds)

        # Check if currently locked out
        if key in self.lockouts:
            if current_time < self.lockouts[key]:
                remaining = int(self.lockouts[key] - current_time)
                return True, f"Account locked. Try again in {remaining} seconds"
            else:
                # Lockout expired
                del self.lockouts[key]
                self.requests.pop(key, None)

        # Clean old requests outside window
        self.requests[key] = [
            req_time
            for req_time in self.requests[key]
            if current_time - req_time < window_seconds
        ]

        # Check rate limit
        if len(self.requests[key]) >= max_requests:
            # Too many requests - apply lockout
            self.lockouts[key] = current_time + lockout_seconds
            return (
                True,
                f"Too many requests. Account locked for {lockout_seconds // 60} minutes",
            )

        # Record this request
        self.requests[key].append(current_time)

        return False, None


# Global rate limiter instance
rate_limiter = RateLimiter()


# ============================================
# CSRF Protection
# ============================================


class CSRFProtection:
    """
    CSRF token generation and validation
    """

    @staticmethod
    def generate_token() -> str:
        """Generate a secure CSRF token"""
        return secrets.token_urlsafe(32)

    @staticmethod
    def validate_token(request_token: str, session_token: str) -> bool:
        """
        Validate CSRF token using constant-time comparison

        Args:
            request_token: Token from request header
            session_token: Token from session

        Returns:
            True if valid, False otherwise
        """
        if not request_token or not session_token:
            return False

        return secrets.compare_digest(request_token, session_token)


# ============================================
# Input Sanitization
# ============================================


class InputSanitizer:
    """
    Sanitize and validate user inputs
    """

    @staticmethod
    def sanitize_string(value: str, max_length: int = 1000) -> str:
        """
        Sanitize string input

        - HTML escape
        - Strip dangerous characters
        - Enforce length limits
        """
        if not isinstance(value, str):
            return ""

        # Truncate to max length
        value = value[:max_length]

        # HTML escape
        value = html.escape(value)

        # Remove null bytes
        value = value.replace("\x00", "")

        # Strip leading/trailing whitespace
        value = value.strip()

        return value

    @staticmethod
    def sanitize_email(email: str) -> str:
        """
        Sanitize email address

        - Convert to lowercase
        - Remove whitespace
        - Validate format
        """
        if not isinstance(email, str):
            raise ValueError("Email must be a string")

        email = email.lower().strip()

        # Basic email validation
        if not re.match(
            r"^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",
            email,
        ):
            raise ValueError("Invalid email format")

        # Check for injection attempts
        if "\n" in email or "\r" in email or "%0a" in email or "%0d" in email:
            raise ValueError("Invalid email format")

        if len(email) > 254:
            raise ValueError("Email too long")

        return email

    @staticmethod
    def sanitize_username(username: str) -> str:
        """
        Sanitize username

        - Alphanumeric, underscore, hyphen only
        - 3-32 characters
        """
        if not isinstance(username, str):
            raise ValueError("Username must be a string")

        username = username.strip()

        if not re.match(r"^[a-zA-Z0-9_-]{3,32}$", username):
            raise ValueError(
                "Username must be 3-32 characters (letters, numbers, underscore, hyphen only)"
            )

        return username

    @staticmethod
    def sanitize_phone(phone: str) -> str:
        """
        Sanitize phone number
        """
        if not isinstance(phone, str):
            raise ValueError("Phone must be a string")

        # Remove all non-digit characters except +
        phone = re.sub(r"[^\d+]", "", phone)

        # Basic validation
        if not re.match(r"^\+?[\d]{7,15}$", phone):
            raise ValueError("Invalid phone number format")

        return phone

    @staticmethod
    def validate_url(url: str, allow_http: bool = False) -> str:
        """
        Validate and sanitize URL

        Args:
            url: URL to validate
            allow_http: Whether to allow HTTP (not recommended for production)

        Returns:
            Sanitized URL
        """
        if not isinstance(url, str):
            raise ValueError("URL must be a string")

        url = url.strip()

        # Check protocol
        if not url.startswith("https://"):
            if allow_http and url.startswith("http://"):
                pass  # Allow HTTP in development
            else:
                raise ValueError("URL must use HTTPS")

        # Basic URL validation
        if not re.match(r"^https?://[a-zA-Z0-9.-]+(?:\.[a-zA-Z]{2,})?(?:/.*)?$", url):
            raise ValueError("Invalid URL format")

        return url


# ============================================
# Security Headers Middleware
# ============================================


class SecurityHeadersMiddleware:
    """
    Add security headers to all responses.

    Implemented as a pure ASGI middleware (not BaseHTTPMiddleware) to avoid
    the response-wrapping behaviour of BaseHTTPMiddleware which can strip
    Set-Cookie headers when multiple BaseHTTPMiddleware layers are stacked.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    # Pre-build the static header list once (all values are constant).
    _STATIC_HEADERS: list[tuple[bytes, bytes]] = [
        (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"x-xss-protection", b"1; mode=block"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
        (b"permissions-policy", b"geolocation=(), microphone=(), camera=()"),
        (
            b"content-security-policy",
            b"default-src 'self'; "
            b"script-src 'self'; "
            b"style-src 'self' 'unsafe-inline'; "
            b"style-src-elem 'self' 'unsafe-inline'; "
            b"style-src-attr 'unsafe-inline'; "
            b"img-src 'self' data: blob:; "
            b"font-src 'self'; "
            b"connect-src 'self'; "
            b"object-src 'none'; "
            b"frame-ancestors 'none'; "
            b"base-uri 'self'; "
            b"form-action 'self'; "
            b"upgrade-insecure-requests",
        ),
    ]

    _API_CACHE_HEADERS: list[tuple[bytes, bytes]] = [
        (b"cache-control", b"no-store, no-cache, must-revalidate, proxy-revalidate"),
        (b"pragma", b"no-cache"),
        (b"expires", b"0"),
    ]

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        is_api = path.startswith("/api/")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend(self._STATIC_HEADERS)
                if is_api:
                    headers.extend(self._API_CACHE_HEADERS)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


# ============================================
# Rate Limiting Dependency
# ============================================


async def check_rate_limit(
    request: Request,
    max_requests: int = 5,
    window_seconds: int = 60,
    lockout_seconds: int = 1800,
) -> None:
    """
    Dependency to check rate limits.

    Tries Redis-backed distributed rate limiting first (for multi-instance
    deployments).  Falls back to the in-memory ``rate_limiter`` when Redis
    is unavailable.

    Usage:
        @router.post("/endpoint", dependencies=[Depends(check_rate_limit)])
    """
    client_ip = request.client.host if request.client else "unknown"

    # Try Redis-backed sliding-window rate limiting first
    try:
        from app.core.cache import cache_manager
        from app.core.security import is_rate_limited as redis_rate_limited

        if cache_manager.is_connected and cache_manager.redis_client:
            exceeded = await redis_rate_limited(
                key=f"auth:{client_ip}",
                limit=max_requests,
                window_seconds=window_seconds,
                fail_closed=False,  # Fall back to in-memory on error
            )
            if exceeded:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests. Please try again later.",
                    headers={"Retry-After": str(window_seconds)},
                )
            return
    except HTTPException:
        raise
    except Exception:
        pass  # Redis unavailable — fall through to in-memory limiter

    # Fallback: in-memory rate limiter
    is_limited, reason = rate_limiter.is_rate_limited(
        key=client_ip,
        max_requests=max_requests,
        window_seconds=window_seconds,
        lockout_seconds=lockout_seconds,
    )

    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=reason or "Too many requests. Please try again later.",
            headers={"Retry-After": str(lockout_seconds)},
        )


def rate_limit_login():
    """Stricter rate limit for login: 5 attempts per 60 seconds."""

    async def _dependency(request: Request) -> None:
        await check_rate_limit(
            request, max_requests=5, window_seconds=60, lockout_seconds=1800
        )

    return Depends(_dependency)


def rate_limit_register():
    """Stricter rate limit for registration: 3 attempts per 60 seconds."""

    async def _dependency(request: Request) -> None:
        await check_rate_limit(
            request, max_requests=3, window_seconds=60, lockout_seconds=1800
        )

    return Depends(_dependency)


def rate_limit_password_reset():
    """Strict rate limit for password reset: 3 attempts per 5 minutes."""

    async def _dependency(request: Request) -> None:
        await check_rate_limit(
            request, max_requests=3, window_seconds=300, lockout_seconds=1800
        )

    return Depends(_dependency)


def rate_limit_token_refresh():
    """More lenient rate limit for token refresh: 10 per 60 seconds."""

    async def _dependency(request: Request) -> None:
        await check_rate_limit(
            request, max_requests=10, window_seconds=60, lockout_seconds=600
        )

    return Depends(_dependency)


# ============================================
# CSRF Protection Dependency
# ============================================


async def verify_csrf_token(request: HTTPConnection) -> None:
    """
    Dependency to verify CSRF token on state-changing requests.

    **Primary CSRF defence**: auth cookies are set with ``SameSite=Strict``
    which prevents the browser from sending them on any cross-site
    request, making traditional CSRF attacks impossible.

    This dependency provides a *defence-in-depth* double-submit check:
    the frontend reads a non-httpOnly ``csrf_token`` cookie and echoes it
    in the ``X-CSRF-Token`` header.  An attacker on a different origin
    cannot read the cookie and therefore cannot forge the header.

    Usage:
        @router.post("/endpoint", dependencies=[Depends(verify_csrf_token)])
    """
    # Skip CSRF for WebSocket connections — CSRF attacks exploit automatic
    # cookie sending on cross-origin HTTP requests; WebSocket endpoints use
    # their own JWT-based authentication during the handshake.
    if request.scope["type"] == "websocket":
        return

    # Skip CSRF for safe methods
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return

    # Double-submit cookie pattern: compare header value against cookie
    request_token = request.headers.get("X-CSRF-Token")
    cookie_token = request.cookies.get("csrf_token")

    if not cookie_token:
        # No CSRF cookie yet — allow (first request after login).
        # The login response sets the csrf_token cookie for subsequent
        # requests.  This means the very first state-changing request
        # after login is NOT protected by the double-submit check.
        # This is an accepted tradeoff because:
        #   1. SameSite=Strict on auth cookies is the primary CSRF defence.
        #   2. A browser that blocks cookies entirely cannot authenticate.
        #   3. The window is limited to the single request before the
        #      cookie is set.
        return

    if not request_token or not CSRFProtection.validate_token(
        request_token, cookie_token
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token"
        )


# ============================================
# Audit Logging
# ============================================


class SecurityAuditLogger:
    """
    Log security-relevant events
    """

    @staticmethod
    async def log_event(
        event_type: str,
        user_id: str | None,
        ip_address: str,
        user_agent: str | None,
        details: dict,
        severity: str = "INFO",
    ) -> None:
        """
        Log security event to audit log

        In production, send to centralized logging system
        """
        timestamp = datetime.now(timezone.utc).isoformat()

        log_entry = {
            "timestamp": timestamp,
            "event_type": event_type,
            "user_id": user_id,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "details": details,
            "severity": severity,
        }

        from loguru import logger

        logger.warning(f"[SECURITY AUDIT] {log_entry}")

    @staticmethod
    async def log_failed_login(
        username: str, ip_address: str, user_agent: str | None, reason: str
    ) -> None:
        """Log failed login attempt"""
        await SecurityAuditLogger.log_event(
            event_type="FAILED_LOGIN",
            user_id=None,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"username": username, "reason": reason},
            severity="WARNING",
        )

    @staticmethod
    async def log_successful_login(
        user_id: str, username: str, ip_address: str, user_agent: str | None
    ) -> None:
        """Log successful login"""
        await SecurityAuditLogger.log_event(
            event_type="SUCCESSFUL_LOGIN",
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"username": username},
            severity="INFO",
        )

    @staticmethod
    async def log_password_change(
        user_id: str, ip_address: str, user_agent: str | None
    ) -> None:
        """Log password change"""
        await SecurityAuditLogger.log_event(
            event_type="PASSWORD_CHANGE",
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={},
            severity="INFO",
        )

    @staticmethod
    async def log_suspicious_activity(
        user_id: str | None,
        ip_address: str,
        user_agent: str | None,
        description: str,
    ) -> None:
        """Log suspicious activity"""
        await SecurityAuditLogger.log_event(
            event_type="SUSPICIOUS_ACTIVITY",
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"description": description},
            severity="CRITICAL",
        )


# ============================================
# Helper Functions
# ============================================


def get_client_ip(request: Request) -> str:
    """Get client IP address from request.

    Only trusts the X-Forwarded-For header when the direct peer IP is in
    the configured TRUSTED_PROXY_IPS list (SEC-16).  This prevents clients
    from spoofing their IP to bypass rate limiting or geo-blocking.

    When TRUSTED_PROXY_IPS is empty (default), X-Forwarded-For is never
    trusted — a secure-by-default stance.  Deployments behind a reverse
    proxy (nginx, Docker, load balancer) MUST set TRUSTED_PROXY_IPS to
    the proxy's IP(s) so that real client IPs are logged correctly.
    """
    from app.core.config import settings

    direct_ip = request.client.host if request.client else "unknown"
    trusted_proxies = settings.get_trusted_proxy_ips()

    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for and trusted_proxies and direct_ip in trusted_proxies:
        # Take the left-most IP (original client)
        return forwarded_for.split(",")[0].strip()

    return direct_ip


def get_user_agent(request: Request) -> str | None:
    """Get user agent from request"""
    return request.headers.get("User-Agent")


# ============================================
# IP/Country Blocking Middleware
# ============================================


class IPBlockingMiddleware:
    """
    Middleware for IP-based and country-based access control.

    Implemented as a pure ASGI middleware (not BaseHTTPMiddleware) to avoid
    stripping Set-Cookie headers when multiple middleware layers are stacked
    (SEC-15).

    Features:
    - Blocks requests from specified countries (geo-blocking)
    - Supports IP allowlist exceptions
    - Logs all blocked attempts for security auditing
    - Integrates with GeoIP service for country lookup
    """

    # Paths that bypass IP blocking (health checks, onboarding, etc.)
    # Onboarding must be accessible from any location since it's the
    # first-time setup process before any configuration exists.
    BYPASS_PATHS = {"/health", "/health/detailed", "/"}
    BYPASS_PREFIXES = ("/api/v1/onboarding",)

    def __init__(
        self,
        app: ASGIApp,
        enabled: bool = True,
        log_blocked_attempts: bool = True,
    ):
        self.app = app
        self.enabled = enabled
        self.log_blocked_attempts = log_blocked_attempts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Process request and check IP/country restrictions."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Skip if disabled
        if not self.enabled:
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")

        # Skip health check and onboarding endpoints
        if path in self.BYPASS_PATHS:
            await self.app(scope, receive, send)
            return

        # Skip paths with bypass prefixes (e.g., onboarding)
        if any(path.startswith(prefix) for prefix in self.BYPASS_PREFIXES):
            await self.app(scope, receive, send)
            return

        request = Request(scope)

        # Get client IP
        client_ip = get_client_ip(request)

        # Check if IP should be blocked
        from app.core.geoip import get_geoip_service

        geoip = get_geoip_service()
        if geoip:
            # Get allowed IPs from database (cached)
            allowed_ips = await self._get_allowed_ips()

            is_blocked, reason = geoip.is_ip_blocked(client_ip, allowed_ips)

            if is_blocked:
                # Log the blocked attempt
                if self.log_blocked_attempts:
                    await self._log_blocked_attempt(request, client_ip, reason)

                # Return 403 Forbidden as a raw ASGI response
                import json

                body = json.dumps(
                    {
                        "detail": "Access denied from your location",
                        "error_code": "GEO_BLOCKED",
                    }
                ).encode("utf-8")
                await send(
                    {
                        "type": "http.response.start",
                        "status": 403,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send(
                    {
                        "type": "http.response.body",
                        "body": body,
                    }
                )
                return

            # Add geo info to request state for downstream use
            geo_info = geoip.lookup_ip(client_ip)
            scope.setdefault("state", {})
            scope["state"]["geo_info"] = geo_info
            scope["state"]["client_ip"] = client_ip

        await self.app(scope, receive, send)

    async def _get_allowed_ips(self) -> set:
        """
        Get set of allowed IPs from database.

        In production, this should be cached with TTL.
        """
        # Import here to avoid circular imports
        try:
            from app.core.cache import cache_manager

            # Try to get from cache first
            if cache_manager.is_connected:
                cached = await cache_manager.get("ip_allowlist")
                if cached:
                    return set(cached)

            # Load from database
            # This would be implemented with a service function
            # For now, return empty set
            return set()

        except Exception:
            return set()

    async def _log_blocked_attempt(
        self, request: Request, client_ip: str, reason: str
    ) -> None:
        """Log blocked access attempt to database."""
        try:
            from app.core.geoip import get_geoip_service

            geoip = get_geoip_service()
            geo_info = geoip.lookup_ip(client_ip) if geoip else {}

            # Log using loguru (immediate)
            from loguru import logger

            logger.warning(
                f"BLOCKED ACCESS: IP={client_ip}, "
                f"Country={geo_info.get('country_code', 'unknown')}, "
                f"Reason={reason}, "
                f"Path={request.url.path}"
            )

            # Log to database asynchronously for audit trail
            try:
                from app.core.audit import log_audit_event
                from app.core.database import async_session_factory

                async with async_session_factory() as db:
                    await log_audit_event(
                        db=db,
                        event_type="security.ip_blocked",
                        event_category="security",
                        severity="critical",
                        event_data={
                            "ip_address": client_ip,
                            "country_code": geo_info.get("country_code", "unknown"),
                            "reason": reason,
                            "path": str(request.url.path),
                            "method": request.method,
                            "user_agent": request.headers.get("user-agent", ""),
                        },
                        ip_address=client_ip,
                    )
                    await db.commit()
            except Exception as db_err:
                logger.error(f"Failed to write blocked attempt to database: {db_err}")

        except Exception as e:
            from loguru import logger

            logger.error(f"Failed to log blocked attempt: {e}")


# ============================================
# IP Logging Middleware
# ============================================


class IPLoggingMiddleware:
    """
    Middleware for logging all request IP addresses and geo information.

    Provides comprehensive request logging for security auditing.
    Also assigns a unique request ID (UUID4-hex) for log correlation,
    logs request method/path/status/duration at INFO level, and
    binds the request_id to the Loguru context for the duration of
    the request.

    Implemented as a pure ASGI middleware (not BaseHTTPMiddleware) to avoid
    stripping Set-Cookie headers during response wrapping.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        from loguru import logger

        from app.core.geoip import get_geoip_service
        from app.core.logging import generate_request_id, request_id_ctx

        request = Request(scope)

        # Generate or reuse incoming request ID
        request_id = request.headers.get("X-Request-ID") or generate_request_id()
        request_id_ctx.set(request_id)

        client_ip = get_client_ip(request)
        user_agent = get_user_agent(request)

        # Get geo info if available
        geo_info: dict = {}
        geoip = get_geoip_service()
        if geoip:
            geo_info = geoip.lookup_ip(client_ip)

        # Store in request state
        request.state.client_ip = client_ip
        request.state.user_agent = user_agent
        request.state.geo_info = geo_info
        request.state.request_id = request_id

        # Log incoming request at debug level
        logger.debug(
            f"Request: {request.method} {request.url.path} | "
            f"IP: {client_ip} | "
            f"Country: {geo_info.get('country_code', 'unknown')} | "
            f"Request-ID: {request_id}"
        )

        # Track timing and response status
        start = time.monotonic()
        response_status = 0

        async def send_with_request_id(message: Message) -> None:
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = message.get("status", 0)
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_request_id)

        duration_ms = (time.monotonic() - start) * 1000

        # Log completed request at INFO level (skip health checks to reduce noise)
        path = request.url.path
        if path not in ("/health", "/health/detailed"):
            logger.info(
                f"{request.method} {path} → {response_status} "
                f"({duration_ms:.0f}ms) [rid={request_id}]"
            )


# ============================================
# Security Monitoring Integration Middleware
# ============================================


class SecurityMonitoringMiddleware:
    """
    Middleware for real-time security monitoring.

    Implemented as a pure ASGI middleware (not BaseHTTPMiddleware) to avoid
    stripping Set-Cookie headers when multiple middleware layers are stacked
    (SEC-15).

    Integrates with the SecurityMonitoringService to:
    - Detect injection attempts
    - Monitor for brute force attacks
    - Track session anomalies
    - Monitor data exfiltration
    """

    # Sensitive endpoints that need extra monitoring
    SENSITIVE_ENDPOINTS = {
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/users/password",
        "/api/v1/roles",
        "/api/v1/organization",
    }

    # Export endpoints for data exfiltration monitoring
    EXPORT_ENDPOINTS = {
        "/api/v1/users/export",
        "/api/v1/events/export",
        "/api/v1/audit/export",
        "/api/v1/reports",
    }

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Process request through security monitoring."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        from loguru import logger

        request = Request(scope)
        client_ip = get_client_ip(request)
        user_agent = get_user_agent(request)
        path: str = scope.get("path", "")
        method: str = scope.get("method", "GET")

        # Build request data for analysis
        request_data: dict[str, Any] = {
            "ip_address": client_ip,
            "user_agent": user_agent,
            "path": path,
            "method": method,
            "query_params": dict(request.query_params),
        }

        # Try to get user ID if authenticated
        user_id = None
        session_id = None
        try:
            if hasattr(request, "state") and hasattr(request.state, "user"):
                user_id = str(request.state.user.id)
        except Exception:
            pass

        # Get session ID from header
        session_id = request.headers.get("X-Session-ID")

        # Analyze request for threats (only for write operations)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            try:
                body_chunks: list[bytes] = []
                while True:
                    message = await receive()
                    chunk = message.get("body", b"")
                    if chunk:
                        body_chunks.append(chunk)
                    if not message.get("more_body", False):
                        break
                body_for_analysis = b"".join(body_chunks)

                if body_for_analysis:
                    try:
                        request_data["body"] = body_for_analysis.decode("utf-8")[
                            :10000
                        ]  # Limit size
                    except UnicodeDecodeError:
                        pass  # Binary data, skip

                # Create a replay receive callable so downstream can read the body
                _body_sent = False

                async def _replay_receive() -> Message:
                    nonlocal _body_sent
                    if not _body_sent:
                        _body_sent = True
                        return {
                            "type": "http.request",
                            "body": body_for_analysis,
                            "more_body": False,
                        }
                    # Subsequent calls return empty body (ASGI protocol)
                    return {"type": "http.request", "body": b"", "more_body": False}

                actual_receive = _replay_receive
            except Exception as e:
                logger.debug(f"Could not read request body: {e}")

        # Check for session hijacking on authenticated requests
        if user_id and session_id and client_ip:
            try:
                from app.core.database import async_session_factory
                from app.services.security_monitoring import security_monitor

                async with async_session_factory() as db:
                    alert = await security_monitor.detect_session_hijack(
                        db=db,
                        session_id=session_id,
                        current_ip=client_ip,
                        user_agent=user_agent or "",
                        user_id=user_id,
                    )
                    if alert:
                        logger.critical(f"Session hijack detected: {alert.description}")
            except Exception as e:
                logger.debug(f"Session monitoring error: {e}")

        # Track response status and content-length for exfiltration monitoring
        response_status = 0
        content_length_value: str | None = None

        async def send_with_monitoring(message: Message) -> None:
            nonlocal response_status, content_length_value
            if message["type"] == "http.response.start":
                response_status = message.get("status", 0)
                for header_name, header_value in message.get("headers", []):
                    if header_name == b"content-length":
                        content_length_value = header_value.decode()
                        break
            await send(message)

        await self.app(scope, actual_receive, send_with_monitoring)

        # Monitor data exfiltration on export endpoints (post-response)
        if path in self.EXPORT_ENDPOINTS and user_id:
            try:
                if content_length_value:
                    data_size = int(content_length_value)

                    from app.core.database import async_session_factory
                    from app.services.security_monitoring import security_monitor

                    async with async_session_factory() as db:
                        await security_monitor.detect_data_exfiltration(
                            db=db,
                            user_id=user_id,
                            data_size_bytes=data_size,
                            endpoint=path,
                            ip_address=client_ip,
                        )
            except Exception as e:
                logger.debug(f"Data exfiltration monitoring error: {e}")


# ============================================
# Periodic Security Check Task
# ============================================


async def run_periodic_security_checks() -> dict[str, Any]:
    """
    Run periodic security checks.

    Should be called by a scheduler (e.g., APScheduler, Celery) every hour.

    Returns:
        Dictionary with check results
    """
    from loguru import logger

    from app.core.audit import audit_logger, verify_audit_log_integrity
    from app.core.database import async_session_factory
    from app.services.security_monitoring import security_monitor

    results = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": {},
    }

    try:
        async with async_session_factory() as db:
            # 1. Verify audit log integrity
            logger.info("Running scheduled audit log integrity check...")
            integrity = await verify_audit_log_integrity(db)
            results["checks"]["log_integrity"] = {
                "verified": integrity["verified"],
                "entries_checked": integrity["total_checked"],
                "errors": len(integrity.get("errors", [])),
            }

            if not integrity["verified"]:
                logger.critical(
                    f"SCHEDULED CHECK FAILED: Audit log tampering detected! "
                    f"{len(integrity.get('errors', []))} errors found"
                )

            # 2. Get security status
            logger.info("Running scheduled security status check...")
            status = await security_monitor.get_security_status(db)
            results["checks"]["security_status"] = {
                "status": status["status"],
                "alerts_last_hour": status["alerts"]["total_last_hour"],
                "failed_logins": status["metrics"]["failed_logins_last_hour"],
            }

            # 3. Create periodic checkpoint if enough logs
            # SEC: Use text() wrapper for raw SQL to prevent injection risks
            from sqlalchemy import text

            log_status = await db.execute(
                text(
                    "SELECT MIN(id), MAX(id), COUNT(*) FROM audit_logs WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)"
                )
            )
            row = log_status.fetchone()
            if row and row[2] > 100:  # At least 100 logs
                try:
                    checkpoint = await audit_logger.create_checkpoint(
                        db, row[0], row[1]
                    )
                    results["checks"]["checkpoint_created"] = {
                        "id": checkpoint.id,
                        "entries": checkpoint.total_entries,
                    }
                    logger.info(f"Created hourly checkpoint: {checkpoint.id}")
                except Exception as e:
                    logger.warning(f"Could not create checkpoint: {e}")

            results["overall_status"] = (
                "healthy" if integrity["verified"] else "critical"
            )

    except Exception as e:
        logger.error(f"Periodic security check failed: {e}")
        results["error"] = str(e)
        results["overall_status"] = "error"

    return results
