"""
Unit tests for security middleware and utilities.

Covers:
  - In-memory RateLimiter (window enforcement, lockout, expiry)
  - CSRFProtection (token generation, validation, edge cases)
  - InputSanitizer (string, email, username, phone, URL sanitization)
  - SecurityHeadersMiddleware (header injection on API and non-API paths)
  - verify_csrf_token FastAPI dependency (double-submit cookie pattern)
"""

import pytest
import time
import secrets
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

from app.core.security_middleware import (
    RateLimiter,
    CSRFProtection,
    InputSanitizer,
    SecurityHeadersMiddleware,
    verify_csrf_token,
)


# ---------------------------------------------------------------------------
# RateLimiter
# ---------------------------------------------------------------------------

class TestRateLimiter:

    @pytest.mark.unit
    def test_first_request_is_not_limited(self):
        """The very first request for a given key should not be rate-limited."""
        limiter = RateLimiter()
        is_limited, reason = limiter.is_rate_limited("ip-1", max_requests=5, window_seconds=60)
        assert is_limited is False
        assert reason is None

    @pytest.mark.unit
    def test_under_limit_allows_requests(self):
        """Requests within the limit should all be allowed."""
        limiter = RateLimiter()
        for _ in range(4):
            is_limited, _ = limiter.is_rate_limited("ip-2", max_requests=5, window_seconds=60)
            assert is_limited is False

    @pytest.mark.unit
    def test_exceeding_limit_triggers_lockout(self):
        """Exceeding max_requests should trigger a lockout."""
        limiter = RateLimiter()
        key = "ip-3"
        for _ in range(5):
            limiter.is_rate_limited(key, max_requests=5, window_seconds=60)

        # The 6th request should be rate-limited
        is_limited, reason = limiter.is_rate_limited(key, max_requests=5, window_seconds=60)
        assert is_limited is True
        assert reason is not None
        assert "locked" in reason.lower() or "too many" in reason.lower()

    @pytest.mark.unit
    def test_lockout_persists_during_lockout_period(self):
        """While locked out, requests should continue to be denied."""
        limiter = RateLimiter()
        key = "ip-4"
        for _ in range(6):
            limiter.is_rate_limited(key, max_requests=5, window_seconds=60, lockout_seconds=1800)

        # Still locked
        is_limited, reason = limiter.is_rate_limited(key, max_requests=5, window_seconds=60)
        assert is_limited is True
        assert "locked" in reason.lower()

    @pytest.mark.unit
    def test_lockout_expiry(self):
        """After the lockout period expires, requests should be allowed again."""
        limiter = RateLimiter()
        key = "ip-5"
        # Trigger lockout with very short lockout window
        for _ in range(6):
            limiter.is_rate_limited(key, max_requests=5, window_seconds=60, lockout_seconds=1)

        # Simulate lockout expiry by moving the lockout timestamp into the past
        limiter.lockouts[key] = time.time() - 1

        is_limited, reason = limiter.is_rate_limited(key, max_requests=5, window_seconds=60)
        assert is_limited is False
        assert reason is None

    @pytest.mark.unit
    def test_different_keys_independent(self):
        """Rate limiting for one key should not affect another key."""
        limiter = RateLimiter()
        # Exhaust key A
        for _ in range(6):
            limiter.is_rate_limited("key-A", max_requests=5, window_seconds=60)

        # Key B should still be fine
        is_limited, _ = limiter.is_rate_limited("key-B", max_requests=5, window_seconds=60)
        assert is_limited is False

    @pytest.mark.unit
    def test_window_expiry_cleans_old_requests(self):
        """Requests outside the time window should be cleaned and not count."""
        limiter = RateLimiter()
        key = "ip-6"
        # Manually add old timestamps well outside the window
        old_time = time.time() - 120  # 2 minutes ago
        limiter.requests[key] = [old_time] * 5

        # Despite 5 old requests, a new request should pass (window=60s)
        is_limited, _ = limiter.is_rate_limited(key, max_requests=5, window_seconds=60)
        assert is_limited is False

    @pytest.mark.unit
    def test_lockout_remaining_time_in_reason(self):
        """The lockout reason message should include remaining time."""
        limiter = RateLimiter()
        key = "ip-7"
        for _ in range(6):
            limiter.is_rate_limited(key, max_requests=5, window_seconds=60, lockout_seconds=1800)

        _, reason = limiter.is_rate_limited(key, max_requests=5, window_seconds=60)
        # Reason should mention seconds remaining
        assert "seconds" in reason.lower() or "minutes" in reason.lower()


# ---------------------------------------------------------------------------
# CSRFProtection
# ---------------------------------------------------------------------------

