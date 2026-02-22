"""
Security Middleware and Utilities for FastAPI

Implements rate limiting, CSRF protection, security headers,
input sanitization, and other security features.
"""

from fastapi import Request, HTTPException, status
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp
from typing import Callable, Dict, List, Optional, Any
import time
import hashlib
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import re
import html


# ============================================
# Rate Limiting
# ============================================

class RateLimiter:
    """
    In-memory rate limiter for API endpoints

    In production, use Redis for distributed rate limiting
    """
    def __init__(self):
        self.requests: Dict[str, List[float]] = defaultdict(list)
        self.lockouts: Dict[str, float] = {}

    def is_rate_limited(
        self,
        key: str,
        max_requests: int = 5,
        window_seconds: int = 60,
        lockout_seconds: int = 1800  # 30 minutes
    ) -> tuple[bool, Optional[str]]:
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

        # Check if currently locked out
        if key in self.lockouts:
            if current_time < self.lockouts[key]:
                remaining = int(self.lockouts[key] - current_time)
                return True, f"Account locked. Try again in {remaining} seconds"
            else:
                # Lockout expired
                del self.lockouts[key]
                self.requests[key] = []

        # Clean old requests outside window
        self.requests[key] = [
            req_time for req_time in self.requests[key]
            if current_time - req_time < window_seconds
        ]

        # Check rate limit
        if len(self.requests[key]) >= max_requests:
            # Too many requests - apply lockout
            self.lockouts[key] = current_time + lockout_seconds
            return True, f"Too many requests. Account locked for {lockout_seconds // 60} minutes"

        # Record this request
        if key not in self.requests:
            self.requests[key] = []
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
        value = value.replace('\x00', '')

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
        if not re.match(r'^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$', email):
            raise ValueError("Invalid email format")

        # Check for injection attempts
        if '\n' in email or '\r' in email or '%0a' in email or '%0d' in email:
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

        if not re.match(r'^[a-zA-Z0-9_-]{3,32}$', username):
            raise ValueError("Username must be 3-32 characters (letters, numbers, underscore, hyphen only)")

        return username

    @staticmethod
    def sanitize_phone(phone: str) -> str:
        """
        Sanitize phone number
        """
        if not isinstance(phone, str):
            raise ValueError("Phone must be a string")

        # Remove all non-digit characters except +
        phone = re.sub(r'[^\d+]', '', phone)

        # Basic validation
        if not re.match(r'^\+?[\d]{7,15}$', phone):
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
        if not url.startswith('https://'):
            if allow_http and url.startswith('http://'):
                pass  # Allow HTTP in development
            else:
                raise ValueError("URL must use HTTPS")

        # Basic URL validation
        if not re.match(r'^https?://[a-zA-Z0-9.-]+(?:\.[a-zA-Z]{2,})?(?:/.*)?$', url):
            raise ValueError("Invalid URL format")

        return url


