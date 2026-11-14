"""Per-account limit on failed step-up re-verifications (AUTH-23).

``POST /auth/step-up`` checks a password, authenticator code or passkey for a
member who is *already signed in*. The attacker it has to stop holds the
member's live session (a stolen cookie, an unattended station computer) but
not the secret, so the per-address sign-in limiter alone let them keep guessing
at that rate indefinitely, from any address they liked.

Owner decision of 2026-11-01: count failed step-ups per **account** over a
longer window, and refuse further attempts with a 429 while over the limit —
with **no account lock**. ``failed_login_attempts`` / ``locked_until`` are never
touched here, and must not be: they gate signing in, so feeding them would let
the same session thief lock the real owner out of their own account by failing
step-up on purpose. The cost of this choice is accepted: the thief can make the
owner wait out the window before re-verifying, but cannot stop them signing in.

The count is a fixed window opened by the first failure. An attempt is reserved
(counted) *before* the secret is checked, so concurrent requests cannot all
pass a check-then-increment race; a successful step-up clears the count, which
makes what remains a count of failures.

Redis-backed so it is shared across workers, degrading to a per-process
in-memory counter when Redis is unavailable or erroring — bounded per Pitfall
#9.
"""

import time

from loguru import logger

from app.core.config import settings

_KEY = "stepup_fail:{user_id}"


class _InMemoryStepUpCounter:
    """Per-process fallback, used only when Redis is unavailable.

    Keys are user ids, so the population is bounded by the department's
    membership in practice; the cap is defence in depth. Expired windows are
    swept periodically, and if the cap is still exceeded the entries whose
    window ends soonest go first — they are the ones closest to being allowed
    again anyway.
    """

    _MAX_KEYS = 10_000
    _EVICTION_INTERVAL = 60.0

    def __init__(self) -> None:
        # user id -> (attempts in the window, unix time the window ends)
        self._entries: dict[str, tuple[int, float]] = {}
        self._last_eviction = 0.0

    def _evict(self, now: float) -> None:
        over = len(self._entries) > self._MAX_KEYS
        if not over and now - self._last_eviction < self._EVICTION_INTERVAL:
            return
        self._last_eviction = now
        for key in [k for k, (_, ends) in self._entries.items() if ends <= now]:
            del self._entries[key]
        excess = len(self._entries) - self._MAX_KEYS
        if excess > 0:
            soonest = sorted(self._entries.items(), key=lambda kv: kv[1][1])
            for key, _ in soonest[:excess]:
                del self._entries[key]

    def reserve(self, user_id: str, max_attempts: int, window_seconds: int) -> int:
        """Count one attempt. Returns 0 if allowed, else seconds to wait."""
        now = time.time()
        count, ends = self._entries.get(user_id, (0, 0.0))
        if ends <= now:
            count, ends = 0, now + window_seconds
        count += 1
        self._entries[user_id] = (count, ends)
        self._evict(now)
        if count > max_attempts:
            return max(1, int(ends - now))
        return 0

    def clear(self, user_id: str) -> None:
        self._entries.pop(user_id, None)


_memory_counter = _InMemoryStepUpCounter()


def _redis():
    from app.core.cache import cache_manager

    if cache_manager.is_connected and cache_manager.redis_client:
        return cache_manager.redis_client
    return None


async def reserve_stepup_attempt(user_id: str) -> int:
    """Count one step-up attempt for *user_id* before its secret is checked.

    Returns 0 when the attempt may proceed, otherwise the seconds until the
    account's window ends (for ``Retry-After``). Honours ``RATE_LIMIT_ENABLED``
    like the other limiters; production refuses to start with it off.
    """
    if not settings.RATE_LIMIT_ENABLED:
        return 0
    max_attempts = settings.STEPUP_MAX_FAILED_ATTEMPTS
    window = settings.STEPUP_FAILURE_WINDOW_MINUTES * 60

    client = _redis()
    if client is not None:
        key = _KEY.format(user_id=user_id)
        try:
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, window)
                ttl = window
            else:
                ttl = await client.ttl(key)
                if ttl is None or ttl < 0:
                    # Self-heal a counter left with no expiry by an EXPIRE that
                    # failed after its INCR; otherwise it would never reset.
                    await client.expire(key, window)
                    ttl = window
            return max(1, int(ttl)) if count > max_attempts else 0
        except Exception as exc:
            logger.warning(
                "Step-up throttle: Redis failed, using in-memory counter: {}",
                type(exc).__name__,
            )

    return _memory_counter.reserve(user_id, max_attempts, window)


async def clear_stepup_failures(user_id: str) -> None:
    """Forget *user_id*'s count after a successful step-up."""
    _memory_counter.clear(user_id)
    client = _redis()
    if client is None:
        return
    try:
        await client.delete(_KEY.format(user_id=user_id))
    except Exception as exc:
        logger.warning(
            "Step-up throttle: could not clear counter: {}", type(exc).__name__
        )