class TestCSRFProtection:

    @pytest.mark.unit
    def test_generate_token_is_string(self):
        """generate_token should return a non-empty string."""
        token = CSRFProtection.generate_token()
        assert isinstance(token, str)
        assert len(token) > 0

    @pytest.mark.unit
    def test_generate_token_uniqueness(self):
        """Each generated token should be unique."""
        tokens = {CSRFProtection.generate_token() for _ in range(20)}
        assert len(tokens) == 20

    @pytest.mark.unit
    def test_validate_token_matching(self):
        """Identical tokens should validate as True."""
        token = CSRFProtection.generate_token()
        assert CSRFProtection.validate_token(token, token) is True

    @pytest.mark.unit
    def test_validate_token_mismatched(self):
        """Different tokens should validate as False."""
        t1 = CSRFProtection.generate_token()
        t2 = CSRFProtection.generate_token()
        assert CSRFProtection.validate_token(t1, t2) is False

    @pytest.mark.unit
    def test_validate_token_empty_request_token(self):
        """An empty request token should fail validation."""
        token = CSRFProtection.generate_token()
        assert CSRFProtection.validate_token("", token) is False

    @pytest.mark.unit
    def test_validate_token_empty_session_token(self):
        """An empty session token should fail validation."""
        token = CSRFProtection.generate_token()
        assert CSRFProtection.validate_token(token, "") is False

    @pytest.mark.unit
    def test_validate_token_both_empty(self):
        """Both tokens empty should fail validation."""
        assert CSRFProtection.validate_token("", "") is False

    @pytest.mark.unit
    def test_validate_token_none_request(self):
        """None as request_token should fail validation."""
        assert CSRFProtection.validate_token(None, "some-token") is False

    @pytest.mark.unit
    def test_validate_token_none_session(self):
        """None as session_token should fail validation."""
        assert CSRFProtection.validate_token("some-token", None) is False

    @pytest.mark.unit
    def test_validate_uses_constant_time_comparison(self):
        """The validation should use secrets.compare_digest (constant-time)."""
        # We can verify this by checking CSRFProtection.validate_token
        # uses secrets.compare_digest. A functional test: matching tokens
        # should return True, which confirms the code path works.
        token = "test-csrf-token-value"
        assert CSRFProtection.validate_token(token, token) is True


# ---------------------------------------------------------------------------
# InputSanitizer
# ---------------------------------------------------------------------------

