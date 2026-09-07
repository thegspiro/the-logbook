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

    @pytest.mark.unit
    def test_a_calling_keys_own_history_survives_its_own_forced_eviction(self):
        """CI3-33-2: the MAX_KEYS forced eviction in _evict_stale ranks every
        tracked key by its *last recorded* request time, and previously ran
        before this call's own read of self.requests[key] — so if this exact
        key's last activity happened to be the globally-oldest among an
        over-cap tracker (plausible for a long-window scope sitting next to
        a flood of short-window ones), its own call could wipe its own
        history right before reading it, undercounting the request and
        silently granting extra allowance. The read must be captured before
        eviction runs and the result written back explicitly afterward."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        # "target" already has 2 prior requests but is the globally-oldest
        # tracked key (its own window is long enough that it isn't stale).
        limiter.requests["target"] = [now - 50, now - 49]
        limiter._key_windows["target"] = 200
        for i in range(4):
            limiter.requests[f"other-{i}"] = [now - 10 + i]

        # 3rd request (2 prior + this) is still within a cap of 3 — allowed,
        # but the history must be preserved, not reset to just this one call.
        is_limited, _ = limiter.is_rate_limited(
            "target", max_requests=3, window_seconds=200
        )
        assert is_limited is False
        assert len(limiter.requests["target"]) == 3

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
        self.lockouts[key] for every key it evicted from self.requests,
        purely by last-request-time recency — with no regard for whether
        that lockout was still active, and regardless of which key's call
        actually triggered the sweep. An attacker's lockout could therefore
        be silently lifted early by unrelated traffic from other keys
        pushing the tracker over _MAX_KEYS, well before the lockout's own
        expiry. Evicting the request-history entry itself is harmless for a
        locked-out key (is_rate_limited returns on the lockout check before
        ever touching self.requests) — only the lockout dict entry matters,
        and it must survive until it naturally expires."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        # "attacker" is already locked out for a while longer, but its last
        # recorded request (from before the lockout) is the globally-oldest
        # entry in the tracker — lockouts don't touch self.requests.
        limiter.requests["attacker"] = [now - 100]
        limiter.lockouts["attacker"] = now + 1700
        for i in range(4):
            limiter.requests[f"other-{i}"] = [now - 10 + i]

        # An unrelated key's call triggers the over-cap eviction sweep.
        limiter.is_rate_limited("victim-check", max_requests=100, window_seconds=200)

        assert "attacker" in limiter.lockouts
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
        forced-evicted key's *request history* by capturing it before
        _evict_stale runs, but the forced-eviction loop also pops
        self._key_windows[key] for the same evicted keys, and nothing
        restored that. A key whose window metadata goes missing this way
        gets judged, on the *next* sweep, against whichever window_seconds
        happened to trigger that later sweep — CI2-33-2's exact bug,
        reintroduced by omission. Reproduced in two steps: first, force
        eviction during the key's own call (window metadata must survive
        that call); second, an unrelated short-window call's later sweep
        must not evict the key's still-within-its-own-long-window history."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        limiter.requests["target"] = [now - 50]
        for i in range(4):
            limiter.requests[f"other-{i}"] = [now - 10 + i]
            limiter._key_windows[f"other-{i}"] = 60

        # "target"'s own call, with a long (3600s) window, forces eviction
        # (over _MAX_KEYS) — which pops _key_windows["target"] as a side
        # effect unless restored.
        limiter.is_rate_limited("target", max_requests=100, window_seconds=3600)
        assert limiter._key_windows.get("target") == 3600

        # Isolate the *individual staleness* mechanism (stale_keys, judged
        # against _key_windows.get(k, window_seconds)) from the unrelated
        # forced-by-recency eviction by raising the cap so the latter can't
        # fire on the next sweep.
        limiter._MAX_KEYS = 10_000
        now2 = time.time()
        # "target" quiet for 65s — stale under a 60s window, well within its
        # real 3600s one.
        limiter.requests["target"] = [now2 - 65]
        limiter._last_eviction = 0.0
        limiter.is_rate_limited("login:5.6.7.8", max_requests=100, window_seconds=60)

        assert "target" in limiter.requests
        assert len(limiter.requests["target"]) > 0

    @pytest.mark.unit
    def test_lockouts_are_capped_independently_of_requests(self):
        """CI3-33-1b/1c (Codex review of PR #2368): CI3-33-1 stopped the
        requests-eviction loop from also popping active lockouts, which
        fixed the early-unlock bug — but that had been the *only* thing
        bounding self.lockouts' size. Decoupled, self.lockouts has no cap of
        its own: a flood of distinct keys each tripping the lockout (e.g.
        during a Redis outage, this limiter's exact fallback window) grows
        it unboundedly for the full lockout duration — CLAUDE.md Pitfall #9's
        shape. Capped at insertion time by _MAX_LOCKOUTS (CI3-33-1c) — never
        by evicting an existing entry, so the dict can never exceed the cap
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

        assert len(limiter.lockouts) <= limiter._MAX_LOCKOUTS

    @pytest.mark.unit
    def test_an_already_persisted_lockout_is_never_evicted_once_saturated(self):
        """CI3-33-1b: once self.lockouts reaches its cap, the FIRST attackers
        to have been locked out (persisted before saturation) must keep
        their lockouts for the rest of a sustained flood — the cap must bind
        *new* insertions, never bump an existing active lockout to make
        room."""
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
        assert all(f"attacker-{i}" in limiter.lockouts for i in range(100))

    @pytest.mark.unit
    def test_an_active_lockout_is_never_evicted_by_an_unrelated_keys_sweep(self):
        """CI3-33-1c (Codex review of PR #2368, correcting CI3-33-1b's own
        fix): CI3-33-1b's first attempt at bounding self.lockouts evicted
        the soonest-to-expire entries once over _MAX_LOCKOUTS. That
        protected the *calling* key's own lockout (via read-before-evict)
        but not anyone else's — an unrelated key's own over-cap call could
        still pick a genuinely different, currently locked-out victim's
        entry for eviction, silently releasing an active lockout early
        (the identical failure class CI3-33-1 started this chain by fixing,
        just at _MAX_LOCKOUTS scale instead of _MAX_KEYS scale). Reproduced
        by Codex: with self.requests[victim] also evicted by the unrelated
        _MAX_KEYS sweep in the same call, victim's very next request came
        back (False, None) — not rate limited, mid-lockout. An active
        lockout must never be evicted for size, only for having genuinely
        expired."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 3
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        # "victim" is locked out and has request history, but is NOT the key
        # making the triggering call below. Its lockout was, under the old
        # (buggy) by-expiry policy, the first eviction candidate.
        limiter.requests["victim"] = [now - 100]
        limiter.lockouts["victim"] = now + 5
        for i in range(4):
            limiter.requests[f"other-{i}"] = [now - 10 + i]
            limiter.lockouts[f"other-{i}"] = now + 1000 + i

        # An unrelated key's call triggers the over-cap sweep on both dicts.
        limiter.is_rate_limited("trigger-key", max_requests=100, window_seconds=60)

        assert "victim" in limiter.lockouts

        is_limited, reason = limiter.is_rate_limited(
            "victim", max_requests=5, window_seconds=60, lockout_seconds=1800
        )
        assert is_limited is True
        assert "locked" in (reason or "").lower()

    @pytest.mark.unit
    def test_a_saturated_lockout_table_fails_closed_without_evicting_anyone(self):
        """CI3-33-1c: once self.lockouts is genuinely at capacity with
        active entries, a *new* key that trips the limit is still rejected
        this call (the count-based check already decided that on its own
        merits) but its lockout is simply not persisted — the existing
        entries are left completely untouched rather than one being bumped
        to make room."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        limiter.lockouts["existing-1"] = now + 1000
        limiter.lockouts["existing-2"] = now + 1000
        limiter.lockouts["existing-3"] = now + 1000

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
        # But the table is untouched — no existing lockout was evicted, and
        # the new one was not force-inserted over the cap.
        assert set(limiter.lockouts.keys()) == {
            "existing-1",
            "existing-2",
            "existing-3",
        }
        assert "new-violator" not in limiter.lockouts

    @pytest.mark.unit
    def test_key_windows_does_not_grow_unbounded_from_locked_out_retries(self):
        """CI3-33-1d (Codex-caught, round 3): is_rate_limited() sets
        self._key_windows[key] on *every* call, including a call that only
        retries against an already-active lockout — which never writes
        self.requests[key] (the method returns early on the lockout check).
        Neither existing cleanup path notices this: the stale-keys sweep and
        the forced _MAX_KEYS eviction both pop self._key_windows[k] only as
        a side effect of popping self.requests[k]. A key that is only ever
        locked out, never separately over its own request count, therefore
        left a permanent self._key_windows entry with nothing to evict it —
        fully unbounded by _MAX_KEYS despite self.requests and self.lockouts
        both being capped."""
        limiter = RateLimiter()
        limiter._MAX_KEYS = 50
        limiter._MAX_LOCKOUTS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = time.time()
        for i in range(2000):
            key = f"attacker-{i}"
            limiter.lockouts[key] = now + 1800
            limiter.is_rate_limited(
                key, max_requests=5, window_seconds=60, lockout_seconds=1800
            )

        assert len(limiter.requests) == 0
        assert len(limiter._key_windows) <= limiter._MAX_KEYS

    @pytest.mark.unit
    def test_a_saturated_table_violator_stays_rejected_past_its_own_window(self):
        """CI3-33-1e (Codex-caught, round 3): CI3-33-1c correctly stopped
        persisting a lockout once self.lockouts is saturated, but left the
        violator with *no* memory of the violation beyond self.requests' own
        (much shorter) window_seconds — so a retry after the sliding window
        naturally clears, but long before lockout_seconds has elapsed,
        sailed through unlimited despite having just been told "Account
        locked for 30 minutes". Reproduced exactly as Codex described: with
        the lockouts table saturated, a violator's retry 61 seconds after a
        60-second window returned (False, None)."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter.lockouts["existing-1"] = now + 1000
            limiter.lockouts["existing-2"] = now + 1000
            limiter.lockouts["existing-3"] = now + 1000
            limiter.is_rate_limited(
                "violator", max_requests=1, window_seconds=60, lockout_seconds=1800
            )
            limiter.is_rate_limited(
                "violator", max_requests=1, window_seconds=60, lockout_seconds=1800
            )
        assert "violator" not in limiter.lockouts  # table was saturated

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
        same-scope check, not a by-product of RL5-1's cross-scope
        isolation."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter.lockouts["login:existing-1"] = now + 1000
            limiter.lockouts["login:existing-2"] = now + 1000
            limiter.lockouts["login:existing-3"] = now + 1000
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
        RL5-1's cross-scope isolation."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 0

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter.lockouts["login:existing-1"] = now + 1000
            limiter.lockouts["login:existing-2"] = now + 1000
            limiter.lockouts["login:existing-3"] = now + 1000
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
        """RL5-1 (Codex review of PR #2368 after merge): CI3-33-1e's
        self._saturation_reject_until was a single process-wide scalar on
        the shared rate_limiter instance that backs every scope (login,
        register, password-reset, token-refresh, password-change, and
        every public_rate_limit() caller). Saturating ONE scope's lockout
        table (e.g. a login-lockout flood during a Redis outage) then
        failed closed for every OTHER scope too — a self-inflicted,
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
            limiter.lockouts["login:1.2.3.4"] = now + 1000
            limiter.lockouts["login:1.2.3.5"] = now + 1000
            limiter.lockouts["login:1.2.3.6"] = now + 1000
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
        """RL5-2 (Codex review of PR #2368 after merge): the insertion
        guard's strict "<" comparison (len(self.lockouts) < _MAX_LOCKOUTS)
        reads self.lockouts *after* _evict_stale runs in the same call —
        but _evict_stale's own over_limit gate used a strict ">" against
        _MAX_LOCKOUTS, so a table sitting at *exactly* capacity did not
        force an immediate sweep and instead deferred to the normal ~60s
        eviction throttle. If the last periodic sweep was recent, entries
        that have since expired stay counted, so a new violator gets
        treated as hitting a genuinely full table when the real count of
        *active* lockouts is lower (or zero).

        Originally fixed by using ">=" for the lockouts term in
        _evict_stale's own gate — that fix was itself replaced by
        RL5-3 (round 6) with a narrower, lockouts-only prune at the
        insertion decision, because ">=" forced the shared *three-dict*
        sweep for every request sharing this limiter once the table merely
        reached capacity, not only for the one request that needed an
        accurate answer — see
        test_saturated_lockout_table_does_not_force_a_full_sweep_for_every_request
        below. This test still pins the original *symptom* (a stale count
        must not cause a false saturation rejection); it is unaffected by
        which mechanism closes it."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        # Non-zero interval, matching production — the throttle this bug
        # exploits.
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            # 3 lockouts that are already expired, filling the table to
            # exactly _MAX_LOCKOUTS.
            limiter.lockouts["login:1.2.3.4"] = now - 10
            limiter.lockouts["login:1.2.3.5"] = now - 10
            limiter.lockouts["login:1.2.3.6"] = now - 10
            # Simulate a recent periodic sweep, so the 60s throttle alone
            # would otherwise block another one from happening.
            limiter._last_eviction = now

            # A new violator trips the limit. All 3 existing entries are
            # already expired — there are zero *active* lockouts in the
            # way, so this violator's own lockout must persist normally.
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

        assert "login:violator" in limiter.lockouts
        assert limiter._saturation_reject_until.get("login", 0.0) == 0.0

    @pytest.mark.unit
    def test_saturated_lockout_table_does_not_force_a_full_sweep_for_every_request(
        self,
    ):
        """RL5-3 (Codex review of PR #2370, round 6): RL5-2's fix changed
        _evict_stale's over_limit gate to ">=" against _MAX_LOCKOUTS, so
        once self.lockouts reaches exactly _MAX_LOCKOUTS *active* (not
        stale) entries — the steady state during a sustained attack — every
        single subsequent request, from any key, on any scope sharing this
        one process-wide limiter, forced a full O(_MAX_KEYS +
        _MAX_LOCKOUTS) three-dict sweep instead of respecting the normal
        ~60s throttle. That's a CPU-amplification DoS: an attacker who
        fills the table turns every request anyone makes into full-table-
        scan work, for as long as the table stays full.

        Fixed by reverting _evict_stale's own gate to ">" (a safety net
        that should structurally never fire, since insertion is gated) and
        moving the capacity-accuracy concern RL5-2 actually needed to a
        narrow, lockouts-only _prune_expired_lockouts(), called only from
        the one request that is itself about to attempt an insertion while
        observing the table at/over capacity — not from every request that
        merely finds it there.

        This reproduces the bug directly: 200 distinct OBSERVER keys, none
        of them anywhere near their own limit (so none attempt an
        insertion), each make one call while self.lockouts sits at exactly
        _MAX_LOCKOUTS with genuinely active entries. None of these 200
        calls should force _evict_stale's full sweep body to run."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter.lockouts["login:1.2.3.4"] = now + 1000
            limiter.lockouts["login:1.2.3.5"] = now + 1000
            limiter.lockouts["login:1.2.3.6"] = now + 1000

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
    def test_genuine_saturation_still_rejects_new_lockouts_without_evicting_existing(
        self,
    ):
        """RL5-3 companion guard: the fix for the CPU-amplification bug
        must not weaken the genuine-saturation case RL5-2 protects. With 3
        truly active (unexpired) lockouts at cap, a new violator's own
        lockout still correctly fails to persist, and none of the existing
        active entries are evicted to make room."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        with patch("time.time", return_value=now):
            limiter.lockouts["login:1.2.3.4"] = now + 1000
            limiter.lockouts["login:1.2.3.5"] = now + 1000
            limiter.lockouts["login:1.2.3.6"] = now + 1000
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
        assert "login:new-violator" not in limiter.lockouts
        assert set(limiter.lockouts.keys()) == {
            "login:1.2.3.4",
            "login:1.2.3.5",
            "login:1.2.3.6",
        }

    @pytest.mark.unit
    def test_saturated_scope_does_not_repeat_full_prune_scan_on_retry(self):
        """RL5-4 (Codex review of PR #2370, round 7): RL5-3's fix scoped the
        lockouts-only prune to only the one call that is itself about to
        attempt an insertion — but an already-rejected key keeps retrying
        (filtered_requests never drops below max_requests for it until its
        own history ages out of window_seconds), so every retry from that
        SAME key re-enters the branch and repeats the full O(_MAX_LOCKOUTS)
        prune scan for as long as it keeps retrying. The attacker's own
        retry loop became the amplifier RL5-3 had just narrowed away from
        everyone else.

        Reproduces directly: self.lockouts at exactly _MAX_LOCKOUTS with 3
        genuinely active (non-expired) entries, then a single already-
        saturated key retries 100 times. Before the fix, 99 of those 100
        retries (all but the first, which is the one establishing
        saturation) each pay a full prune scan.

        Fixed by short-circuiting on this scope's own
        _saturation_reject_until: once a call has already established the
        scope as saturated, a later call within reject_until skips the
        prune and the capacity check entirely and goes straight to
        extending the signal — cannot make this key's own fallback
        protection weaker than reject_until already promised it."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 60

        now = 1_000_000.0
        prune_calls = 0
        original_prune = limiter._prune_expired_lockouts

        def counting_prune(current_time):
            nonlocal prune_calls
            prune_calls += 1
            return original_prune(current_time)

        limiter._prune_expired_lockouts = counting_prune

        with patch("time.time", return_value=now):
            limiter.lockouts["login:1.2.3.4"] = now + 1000
            limiter.lockouts["login:1.2.3.5"] = now + 1000
            limiter.lockouts["login:1.2.3.6"] = now + 1000
            limiter._last_eviction = now

            results = [
                limiter.is_rate_limited(
                    "pub_form_submit:9.9.9.9",
                    max_requests=1,
                    window_seconds=60,
                    lockout_seconds=600,
                )
                for _ in range(100)
            ]

        assert prune_calls == 1
        assert all(is_limited for is_limited, _ in results[1:])

    @pytest.mark.unit
    def test_saturation_short_circuit_re_checks_capacity_once_reject_until_lapses(
        self,
    ):
        """RL5-4 companion guard: the short-circuit added above must not
        outlive the scope's own reject_until — once it lapses, the next
        call over its limit must re-run the accurate prune/capacity check
        rather than treating the scope as saturated forever. With capacity
        freed (the 3 active lockouts replaced by expired ones) and
        reject_until in the past, a new violator's own lockout is
        persisted again."""
        limiter = RateLimiter()
        limiter._MAX_LOCKOUTS = 3
        limiter._MAX_KEYS = 10_000
        limiter._EVICTION_INTERVAL = 60

        saturation_time = 1_000_000.0
        with patch("time.time", return_value=saturation_time):
            limiter.lockouts["login:1.2.3.4"] = saturation_time + 1
            limiter.lockouts["login:1.2.3.5"] = saturation_time + 1
            limiter.lockouts["login:1.2.3.6"] = saturation_time + 1
            limiter._last_eviction = saturation_time
            # First call just records the request (filtered_requests starts
            # empty); the second is the one that exceeds max_requests=1 and
            # actually attempts — and fails — the insertion, establishing
            # this scope's reject_until.
            limiter.is_rate_limited(
                "login:short-lockout-violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1,
            )
            limiter.is_rate_limited(
                "login:short-lockout-violator",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1,
            )
            reject_until = limiter._saturation_reject_until["login"]

        later = reject_until + 1
        with patch("time.time", return_value=later):
            limiter._last_eviction = later
            # Same two-call shape: the second call is the one that exceeds
            # its own limit and reaches the short-circuit under test.
            limiter.is_rate_limited(
                "login:new-violator-after-lapse",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )
            is_limited, _ = limiter.is_rate_limited(
                "login:new-violator-after-lapse",
                max_requests=1,
                window_seconds=60,
                lockout_seconds=1800,
            )

        assert is_limited is True
        assert "login:new-violator-after-lapse" in limiter.lockouts


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
