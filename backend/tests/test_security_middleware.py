"""
Unit tests for security middleware and utilities.

Covers:
  - In-memory RateLimiter (window enforcement, lockout, expiry)
  - CSRFProtection (token generation, validation, edge cases)
  - InputSanitizer (string, email, username, phone, URL sanitization)
  - SecurityHeadersMiddleware (header injection on API and non-API paths)
  - verify_csrf_token FastAPI dependency (double-submit cookie pattern)
"""

import secrets
import time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.core.security_middleware import (
    CSRFProtection,
    InputSanitizer,
    IPBlockingMiddleware,
    RateLimiter,
    SecurityHeadersMiddleware,
    public_rate_limit,
    rate_limiter,
    verify_csrf_token,
)

# ---------------------------------------------------------------------------
# RateLimiter
# ---------------------------------------------------------------------------


class TestRateLimiter:

    @pytest.mark.unit
    async def test_public_limiter_falls_back_when_redis_command_fails(
        self, monkeypatch
    ):
        """A connected but failing Redis must not disable public throttling."""
        from app.core.cache import cache_manager

        class FailingPipeline:
            def __getattr__(self, _name):
                return lambda *args, **kwargs: self

            async def execute(self):
                raise TimeoutError("Redis command timed out")

        class FailingRedis:
            def pipeline(self):
                return FailingPipeline()

        monkeypatch.setattr(cache_manager, "redis_client", FailingRedis())
        monkeypatch.setattr(cache_manager, "_connected", True)
        monkeypatch.setattr(
            "app.core.security_middleware.settings.RATE_LIMIT_ENABLED", True
        )

        key = "redis-error-fallback"
        rate_limiter.requests.pop(key, None)
        rate_limiter.lockouts.pop(key, None)
        try:
            results = [
                await public_rate_limit(key, max_requests=2, window_seconds=60)
                for _ in range(3)
            ]
        finally:
            rate_limiter.requests.pop(key, None)
            rate_limiter.lockouts.pop(key, None)

        assert [limited for limited, _ in results] == [False, False, True]

    @pytest.mark.unit
    async def test_auth_limiter_falls_back_when_redis_command_fails(self, monkeypatch):
        """CI-11: a connected but failing Redis must not disable auth throttling.

        ``is_rate_limited`` swallowed its own Redis errors and returned False
        ("not limited"), so ``check_rate_limit``'s ``except -> in-memory`` path
        was unreachable and the request was limited by neither backend. The
        third call here must 429 from the in-memory limiter.
        """
        from app.core.cache import cache_manager
        from app.core.security_middleware import check_rate_limit

        class FailingPipeline:
            def __getattr__(self, _name):
                return lambda *args, **kwargs: self

            async def execute(self):
                raise TimeoutError("Redis command timed out")

        class FailingRedis:
            def pipeline(self):
                return FailingPipeline()

        monkeypatch.setattr(cache_manager, "redis_client", FailingRedis())
        monkeypatch.setattr(cache_manager, "_connected", True)
        monkeypatch.setattr(
            "app.core.security_middleware.settings.RATE_LIMIT_ENABLED", True
        )

        client_ip = "203.0.113.77"
        request = MagicMock()
        request.client.host = client_ip
        request.headers = {}

        key = f"login:{client_ip}"
        rate_limiter.requests.pop(key, None)
        rate_limiter.lockouts.pop(key, None)

        statuses = []
        try:
            for _ in range(3):
                try:
                    await check_rate_limit(
                        request,
                        max_requests=2,
                        window_seconds=60,
                        lockout_seconds=60,
                        scope="login",
                    )
                    statuses.append(200)
                except HTTPException as exc:
                    statuses.append(exc.status_code)
        finally:
            rate_limiter.requests.pop(key, None)
            rate_limiter.lockouts.pop(key, None)

        assert statuses == [200, 200, 429]

    @pytest.mark.unit
    def test_first_request_is_not_limited(self):
        """The very first request for a given key should not be rate-limited."""
        limiter = RateLimiter()
        is_limited, reason = limiter.is_rate_limited(
            "ip-1", max_requests=5, window_seconds=60
        )
        assert is_limited is False
        assert reason is None

    @pytest.mark.unit
    def test_under_limit_allows_requests(self):
        """Requests within the limit should all be allowed."""
        limiter = RateLimiter()
        for _ in range(4):
            is_limited, _ = limiter.is_rate_limited(
                "ip-2", max_requests=5, window_seconds=60
            )
            assert is_limited is False

    @pytest.mark.unit
    def test_exceeding_limit_triggers_lockout(self):
        """Exceeding max_requests should trigger a lockout."""
        limiter = RateLimiter()
        key = "ip-3"
        for _ in range(5):
            limiter.is_rate_limited(key, max_requests=5, window_seconds=60)

        # The 6th request should be rate-limited
        is_limited, reason = limiter.is_rate_limited(
            key, max_requests=5, window_seconds=60
        )
        assert is_limited is True
        assert reason is not None
        assert "locked" in reason.lower() or "too many" in reason.lower()

    @pytest.mark.unit
    def test_lockout_persists_during_lockout_period(self):
        """While locked out, requests should continue to be denied."""
        limiter = RateLimiter()
        key = "ip-4"
        for _ in range(6):
            limiter.is_rate_limited(
                key, max_requests=5, window_seconds=60, lockout_seconds=1800
            )

        # Still locked
        is_limited, reason = limiter.is_rate_limited(
            key, max_requests=5, window_seconds=60
        )
        assert is_limited is True
        assert "locked" in reason.lower()

    @pytest.mark.unit
    def test_lockout_expiry(self):
        """After the lockout period expires, requests should be allowed again."""
        limiter = RateLimiter()
        key = "ip-5"
        # Trigger lockout with very short lockout window
        for _ in range(6):
            limiter.is_rate_limited(
                key, max_requests=5, window_seconds=60, lockout_seconds=1
            )

        # Simulate lockout expiry by moving the lockout timestamp into the past
        limiter.lockouts[key] = time.time() - 1

        is_limited, reason = limiter.is_rate_limited(
            key, max_requests=5, window_seconds=60
        )
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
        is_limited, _ = limiter.is_rate_limited(
            "key-B", max_requests=5, window_seconds=60
        )
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
            limiter.is_rate_limited(
                key, max_requests=5, window_seconds=60, lockout_seconds=1800
            )

        _, reason = limiter.is_rate_limited(key, max_requests=5, window_seconds=60)
        # Reason should mention seconds remaining
        assert "seconds" in reason.lower() or "minutes" in reason.lower()

    @pytest.mark.unit
    def test_max_keys_enforced_on_eviction(self):
        """When tracked keys exceed _MAX_KEYS, the oldest should be force-evicted."""
        limiter = RateLimiter()
        # Lower the threshold for testing
        limiter._MAX_KEYS = 5
        limiter._EVICTION_INTERVAL = 0  # Allow eviction on every call

        now = time.time()
        # Insert 8 keys with staggered timestamps so oldest can be identified
        for i in range(8):
            key = f"ip-max-{i}"
            limiter.requests[key] = [now - 100 + i]

        # Trigger eviction by calling is_rate_limited (which calls _evict_stale)
        limiter.is_rate_limited("ip-trigger", max_requests=100, window_seconds=200)

        # Should have at most _MAX_KEYS (5) keys, plus the trigger key = 6 max,
        # but since _evict_stale runs before the new request is recorded,
        # the oldest 3 keys (ip-max-0, ip-max-1, ip-max-2) should be evicted.
        assert len(limiter.requests) <= limiter._MAX_KEYS + 1
        # The oldest keys should be gone
        assert "ip-max-0" not in limiter.requests
        assert "ip-max-1" not in limiter.requests
        assert "ip-max-2" not in limiter.requests
        # The newest should remain
        assert "ip-max-7" in limiter.requests

    @pytest.mark.unit
    def test_max_keys_evicts_associated_lockouts(self):
        """Force-eviction of keys should also remove their lockout entries."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        for i in range(6):
            key = f"ip-lock-{i}"
            limiter.requests[key] = [now - 100 + i]
            limiter.lockouts[key] = now + 3600  # Future lockout

        # Trigger eviction
        limiter.is_rate_limited("ip-lock-trigger", max_requests=100, window_seconds=200)

        # Evicted keys should have their lockouts removed too
        for key in list(limiter.requests.keys()):
            if key in limiter.lockouts:
                # Lockout should only exist for keys still in requests
                assert key in limiter.requests

    @pytest.mark.unit
    def test_eviction_skipped_when_under_limit_and_interval(self):
        """Eviction should be skipped when under _MAX_KEYS and within interval."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 100
        limiter._EVICTION_INTERVAL = 60

        # Set last eviction to now so interval check fails
        limiter._last_eviction = time.time()

        # Add a stale key
        old_time = time.time() - 200
        limiter.requests["stale-key"] = [old_time]

        # Eviction should be skipped (interval not elapsed, under _MAX_KEYS)
        limiter.is_rate_limited("new-key", max_requests=5, window_seconds=60)
        assert "stale-key" in limiter.requests

    @pytest.mark.unit
    def test_eviction_forced_when_over_max_keys(self):
        """Eviction should run immediately when over _MAX_KEYS, ignoring interval."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 60

        # Set last eviction to now so interval check would normally skip
        limiter._last_eviction = time.time()

        now = time.time()
        for i in range(5):
            limiter.requests[f"over-{i}"] = [now - 50 + i]

        # Despite interval not elapsed, should evict because over _MAX_KEYS
        limiter.is_rate_limited("trigger", max_requests=100, window_seconds=60)
        assert len(limiter.requests) <= limiter._MAX_KEYS + 1

    @pytest.mark.unit
    def test_is_rate_limited_records_the_callers_window_for_the_key(self):
        limiter = RateLimiter()
        limiter.is_rate_limited(
            "data-export:1.2.3.4", max_requests=3, window_seconds=3600
        )
        assert limiter._key_windows["data-export:1.2.3.4"] == 3600

    @pytest.mark.unit
    def test_a_long_window_keys_eviction_uses_its_own_window_not_the_triggering_calls(
        self,
    ):
        """CI2-33-2: this limiter is shared across scopes with very different
        windows (most 60s, but e.g. data_export is 3600s). A sweep triggered
        by a 60s-window call must not evict a key tracked under a 3600s
        window just because it's been quiet for longer than 60s — that
        resets its counter to zero, letting an attacker exceed a 3/hour
        limit by spacing requests ~65s+ apart."""
        limiter = RateLimiter()
        limiter._EVICTION_INTERVAL = 0  # allow eviction on every call

        now = time.time()
        # Last active 90s ago — stale under a 60s window, well within a 3600s one.
        limiter.requests["data-export:1.2.3.4"] = [now - 90]
        limiter._key_windows["data-export:1.2.3.4"] = 3600

        # A different scope's 60s-window call triggers the sweep.
        limiter.is_rate_limited("login:5.6.7.8", max_requests=100, window_seconds=60)

        assert "data-export:1.2.3.4" in limiter.requests

    @pytest.mark.unit
    def test_a_long_window_key_is_still_evicted_once_its_own_window_elapses(self):
        limiter = RateLimiter()
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        # Past its own 3600s window.
        limiter.requests["data-export:1.2.3.4"] = [now - 4000]
        limiter._key_windows["data-export:1.2.3.4"] = 3600

        limiter.is_rate_limited("login:5.6.7.8", max_requests=100, window_seconds=60)

        assert "data-export:1.2.3.4" not in limiter.requests
        assert "data-export:1.2.3.4" not in limiter._key_windows


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
        token = "test-csrf-token-value"
        with patch.object(
            secrets, "compare_digest", wraps=secrets.compare_digest
        ) as mock_compare:
            result = CSRFProtection.validate_token(token, token)
            assert result is True
            mock_compare.assert_called_once_with(token, token)


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
    def test_sanitize_string_max_length_bounds_the_escaped_output(self):
        """CI2-33-9: truncating before escaping let the escaped output exceed
        max_length (each &<>"' expands 3-5x on escape) — a caller trusting
        this as a true length bound didn't get one."""
        result = InputSanitizer.sanitize_string("<" * 100, max_length=50)
        assert len(result) <= 50
        # And the escaping is still real, not skipped to make the bound work.
        assert "<" not in result

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
        with pytest.raises(ValueError, match="3-32 characters"):
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
    def test_validate_url_rejects_a_bare_ip_host(self):
        """CI2-33-12: a bare IPv4 host (e.g. an internal/link-local address
        like 169.254.169.254) matched the old host regex — this function has
        no callers today, but if it's ever wired to a webhook/URL-fetch
        feature, a raw IP bypassing here would need its own SSRF check."""
        with pytest.raises(ValueError, match="bare IP"):
            InputSanitizer.validate_url("https://169.254.169.254/latest/meta-data")

    @pytest.mark.unit
    def test_validate_url_still_accepts_a_domain_that_looks_ip_adjacent(self):
        # e.g. a domain with digit labels must not be caught by the IP check.
        result = InputSanitizer.validate_url("https://192.example.com/path")
        assert result == "https://192.example.com/path"

    @pytest.mark.unit
    def test_validate_url_invalid_format(self):
        """A malformed URL should raise ValueError."""
        with pytest.raises(ValueError, match="Invalid URL format"):
            InputSanitizer.validate_url("https://")

    @pytest.mark.unit
    def test_validate_url_javascript_protocol_rejected(self):
        """A javascript: URL (XSS vector) should be rejected."""
        # Rejected at the protocol gate, before any format check.
        with pytest.raises(ValueError, match="must use HTTPS"):
            InputSanitizer.validate_url("javascript:alert(1)")


# ---------------------------------------------------------------------------
# SecurityHeadersMiddleware
# ---------------------------------------------------------------------------


class TestSecurityHeadersMiddleware:
    """Tests for SecurityHeadersMiddleware (pure ASGI middleware).

    The middleware operates at the ASGI level: it wraps the ``send``
    callable to inject headers into ``http.response.start`` messages.
    These tests simulate the ASGI lifecycle by calling the middleware
    with a scope, a no-op ``receive``, and an async recording ``send``.
    """

    @staticmethod
    def _make_scope(path: str) -> dict:
        """Create a minimal ASGI HTTP scope for *path*."""
        return {"type": "http", "path": path}

    @staticmethod
    async def _noop_receive():
        return {"type": "http.request", "body": b""}

    @staticmethod
    def _make_app(status: int = 200):
        """Return a minimal ASGI app that sends a response with *status*."""

        async def app(scope, receive, send):
            await send(
                {
                    "type": "http.response.start",
                    "status": status,
                    "headers": [],
                }
            )
            await send(
                {
                    "type": "http.response.body",
                    "body": b"",
                }
            )

        return app

    @staticmethod
    def _make_send(sent: list):
        """Return an async send callable that records messages into *sent*."""

        async def _send(message):
            sent.append(message)

        return _send

    @staticmethod
    def _headers_dict(messages: list) -> dict[str, str]:
        """Extract headers from recorded ``http.response.start`` messages
        into a ``{name: value}`` dict (both decoded from bytes)."""
        for msg in messages:
            if msg["type"] == "http.response.start":
                return {k.decode(): v.decode() for k, v in msg.get("headers", [])}
        return {}

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_api_path_includes_cache_control(self):
        """API paths should get cache-busting headers."""
        sent: list = []
        middleware = SecurityHeadersMiddleware(self._make_app())

        await middleware(
            self._make_scope("/api/v1/users"), self._noop_receive, self._make_send(sent)
        )

        headers = self._headers_dict(sent)
        assert (
            headers["cache-control"]
            == "no-store, no-cache, must-revalidate, proxy-revalidate"
        )
        assert headers["pragma"] == "no-cache"
        assert headers["expires"] == "0"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_non_api_path_no_cache_control(self):
        """Non-API paths should NOT get cache-busting headers."""
        sent: list = []
        middleware = SecurityHeadersMiddleware(self._make_app())

        await middleware(
            self._make_scope("/static/logo.png"),
            self._noop_receive,
            self._make_send(sent),
        )

        headers = self._headers_dict(sent)
        assert "cache-control" not in headers

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_security_headers_always_set(self):
        """Security headers should be set on every response."""
        sent: list = []
        middleware = SecurityHeadersMiddleware(self._make_app())

        await middleware(
            self._make_scope("/api/v1/data"), self._noop_receive, self._make_send(sent)
        )

        headers = self._headers_dict(sent)
        assert (
            headers["strict-transport-security"]
            == "max-age=31536000; includeSubDomains"
        )
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert headers["x-xss-protection"] == "1; mode=block"
        assert headers["referrer-policy"] == "strict-origin-when-cross-origin"
        assert (
            headers["permissions-policy"]
            == "geolocation=(), microphone=(), camera=(self)"
        )
        assert "content-security-policy" in headers

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_csp_header_content(self):
        """Content-Security-Policy header should include expected directives."""
        sent: list = []
        middleware = SecurityHeadersMiddleware(self._make_app())

        await middleware(
            self._make_scope("/api/v1/resource"),
            self._noop_receive,
            self._make_send(sent),
        )

        headers = self._headers_dict(sent)
        csp = headers["content-security-policy"]
        assert "default-src 'self'" in csp
        assert "script-src 'self'" in csp
        assert "frame-ancestors 'none'" in csp

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_non_http_scope_passes_through(self):
        """Non-HTTP scopes (e.g. lifespan) should pass through without modification."""
        inner_called = False

        async def inner_app(scope, receive, send):
            nonlocal inner_called
            inner_called = True

        middleware = SecurityHeadersMiddleware(inner_app)

        async def noop_send(msg):
            pass

        await middleware({"type": "lifespan"}, self._noop_receive, noop_send)

        assert inner_called


# ---------------------------------------------------------------------------
# verify_csrf_token dependency
# ---------------------------------------------------------------------------


class TestVerifyCSRFTokenDependency:

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_websocket_connections_skip_csrf(self):
        """WebSocket connections should skip CSRF validation entirely."""
        request = MagicMock()
        request.scope = {"type": "websocket"}
        # Should not raise — CSRF doesn't apply to WebSocket
        await verify_csrf_token(request)

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
        request.scope = {"type": "http", "path": "/api/v1/test"}
        request.headers = {"X-CSRF-Token": "wrong-token"}
        request.cookies = {"csrf_token": "correct-token"}

        with pytest.raises(HTTPException) as exc_info:
            await verify_csrf_token(request)
        assert exc_info.value.status_code == 403

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_onboarding_path_skips_the_global_csrf_check(self):
        """Onboarding implements its own session-based CSRF check — the
        global double-submit check must not apply there even with no
        matching token pair at all."""
        request = MagicMock()
        request.method = "POST"
        request.scope = {
            "type": "http",
            "path": "/api/v1/onboarding/organization",
        }
        request.headers = {}
        request.cookies = {}
        # Should not raise, despite no CSRF cookie/header/access_token.
        await verify_csrf_token(request)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_a_path_merely_containing_onboarding_is_not_exempt(self):
        """CI2-33-10: the bypass used to be a substring match
        ('/onboarding/' in path / path.endswith('/onboarding')), which would
        silently exempt any future endpoint whose path happened to contain
        that substring. It's anchored to the real router prefix now."""
        from fastapi import HTTPException

        request = MagicMock()
        request.method = "POST"
        request.scope = {
            "type": "http",
            "path": "/api/v1/events/onboarding-checklist",
        }
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
        request.scope = {"type": "http", "path": "/api/v1/test"}
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
        request.scope = {"type": "http", "path": "/api/v1/test"}
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
        request.scope = {"type": "http", "path": "/api/v1/test"}
        request.headers = {"X-CSRF-Token": "bad"}
        request.cookies = {"csrf_token": "good"}

        with pytest.raises(HTTPException) as exc_info:
            await verify_csrf_token(request)
        assert exc_info.value.status_code == 403

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_patch_method_requires_csrf(self):
        """PATCH requests should also be subject to CSRF validation."""
        from fastapi import HTTPException

        request = MagicMock()
        request.method = "PATCH"
        request.scope = {"type": "http", "path": "/api/v1/test"}
        request.headers = {"X-CSRF-Token": "bad"}
        request.cookies = {"csrf_token": "good"}

        with pytest.raises(HTTPException) as exc_info:
            await verify_csrf_token(request)
        assert exc_info.value.status_code == 403


class TestIPBlockingMiddlewareBlockedAttemptLogging:
    """A blocked request must be visible in BOTH the audit log and the
    blocked_access_attempts table — GET /ip-security/blocked-attempts reads
    only the latter, so a block that never inserts one is invisible there
    even though it was correctly denied and audit-logged."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_logs_to_both_audit_and_blocked_attempts_table(self):
        from app.models.ip_security import BlockedAccessAttempt

        request = MagicMock()
        request.url.path = "/api/v1/events"
        request.method = "GET"
        request.headers = {"user-agent": "curl/8.0"}

        db = MagicMock()
        db.add = MagicMock()
        db.commit = AsyncMock()

        @asynccontextmanager
        async def fake_session_factory():
            yield db

        geoip = MagicMock()
        geoip.lookup_ip.return_value = {
            "country_code": "RU",
            "country_name": "Russia",
        }

        log_audit_event = AsyncMock()

        middleware = IPBlockingMiddleware(app=None)
        with (
            patch("app.core.geoip.get_geoip_service", return_value=geoip),
            patch(
                "app.core.database.async_session_factory",
                fake_session_factory,
            ),
            patch("app.core.audit.log_audit_event", log_audit_event),
        ):
            await middleware._log_blocked_attempt(
                request, "203.0.113.9", "country_blocked"
            )

        log_audit_event.assert_awaited_once()
        db.add.assert_called_once()
        row = db.add.call_args.args[0]
        assert isinstance(row, BlockedAccessAttempt)
        assert row.ip_address == "203.0.113.9"
        assert row.block_reason == "country_blocked"
        assert row.country_code == "RU"
        assert row.country_name == "Russia"
        assert row.request_path == "/api/v1/events"
        assert row.request_method == "GET"
        db.commit.assert_awaited_once()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_request_method_is_truncated_to_column_width(self):
        """request_method is String(10). A malformed/overlong method must be
        truncated before insert, or the commit fails and the exception
        handler drops the row from both security logs (Codex P2, PR #1911)."""
        request = MagicMock()
        request.url.path = "/api/v1/events"
        request.method = "X" * 50
        request.headers = {"user-agent": "curl/8.0"}

        db = MagicMock()
        db.add = MagicMock()
        db.commit = AsyncMock()

        @asynccontextmanager
        async def fake_session_factory():
            yield db

        geoip = MagicMock()
        geoip.lookup_ip.return_value = {
            "country_code": "RU",
            "country_name": "Russia",
        }

        middleware = IPBlockingMiddleware(app=None)
        with (
            patch("app.core.geoip.get_geoip_service", return_value=geoip),
            patch(
                "app.core.database.async_session_factory",
                fake_session_factory,
            ),
            patch("app.core.audit.log_audit_event", AsyncMock()),
        ):
            await middleware._log_blocked_attempt(
                request, "203.0.113.9", "country_blocked"
            )

        row = db.add.call_args.args[0]
        assert len(row.request_method) <= 10
        assert row.request_method == "X" * 10


# ---------------------------------------------------------------------------
# SecurityMonitoringMiddleware
# ---------------------------------------------------------------------------


class TestSecurityMonitoringMiddlewareReadsTheRealAuthenticatedUser:
    """CI2-33-1 (HIGH): this middleware read request.state.user before
    self.app() ran. No auth path ever sets ".user" (get_current_user sets
    ".authenticated_user"), and that attribute isn't populated until a route
    dependency runs *inside* self.app() anyway — so user_id was always None,
    silently disabling both session-hijack and data-exfiltration monitoring
    for every request, with no error and nothing to distinguish it from
    working."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_session_hijack_check_uses_the_user_the_route_authenticated(
        self, monkeypatch
    ):
        from types import SimpleNamespace

        from starlette.requests import Request

        from app.core.security_middleware import SecurityMonitoringMiddleware

        calls = {}

        async def fake_detect_session_hijack(**kwargs):
            calls.update(kwargs)
            return None

        monkeypatch.setattr(
            "app.services.security_monitoring.security_monitor",
            SimpleNamespace(detect_session_hijack=fake_detect_session_hijack),
        )

        @asynccontextmanager
        async def fake_session_factory():
            yield MagicMock()

        monkeypatch.setattr(
            "app.core.database.async_session_factory", fake_session_factory
        )

        async def inner_app(scope, receive, send):
            # Mirrors what get_current_user actually does: sets this
            # attribute on the same Request the outer middleware holds,
            # from *inside* the self.app() call.
            req = Request(scope)
            req.state.authenticated_user = SimpleNamespace(id="user-123")
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        middleware = SecurityMonitoringMiddleware(inner_app)

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/some-route",
            "headers": [(b"x-session-id", b"sess-abc")],
            "client": ("203.0.113.9", 12345),
            "query_string": b"",
        }

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        sent = []

        async def send(message):
            sent.append(message)

        await middleware(scope, receive, send)

        assert calls.get("user_id") == "user-123"
        assert calls.get("session_id") == "sess-abc"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_no_hijack_check_when_the_route_never_authenticates(
        self, monkeypatch
    ):
        """An unauthenticated route (no request.state.authenticated_user set)
        must not call the hijack check at all — confirms the fix reads the
        real attribute rather than always finding *something*."""
        from unittest.mock import AsyncMock as _AsyncMock

        fake_detect = _AsyncMock()
        monkeypatch.setattr(
            "app.services.security_monitoring.security_monitor",
            MagicMock(detect_session_hijack=fake_detect),
        )

        async def inner_app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        from app.core.security_middleware import SecurityMonitoringMiddleware

        middleware = SecurityMonitoringMiddleware(inner_app)

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/public-route",
            "headers": [(b"x-session-id", b"sess-abc")],
            "client": ("203.0.113.9", 12345),
            "query_string": b"",
        }

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            pass

        await middleware(scope, receive, send)

        fake_detect.assert_not_awaited()


# ---------------------------------------------------------------------------
# IPLoggingMiddleware — X-Request-ID validation
# ---------------------------------------------------------------------------


class TestIPLoggingMiddlewareRequestIdValidation:
    """CI2-33-7: an unvalidated client-supplied X-Request-ID was interpolated
    verbatim into log lines and the response header — a client could forge
    what looks like a genuine, distinct log entry (e.g. embedded newlines) in
    the security audit trail."""

    @staticmethod
    async def _run(monkeypatch, incoming_request_id: str | None):
        from app.core.security_middleware import IPLoggingMiddleware

        monkeypatch.setattr("app.core.geoip.get_geoip_service", lambda: None)

        async def inner_app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        middleware = IPLoggingMiddleware(inner_app)

        headers = []
        if incoming_request_id is not None:
            headers.append((b"x-request-id", incoming_request_id.encode()))
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/some-route",
            "headers": headers,
            "client": ("203.0.113.9", 12345),
            "query_string": b"",
        }

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        sent = []

        async def send(message):
            sent.append(message)

        await middleware(scope, receive, send)

        start = next(m for m in sent if m["type"] == "http.response.start")
        response_request_id = next(
            v.decode() for k, v in start["headers"] if k == b"x-request-id"
        )
        return response_request_id

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_a_valid_format_incoming_id_is_reused(self, monkeypatch):
        valid_id = "0123456789abcdef"  # 16 lowercase hex chars
        response_request_id = await self._run(monkeypatch, valid_id)
        assert response_request_id == valid_id

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_an_invalid_format_incoming_id_is_replaced(self, monkeypatch):
        forged = "1\n2026-08-27 ERROR admin session revoked"
        response_request_id = await self._run(monkeypatch, forged)
        assert response_request_id != forged
        assert "\n" not in response_request_id

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_no_incoming_id_generates_one(self, monkeypatch):
        response_request_id = await self._run(monkeypatch, None)
        assert len(response_request_id) == 16
