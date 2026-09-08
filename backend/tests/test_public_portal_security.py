"""
Unit tests for public portal security rate limiting and cache cleanup.

Covers:
  - Per-key stale timestamp pruning in check_rate_limit
  - Per-IP stale timestamp pruning in check_ip_rate_limit
  - cleanup_rate_limit_cache forced eviction when over max keys
  - PUB-5: check_rate_limit's DB reconciliation raises the tally, never lowers it
"""

import sys
from datetime import datetime, timezone
from types import ModuleType
from unittest.mock import MagicMock

import pytest

# Stub out heavy transitive imports that are not available in the test
# environment (bcrypt → cryptography → _cffi_backend).  We only need the
# rate-limit cache data structures and helpers, not the actual crypto.


def _module_available(name: str) -> bool:
    """True if the real module can be imported.

    Stub only what is genuinely unavailable: planting a stub for an
    importable module poisons sys.modules for the whole pytest run —
    module-level code executes at collection, so a MagicMock aiomysql
    broke every real-database integration test in CI.
    """
    import importlib

    try:
        importlib.import_module(name)
        return True
    except ImportError:
        return False


_stubs: dict[str, ModuleType] = {}
for _mod_name in ("bcrypt",):
    if _mod_name not in sys.modules and not _module_available(_mod_name):
        stub = ModuleType(_mod_name)
        stub.__dict__.setdefault("gensalt", lambda: b"$2b$12$fakesalt")
        stub.__dict__.setdefault("hashpw", lambda pw, salt: b"$2b$12$fakehash")
        stub.__dict__.setdefault("checkpw", lambda pw, h: True)
        sys.modules[_mod_name] = stub
        _stubs[_mod_name] = stub

# Stub only the transitive DB driver imports the module pulls in. NOTE: do NOT
# stub `app.models.public_portal` — replacing it with a MagicMock leaves a real
# ORM model unregistered in SQLAlchemy's shared declarative registry, so a later
# test module's first mapper configuration fails to resolve string relationships
# like Organization.relationship("PublicPortalConfig"). conftest imports the real
# models eagerly; keep them real here too.
for _mod_name in (
    "aiomysql",
    "redis",
    "redis.asyncio",
):
    if _mod_name not in sys.modules and not _module_available(_mod_name):
        stub = MagicMock()
        sys.modules[_mod_name] = stub
        _stubs[_mod_name] = stub

from datetime import timedelta

from fastapi import HTTPException

from app.core.public_portal_security import (
    _LAST_USED_THROTTLE_SECONDS,
    _MAX_IP_RATE_LIMIT_KEYS,
    _MAX_RATE_LIMIT_KEYS,
    _last_used_is_stale,
    authenticate_api_key,
    check_ip_rate_limit,
    check_rate_limit,
    cleanup_rate_limit_cache,
    generate_api_key,
    ip_rate_limit_cache,
    rate_limit_cache,
)


def _current_hour_ts() -> int:
    """The hour bucket check_rate_limit keys on, computed the same way."""
    return int(
        datetime.now(timezone.utc)
        .replace(minute=0, second=0, microsecond=0)
        .timestamp()
    )


class _CountingDB:
    """Stand-in session whose only query answers a fixed ``COUNT(*)``."""

    def __init__(self, count: int):
        self._count = count
        self.executions = 0
        # The lower bound the reconciliation query's WHERE clause was built
        # with, captured from the compiled statement rather than asserted
        # against separately — see test_reconciliation_query_scopes_to_the_
        # current_hour_bucket below.
        self.captured_lower_bound: str | None = None

    async def execute(self, stmt, *args, **kwargs):
        self.executions += 1
        for clause in stmt.whereclause.clauses:
            if getattr(clause.left, "key", None) == "timestamp":
                self.captured_lower_bound = clause.right.value
        result = MagicMock()
        result.scalar.return_value = self._count
        return result


