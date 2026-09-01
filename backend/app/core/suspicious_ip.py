"""
Suspicious-IP throttling for authentication routes.

Complements, rather than duplicates, the two brute-force controls that already
exist:

* ``check_rate_limit`` caps how *fast* one IP may call an auth endpoint
  (5 logins/minute). It counts every attempt, successful or not, over a short
  window.
* The account lockout in ``auth_service`` caps how many consecutive failures one
  *account* tolerates before it is locked.

Neither stops a low-and-slow credential-stuffing spray: an attacker trying two
passwords each against a thousand usernames stays under the per-minute limit and
never reaches ``MAX_LOGIN_ATTEMPTS`` on any single account, because no account is
tried more than twice. This module closes that gap by counting *failed* auth
attempts per IP **across all accounts** over a long window (default 1 hour) and
blocking the IP outright once the total crosses the threshold.

Two design points worth keeping:

* A successful sign-in **clears** the IP's counter. Station computers and other
  shared NAT egress points produce a steady trickle of ordinary typos; without
  the reset those would accumulate over the window and eventually lock out a
  whole firehouse. Resetting on success means only an IP that is failing and
  never succeeding accrues toward a block.
* The counter is Redis-backed so it is shared across workers, and degrades to a
  per-process in-memory counter when Redis is unavailable — bounded per Pitfall
  #9 with a size cap and periodic eviction.
"""

import time

from fastapi import HTTPException, Request, status
from loguru import logger

from app.core.config import settings
from app.core.security_middleware import get_client_ip

# Redis key namespaces. Kept distinct from the ``rate_limit:`` namespace used by
# the sliding-window limiter so the two controls cannot evict each other.
_FAIL_KEY = "suspicious_ip:fail:{ip}"
_BLOCK_KEY = "suspicious_ip:block:{ip}"


class _InMemoryFailureTracker:
    """Per-process fallback used only when Redis is unavailable.

    Bounded per Pitfall #9: a hard key cap, periodic eviction of entries whose
    window has fully elapsed, and oldest-first force-eviction when the cap is
    still exceeded afterwards. The keys are attacker-controlled (client IPs), so
    an unbounded dict here would be a memory-exhaustion surface.
    """

    _MAX_KEYS = 10_000
    _EVICTION_INTERVAL = 60.0

    def __init__(self) -> None:
        # ip -> list of failure timestamps within the window
        self.failures: dict[str, list[float]] = {}
        # ip -> unix time at which the block expires
        self.blocks: dict[str, float] = {}
        self._last_eviction = 0.0

    def _evict(self, now: float, window_seconds: int) -> None:
        over_limit = len(self.failures) > self._MAX_KEYS
        if not over_limit and now - self._last_eviction < self._EVICTION_INTERVAL:
            return
        self._last_eviction = now

        for ip in [ip for ip, until in self.blocks.items() if now >= until]:
            del self.blocks[ip]

        for ip in [
            ip
            for ip, stamps in self.failures.items()
            if not stamps or (now - stamps[-1]) > window_seconds
        ]:
            del self.failures[ip]

        if len(self.failures) > self._MAX_KEYS:
            by_recency = sorted(
                self.failures.items(),
                key=lambda kv: kv[1][-1] if kv[1] else 0.0,
            )
            for ip, _ in by_recency[: len(self.failures) - self._MAX_KEYS]:
                del self.failures[ip]
                self.blocks.pop(ip, None)

    def blocked_for(self, ip: str, window_seconds: int) -> int:
        """Seconds remaining on this IP's block, or 0 if it is not blocked."""
        now = time.time()
        self._evict(now, window_seconds)
        until = self.blocks.get(ip)
        if until is None:
            return 0
        if now >= until:
            del self.blocks[ip]
            self.failures.pop(ip, None)
            return 0
        return int(until - now)

    def record_failure(
        self, ip: str, window_seconds: int, max_failures: int, block_seconds: int
    ) -> bool:
        """Record one failure. Returns True if this failure triggered a block."""
        now = time.time()
        self._evict(now, window_seconds)
        stamps = [t for t in self.failures.get(ip, []) if now - t < window_seconds]
        stamps.append(now)
        self.failures[ip] = stamps
        if len(stamps) >= max_failures:
            self.blocks[ip] = now + block_seconds
            return True
        return False