# ============================================
# Security Headers Middleware
# ============================================

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Add security headers to all responses
    """

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)

        # Strict Transport Security (HSTS)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Clickjacking protection
        response.headers["X-Frame-Options"] = "DENY"

        # XSS Protection (legacy but still useful)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Referrer Policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions Policy
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        # Content Security Policy
        csp = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "font-src 'self'; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        response.headers["Content-Security-Policy"] = csp

        return response


# ============================================
# Rate Limiting Dependency
# ============================================

async def check_rate_limit(
    request: Request,
    max_requests: int = 5,
    window_seconds: int = 60
) -> None:
    """
    Dependency to check rate limits

    Usage:
        @router.post("/endpoint", dependencies=[Depends(check_rate_limit)])
    """
    # Get client IP
    client_ip = request.client.host if request.client else "unknown"

    # Check rate limit
    is_limited, reason = rate_limiter.is_rate_limited(
        key=client_ip,
        max_requests=max_requests,
        window_seconds=window_seconds
    )

    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=reason or "Too many requests"
        )


# ============================================
# CSRF Protection Dependency
# ============================================

async def verify_csrf_token(request: Request) -> None:
    """
    Dependency to verify CSRF token

    Usage:
        @router.post("/endpoint", dependencies=[Depends(verify_csrf_token)])
    """
    # Skip CSRF for GET, HEAD, OPTIONS
    if request.method in ["GET", "HEAD", "OPTIONS"]:
        return

    # Get token from header
    request_token = request.headers.get("X-CSRF-Token")

    # Get token from session (you'll need to implement session management)
    # For now, we'll skip if no session exists
    session_token = request.session.get("csrf_token") if hasattr(request, "session") else None

    if not session_token:
        # Generate new token if none exists
        return

    # Validate token
    if not CSRFProtection.validate_token(request_token, session_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid CSRF token"
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
        user_id: Optional[str],
        ip_address: str,
        user_agent: Optional[str],
        details: dict,
        severity: str = "INFO"
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
            "severity": severity
        }

        from loguru import logger
        logger.warning(f"[SECURITY AUDIT] {log_entry}")

    @staticmethod
    async def log_failed_login(
        username: str,
        ip_address: str,
        user_agent: Optional[str],
        reason: str
    ) -> None:
        """Log failed login attempt"""
        await SecurityAuditLogger.log_event(
            event_type="FAILED_LOGIN",
            user_id=None,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"username": username, "reason": reason},
            severity="WARNING"
        )

    @staticmethod
    async def log_successful_login(
        user_id: str,
        username: str,
        ip_address: str,
        user_agent: Optional[str]
    ) -> None:
        """Log successful login"""
        await SecurityAuditLogger.log_event(
            event_type="SUCCESSFUL_LOGIN",
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"username": username},
            severity="INFO"
        )

    @staticmethod
    async def log_password_change(
        user_id: str,
        ip_address: str,
        user_agent: Optional[str]
    ) -> None:
        """Log password change"""
        await SecurityAuditLogger.log_event(
            event_type="PASSWORD_CHANGE",
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={},
            severity="INFO"
        )

    @staticmethod
    async def log_suspicious_activity(
        user_id: Optional[str],
        ip_address: str,
        user_agent: Optional[str],
        description: str
    ) -> None:
        """Log suspicious activity"""
        await SecurityAuditLogger.log_event(
            event_type="SUSPICIOUS_ACTIVITY",
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"description": description},
            severity="CRITICAL"
        )


# ============================================
# Helper Functions
# ============================================

def get_client_ip(request: Request) -> str:
    """Get client IP address from request.

    Only trusts the X-Forwarded-For header when the direct peer IP is in
    the configured TRUSTED_PROXY_IPS list (SEC-16).  This prevents clients
    from spoofing their IP to bypass rate limiting or geo-blocking.
    """
    from app.core.config import settings

    direct_ip = request.client.host if request.client else "unknown"
    trusted_proxies = settings.get_trusted_proxy_ips()

    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for and (not trusted_proxies or direct_ip in trusted_proxies):
        # Take the left-most IP (original client)
        return forwarded_for.split(",")[0].strip()

    return direct_ip


def get_user_agent(request: Request) -> Optional[str]:
    """Get user agent from request"""
    return request.headers.get("User-Agent")


# ============================================
# IP/Country Blocking Middleware
# ============================================

class IPBlockingMiddleware(BaseHTTPMiddleware):
    """
    Middleware for IP-based and country-based access control.

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
        super().__init__(app)
        self.enabled = enabled
        self.log_blocked_attempts = log_blocked_attempts

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint
    ) -> Response:
        """Process request and check IP/country restrictions."""

        # Skip if disabled
        if not self.enabled:
            return await call_next(request)

        # Skip health check and onboarding endpoints
        if request.url.path in self.BYPASS_PATHS:
            return await call_next(request)

        # Skip paths with bypass prefixes (e.g., onboarding)
        if any(request.url.path.startswith(prefix) for prefix in self.BYPASS_PREFIXES):
            return await call_next(request)

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

                # Return 403 Forbidden
                from fastapi.responses import JSONResponse
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={
                        "detail": "Access denied from your location",
                        "error_code": "GEO_BLOCKED",
                    }
                )

            # Add geo info to request state for downstream use
            geo_info = geoip.lookup_ip(client_ip)
            request.state.geo_info = geo_info
            request.state.client_ip = client_ip

        return await call_next(request)

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
        self,
        request: Request,
        client_ip: str,
        reason: str
    ) -> None:
        """Log blocked access attempt to database."""
        try:
            from app.core.geoip import get_geoip_service
            import json

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
                from app.core.database import async_session_factory
                from app.core.audit import log_audit_event

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

class IPLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware for logging all request IP addresses and geo information.

    Provides comprehensive request logging for security auditing.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint
    ) -> Response:
        """Log request IP and geo information."""
        from loguru import logger
        from app.core.geoip import get_geoip_service

        client_ip = get_client_ip(request)
        user_agent = get_user_agent(request)

        # Get geo info if available
        geo_info = {}
        geoip = get_geoip_service()
        if geoip:
            geo_info = geoip.lookup_ip(client_ip)

        # Store in request state
        request.state.client_ip = client_ip
        request.state.user_agent = user_agent
        request.state.geo_info = geo_info

        # Log request (debug level for non-sensitive endpoints)
        logger.debug(
            f"Request: {request.method} {request.url.path} | "
            f"IP: {client_ip} | "
            f"Country: {geo_info.get('country_code', 'unknown')}"
        )

        # Process request
        response = await call_next(request)

        # Add request ID header
        request_id = request.headers.get("X-Request-ID", str(hash(f"{client_ip}{datetime.now().timestamp()}")))
        response.headers["X-Request-ID"] = request_id

        return response


# ============================================
# Security Monitoring Integration Middleware
# ============================================

class SecurityMonitoringMiddleware(BaseHTTPMiddleware):
    """
    Middleware for real-time security monitoring.

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

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint
    ) -> Response:
        """Process request through security monitoring."""
        from loguru import logger

        client_ip = get_client_ip(request)
        user_agent = get_user_agent(request)

        # Build request data for analysis
        request_data = {
            "ip_address": client_ip,
            "user_agent": user_agent,
            "path": request.url.path,
            "method": request.method,
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
        if request.method not in ["GET", "HEAD", "OPTIONS"]:
            try:
                # Read body for analysis (need to reconstruct for handler)
                body = await request.body()
                if body:
                    try:
                        request_data["body"] = body.decode("utf-8")[:10000]  # Limit size
                    except UnicodeDecodeError:
                        pass  # Binary data, skip

                # Re-wrap body for handler
                from starlette.requests import Request as StarletteRequest
                request = StarletteRequest(
                    scope=request.scope,
                    receive=lambda: {"type": "http.request", "body": body},
                )
            except Exception as e:
                logger.debug(f"Could not read request body: {e}")

        # Check for session hijacking on authenticated requests
        if user_id and session_id and client_ip:
            try:
                # Import here to avoid circular imports
                from app.services.security_monitoring import security_monitor
                from app.core.database import async_session_factory

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

        # Process the request
        response = await call_next(request)

        # Monitor data exfiltration on export endpoints
        if request.url.path in self.EXPORT_ENDPOINTS and user_id:
            try:
                # Estimate response size
                content_length = response.headers.get("content-length")
                if content_length:
                    data_size = int(content_length)

                    from app.services.security_monitoring import security_monitor
                    from app.core.database import async_session_factory

                    async with async_session_factory() as db:
                        await security_monitor.detect_data_exfiltration(
                            db=db,
                            user_id=user_id,
                            data_size_bytes=data_size,
                            endpoint=request.url.path,
                            ip_address=client_ip,
                        )
            except Exception as e:
                logger.debug(f"Data exfiltration monitoring error: {e}")

        return response


# ============================================
# Periodic Security Check Task
# ============================================

async def run_periodic_security_checks() -> Dict[str, Any]:
    """
    Run periodic security checks.

    Should be called by a scheduler (e.g., APScheduler, Celery) every hour.

    Returns:
        Dictionary with check results
    """
    from loguru import logger
    from app.services.security_monitoring import security_monitor
    from app.core.database import async_session_factory
    from app.core.audit import verify_audit_log_integrity, audit_logger

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
            log_status = await db.execute(
                "SELECT MIN(id), MAX(id), COUNT(*) FROM audit_logs WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)"
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

            results["overall_status"] = "healthy" if integrity["verified"] else "critical"

    except Exception as e:
        logger.error(f"Periodic security check failed: {e}")
        results["error"] = str(e)
        results["overall_status"] = "error"

    return results