@pytest.fixture(autouse=True)
def _clear_caches():
    """Clear global caches before and after each test."""
    rate_limit_cache.clear()
    ip_rate_limit_cache.clear()
    yield
    rate_limit_cache.clear()
    ip_rate_limit_cache.clear()


# ---------------------------------------------------------------------------
# cleanup_rate_limit_cache
# ---------------------------------------------------------------------------


class TestCleanupRateLimitCache:

    @pytest.mark.unit
    def test_removes_old_hour_timestamps(self):
        """Stale hour-buckets older than 1 hour should be removed."""
        now = datetime.now(timezone.utc)
        current_hour = now.replace(minute=0, second=0, microsecond=0)
        current_ts = int(current_hour.timestamp())
        old_ts = current_ts - 7200  # 2 hours ago

        rate_limit_cache["key-1"][old_ts] = 50
        rate_limit_cache["key-1"][current_ts] = 10

        cleanup_rate_limit_cache()

        assert old_ts not in rate_limit_cache["key-1"]
        assert current_ts in rate_limit_cache["key-1"]

    @pytest.mark.unit
    def test_removes_empty_api_key_entries(self):
        """API key entries with no remaining timestamps should be removed."""
        now = datetime.now(timezone.utc)
        current_hour = now.replace(minute=0, second=0, microsecond=0)
        current_ts = int(current_hour.timestamp())
        old_ts = current_ts - 7200

        rate_limit_cache["empty-key"][old_ts] = 5

        cleanup_rate_limit_cache()

        assert "empty-key" not in rate_limit_cache

    @pytest.mark.unit
    def test_removes_old_minute_timestamps(self):
        """Stale minute-buckets older than 2 minutes should be removed."""
        now = datetime.now(timezone.utc)
        current_minute = now.replace(second=0, microsecond=0)
        current_ts = int(current_minute.timestamp())
        old_ts = current_ts - 300  # 5 minutes ago

        ip_rate_limit_cache["1.2.3.4"][old_ts] = 20
        ip_rate_limit_cache["1.2.3.4"][current_ts] = 5

        cleanup_rate_limit_cache()

        assert old_ts not in ip_rate_limit_cache["1.2.3.4"]
        assert current_ts in ip_rate_limit_cache["1.2.3.4"]

    @pytest.mark.unit
    def test_force_evicts_api_keys_over_limit(self):
        """When rate_limit_cache exceeds _MAX_RATE_LIMIT_KEYS, oldest keys
        should be force-evicted."""
        now = datetime.now(timezone.utc)
        current_hour = now.replace(minute=0, second=0, microsecond=0)
        current_ts = int(current_hour.timestamp())

        # Insert more keys than the limit
        num_keys = _MAX_RATE_LIMIT_KEYS + 100
        for i in range(num_keys):
            # Stagger timestamps so oldest are identifiable
            rate_limit_cache[f"key-{i}"][current_ts - i] = 1

        cleanup_rate_limit_cache()

        assert len(rate_limit_cache) <= _MAX_RATE_LIMIT_KEYS

    @pytest.mark.unit
    def test_force_evicts_ips_over_limit(self):
        """When ip_rate_limit_cache exceeds _MAX_IP_RATE_LIMIT_KEYS, oldest
        IPs should be force-evicted."""
        now = datetime.now(timezone.utc)
        current_minute = now.replace(second=0, microsecond=0)
        current_ts = int(current_minute.timestamp())

        num_keys = _MAX_IP_RATE_LIMIT_KEYS + 50
        for i in range(num_keys):
            ip_rate_limit_cache[f"10.0.{i // 256}.{i % 256}"][current_ts - (i % 60)] = 1

        cleanup_rate_limit_cache()

        assert len(ip_rate_limit_cache) <= _MAX_IP_RATE_LIMIT_KEYS


# ---------------------------------------------------------------------------
# check_ip_rate_limit (per-IP stale timestamp pruning)
# ---------------------------------------------------------------------------