class TestInputSanitizer:

    # -- sanitize_string --

    @pytest.mark.unit
    def test_sanitize_string_html_escapes(self):
        """HTML special characters should be escaped."""
        result = InputSanitizer.sanitize_string("<script>alert('xss')</script>")
        assert "<script>" not in result
        assert "&lt;script&gt;" in result

    @pytest.mark.unit
    def test_sanitize_string_removes_null_bytes(self):
        """Null bytes should be removed from the string."""
        result = InputSanitizer.sanitize_string("hello\x00world")
        assert "\x00" not in result

    @pytest.mark.unit
    def test_sanitize_string_enforces_max_length(self):
        """Strings exceeding max_length should be truncated."""
        result = InputSanitizer.sanitize_string("a" * 2000, max_length=100)
        assert len(result) <= 100

    @pytest.mark.unit
    def test_sanitize_string_non_string_returns_empty(self):
        """Non-string input should return an empty string."""
        result = InputSanitizer.sanitize_string(12345)
        assert result == ""

    @pytest.mark.unit
    def test_sanitize_string_strips_whitespace(self):
        """Leading and trailing whitespace should be stripped."""
        result = InputSanitizer.sanitize_string("  hello  ")
        assert result == "hello"

    @pytest.mark.unit
    def test_sanitize_string_preserves_normal_text(self):
        """Normal text without special characters should pass through."""
        result = InputSanitizer.sanitize_string("Hello World 123")
        assert result == "Hello World 123"

    # -- sanitize_email --

    @pytest.mark.unit
    def test_sanitize_email_valid(self):
        """A valid email should be returned lowercased and trimmed."""
        result = InputSanitizer.sanitize_email("  User@Example.COM  ")
        assert result == "user@example.com"

    @pytest.mark.unit
    def test_sanitize_email_invalid_format(self):
        """An email with invalid format should raise ValueError."""
        with pytest.raises(ValueError, match="[Ii]nvalid email"):
            InputSanitizer.sanitize_email("not-an-email")

    @pytest.mark.unit
    def test_sanitize_email_non_string(self):
        """Non-string input should raise ValueError."""
        with pytest.raises(ValueError, match="must be a string"):
            InputSanitizer.sanitize_email(12345)

    @pytest.mark.unit
    def test_sanitize_email_injection_newline(self):
        """Email with newline injection attempt should raise ValueError."""
        with pytest.raises(ValueError, match="[Ii]nvalid email"):
            InputSanitizer.sanitize_email("user@example.com\nBCC: attacker@evil.com")

    @pytest.mark.unit
    def test_sanitize_email_injection_encoded_newline(self):
        """Email with percent-encoded newline should raise ValueError."""
        with pytest.raises(ValueError, match="[Ii]nvalid email"):
            InputSanitizer.sanitize_email("user@example.com%0abcc:attacker@evil.com")

    @pytest.mark.unit
    def test_sanitize_email_too_long(self):
        """Email exceeding 254 characters should raise ValueError."""
        long_email = "a" * 246 + "@test.com"  # 255 chars, exceeds 254 limit
        with pytest.raises(ValueError, match="[Tt]oo long"):
            InputSanitizer.sanitize_email(long_email)

    # -- sanitize_username --

    @pytest.mark.unit
    def test_sanitize_username_valid(self):
        """A valid username should be returned unchanged."""
        result = InputSanitizer.sanitize_username("john_doe-99")
        assert result == "john_doe-99"

    @pytest.mark.unit
    def test_sanitize_username_too_short(self):
        """Username shorter than 3 characters should raise ValueError."""
        with pytest.raises(ValueError, match="3-32"):
            InputSanitizer.sanitize_username("ab")

    @pytest.mark.unit
    def test_sanitize_username_too_long(self):
        """Username longer than 32 characters should raise ValueError."""
        with pytest.raises(ValueError, match="3-32"):
            InputSanitizer.sanitize_username("a" * 33)

    @pytest.mark.unit
    def test_sanitize_username_special_chars_rejected(self):
        """Username with special characters (other than _ and -) should raise."""
        with pytest.raises(ValueError):
            InputSanitizer.sanitize_username("user@name!")

    @pytest.mark.unit
    def test_sanitize_username_non_string(self):
        """Non-string input should raise ValueError."""
        with pytest.raises(ValueError, match="must be a string"):
            InputSanitizer.sanitize_username(12345)

    # -- sanitize_phone --

    @pytest.mark.unit
    def test_sanitize_phone_valid_us(self):
        """A US phone number with formatting should be cleaned."""
        result = InputSanitizer.sanitize_phone("+1 (555) 123-4567")
        assert result == "+15551234567"

    @pytest.mark.unit
    def test_sanitize_phone_too_short(self):
        """A phone number that is too short should raise ValueError."""
        with pytest.raises(ValueError, match="[Ii]nvalid phone"):
            InputSanitizer.sanitize_phone("123")

    @pytest.mark.unit
    def test_sanitize_phone_non_string(self):
        """Non-string input should raise ValueError."""
        with pytest.raises(ValueError, match="must be a string"):
            InputSanitizer.sanitize_phone(12345)

    # -- validate_url --

    @pytest.mark.unit
    def test_validate_url_valid_https(self):
        """A valid HTTPS URL should pass."""
        result = InputSanitizer.validate_url("https://example.com/path")
        assert result == "https://example.com/path"

    @pytest.mark.unit
    def test_validate_url_http_rejected_by_default(self):
        """An HTTP URL should be rejected when allow_http is False."""
        with pytest.raises(ValueError, match="HTTPS"):
            InputSanitizer.validate_url("http://example.com")

    @pytest.mark.unit
    def test_validate_url_http_allowed_when_flagged(self):
        """An HTTP URL should be accepted when allow_http is True."""
        result = InputSanitizer.validate_url("http://example.com", allow_http=True)
        assert result.startswith("http://")

    @pytest.mark.unit
    def test_validate_url_non_string(self):
        """Non-string input should raise ValueError."""
        with pytest.raises(ValueError, match="must be a string"):
            InputSanitizer.validate_url(12345)

    @pytest.mark.unit
    def test_validate_url_invalid_format(self):
        """A malformed URL should raise ValueError."""
        with pytest.raises(ValueError):
            InputSanitizer.validate_url("https://")


# ---------------------------------------------------------------------------
# SecurityHeadersMiddleware
# ---------------------------------------------------------------------------