_memory_tracker = _InMemoryFailureTracker()


def _redis():
    """Return a usable Redis client, or None to signal in-memory fallback."""
    from app.core.cache import cache_manager

    if cache_manager.is_connected and cache_manager.redis_client:
        return cache_manager.redis_client
    return None


async def get_block_remaining(ip: str) -> int:
    """Seconds remaining on *ip*'s block, or 0 when it is not blocked."""
    if not settings.SUSPICIOUS_IP_THROTTLE_ENABLED:
        return 0

    client = _redis()
    if client is not None:
        try:
            ttl = await client.ttl(_BLOCK_KEY.format(ip=ip))
            # redis-py returns -2 for "no such key" and -1 for "key without a
            # TTL"; neither means blocked-for-N-seconds.
            return ttl if ttl and ttl > 0 else 0
        except Exception as exc:
            logger.error(f"Suspicious-IP block lookup failed for {ip}: {exc}")
            # Fall through to the in-memory tracker rather than failing open.

    return _memory_tracker.blocked_for(ip, settings.SUSPICIOUS_IP_WINDOW_SECONDS)


async def record_auth_failure(ip: str) -> bool:
    """Count one failed auth attempt from *ip*.

    Returns True when this failure pushed the IP over the threshold and a block
    was applied. Callers treat the return value as advisory (for alerting); the
    block itself is enforced on the *next* request by ``enforce_suspicious_ip``,
    so the current failed attempt still returns its normal 401.
    """
    if not settings.SUSPICIOUS_IP_THROTTLE_ENABLED:
        return False

    max_failures = settings.SUSPICIOUS_IP_MAX_FAILURES
    window = settings.SUSPICIOUS_IP_WINDOW_SECONDS
    block_seconds = settings.SUSPICIOUS_IP_BLOCK_SECONDS

    client = _redis()
    if client is not None:
        try:
            fail_key = _FAIL_KEY.format(ip=ip)
            pipe = client.pipeline()
            pipe.incr(fail_key)
            # Refresh the TTL on every failure so the window slides with
            # activity. A fixed expiry set only on the first failure would let
            # an attacker who paces just under the threshold reset for free the
            # moment the original key expired.
            pipe.expire(fail_key, window)
            results = await pipe.execute()
            count = int(results[0] or 0)
            if count >= max_failures:
                await client.setex(_BLOCK_KEY.format(ip=ip), block_seconds, "1")
                logger.warning(
                    f"Suspicious-IP throttle engaged for {ip}: "
                    f"{count} failed auth attempts in {window}s"
                )
                return True
            return False
        except Exception as exc:
            logger.error(f"Suspicious-IP failure recording failed for {ip}: {exc}")
            # Fall through: a Redis error must not mean the attempt goes
            # uncounted (the CI-11 lesson).

    blocked = _memory_tracker.record_failure(ip, window, max_failures, block_seconds)
    if blocked:
        logger.warning(
            f"Suspicious-IP throttle engaged for {ip} (in-memory): "
            f"{max_failures} failed auth attempts in {window}s"
        )
    return blocked


async def clear_auth_failures(ip: str) -> None:
    """Reset *ip*'s failure counter after a successful authentication.

    Deliberately does **not** clear an active block: once an IP is blocked it
    stays blocked for the full duration, otherwise an attacker holding one valid
    credential could unblock themselves at will and continue spraying.
    """
    if not settings.SUSPICIOUS_IP_THROTTLE_ENABLED:
        return

    client = _redis()
    if client is not None:
        try:
            await client.delete(_FAIL_KEY.format(ip=ip))
            return
        except Exception as exc:
            logger.error(f"Suspicious-IP counter reset failed for {ip}: {exc}")

    _memory_tracker.failures.pop(ip, None)


async def enforce_suspicious_ip(request: Request) -> None:
    """FastAPI dependency: reject requests from a currently blocked IP.

    Usage:
        @router.post("/login", dependencies=[Depends(enforce_suspicious_ip)])
    """
    if not settings.SUSPICIOUS_IP_THROTTLE_ENABLED:
        return

    ip = get_client_ip(request)
    remaining = await get_block_remaining(ip)
    if remaining > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts from this network. Try again later.",
            headers={"Retry-After": str(remaining)},
        )