class TestCheckIpRateLimit:

    @pytest.mark.unit
    async def test_prunes_stale_minute_buckets(self):
        """Old minute-buckets should be pruned when checking IP rate limit."""
        now = datetime.now(timezone.utc)
        current_minute = now.replace(second=0, microsecond=0)
        current_ts = int(current_minute.timestamp())
        old_ts = current_ts - 300  # 5 minutes ago

        ip_rate_limit_cache["5.6.7.8"][old_ts] = 99

        is_allowed, count, limit = await check_ip_rate_limit("5.6.7.8", limit=100)

        assert is_allowed is True
        # Old bucket should be gone
        assert old_ts not in ip_rate_limit_cache["5.6.7.8"]

    @pytest.mark.unit
    async def test_allows_requests_under_limit(self):
        """Requests under the limit should be allowed."""
        is_allowed, count, limit = await check_ip_rate_limit("9.9.9.9", limit=100)
        assert is_allowed is True

    @pytest.mark.unit
    async def test_blocks_requests_over_limit(self):
        """Requests over the limit should be blocked."""
        now = datetime.now(timezone.utc)
        current_minute = now.replace(second=0, microsecond=0)
        current_ts = int(current_minute.timestamp())

        ip_rate_limit_cache["9.9.9.9"][current_ts] = 100

        is_allowed, count, limit = await check_ip_rate_limit("9.9.9.9", limit=100)
        assert is_allowed is False


# ---------------------------------------------------------------------------
# PP-4: IP rate limit ahead of bcrypt; selective key prefix
# ---------------------------------------------------------------------------


class TestAuthenticateApiKeyDoSHardening:

    @pytest.mark.unit
    async def test_ip_rate_limit_runs_before_db_and_bcrypt(self):
        """An over-limit IP is rejected before any DB lookup / bcrypt verify."""
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        ip_rate_limit_cache["1.2.3.4"][int(now.timestamp())] = 100  # at limit

        class _ExplodingDB:
            async def execute(self, *args, **kwargs):
                raise AssertionError(
                    "DB/bcrypt was reached before the IP rate limit (PP-4)"
                )

        request = MagicMock()
        request.client.host = "1.2.3.4"

        with pytest.raises(HTTPException) as exc:
            await authenticate_api_key(
                request, api_key="logbook_" + "a" * 40, db=_ExplodingDB()
            )
        assert exc.value.status_code == 429


class TestLastUsedThrottle:

    @pytest.mark.unit
    def test_missing_is_stale(self):
        assert _last_used_is_stale(None, datetime.now(timezone.utc)) is True
        assert _last_used_is_stale("", datetime.now(timezone.utc)) is True

    @pytest.mark.unit
    def test_recent_is_not_stale(self):
        now = datetime.now(timezone.utc)
        recent = (now - timedelta(seconds=5)).isoformat()
        assert _last_used_is_stale(recent, now) is False

    @pytest.mark.unit
    def test_old_is_stale(self):
        now = datetime.now(timezone.utc)
        old = (now - timedelta(seconds=_LAST_USED_THROTTLE_SECONDS + 5)).isoformat()
        assert _last_used_is_stale(old, now) is True

    @pytest.mark.unit
    def test_malformed_is_stale(self):
        assert (
            _last_used_is_stale("not-a-timestamp", datetime.now(timezone.utc)) is True
        )

    @pytest.mark.unit
    def test_naive_timestamp_treated_as_utc(self):
        now = datetime.now(timezone.utc)
        naive_recent = now.replace(tzinfo=None).isoformat()
        # Must not raise on naive/aware subtraction; recent → not stale.
        assert _last_used_is_stale(naive_recent, now) is False


# ---------------------------------------------------------------------------
# PUB-5: the hourly reconciliation query may raise the tally, never lower it
# ---------------------------------------------------------------------------


