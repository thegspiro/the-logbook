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
    _KeyState,
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
        rate_limiter._keys.pop(key, None)
        try:
            results = [
                await public_rate_limit(key, max_requests=2, window_seconds=60)
                for _ in range(3)
            ]
        finally:
            rate_limiter._keys.pop(key, None)

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
        rate_limiter._keys.pop(key, None)

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
            rate_limiter._keys.pop(key, None)

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
        limiter._keys[key].lockout_until = time.time() - 1

        is_limited, reason = limiter.is_rate_limited(
            key, max_requests=5, window_seconds=60
        )
        assert is_limited is False
        assert reason is None

    @pytest.mark.unit
    def test_zero_lockout_does_not_reset_the_window(self):
        """Codex, PR #2106: public_rate_limit's in-memory fallback calls with
        lockout_seconds=0 for several unauthenticated public endpoints
        (calendar, legal, display, finance-approval tokens, three webhook
        receivers). A lockout of 0 reads as already-expired on the very next
        call — if that also wiped the request history, an attacker would get
        a full fresh allowance every max_requests+1'th request, defeating
        the window almost entirely instead of just skipping the cool-down
        period."""
        limiter = RateLimiter()
        key = "ip-zero-lockout"
        results = [
            limiter.is_rate_limited(
                key, max_requests=5, window_seconds=60, lockout_seconds=0
            )[0]
            for _ in range(10)
        ]
        # Buggy behaviour resets on the very next call after tripping the
        # limit: [F,F,F,F,F, T,F,F,F,F] — a full new allowance every 6th
        # call. Fixed behaviour stays limited once the window is full.
        assert results == [False] * 5 + [True] * 5

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
        limiter._keys[key] = _KeyState(request_times=[old_time] * 5, window_seconds=60)

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
        # Insert 8 keys with staggered timestamps so oldest can be identified.
        # window_seconds=200 matches the trigger call's own window below, so
        # none of these are individually "stale" (they're all <100s old) —
        # this isolates the by-recency MAX_KEYS mechanism from the separate
        # per-key staleness check.
        for i in range(8):
            key = f"ip-max-{i}"
            limiter._keys[key] = _KeyState(
                request_times=[now - 100 + i], window_seconds=200
            )

        # Trigger eviction by calling is_rate_limited (which calls _sweep)
        limiter.is_rate_limited("ip-trigger", max_requests=100, window_seconds=200)

        # Should have at most _MAX_KEYS (5) keys, plus the trigger key = 6 max,
        # but since _sweep runs before the new request is recorded,
        # the oldest 3 keys (ip-max-0, ip-max-1, ip-max-2) should be evicted.
        assert len(limiter._keys) <= limiter._MAX_KEYS + 1
        # The oldest keys should be gone
        assert "ip-max-0" not in limiter._keys
        assert "ip-max-1" not in limiter._keys
        assert "ip-max-2" not in limiter._keys
        # The newest should remain
        assert "ip-max-7" in limiter._keys

    @pytest.mark.unit
    def test_max_keys_eviction_never_touches_an_actively_locked_out_key(self):
        """Force-eviction by MAX_KEYS must skip every key with an active
        lockout, no matter how stale its request history looks — an active
        lockout is a security decision already made, and evicting it early
        (even just to make room under key-count pressure) lets a locked-out
        attacker back in ahead of schedule. This is the invariant the old
        three-dict design needed a dedicated "don't also pop self.lockouts"
        step to preserve (CI3-33-1); under the unified _KeyState model it
        holds by construction — the eviction pool for MAX_KEYS pressure
        excludes any record with an unexpired lockout_until entirely, so
        the total tracked key count can exceed _MAX_KEYS by up to
        _MAX_LOCKOUTS worth of actively-locked-out records that the
        by-recency mechanism is not permitted to touch."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 3
        limiter._MAX_LOCKOUTS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        for i in range(6):
            key = f"ip-lock-{i}"
            limiter._keys[key] = _KeyState(
                request_times=[now - 100 + i],
                window_seconds=60,
                lockout_until=now + 3600,
            )
        limiter._active_lockout_count = 6

        # Trigger eviction — 6 keys is well over _MAX_KEYS=3, but all 6 are
        # actively locked out, so none are evictable by recency.
        limiter.is_rate_limited("ip-lock-trigger", max_requests=100, window_seconds=200)

        for i in range(6):
            key = f"ip-lock-{i}"
            assert key in limiter._keys
            assert limiter._keys[key].lockout_until == now + 3600

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
        limiter._keys["stale-key"] = _KeyState(
            request_times=[old_time], window_seconds=60
        )

        # Eviction should be skipped (interval not elapsed, under _MAX_KEYS)
        limiter.is_rate_limited("new-key", max_requests=5, window_seconds=60)
        assert "stale-key" in limiter._keys

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
            limiter._keys[f"over-{i}"] = _KeyState(
                request_times=[now - 50 + i], window_seconds=60
            )

        # Despite interval not elapsed, should evict because over _MAX_KEYS
        limiter.is_rate_limited("trigger", max_requests=100, window_seconds=60)
        assert len(limiter._keys) <= limiter._MAX_KEYS + 1

    @pytest.mark.unit
    def test_is_rate_limited_records_the_callers_window_for_the_key(self):
        limiter = RateLimiter()
        limiter.is_rate_limited(
            "data-export:1.2.3.4", max_requests=3, window_seconds=3600
        )
        assert limiter._keys["data-export:1.2.3.4"].window_seconds == 3600

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
        limiter._keys["data-export:1.2.3.4"] = _KeyState(
            request_times=[now - 90], window_seconds=3600
        )

        # A different scope's 60s-window call triggers the sweep.
        limiter.is_rate_limited("login:5.6.7.8", max_requests=100, window_seconds=60)

        assert "data-export:1.2.3.4" in limiter._keys

    @pytest.mark.unit
    def test_a_long_window_key_is_still_evicted_once_its_own_window_elapses(self):
        limiter = RateLimiter()
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        # Past its own 3600s window.
        limiter._keys["data-export:1.2.3.4"] = _KeyState(
            request_times=[now - 4000], window_seconds=3600
        )

        limiter.is_rate_limited("login:5.6.7.8", max_requests=100, window_seconds=60)

        assert "data-export:1.2.3.4" not in limiter._keys

    @pytest.mark.unit
    def test_a_calling_keys_own_history_survives_its_own_forced_eviction(self):
        """CI3-33-2: the MAX_KEYS forced eviction in _sweep ranks every
        tracked key by its *last recorded* request time, and previously ran
        before this call's own read of its own record — so if this exact
        key's last activity happened to be the globally-oldest among an
        over-cap tracker (plausible for a long-window scope sitting next to
        a flood of short-window ones), its own call could wipe its own
        history right before reading it, undercounting the request and
        silently granting extra allowance. The read must be captured before
        the sweep runs and the result written back explicitly afterward."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        # "target" already has 2 prior requests but is the globally-oldest
        # tracked key (its own window is long enough that it isn't stale).
        limiter._keys["target"] = _KeyState(
            request_times=[now - 50, now - 49], window_seconds=200
        )
        for i in range(4):
            limiter._keys[f"other-{i}"] = _KeyState(
                request_times=[now - 10 + i], window_seconds=200
            )

        # 3rd request (2 prior + this) is still within a cap of 3 — allowed,
        # but the history must be preserved, not reset to just this one call.
        is_limited, _ = limiter.is_rate_limited(
            "target", max_requests=3, window_seconds=200
        )
        assert is_limited is False
        assert len(limiter._keys["target"].request_times) == 3

        # The 4th request must now be blocked — it would incorrectly be
        # allowed if the 3rd call's own eviction pass had wiped its history.
        is_limited2, _ = limiter.is_rate_limited(
            "target", max_requests=3, window_seconds=200
        )
        assert is_limited2 is True

    @pytest.mark.unit
    def test_an_active_lockout_survives_a_forced_eviction_triggered_by_another_key(
        self,
    ):
        """CI3-33-1: the MAX_KEYS forced eviction loop unconditionally popped
        the lockout entry for every key it evicted by request-history
        recency — with no regard for whether that lockout was still active,
        and regardless of which key's call actually triggered the sweep. An
        attacker's lockout could therefore be silently lifted early by
        unrelated traffic from other keys pushing the tracker over
        _MAX_KEYS, well before the lockout's own expiry. Evicting the
        request-history portion of a locked-out key's record is harmless
        (is_rate_limited returns on the lockout check before ever reading
        request_times) — only the lockout itself matters, and it must
        survive until it naturally expires. Under the unified model this
        holds structurally: a record with an active lockout is entirely
        excluded from the by-recency eviction pool, not just partially
        protected."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        # "attacker" is already locked out for a while longer, but its last
        # recorded request (from before the lockout) is the globally-oldest
        # entry in the tracker.
        limiter._keys["attacker"] = _KeyState(
            request_times=[now - 100], window_seconds=60, lockout_until=now + 1700
        )
        limiter._active_lockout_count = 1
        for i in range(4):
            limiter._keys[f"other-{i}"] = _KeyState(
                request_times=[now - 10 + i], window_seconds=60
            )

        # An unrelated key's call triggers the over-cap eviction sweep.
        limiter.is_rate_limited("victim-check", max_requests=100, window_seconds=200)

        assert "attacker" in limiter._keys
        assert limiter._keys["attacker"].lockout_until == now + 1700
        is_limited, reason = limiter.is_rate_limited(
            "attacker", max_requests=5, window_seconds=60
        )
        assert is_limited is True
        assert "locked" in (reason or "").lower()

    @pytest.mark.unit
    def test_a_calling_keys_own_window_metadata_survives_its_own_forced_eviction(
        self,
    ):
        """CI3-33-1a (Codex review of PR #2368): CI3-33-2's fix restores a
        forced-evicted key's *request history* by capturing it before the
        sweep runs, but the old three-dict design's forced-eviction loop
        also popped the key's separately-tracked window metadata, and
        nothing restored that — a key whose window metadata went missing
        this way got judged, on the *next* sweep, against whichever
        window_seconds happened to trigger that later sweep (CI2-33-2's
        exact bug, reintroduced by omission). Under the unified _KeyState
        model, window_seconds travels in the same record as request_times,
        so the read-before/write-after-sweep capture that protects request
        history automatically protects the window too — there is no
        separate metadata to forget."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        limiter._keys["target"] = _KeyState(request_times=[now - 50], window_seconds=60)
        for i in range(4):
            limiter._keys[f"other-{i}"] = _KeyState(
                request_times=[now - 10 + i], window_seconds=60
            )

        # "target"'s own call, with a long (3600s) window, forces eviction
        # (over _MAX_KEYS) — which would remove "target"'s whole record
        # unless the read-before/write-after-sweep capture restores it.
        limiter.is_rate_limited("target", max_requests=100, window_seconds=3600)
        assert limiter._keys.get("target") is not None
        assert limiter._keys["target"].window_seconds == 3600

        # Isolate the *individual staleness* mechanism from the unrelated
        # forced-by-recency eviction by raising the cap so the latter can't
        # fire on the next sweep.
        limiter._MAX_KEYS = 10_000
        now2 = time.time()
        # "target" quiet for 65s — stale under a 60s window, well within its
        # real 3600s one. Mutate in place so the window set above (3600)
        # persists, matching what a real caller reusing "target"'s own
        # scope would see.
        limiter._keys["target"].request_times = [now2 - 65]
        limiter._last_eviction = 0.0
        limiter.is_rate_limited("login:5.6.7.8", max_requests=100, window_seconds=60)

        assert "target" in limiter._keys
        assert len(limiter._keys["target"].request_times) > 0

    @pytest.mark.unit
    def test_lockouts_are_capped_independently_of_requests(self):
        """CI3-33-1b/1c (Codex review of PR #2368): CI3-33-1 stopped the
        request-eviction path from also releasing active lockouts, which
        fixed the early-unlock bug — but that had been the *only* thing
        bounding how many active lockouts could accumulate. Decoupled, a
        flood of distinct keys each tripping the lockout (e.g. during a
        Redis outage, this limiter's exact fallback window) could grow
        unboundedly for the full lockout duration — CLAUDE.md Pitfall #9's
        shape. Capped at insertion time by _MAX_LOCKOUTS — never by
        evicting an existing entry, so the count can never exceed the cap
        even by one."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 100
        limiter._MAX_LOCKOUTS = 100
        limiter._EVICTION_INTERVAL = 0

        for i in range(500):
            limiter.is_rate_limited(
                f"attacker-{i}", max_requests=1, window_seconds=60, lockout_seconds=1800
            )
            limiter.is_rate_limited(
                f"attacker-{i}", max_requests=1, window_seconds=60, lockout_seconds=1800
            )

        active_lockouts = sum(
            1
            for st in limiter._keys.values()
            if st.lockout_until is not None and st.lockout_until > time.time()
        )
        assert active_lockouts <= limiter._MAX_LOCKOUTS

    @pytest.mark.unit
    def test_an_already_persisted_lockout_is_never_evicted_once_saturated(self):
        """CI3-33-1b: once the active-lockout cap is reached, the FIRST
        attackers to have been locked out (persisted before saturation)
        must keep their lockouts for the rest of a sustained flood — the
        cap must bind *new* insertions, never bump an existing active
        lockout to make room."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 100
        limiter._MAX_LOCKOUTS = 100
        limiter._EVICTION_INTERVAL = 0

        for i in range(500):
            limiter.is_rate_limited(
                f"attacker-{i}", max_requests=1, window_seconds=60, lockout_seconds=1800
            )
            limiter.is_rate_limited(
                f"attacker-{i}", max_requests=1, window_seconds=60, lockout_seconds=1800
            )

        # The first 100 attackers were persisted before the table saturated
        # — none of them should have been displaced by the 400 that came
        # after.
        now = time.time()
        assert all(
            f"attacker-{i}" in limiter._keys
            and limiter._keys[f"attacker-{i}"].lockout_until is not None
            and limiter._keys[f"attacker-{i}"].lockout_until > now
            for i in range(100)
        )

    @pytest.mark.unit
    def test_an_active_lockout_is_never_evicted_by_an_unrelated_keys_sweep(self):
        """CI3-33-1c (Codex review of PR #2368, correcting CI3-33-1b's own
        fix): CI3-33-1b's first attempt at bounding active lockouts evicted
        the soonest-to-expire entries once over the cap. That protected the
        *calling* key's own lockout (via read-before-evict) but not anyone
        else's — an unrelated key's own over-cap call could still pick a
        genuinely different, currently locked-out victim's entry for
        eviction, silently releasing an active lockout early. Reproduced by
        Codex: with the victim's request history also evicted by the
        unrelated MAX_KEYS sweep in the same call, victim's very next
        request came back (False, None) — not rate limited, mid-lockout. An
        active lockout must never be evicted for size, only for having
        genuinely expired."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        # "victim" is locked out and has request history, but is NOT the key
        # making the triggering call below.
        limiter._keys["victim"] = _KeyState(
            request_times=[now - 100], window_seconds=60, lockout_until=now + 5
        )
        for i in range(4):
            limiter._keys[f"other-{i}"] = _KeyState(
                request_times=[now - 10 + i],
                window_seconds=60,
                lockout_until=now + 1000 + i,
            )
        limiter._active_lockout_count = 5

        # An unrelated key's call triggers the over-cap sweep.
        limiter.is_rate_limited("trigger-key", max_requests=100, window_seconds=60)

        assert "victim" in limiter._keys
        assert limiter._keys["victim"].lockout_until == now + 5

        is_limited, reason = limiter.is_rate_limited(
            "victim", max_requests=5, window_seconds=60, lockout_seconds=1800
        )
        assert is_limited is True
        assert "locked" in (reason or "").lower()

    @pytest.mark.unit
    def test_a_saturated_lockout_table_fails_closed_without_evicting_anyone(self):
        """CI3-33-1c: once the active-lockout cap is genuinely reached, a
        *new* key that trips the limit is still rejected this call (the
        count-based check already decided that on its own merits) but its
        lockout is simply not persisted — the existing entries are left
        completely untouched rather than one being bumped to make room."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        limiter._keys["existing-1"] = _KeyState(
            window_seconds=60, lockout_until=now + 1000
        )
        limiter._keys["existing-2"] = _KeyState(
            window_seconds=60, lockout_until=now + 1000
        )
        limiter._keys["existing-3"] = _KeyState(
            window_seconds=60, lockout_until=now + 1000
        )
        limiter._active_lockout_count = 3

        # First call for "new-violator" is allowed (establishes 1 request in
        # its window); the second exceeds max_requests=1 and should trip a
        # lockout it can't persist, since the table is already saturated.
        limiter.is_rate_limited(
            "new-violator", max_requests=1, window_seconds=60, lockout_seconds=1800
        )
        is_limited, reason = limiter.is_rate_limited(
            "new-violator", max_requests=1, window_seconds=60, lockout_seconds=1800
        )

        # Rejected this call regardless of whether the lockout could be
        # persisted.
        assert is_limited is True
        # But the table is untouched — no existing lockout was evicted.
        for k in ("existing-1", "existing-2", "existing-3"):
            assert limiter._keys[k].lockout_until == now + 1000
        assert (
            "new-violator" not in limiter._keys
            or limiter._keys["new-violator"].lockout_until is None
        )

    @pytest.mark.unit
    def test_key_count_stays_bounded_by_max_keys_plus_max_lockouts_under_locked_out_retries(
        self,
    ):
        """CI3-33-1d's original finding (self._key_windows growing
        unbounded from locked-out retries) described a defect specific to
        the old three-dict design: window metadata was tracked separately
        from lockout status, so a key that was only ever locked out — never
        separately over its own request count — left a permanent orphaned
        window entry with nothing to evict it. Under the unified _KeyState
        model that specific failure mode is structurally impossible: window
        metadata lives in the same record as lockout status, so there is no
        third structure to leak independently. What this test now verifies
        is the equivalent, real invariant for the new design: a flood of
        distinct already-locked-out keys, each retrying once, must not grow
        self._keys past the combined bound (_MAX_KEYS non-locked-out
        records, plus up to _MAX_LOCKOUTS actively-locked-out ones that the
        by-recency eviction pool is not permitted to touch)."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 50
        limiter._MAX_LOCKOUTS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        for i in range(2000):
            key = f"attacker-{i}"
            limiter._keys[key] = _KeyState(window_seconds=60, lockout_until=now + 1800)
        limiter._active_lockout_count = 2000

        for i in range(2000):
            key = f"attacker-{i}"
            limiter.is_rate_limited(
                key, max_requests=5, window_seconds=60, lockout_seconds=1800
            )

        # A retry against an already-active lockout returns early without
        # writing anything new — self._keys should hold exactly the 2000
        # pre-existing records, no more, and well within the combined bound.
        assert len(limiter._keys) == 2000
        assert len(limiter._keys) <= limiter._MAX_KEYS + limiter._MAX_LOCKOUTS

    @pytest.mark.unit
    def test_active_lockouts_saturating_max_keys_do_not_starve_unlocked_histories(
        self,
    ):
        """P1 (Codex review of the structural refactor, round 9): _sweep's
        forced eviction sized `to_remove` off `len(self._keys) -
        self._MAX_KEYS` — the *combined* total, including active lockouts
        — rather than off how many evictable (non-actively-locked-out)
        records actually exceed `_MAX_KEYS`. `_MAX_KEYS` and
        `_MAX_LOCKOUTS` share the same default (10,000), so once active
        lockouts alone fill the table, `_MAX_KEYS` has no headroom left
        for an ordinary request history at all: any unlocked entry just
        written gets evicted on the very next call to `is_rate_limited`
        for *any* key, before it can ever accumulate enough history to
        trip its own `max_requests`. Two keys alternating one request
        each then each see an empty history on every call, so neither
        ever reaches its limit no matter how many requests either sends
        — the count-based check is silently defeated for as long as
        lockouts stay saturated, exactly when the fallback needs to hold.

        Reproduces directly: `_MAX_KEYS = _MAX_LOCKOUTS = 10` (all active),
        two unrelated keys alternate one request each with
        `max_requests=3`. Verified to **fail** against the pre-fix code
        (20 requests, 0 ever rejected) and **pass** after (both keys are
        rejected once they exceed 3 of their own requests)."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 10
        limiter._MAX_LOCKOUTS = 10
        limiter._EVICTION_INTERVAL = 60
        limiter._LOCKOUT_VERIFY_INTERVAL = 1.0

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            for i in range(10):
                limiter._keys[f"login:locked{i}"] = _KeyState(lockout_until=now + 1000)
            limiter._active_lockout_count = 10
            limiter._last_lockout_verify = now
            limiter._last_eviction = now

            results = []
            for i in range(20):
                scope = "scopeA" if i % 2 == 0 else "scopeB"
                is_limited, _ = limiter.is_rate_limited(
                    f"{scope}:attacker",
                    max_requests=3,
                    window_seconds=60,
                    lockout_seconds=600,
                )
                results.append(is_limited)

        assert any(results), "expected the count-based limit to eventually trigger"

    @pytest.mark.unit
    def test_over_capacity_retries_do_not_force_a_sweep_on_every_request(self):
        """Companion finding, same review round: writing an over-capacity
        violator's own record back into self._keys (needed so its own
        retries keep seeing their prior history — see the branch below)
        pushes len(self._keys) one past _MAX_KEYS whenever active lockouts
        already fill it. Before the fix, that alone kept `_sweep`'s
        `over_limit` gate permanently true, bypassing its throttle and
        re-running the full stale/evictable scan on every single retry
        from that one key, forever — a CPU-amplification DoS distinct
        from (but sharing the root cause of) the starvation bug above.

        Detects a real (non-throttled) sweep body execution by advancing
        the mocked clock a tiny amount each call (far below
        _EVICTION_INTERVAL) and checking whether _last_eviction was
        updated to that call's own timestamp."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 10_000
        limiter._MAX_LOCKOUTS = 10_000
        limiter._EVICTION_INTERVAL = 60
        limiter._LOCKOUT_VERIFY_INTERVAL = 1.0

        base = 1_000_000.0
        with patch("time.time", return_value=base):
            for i in range(10_000):
                limiter._keys[f"login:locked{i}"] = _KeyState(lockout_until=base + 1000)
            limiter._active_lockout_count = 10_000
            limiter._last_lockout_verify = base
            limiter._last_eviction = base

        real_sweeps = 0
        for i in range(1, 51):
            call_time = base + i * 0.001
            with patch("time.time", return_value=call_time):
                limiter.is_rate_limited(
                    "pub_form_submit:9.9.9.9",
                    max_requests=1,
                    window_seconds=60,
                    lockout_seconds=0,
                )
            if limiter._last_eviction == call_time:
                real_sweeps += 1

        assert real_sweeps == 0

    @pytest.mark.unit
    def test_a_saturated_table_violator_stays_rejected_past_its_own_window(self):
        """CI3-33-1e (Codex-caught, round 3): CI3-33-1c correctly stopped
        persisting a lockout once the active-lockout cap is saturated, but
        left the violator with *no* memory of the violation beyond its own
        request history's (much shorter) window_seconds — so a retry after
        the sliding window naturally clears, but long before
        lockout_seconds has elapsed, sailed through unlimited despite
        having just been told "Account locked for 30 minutes". Reproduced
        exactly as Codex described: with the lockouts table saturated, a
        violator's retry 61 seconds after a 60-second window returned
        (False, None)."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter._keys["existing-1"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["existing-2"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["existing-3"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._active_lockout_count = 3
            limiter.is_rate_limited(
                "violator", max_requests=1, window_seconds=60, lockout_seconds=1800
            )
            limiter.is_rate_limited(
                "violator", max_requests=1, window_seconds=60, lockout_seconds=1800
            )
        # table was saturated -- violator's own lockout not persisted
        assert limiter._keys["violator"].lockout_until is None

        with patch("time.time", return_value=now + 61):
            is_limited, reason = limiter.is_rate_limited(
                "violator", max_requests=1, window_seconds=60, lockout_seconds=1800
            )

        assert is_limited is True
        assert "locked" in (reason or "").lower()

    @pytest.mark.unit
    def test_saturation_fail_closed_does_not_affect_a_key_with_live_history(self):
        """CI3-33-1e: the saturation-reject signal must never intercept a
        key that has genuine, current in-window request history — only a
        key that would otherwise look like a fresh, no-evidence request
        (filtered_requests empty). Established with live history *before*
        saturation is triggered, then checked again while saturation is
        still active. Both keys share the "login" scope, so this is a
        same-scope check, not a by-product of CI3-33-2a's cross-scope
        isolation."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter._keys["login:existing-1"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:existing-2"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:existing-3"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._active_lockout_count = 3
            # legit-user establishes live history before any saturation
            # event has happened at all.
            limiter.is_rate_limited(
                "login:legit-user",
                max_requests=5,
                window_seconds=60,
                lockout_seconds=1800,
            )
            # A violator, same scope, trips saturation.
            limiter.is_rate_limited(
                "login:violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            limiter.is_rate_limited(
                "login:violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            assert limiter._saturation_reject_until.get("login", 0.0) > now

            # legit-user's second call, still comfortably within its own
            # 60s window, in the same instant saturation became active for
            # its own ("login") scope.
            is_limited, reason = limiter.is_rate_limited(
                "login:legit-user",
                max_requests=5,
                window_seconds=60,
                lockout_seconds=1800,
            )

        assert is_limited is False
        assert reason is None

    @pytest.mark.unit
    def test_saturation_fail_closed_decays_once_the_window_passes(self):
        """CI3-33-1e: the saturation-reject signal must not linger forever
        — once its scope's reject-until has passed, a key with no history
        is treated as an ordinary fresh request again. Both keys share the
        "login" scope, so this exercises decay within one scope, not
        CI3-33-2a's cross-scope isolation."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter._keys["login:existing-1"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:existing-2"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:existing-3"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._active_lockout_count = 3
            limiter.is_rate_limited(
                "login:violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            limiter.is_rate_limited(
                "login:violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            saturation_until = limiter._saturation_reject_until["login"]

        with patch("time.time", return_value=saturation_until + 1):
            is_limited, reason = limiter.is_rate_limited(
                "login:brand-new-key",
                max_requests=5,
                window_seconds=60,
                lockout_seconds=1800,
            )

        assert is_limited is False
        assert reason is None

    @pytest.mark.unit
    def test_saturation_reject_is_scoped_to_the_affected_rate_limit_scope(self):
        """CI3-33-2a (Codex review of PR #2368 after merge): the saturation
        reject signal was a single process-wide scalar on the shared
        rate_limiter instance that backs every scope (login, register,
        password-reset, token-refresh, password-change, and every
        public_rate_limit() caller). Saturating ONE scope's lockout table
        (e.g. a login-lockout flood during a Redis outage) then failed
        closed for every OTHER scope too — a self-inflicted,
        attacker-triggerable DoS across the whole app. Keys are built as
        f"{scope}:{identifier}" by every real caller (check_rate_limit,
        public_rate_limit); the fix scopes the reject signal to the prefix
        before the first ":"."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            # Saturate the "login" scope's lockout table.
            limiter._keys["login:1.2.3.4"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:1.2.3.5"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:1.2.3.6"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._active_lockout_count = 3
            limiter.is_rate_limited(
                "login:attacker",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            limiter.is_rate_limited(
                "login:attacker",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )

            # An unrelated scope, brand-new key, no live history, nothing
            # to do with the login flood.
            is_limited, reason = limiter.is_rate_limited(
                "pub_form_submit:9.9.9.9",
                max_requests=10,
                window_seconds=60,
                lockout_seconds=600,
            )

        assert is_limited is False
        assert reason is None

        with patch("time.time", return_value=now + 61):
            # The saturated scope itself must still fail closed — the fix
            # must not weaken same-scope protection while fixing isolation.
            is_limited, reason = limiter.is_rate_limited(
                "login:attacker",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
        assert is_limited is True
        assert "locked" in (reason or "").lower()

    @pytest.mark.unit
    def test_lockout_saturation_check_purges_expired_entries_first(self):
        """CI3-33-2b (Codex review of PR #2368 after merge): a stale count
        of active lockouts must not cause a false saturation rejection.
        Established via real insertions (rather than directly poking
        internal state) so the active-lockout counter is populated the way
        production traffic populates it, then time is advanced past their
        lockout_seconds so all 3 genuinely expire before the new violator's
        own attempt — the throttled _refresh_active_lockout_count is what
        keeps the cached count from staying stuck at 3 indefinitely (see
        test_saturated_lockout_table_does_not_force_a_full_sweep_for_every_request
        and test_round_7_retries_do_not_repeatedly_rescan_lockout_capacity
        for why this is throttled rather than done on every call)."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            for i in range(3):
                limiter.is_rate_limited(
                    f"login:existing-{i}",
                    max_requests=1,
                    window_seconds=60,
                    lockout_seconds=5,
                )
                limiter.is_rate_limited(
                    f"login:existing-{i}",
                    max_requests=1,
                    window_seconds=60,
                    lockout_seconds=5,
                )
        assert limiter._active_lockout_count == 3

        # Well past their 5s lockouts, and well past the 1s lockout-verify
        # throttle, so a fresh verification is due when the new violator
        # asks.
        with patch("time.time", return_value=now + 10):
            limiter.is_rate_limited(
                "login:violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            limiter.is_rate_limited(
                "login:violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )

        assert limiter._keys["login:violator"].lockout_until is not None
        assert limiter._saturation_reject_until.get("login", 0.0) == 0.0

    @pytest.mark.unit
    def test_saturated_lockout_table_does_not_force_a_full_sweep_for_every_request(
        self,
    ):
        """CI3-33-2c (Codex review of PR #2370, round 6): an earlier fix
        forced a full periodic sweep on every request once the
        active-lockout count merely reached capacity — a CPU-amplification
        DoS, since an attacker who fills the table turns every request
        anyone makes into full-table-scan work for as long as it stays
        full. Fixed by decoupling "keep memory bounded" (the periodic
        sweep, unaffected by lockout saturation) from "answer an accurate
        capacity question" (the throttled _refresh_active_lockout_count,
        called only by a request that is itself about to attempt an
        insertion). This reproduces the bug directly: 200 distinct OBSERVER
        keys, none of them anywhere near their own limit, each make one
        call while the lockout table sits at exactly capacity with
        genuinely active entries. None of these 200 calls should force the
        periodic sweep's full body to run."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter._keys["login:1.2.3.4"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:1.2.3.5"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:1.2.3.6"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._active_lockout_count = 3

            forced_sweep_count = 0
            for i in range(200):
                # A real (non-NaN) sentinel just under `now`, so the
                # interval-throttle comparison behaves normally; only the
                # sweep body itself overwrites _last_eviction to exactly
                # `now`.
                sentinel = now - 1.0
                limiter._last_eviction = sentinel
                limiter.is_rate_limited(
                    f"pub_form_submit:9.9.9.{i}",
                    max_requests=1_000_000,
                    window_seconds=60,
                    lockout_seconds=600,
                )
                if limiter._last_eviction != sentinel:
                    forced_sweep_count += 1

        assert forced_sweep_count == 0

    @pytest.mark.unit
    def test_round_7_retries_do_not_repeatedly_rescan_lockout_capacity(self):
        """CI3-33-2d (Codex review of PR #2370, round 7): CI3-33-2c scoped
        the lockout-capacity verification to only run when the *current*
        call needs to insert and the table is full — but a key that's
        already over its own request limit and repeatedly retrying (an
        attacker hammering the same already-rejected endpoint) re-enters
        that same "needs to insert" branch on every single retry, since its
        own lockout could never be persisted (saturation) and there is
        nothing to distinguish "asking for the first time this second" from
        "asking for the two-hundredth time this second". 100 retries from
        one already-rejected violator, all within the same instant,
        reproduced 100 full O(_MAX_LOCKOUTS) scans under the CI3-33-2c
        design. Fixed by throttling the verification itself
        (_LOCKOUT_VERIFY_INTERVAL, independent of and much shorter than the
        general _EVICTION_INTERVAL) rather than trying to distinguish which
        *caller* is asking — the throttle bounds the cost to a fixed rate
        regardless of whether the repeated asks come from one key retrying
        or from many different keys arriving together (see
        test_saturated_lockout_table_does_not_force_a_full_sweep_for_every_request
        for the "many different keys" half of that same guarantee)."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter._keys["login:1.2.3.4"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:1.2.3.5"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:1.2.3.6"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._active_lockout_count = 3
            # Both throttles already fired recently — matching an attacker
            # arriving into a steady-state saturated table, not the very
            # first request this process has ever handled.
            limiter._last_eviction = now
            limiter._last_lockout_verify = now
            # The attacker key already has one prior recorded request, so
            # the very first call below already trips "too many requests".
            limiter._keys["login:attacker"] = _KeyState(
                request_times=[now - 1], window_seconds=60
            )

            real_scans = 0
            for _ in range(100):
                before = limiter._last_lockout_verify
                limiter.is_rate_limited(
                    "login:attacker",
                    max_requests=1,
                    window_seconds=60,
                    lockout_seconds=1800,
                )
                if limiter._last_lockout_verify != before:
                    real_scans += 1

        assert real_scans == 0

        # Once real time has actually passed beyond the verify throttle,
        # a fresh verification must still be reachable — the throttle
        # bounds cost, it does not disable the check outright.
        with patch("time.time", return_value=now + 2.0):
            before = limiter._last_lockout_verify
            limiter.is_rate_limited(
                "login:attacker",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            assert limiter._last_lockout_verify != before

    @pytest.mark.unit
    def test_genuine_saturation_still_rejects_new_lockouts_without_evicting_existing(
        self,
    ):
        """CI3-33-2c/2d companion guard: neither CPU-amplification fix may
        weaken the genuine-saturation case CI3-33-2b protects. With 3 truly
        active (unexpired) lockouts at cap, a new violator's own lockout
        still correctly fails to persist, and none of the existing active
        entries are evicted to make room."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter._keys["login:1.2.3.4"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:1.2.3.5"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._keys["login:1.2.3.6"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._active_lockout_count = 3
            limiter._last_eviction = now

            limiter.is_rate_limited(
                "login:new-violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            is_limited, reason = limiter.is_rate_limited(
                "login:new-violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )

        assert is_limited is True
        assert limiter._keys["login:new-violator"].lockout_until is None
        for k in ("login:1.2.3.4", "login:1.2.3.5", "login:1.2.3.6"):
            assert limiter._keys[k].lockout_until == now + 1000

    @pytest.mark.unit
    def test_fuzz_mixed_scopes_saturation_and_retries_keeps_internal_state_bounded(
        self,
    ):
        """Property-style guard for the whole defect class CI3-33-1 through
        2d share: hammers one limiter instance with a randomized mix of
        distinct keys across several scopes, deliberate saturation floods,
        and repeated retries of already-rejected keys, then asserts the
        internal state never grows past its documented bounds and every
        externally-observable outcome stays internally consistent (a key
        reported "not locked out" really has no unexpired lockout_until;
        the active-lockout counter never *under*-counts the true value,
        only ever over-counts between throttled refreshes). Deterministic
        (seeded) so a failure is reproducible."""
        import random

        rng = random.Random(20260907)
        limiter = RateLimiter()
        limiter._MAX_KEYS = 200
        limiter._MAX_LOCKOUTS = 50
        limiter._EVICTION_INTERVAL = 5.0
        limiter._LOCKOUT_VERIFY_INTERVAL = 0.5

        scopes = ["login", "register", "pub_form_submit", "data_export"]
        # A small pool of keys per scope so saturation and retries both
        # happen frequently, rather than every call being a brand-new key.
        pool = {
            scope: [f"{scope}:10.0.{i // 256}.{i % 256}" for i in range(60)]
            for scope in scopes
        }

        t = 1_000_000.0
        for _ in range(4000):
            # Time always moves forward, in small increments, so both
            # throttles (eviction, lockout-verify) are exercised across
            # their full range rather than only ever seeing t=0 or a single
            # instant.
            t += rng.uniform(0.0, 0.3)
            scope = rng.choice(scopes)
            key = rng.choice(pool[scope])
            max_requests = rng.choice([1, 2, 5])
            with patch("time.time", return_value=t):
                is_limited, reason = limiter.is_rate_limited(
                    key,
                    max_requests=max_requests,
                    window_seconds=30,
                    lockout_seconds=120,
                )

            # Every returned "limited" must be backed by a real reason, and
            # a returned "not limited" must never carry a stale lockout —
            # i.e. is_rate_limited's own return value and the state it left
            # behind can never disagree.
            state = limiter._keys.get(key)
            if is_limited:
                assert reason is not None
            elif state is not None and state.lockout_until is not None:
                assert state.lockout_until <= t

        with patch("time.time", return_value=t):
            true_active = sum(
                1
                for st in limiter._keys.values()
                if st.lockout_until is not None and st.lockout_until > t
            )

        # The cached counter can only ever be a stale OVER-estimate between
        # throttled refreshes, never an under-estimate — an under-count
        # would mean the cap could be silently exceeded.
        assert limiter._active_lockout_count >= true_active
        # And it must never have drifted so far that it no longer bears any
        # relation to reality — bounded by how many *scopes* worth of
        # saturation could plausibly be in flight at once, a small multiple
        # of _MAX_LOCKOUTS, not an unbounded runaway value.
        assert limiter._active_lockout_count <= limiter._MAX_LOCKOUTS + len(scopes)

        # The combined bound from CI3-33-1d's replacement invariant: total
        # tracked keys never exceeds non-locked-out capacity plus the
        # active-lockout cap.
        assert len(limiter._keys) <= limiter._MAX_KEYS + limiter._MAX_LOCKOUTS

        # The saturation-reject dict is keyed by scope only — a fixed,
        # finite set of literals — so it must never grow past the number of
        # distinct scopes actually exercised.
        assert len(limiter._saturation_reject_until) <= len(scopes)

    @pytest.mark.unit
    def test_saturation_reject_until_is_bounded_under_a_dynamic_scope_flood(self):
        """Codex review of PR #2370: today's call sites only ever pass a
        fixed, finite set of literal scope prefixes, but check_rate_limit's
        and public_rate_limit's own signatures don't enforce that — nothing
        in the type system stops a future caller from building a scope
        dynamically. Verified to fail against the pre-fix code: an
        unbounded dict grew to one entry per distinct scope with no cap and
        no eviction (5000 distinct dynamic scopes -> 5000 tracked entries)."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 1
        limiter._MAX_SATURATION_SCOPES = 1_000

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            # One genuinely active lockout — the table is really at
            # capacity, matching the cached counter exactly.
            limiter._keys["login:1.2.3.4"] = _KeyState(
                window_seconds=60, lockout_until=now + 1000
            )
            limiter._active_lockout_count = 1
            limiter._last_eviction = now
            limiter._last_lockout_verify = now

            for i in range(5_000):
                key = f"dynamic_scope_{i}:9.9.9.9"
                # max_requests=1: the 2nd call from a fresh key already
                # trips "too many requests" and hits the saturation branch,
                # since the table above is already at _MAX_LOCKOUTS.
                limiter.is_rate_limited(
                    key, max_requests=1, window_seconds=60, lockout_seconds=1800
                )
                limiter.is_rate_limited(
                    key, max_requests=1, window_seconds=60, lockout_seconds=1800
                )

        # _sweep evaluates over_limit *before* the triggering call's own
        # insertion, same as _MAX_KEYS elsewhere in this file (see
        # test_max_keys_enforced_on_eviction) — so the count can be one over
        # cap for a single call before the next call's sweep catches it up.
        assert (
            len(limiter._saturation_reject_until) <= limiter._MAX_SATURATION_SCOPES + 1
        )

    @pytest.mark.unit
    def test_sweep_clears_expired_saturation_entries_before_evicting_live_ones(self):
        """The eviction-by-soonest-expiry fallback in _sweep only needs to
        run at all once already-expired entries are cleared first — an
        expired reject_until protects nothing, so clearing it first means a
        flood that arrives and then ages out never forces a live entry to be
        evicted in its place."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 1
        limiter._MAX_SATURATION_SCOPES = 5

        t0 = 1_000_000.0
        with patch("time.time", return_value=t0):
            limiter._keys["login:1.2.3.4"] = _KeyState(
                window_seconds=60, lockout_until=t0 + 1000
            )
            limiter._active_lockout_count = 1
            limiter._last_eviction = t0
            limiter._last_lockout_verify = t0

            # 5 scopes saturate and expire almost immediately (lockout_seconds=1).
            for i in range(5):
                key = f"short_lived_{i}:1.2.3.4"
                limiter.is_rate_limited(
                    key, max_requests=1, window_seconds=60, lockout_seconds=1
                )
                limiter.is_rate_limited(
                    key, max_requests=1, window_seconds=60, lockout_seconds=1
                )
            assert len(limiter._saturation_reject_until) == 5

        # Time passes both the reject_until expiry and the eviction
        # throttle; a 6th, still-live scope arrives. The original lockout
        # is still active (lockout_until = t0 + 1000, well past t1 below).
        t1 = t0 + 120
        with patch("time.time", return_value=t1):
            key = "long_lived:5.6.7.8"
            limiter.is_rate_limited(
                key, max_requests=1, window_seconds=60, lockout_seconds=1800
            )
            limiter.is_rate_limited(
                key, max_requests=1, window_seconds=60, lockout_seconds=1800
            )

        # The 5 expired entries were swept, not evicted-by-soonest — the
        # live entry survives and no now-pointless capacity fight happened.
        assert set(limiter._saturation_reject_until.keys()) == {"long_lived"}

    @pytest.mark.unit
    def test_saturated_lockout_table_does_not_force_a_full_sweep_on_every_retry(
        self,
    ):
        """Codex review of PR #2370: with the default config
        (_MAX_KEYS == _MAX_LOCKOUTS), a fully-saturated lockout table left
        no room for even one unlocked key without pushing len(self._keys)
        over the old flat _MAX_KEYS threshold. The only evictable record
        was ever the retrying attacker's own newly-recorded unlocked one,
        so it was deleted and immediately rewritten by the very call that
        triggered the sweep — forcing a real O(N log N) sweep+sort on
        *every single retry*, forever, not just the first. Detected via
        self._last_eviction actually advancing on every call (real sweep
        ran) vs. only on the throttle's own schedule (it did not). Verified
        to fail against the pre-fix code: with N=100 active lockouts at
        capacity, all 50 retries of one already-over-limit key forced a
        real sweep."""
        limiter = RateLimiter()
        n = 100
        limiter._MAX_KEYS = n
        limiter._MAX_LOCKOUTS = n
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        for i in range(n):
            limiter._keys[f"login:{i}"] = _KeyState(
                window_seconds=60, lockout_until=now + 3600
            )
        limiter._active_lockout_count = n
        limiter._last_eviction = now
        limiter._last_lockout_verify = now

        limiter._keys["login:attacker"] = _KeyState(
            request_times=[now - 1], window_seconds=60
        )

        real_sweeps = 0
        t = now
        for _ in range(50):
            # Advance real (mocked) time by less than _EVICTION_INTERVAL on
            # each retry, so self._last_eviction only changes when a sweep
            # is *forced* early, not on its own 60s schedule — a real sweep
            # is otherwise indistinguishable from a no-op skip when time is
            # held perfectly still.
            t += 0.01
            with patch("time.time", return_value=t):
                before = limiter._last_eviction
                limiter.is_rate_limited(
                    "login:attacker",
                    max_requests=1,
                    window_seconds=60,
                    lockout_seconds=1800,
                )
                if limiter._last_eviction != before:
                    real_sweeps += 1

        assert real_sweeps == 0
        # None of the 100 genuinely active lockouts were ever at risk —
        # they were never in the evictable pool to begin with.
        assert all(f"login:{i}" in limiter._keys for i in range(n))

    @pytest.mark.unit
    def test_alternating_keys_cannot_evict_each_others_history_under_lockout_saturation(
        self,
    ):
        """Codex review of PR #2370: the same flat _MAX_KEYS threshold that
        caused CI3-33-2g's CPU amplification was also a rate-limit bypass —
        once active lockouts alone reached _MAX_KEYS, the by-recency
        eviction pool contained only ever-freshly-recorded unlocked keys,
        so an attacker alternating between two keys had each request evict
        the *other* key's one-entry history before either could accumulate
        enough to trip its own lockout. Verified to fail against the
        pre-fix code: 40 alternating requests (20 per key, max_requests=5)
        produced 0 lockouts and both keys' histories were repeatedly wiped
        rather than accumulating."""
        limiter = RateLimiter()
        n = 100
        limiter._MAX_KEYS = n
        limiter._MAX_LOCKOUTS = n
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            for i in range(n):
                limiter._keys[f"login:{i}"] = _KeyState(
                    window_seconds=60, lockout_until=now + 3600
                )
            limiter._active_lockout_count = n
            limiter._last_eviction = now
            limiter._last_lockout_verify = now

            limited_count = 0
            for i in range(40):
                key = "scopeA:9.9.9.9" if i % 2 == 0 else "scopeB:9.9.9.9"
                is_limited, _ = limiter.is_rate_limited(
                    key, max_requests=5, window_seconds=60, lockout_seconds=1800
                )
                if is_limited:
                    limited_count += 1

        # Each key must actually accumulate its own history and trip its
        # own limit repeatedly — not be wiped by the other key's requests.
        assert limited_count > 0
        assert limiter._keys["scopeA:9.9.9.9"].request_times
        assert limiter._keys["scopeB:9.9.9.9"].request_times

    @pytest.mark.unit
    def test_zero_duration_lockouts_do_not_inflate_the_active_lockout_count(self):
        """P1 (Codex review of the structural refactor): a
        lockout_seconds=0 caller's own lockout_until equals current_time,
        which the read-side check (`current_time < lockout_until`) already
        treats as immediately expired — never a real active lockout. But
        the insertion branch incremented `self._active_lockout_count`
        unconditionally whenever a "lockout" was recorded, regardless of
        whether it was actually still in the future. A single
        lockout_seconds=0 client (matching public_rate_limit's in-memory
        fallback default) retrying past its own limit sees this play out
        every time: each retry's own just-set entry reads as already-
        expired on the very next call, resets, and re-enters this same
        branch — incrementing the cached count again with no real active
        lockout ever existing. Enough retries push the cached count to
        _MAX_LOCKOUTS with zero genuine active lockouts anywhere in
        self._keys, so a real violator in an unrelated scope then gets
        routed into the scope-wide saturation fallback instead of its own
        per-key lockout — a spurious, disproportionate 30-minute rejection
        of every fresh client in that scope, triggered by an endpoint that
        never persists a single real lockout.

        Reproduces directly: 30 retries of a lockout_seconds=0 key against
        _MAX_LOCKOUTS=10. Verified to **fail** against the pre-fix code
        (cached count reached 10 with 0 real active lockouts, and a
        subsequent login violator's own lockout failed to persist) and
        **pass** after (cached count stays 0; the login violator gets its
        own real lockout)."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 10
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 60
        limiter._LOCKOUT_VERIFY_INTERVAL = 1.0

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            for _ in range(30):
                limiter.is_rate_limited(
                    "calendar:9.9.9.9",
                    max_requests=1,
                    window_seconds=60,
                    lockout_seconds=0,
                )

            assert limiter._active_lockout_count == 0
            real_active = sum(
                1
                for st in limiter._keys.values()
                if st.lockout_until is not None and st.lockout_until > now
            )
            assert real_active == 0

            limiter.is_rate_limited(
                "login:attacker",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            is_limited, _ = limiter.is_rate_limited(
                "login:attacker",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )

        assert is_limited is True
        assert limiter._keys["login:attacker"].lockout_until is not None
        assert "login" not in limiter._saturation_reject_until


# ---------------------------------------------------------------------------
# daily_cap_exceeded
# ---------------------------------------------------------------------------


class TestDailyCapExceeded:

    @pytest.mark.unit
    async def test_self_heals_a_ttl_lost_to_a_transient_expire_failure(
        self, monkeypatch
    ):
        """Codex, PR #2106: if a prior call's INCR succeeded but its EXPIRE
        then failed (e.g. a transient Redis blip between the two commands),
        the key is left counting with no TTL and would never reset on its
        own — once count exceeds the limit the scope stays blocked past the
        next UTC day instead of resetting. A later call must notice the
        missing TTL (ttl() < 0) and repair it."""
        from app.core.cache import cache_manager
        from app.core.security_middleware import daily_cap_exceeded

        class FakeRedis:
            def __init__(self):
                self.expire_calls: list[tuple[str, int]] = []

            async def incr(self, key):
                return 2  # not the first increment, so count == 1 is skipped

            async def ttl(self, key):
                return -1  # no TTL — the prior EXPIRE call is the one that failed

            async def expire(self, key, seconds):
                self.expire_calls.append((key, seconds))

        fake_redis = FakeRedis()
        monkeypatch.setattr(cache_manager, "redis_client", fake_redis)
        monkeypatch.setattr(cache_manager, "_connected", True)

        result = await daily_cap_exceeded("test_scope", limit=100)

        assert result is False  # count=2 is under the limit
        assert len(fake_redis.expire_calls) == 1
        assert fake_redis.expire_calls[0][1] == 93600

    @pytest.mark.unit
    async def test_does_not_re_expire_a_key_that_already_has_a_ttl(self, monkeypatch):
        from app.core.cache import cache_manager
        from app.core.security_middleware import daily_cap_exceeded

        class FakeRedis:
            def __init__(self):
                self.expire_calls: list[tuple[str, int]] = []

            async def incr(self, key):
                return 2

            async def ttl(self, key):
                return 3600  # already has a TTL — nothing to repair

            async def expire(self, key, seconds):
                self.expire_calls.append((key, seconds))

        fake_redis = FakeRedis()
        monkeypatch.setattr(cache_manager, "redis_client", fake_redis)
        monkeypatch.setattr(cache_manager, "_connected", True)

        await daily_cap_exceeded("test_scope", limit=100)

        assert fake_redis.expire_calls == []

    @pytest.mark.unit
    async def test_first_increment_still_sets_the_ttl_directly(self, monkeypatch):
        """count == 1 sets the TTL unconditionally, without a ttl() probe."""
        from app.core.cache import cache_manager
        from app.core.security_middleware import daily_cap_exceeded

        class FakeRedis:
            def __init__(self):
                self.expire_calls: list[tuple[str, int]] = []
                self.ttl_calls = 0

            async def incr(self, key):
                return 1

            async def ttl(self, key):
                self.ttl_calls += 1
                return -1

            async def expire(self, key, seconds):
                self.expire_calls.append((key, seconds))

        fake_redis = FakeRedis()
        monkeypatch.setattr(cache_manager, "redis_client", fake_redis)
        monkeypatch.setattr(cache_manager, "_connected", True)

        await daily_cap_exceeded("test_scope", limit=100)

        assert fake_redis.ttl_calls == 0
        assert len(fake_redis.expire_calls) == 1
        assert fake_redis.expire_calls[0][1] == 93600


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
    def test_sanitize_string_does_not_cut_an_entity_in_half(self):
        """CI2-33-9's escape-then-truncate fix can still land the cut inside
        an entity (e.g. "&amp;" -> "&am"), which then renders as literal text
        instead of the character it was escaping (Codex, PR #1917). A
        boundary that lands exactly on "&" (no entity content follows into
        the kept slice) must also drop the dangling "&", not just a
        partial entity body."""
        # "&" escapes to "&amp;" (5 chars). max_length=7 keeps "&amp;" (5)
        # plus 2 more chars of the next escaped "&" ("&a"), landing mid-entity.
        result = InputSanitizer.sanitize_string("&&&&&", max_length=7)
        assert result == "&amp;"
        assert not result.endswith("&a")

        # max_length=1 keeps only the opening "&" of the first entity, with
        # no closing ";" anywhere in the slice.
        result = InputSanitizer.sanitize_string("&", max_length=1)
        assert result == ""

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

        fake_db = AsyncMock()

        @asynccontextmanager
        async def fake_session_factory():
            yield fake_db

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

        # No client ever sends X-Session-ID outside onboarding (Codex, PR
        # #1917) — a real authenticated request carries only the access_token
        # cookie, which is what session_id is now derived from.
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/some-route",
            "headers": [(b"cookie", b"access_token=real-jwt-value")],
            "client": ("203.0.113.9", 12345),
            "query_string": b"",
        }

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        sent = []

        async def send(message):
            sent.append(message)

        await middleware(scope, receive, send)

        import hashlib

        assert calls.get("user_id") == "user-123"
        assert calls.get("session_id") == hashlib.sha256(b"real-jwt-value").hexdigest()
        # CI2-33-13-2 (Codex, PR #1917): a bare AsyncSession context manager
        # doesn't auto-commit like the get_session() request dependency does
        # — without an explicit commit, the alert/audit row this check writes
        # is silently rolled back on scope exit.
        fake_db.commit.assert_awaited_once()

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
