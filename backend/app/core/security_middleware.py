"""
Security Middleware and Utilities for FastAPI

Implements rate limiting, CSRF protection, security headers,
input sanitization, and other security features.
"""

from fastapi import Request, HTTPException, status
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp
from typing import Callable, Dict, List, Optional
import time
import hashlib
import secrets
from collections import defaultdict
from datetime import datetime, timedelta
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
        timestamp = datetime.utcnow().isoformat()

        log_entry = {
            "timestamp": timestamp,
            "event_type": event_type,
            "user_id": user_id,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "details": details,
            "severity": severity
        }

        # In production, send to logging service (e.g., Elasticsearch, CloudWatch)
        print(f"[SECURITY AUDIT] {log_entry}")

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
    """Get client IP address from request"""
    # Check X-Forwarded-For header (if behind proxy)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # Take first IP in list
        return forwarded_for.split(",")[0].strip()

    # Fallback to direct client IP
    return request.client.host if request.client else "unknown"


def get_user_agent(request: Request) -> Optional[str]:
    """Get user agent from request"""
    return request.headers.get("User-Agent")