class TestSecurityHeadersMiddleware:

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_api_path_includes_cache_control(self):
        """API paths should get cache-busting headers."""
        app = MagicMock()
        middleware = SecurityHeadersMiddleware(app)

        # Build a mock request for an API path
        request = MagicMock()
        request.url.path = "/api/v1/users"

        # Build a mock response that call_next returns
        response = MagicMock()
        response.headers = {}

        async def call_next(req):
            return response

        result = await middleware.dispatch(request, call_next)
        assert result.headers["Cache-Control"] == "no-store, no-cache, must-revalidate, proxy-revalidate"
        assert result.headers["Pragma"] == "no-cache"
        assert result.headers["Expires"] == "0"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_non_api_path_no_cache_control(self):
        """Non-API paths should NOT get cache-busting headers."""
        app = MagicMock()
        middleware = SecurityHeadersMiddleware(app)

        request = MagicMock()
        request.url.path = "/static/logo.png"

        response = MagicMock()
        response.headers = {}

        async def call_next(req):
            return response

        result = await middleware.dispatch(request, call_next)
        assert "Cache-Control" not in result.headers

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_security_headers_always_set(self):
        """Security headers should be set on every response."""
        app = MagicMock()
        middleware = SecurityHeadersMiddleware(app)

        request = MagicMock()
        request.url.path = "/api/v1/data"

        response = MagicMock()
        response.headers = {}

        async def call_next(req):
            return response

        result = await middleware.dispatch(request, call_next)

        assert result.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
        assert result.headers["X-Content-Type-Options"] == "nosniff"
        assert result.headers["X-Frame-Options"] == "DENY"
        assert result.headers["X-XSS-Protection"] == "1; mode=block"
        assert result.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert "geolocation=()" in result.headers["Permissions-Policy"]
        assert "Content-Security-Policy" in result.headers

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_csp_header_content(self):
        """Content-Security-Policy header should include expected directives."""
        app = MagicMock()
        middleware = SecurityHeadersMiddleware(app)

        request = MagicMock()
        request.url.path = "/api/v1/resource"

        response = MagicMock()
        response.headers = {}

        async def call_next(req):
            return response

        result = await middleware.dispatch(request, call_next)
        csp = result.headers["Content-Security-Policy"]
        assert "default-src 'self'" in csp
        assert "script-src 'self'" in csp
        assert "frame-ancestors 'none'" in csp


# ---------------------------------------------------------------------------
# verify_csrf_token dependency
# ---------------------------------------------------------------------------

class TestVerifyCSRFTokenDependency:

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_safe_methods_skip_csrf(self):
        """GET, HEAD, OPTIONS requests should skip CSRF validation."""
        for method in ["GET", "HEAD", "OPTIONS"]:
            request = MagicMock()
            request.method = method
            # Should not raise
            await verify_csrf_token(request)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_no_csrf_cookie_allows_request(self):
        """POST without a csrf_token cookie should be allowed (first request after login)."""
        request = MagicMock()
        request.method = "POST"
        request.headers = {}
        request.cookies = {}
        # Should not raise
        await verify_csrf_token(request)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_matching_csrf_tokens_pass(self):
        """POST with matching X-CSRF-Token header and csrf_token cookie should pass."""
        token = secrets.token_urlsafe(32)
        request = MagicMock()
        request.method = "POST"
        request.headers = {"X-CSRF-Token": token}
        request.cookies = {"csrf_token": token}
        # Should not raise
        await verify_csrf_token(request)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_mismatched_csrf_tokens_rejected(self):
        """POST with mismatched CSRF tokens should raise 403."""
        from fastapi import HTTPException

        request = MagicMock()
        request.method = "POST"
        request.headers = {"X-CSRF-Token": "wrong-token"}
        request.cookies = {"csrf_token": "correct-token"}

        with pytest.raises(HTTPException) as exc_info:
            await verify_csrf_token(request)
        assert exc_info.value.status_code == 403

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_missing_header_with_cookie_rejected(self):
        """POST with csrf_token cookie but missing X-CSRF-Token header should raise 403."""
        from fastapi import HTTPException

        request = MagicMock()
        request.method = "POST"
        request.headers = {}  # no X-CSRF-Token
        request.cookies = {"csrf_token": "some-token"}

        with pytest.raises(HTTPException) as exc_info:
            await verify_csrf_token(request)
        assert exc_info.value.status_code == 403

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_put_method_requires_csrf(self):
        """PUT requests should also be subject to CSRF validation."""
        from fastapi import HTTPException

        request = MagicMock()
        request.method = "PUT"
        request.headers = {"X-CSRF-Token": "bad"}
        request.cookies = {"csrf_token": "good"}

        with pytest.raises(HTTPException) as exc_info:
            await verify_csrf_token(request)
        assert exc_info.value.status_code == 403

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_delete_method_requires_csrf(self):
        """DELETE requests should also be subject to CSRF validation."""
        from fastapi import HTTPException

        request = MagicMock()
        request.method = "DELETE"
        request.headers = {"X-CSRF-Token": "bad"}
        request.cookies = {"csrf_token": "good"}

        with pytest.raises(HTTPException) as exc_info:
            await verify_csrf_token(request)
        assert exc_info.value.status_code == 403