class TestCheckRateLimitDbReconciliation:
    """``public_portal_access_log`` only ever carries requests that COMMITTED.

    An HTTPException rolls the request's session back and a 401/429 never
    reaches the handler that writes the row at all, so the reconciliation
    query's answer is a floor on the true count, not the count. Assigning it
    let a caller whose traffic did not persist a row walk the in-memory tally
    up to the 90% threshold and be reset to the (much smaller) persisted count
    every time, so the per-key hourly quota was never reached.
    """

    @pytest.mark.unit
    async def test_db_count_does_not_lower_the_in_memory_tally(self):
        hour_ts = _current_hour_ts()
        rate_limit_cache["key-a"][hour_ts] = 95  # 95 of 100 spent this hour
        db = _CountingDB(0)  # none of them persisted a log row

        is_allowed, current, limit = await check_rate_limit("key-a", 100, db)

        assert db.executions == 1, "the reconciliation query must still run"
        assert current == 95
        assert is_allowed is True
        assert rate_limit_cache["key-a"][hour_ts] == 96

    @pytest.mark.unit
    async def test_repeated_checks_still_reach_the_ceiling(self):
        """The bypass, driven end to end: this loop never limited pre-fix."""
        hour_ts = _current_hour_ts()
        rate_limit_cache["key-b"][hour_ts] = 90  # at the 90% reconcile threshold
        db = _CountingDB(0)

        outcomes = [(await check_rate_limit("key-b", 100, db))[0] for _ in range(30)]

        assert outcomes[0] is True
        assert outcomes[-1] is False
        assert False in outcomes

    @pytest.mark.unit
    async def test_db_count_still_raises_a_low_process_local_tally(self):
        """The cross-process correction the query exists for is preserved."""
        hour_ts = _current_hour_ts()
        rate_limit_cache["key-c"][hour_ts] = 90
        db = _CountingDB(150)  # other workers served 150 requests for this key

        is_allowed, current, limit = await check_rate_limit("key-c", 100, db)

        assert current == 150
        assert is_allowed is False
        assert rate_limit_cache["key-c"][hour_ts] == 150

    @pytest.mark.unit
    async def test_reconciliation_query_scopes_to_the_current_hour_bucket(self):
        """The query's lower bound must be the clock-hour bucket, not a
        rolling 60-minute window.

        ``current_count``/``X-RateLimit-Reset`` both key off the fixed
        clock-hour bucket ``hour_timestamp`` starts. A rolling "last 60
        minutes" window still includes the tail of the *previous* bucket's
        traffic right after the hour turns over, and since the reconciled
        count can only raise the in-memory tally and never lower it, an
        inflated db_count from stale traffic would stick for the rest of the
        new hour and 429 legitimate requests until the bucket rolls over
        again.
        """
        hour_ts = _current_hour_ts()
        rate_limit_cache["key-e"][hour_ts] = 95
        db = _CountingDB(0)

        await check_rate_limit("key-e", 100, db)

        expected = datetime.fromtimestamp(hour_ts, tz=timezone.utc).isoformat()
        assert db.captured_lower_bound == expected

    @pytest.mark.unit
    async def test_no_query_below_the_threshold(self):
        """Well under the limit, the hot path stays a pure in-memory check."""
        hour_ts = _current_hour_ts()
        rate_limit_cache["key-d"][hour_ts] = 10
        db = _CountingDB(0)

        is_allowed, current, limit = await check_rate_limit("key-d", 100, db)

        assert db.executions == 0
        assert is_allowed is True
        assert rate_limit_cache["key-d"][hour_ts] == 11


class TestGenerateApiKeyPrefix:

    @pytest.mark.unit
    def test_prefix_is_selective_not_constant_marker(self):
        """The stored prefix must be selective (16 chars), not the "logbook_"."""
        key1, prefix1 = generate_api_key()
        key2, prefix2 = generate_api_key()

        assert prefix1 == key1[:16]
        assert len(prefix1) == 16
        # The old non-selective 8-char marker forced a bcrypt scan of every key.
        assert prefix1 != "logbook_"
        # Selective: two distinct keys get distinct prefixes.
        assert prefix1 != prefix2
