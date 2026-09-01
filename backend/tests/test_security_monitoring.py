"""
Tests for the security monitoring service
(app/services/security_monitoring.py).

Covers the in-memory threat detection that has no external deps: injection
pattern matching (SQLi / XSS / path traversal), per-IP API rate limiting,
and brute-force login detection. The audit-log call is stubbed. DB mocked.
"""

from datetime import datetime, timedelta, timezone
from unittest import mock
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.security_monitoring import SecurityMonitoringService


@pytest.fixture(autouse=True)
def _stub_audit(monkeypatch):
    monkeypatch.setattr("app.services.security_monitoring.log_audit_event", AsyncMock())


def _db():
    db = MagicMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


def _svc():
    return SecurityMonitoringService()


class TestInjectionPatterns:
    async def test_clean_request_is_none(self):
        out = await _svc()._check_injection_patterns(
            _db(), {"path": "/api/users", "q": "hello world"}, "u1"
        )
        assert out is None

    async def test_sql_injection_detected(self):
        out = await _svc()._check_injection_patterns(
            _db(), {"q": "UNION SELECT * FROM users"}, "u1"
        )
        assert out is not None
        assert out.details["pattern_type"] == "sql_injection"
        assert out.threat_level.value == "high"

    async def test_xss_detected(self):
        out = await _svc()._check_injection_patterns(
            _db(), {"bio": "<script>alert(1)</script>"}, "u1"
        )
        assert out is not None
        assert out.details["pattern_type"] == "xss"

    async def test_path_traversal_detected(self):
        out = await _svc()._check_injection_patterns(
            _db(), {"file": "../../etc/passwd"}, None
        )
        assert out is not None
        assert out.details["pattern_type"] == "path_traversal"


class TestRateLimit:
    async def test_under_threshold_then_alert(self):
        svc = _svc()
        svc.thresholds.api_calls_per_minute = 3
        db = _db()
        ip = "203.0.113.5"
        # First 3 calls are within the limit (len 1,2,3 -> not > 3).
        for _ in range(3):
            assert await svc._check_rate_limit(db, ip, "u1") is None
        # 4th call pushes the count to 4 > 3 -> alert.
        alert = await svc._check_rate_limit(db, ip, "u1")
        assert alert is not None
        assert alert.details["threshold"] == 3
        assert alert.details["calls_per_minute"] == 4


class TestBruteForce:
    async def test_success_clears_and_returns_none(self):
        svc = _svc()
        svc._login_attempts["1.2.3.4"] = ["x", "y"]
        out = await svc.detect_brute_force(_db(), "1.2.3.4", "u1", success=True)
        assert out is None
        assert svc._login_attempts["1.2.3.4"] == []

    async def test_under_threshold_is_none(self):
        svc = _svc()
        svc.thresholds.failed_logins_per_hour = 5
        out = await svc.detect_brute_force(_db(), "1.2.3.4", success=False)
        assert out is None

    async def test_reaching_threshold_alerts(self):
        svc = _svc()
        svc.thresholds.failed_logins_per_hour = 3
        db = _db()
        ip = "1.2.3.4"
        assert await svc.detect_brute_force(db, ip, success=False) is None  # 1
        assert await svc.detect_brute_force(db, ip, success=False) is None  # 2
        alert = await svc.detect_brute_force(db, ip, success=False)  # 3 >= 3
        assert alert is not None
        assert alert.alert_type.value == "brute_force"
        assert alert.details["failed_attempts"] == 3


class TestTrackerCaps:
    """PR #2128 Codex follow-up: hot-path batch eviction and the
    _external_endpoints set, both missed by the first cap-enforcement fix
    (commit 3b6b65e4).
    """

    async def test_dict_tracker_eviction_is_batched_not_one_at_a_time(self):
        """Once a dict tracker hits the cap, eviction must drop it to the
        batch target (90% of the cap) in one pass, not back to exactly the
        cap. One-at-a-time eviction (the pre-fix behavior) would leave the
        tracker sitting at `_MAX_TRACKING_KEYS` after this call; this test
        fails against that code because `len(...) == _MAX_TRACKING_KEYS`
        there, not `<=` the batch target.
        """
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 100
        for i in range(101):
            svc._login_attempts[f"ip-{i}"] = [datetime.now(timezone.utc)]

        svc._enforce_key_caps()

        target = int(svc._MAX_TRACKING_KEYS * svc._EVICTION_TARGET_RATIO)
        assert len(svc._login_attempts) == target

    async def test_sustained_churn_stays_bounded_and_sort_is_amortized(self):
        """Simulates the hot path: one new session per call, well past the
        cap. The tracker must never exceed the cap, and — the actual
        performance claim — the expensive sort must not run on every single
        call once the tracker is saturated; it should run roughly once per
        eviction batch (cap - target), not once per addition.
        """
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 100
        target = int(svc._MAX_TRACKING_KEYS * svc._EVICTION_TARGET_RATIO)
        batch_size = svc._MAX_TRACKING_KEYS - target  # headroom per eviction

        sort_calls = 0
        real_sorted = sorted

        def counting_sorted(*args, **kwargs):
            nonlocal sort_calls
            sort_calls += 1
            return real_sorted(*args, **kwargs)

        total_calls = 500
        with mock.patch("app.services.security_monitoring.sorted", counting_sorted):
            for i in range(total_calls):
                svc._session_ips[f"session:{i}"] = [
                    ("1.2.3.4", datetime.now(timezone.utc))
                ]
                svc._enforce_key_caps()
                assert len(svc._session_ips) <= svc._MAX_TRACKING_KEYS

        # Growth past the cap is (total_calls - cap); each eviction pass
        # buys `batch_size` headroom, so the sort should run roughly that
        # many times, not once per call (500). A generous upper bound keeps
        # this from being timing-flaky while still failing hard against the
        # pre-fix one-key-at-a-time behavior (which sorts on every call once
        # saturated -> ~400 sorts here).
        expected_max_sorts = ((total_calls - svc._MAX_TRACKING_KEYS) // batch_size) + 5
        assert sort_calls <= expected_max_sorts, (
            f"sorted() ran {sort_calls} times for {total_calls} additions past "
            f"the cap; expected at most {expected_max_sorts} (batched eviction)"
        )

    async def test_external_endpoints_capped_by_enforce_key_caps(self):
        """`_external_endpoints` is a set, grown by detect_data_exfiltration,
        and must be bounded by the same `_enforce_key_caps()` call that
        method already makes on entry — not left to the dead
        `_evict_stale_tracking_keys` sweep path that nothing on this growth
        path ever invokes.
        """
        svc = _svc()
        svc._MAX_EXTERNAL_ENDPOINTS = 50
        for i in range(51):
            svc._external_endpoints.add(f"https://evil-{i}.example.com")

        svc._enforce_key_caps()

        target = int(svc._MAX_EXTERNAL_ENDPOINTS * svc._EVICTION_TARGET_RATIO)
        assert len(svc._external_endpoints) == target

    async def test_detect_data_exfiltration_caps_external_endpoints_on_its_own_growth_path(
        self,
    ):
        """End-to-end: calling detect_data_exfiltration itself, repeatedly,
        with distinct external destinations must not grow the set past its
        cap -- this is the actual production growth path (export endpoints,
        security_middleware.py), not a direct call to the enforcement
        helper.
        """
        svc = _svc()
        svc._MAX_EXTERNAL_ENDPOINTS = 20
        db = _db()

        for i in range(40):
            await svc.detect_data_exfiltration(
                db=db,
                user_id="u1",
                data_size_bytes=1024,
                endpoint="/api/v1/some/export",
                destination=f"https://evil-{i}.example.com",
                ip_address="203.0.113.5",
            )

        assert len(svc._external_endpoints) <= svc._MAX_EXTERNAL_ENDPOINTS


class TestReadBeforeEvictOrdering:
    """PR #2128 round 3 (Codex): the round-2 fix (commit 3b6b65e4) added an
    unconditional ``self._enforce_key_caps()`` call to the TOP of
    detect_session_hijack / detect_data_exfiltration -- BEFORE either method
    read its own tracker's prior entries for this exact key. If that key
    happened to be the coldest (least-recently-active) one in an
    over-the-cap tracker, the batch eviction deleted its history first, and
    the read that followed silently found nothing: a genuine hijack looked
    like a first-ever observation, a genuine cumulative transfer looked like
    a lone new one, and no alert fired. detect_brute_force has always had
    the same shape (enforce_key_caps ran before the ip/user append+filter),
    just never flagged.

    Each test below fills the relevant tracker past its cap with the victim
    key as the single oldest entry, then drives the call through the real
    method (not the eviction helper directly) and asserts the alert that
    should fire still does. Each test fails against commit df7438e0 (no
    alert -- the read finds an empty/reset history) and passes after the
    read-before-evict reordering.
    """

    async def test_session_hijack_alert_survives_batch_eviction_of_the_victim_session(
        self,
    ):
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 10

        victim_session = "victim-session"
        victim_key = f"session:{victim_session}"
        now = datetime.now(timezone.utc)
        # Victim's last activity is a few seconds old -- recent enough to
        # still be "within 5 minutes" for the hijack check, but older than
        # every filler entry below, so it is the batch-eviction target.
        svc._session_ips[victim_key] = [("1.1.1.1", now - timedelta(seconds=10))]

        for i in range(20):
            svc._session_ips[f"session:filler-{i}"] = [("2.2.2.2", now)]

        assert len(svc._session_ips) > svc._MAX_TRACKING_KEYS

        alert = await svc.detect_session_hijack(
            _db(),
            session_id=victim_session,
            current_ip="9.9.9.9",
            user_agent="ua",
            user_id="u1",
        )

        assert alert is not None, (
            "session-hijack alert was skipped -- the victim session's prior "
            "IP was evicted before detect_session_hijack could read and "
            "compare it"
        )
        assert alert.alert_type.value == "session_hijack"
        assert alert.details["previous_ip"] == "1.1.1.1"
        assert alert.details["current_ip"] == "9.9.9.9"

    async def test_brute_force_threshold_survives_batch_eviction_of_the_attacker_ip(
        self,
    ):
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 10
        svc.thresholds.failed_logins_per_hour = 3

        attacker_ip = "203.0.113.9"
        now = datetime.now(timezone.utc)
        # Two prior failed attempts, both within the last hour, the most
        # recent of which is still older than every filler IP below.
        svc._login_attempts[attacker_ip] = [
            now - timedelta(minutes=5),
            now - timedelta(minutes=3),
        ]

        for i in range(20):
            svc._login_attempts[f"filler-ip-{i}"] = [now]

        assert len(svc._login_attempts) > svc._MAX_TRACKING_KEYS

        # Third failed attempt for the attacker IP -- should reach the
        # threshold of 3 (2 prior + this one).
        alert = await svc.detect_brute_force(_db(), attacker_ip, success=False)

        assert alert is not None, (
            "brute-force alert was skipped -- the attacker IP's prior failed "
            "attempts were evicted before detect_brute_force could count them"
        )
        assert alert.alert_type.value == "brute_force"
        assert alert.details["failed_attempts"] == 3

    async def test_data_exfiltration_cumulative_alert_survives_batch_eviction(self):
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 10
        svc.thresholds.large_data_export_mb = 10  # cumulative alert at > 50MB/24h

        victim_user = "victim-user"
        now = datetime.now(timezone.utc)
        mb = 1024 * 1024
        # 45MB already transferred, most recent entry older than every
        # filler user below, so this is the batch-eviction target.
        svc._data_transfers[victim_user] = [
            (15 * mb, now - timedelta(minutes=10)),
            (15 * mb, now - timedelta(minutes=7)),
            (15 * mb, now - timedelta(minutes=5)),
        ]

        for i in range(20):
            svc._data_transfers[f"filler-user-{i}"] = [(1, now)]

        assert len(svc._data_transfers) > svc._MAX_TRACKING_KEYS

        # 10MB more -- alone it's not > the 10MB single-transfer threshold,
        # but 45 + 10 = 55MB is > the 50MB cumulative threshold.
        alert = await svc.detect_data_exfiltration(
            db=_db(),
            user_id=victim_user,
            data_size_bytes=10 * mb,
            endpoint="/api/v1/some/export",
            ip_address="203.0.113.5",
        )

        assert alert is not None, (
            "cumulative data-exfiltration alert was skipped -- the victim "
            "user's transfer history was evicted before it could be summed"
        )
        assert alert.alert_type.value == "data_exfiltration"
        assert alert.details["total_24h_mb"] == pytest.approx(55.0)

    async def test_rate_limit_alert_survives_batch_eviction_of_the_victim_ip(self):
        """PR #2132 round 4 (Codex): _check_rate_limit has the identical
        read-after-evict shape as the three methods above, missed by the
        round-3 fix because it evicts via ``_evict_stale_tracking_keys()``
        (not a direct ``_enforce_key_caps()`` call) at the very top of the
        method, before it reads/appends to ``self._api_calls[ip]``. If this
        ip is the coldest key in an over-the-cap tracker, batch eviction
        deletes its prior calls first, the subsequent append+filter reads
        from a fresh empty list, and the request is undercounted as call #1
        -- no rate-limit alert, even though it is really call #3 against a
        threshold of 2.
        """
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 10
        svc.thresholds.api_calls_per_minute = 2

        victim_ip = "203.0.113.9"
        now = datetime.now(timezone.utc)
        # Two prior calls within the last minute, both older than every
        # filler ip below, so this ip is the batch-eviction target.
        svc._api_calls[victim_ip] = [
            now - timedelta(seconds=30),
            now - timedelta(seconds=20),
        ]

        for i in range(20):
            svc._api_calls[f"filler-ip-{i}"] = [datetime.now(timezone.utc)]

        assert len(svc._api_calls) > svc._MAX_TRACKING_KEYS

        # Third call for the victim ip -- should exceed the threshold of 2
        # (2 prior + this one = 3 > 2).
        alert = await svc._check_rate_limit(_db(), victim_ip, "u1")

        assert alert is not None, (
            "rate-limit alert was skipped -- the victim ip's prior calls "
            "were evicted before _check_rate_limit could count them"
        )
        assert alert.alert_type.value == "rate_limit_exceeded"
        assert alert.details["calls_per_minute"] == 3
        assert alert.details["threshold"] == 2


class TestWriteAfterEvictOrdering:
    """PR #2132 round 5 (Codex): the round-4 fix (read the current key's
    tracker entry into a local variable BEFORE calling _enforce_key_caps())
    correctly protects THAT call's own decision, but nothing re-inserted the
    current key's entry into the tracker AFTER eviction ran.

    **Confirmed exploitable, in commit 95db016b, in exactly one of the four
    methods: detect_session_hijack.** Its read (the prior IP/timestamp) and
    its write (this call's new IP/timestamp) are two separate steps, with
    eviction running in between and the write gated behind "no alert fired
    this call" via an early `return alert`. So when the hijack alert fires
    correctly (using the pre-eviction local copy), the method returns before
    ever writing this call's own contribution -- and if this session's key
    was also the batch-eviction target, the tracker is left holding NO entry
    at all for it. The next call from the same hijacked session finds no
    baseline, is scored as a first-ever observation, and the alert stream
    for an ongoing hijack goes silent after its first (correctly fired)
    alert. `test_session_hijack_detects_a_second_and_third_ip_change_in_a_row`
    below fails against 95db016b for exactly this reason.

    **Not reproducible the same way in `_check_rate_limit`,
    `detect_brute_force`, or `detect_data_exfiltration`.** In 95db016b all
    three already write this call's filtered window back to the dict in the
    same statement block that reads/appends it -- *before* calling
    `_enforce_key_caps()` -- so by the time eviction runs, this call's own
    key already carries the freshest timestamp in the tracker and cannot be
    among the "oldest N" keys eviction selects; it always survives its own
    call's eviction pass. Traced and confirmed empirically (see PR
    description / commit message): the three tests below for these methods
    pass unmodified against 95db016b too. The fix still moves their writes
    to run after `_enforce_key_caps()`, matching the read-old/write-new
    shape applied everywhere else -- not because 95db016b is broken here,
    but so the invariant ("the tracker always ends a call holding a live
    entry for the calling key") holds by construction rather than by an
    incidental ordering property that a future refactor (e.g. adding an
    early return, exactly what happened to detect_session_hijack) could
    silently break again. These three tests are regression guards against
    that future break, not reproductions of a currently-live bug.
    """

    async def test_session_hijack_detects_a_second_and_third_ip_change_in_a_row(
        self,
    ):
        """Three calls in a row, not just two -- the fix must be general,
        not just patch the exact two-call reproduction Codex gave. Each call
        changes IP again, simulating an attacker continuing to use the
        hijacked session after the first alert fired.
        """
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 10

        victim_session = "victim-session"
        victim_key = f"session:{victim_session}"
        now = datetime.now(timezone.utc)
        svc._session_ips[victim_key] = [("1.1.1.1", now - timedelta(seconds=10))]

        for i in range(20):
            svc._session_ips[f"session:filler-{i}"] = [("2.2.2.2", now)]

        assert len(svc._session_ips) > svc._MAX_TRACKING_KEYS

        # Call 1: victim_session is the batch-eviction target. The alert
        # fires correctly (round-4 fix already covers this), but round-4
        # left the tracker with no entry at all for victim_key afterward.
        alert1 = await svc.detect_session_hijack(
            _db(),
            session_id=victim_session,
            current_ip="9.9.9.9",
            user_agent="ua",
            user_id="u1",
        )
        assert alert1 is not None
        assert alert1.details["previous_ip"] == "1.1.1.1"
        assert alert1.details["current_ip"] == "9.9.9.9"

        # No further growth past the cap between calls, so no more eviction
        # happens below -- these two calls isolate the write-after-evict gap
        # itself, not a second batch eviction.
        assert len(svc._session_ips) <= svc._MAX_TRACKING_KEYS

        # Call 2: same session, IP changes again. Against 95db016b this
        # finds no entry for victim_key at all (round-4 fixed the read, but
        # nothing wrote the call-1 IP back after eviction deleted it), so
        # session_data is `[]`, the hijack looks like a first-ever
        # observation, and no alert fires.
        alert2 = await svc.detect_session_hijack(
            _db(),
            session_id=victim_session,
            current_ip="8.8.8.8",
            user_agent="ua",
            user_id="u1",
        )
        assert alert2 is not None, (
            "session-hijack alert did not fire on the second call -- the "
            "tracker lost its baseline for this session after the first "
            "call's alert, even though the first call correctly detected "
            "the hijack"
        )
        assert alert2.details["previous_ip"] == "9.9.9.9"
        assert alert2.details["current_ip"] == "8.8.8.8"

        # Call 3: continue the chain one step further to prove the fix does
        # not merely special-case the two-call reproduction.
        alert3 = await svc.detect_session_hijack(
            _db(),
            session_id=victim_session,
            current_ip="7.7.7.7",
            user_agent="ua",
            user_id="u1",
        )
        assert alert3 is not None, (
            "session-hijack alert did not fire on the third call -- the "
            "fix must keep restoring a live baseline on every call, not "
            "just the one immediately after an eviction"
        )
        assert alert3.details["previous_ip"] == "8.8.8.8"
        assert alert3.details["current_ip"] == "7.7.7.7"

    async def test_brute_force_second_attempt_after_batch_eviction_still_counts(
        self,
    ):
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 10
        svc.thresholds.failed_logins_per_hour = 3

        attacker_ip = "203.0.113.9"
        now = datetime.now(timezone.utc)
        svc._login_attempts[attacker_ip] = [
            now - timedelta(minutes=5),
            now - timedelta(minutes=3),
        ]

        for i in range(20):
            svc._login_attempts[f"filler-ip-{i}"] = [now]

        assert len(svc._login_attempts) > svc._MAX_TRACKING_KEYS

        # Call 1 (3rd failed attempt): attacker_ip is the batch-eviction
        # target; the alert correctly fires at the threshold of 3.
        alert1 = await svc.detect_brute_force(_db(), attacker_ip, success=False)
        assert alert1 is not None
        assert alert1.details["failed_attempts"] == 3
        assert len(svc._login_attempts) <= svc._MAX_TRACKING_KEYS

        # Call 2 (4th failed attempt, same attacker): asserts the count keeps
        # accumulating rather than resetting. Passes against 95db016b too --
        # detect_brute_force already writes attacker_ip's filtered window
        # back to the dict in the same statement block that reads it,
        # *before* calling _enforce_key_caps(), so this call's own entry is
        # always the freshest in the tracker and cannot be evicted by its
        # own call's eviction pass. Kept as a regression guard: the fix below
        # moves the write to run after cap enforcement so this holds by
        # construction, not by that ordering coincidence.
        alert2 = await svc.detect_brute_force(_db(), attacker_ip, success=False)
        assert alert2 is not None, (
            "brute-force alert did not fire on the second call -- the "
            "tracker lost the attacker ip's history after the first call's "
            "alert fired"
        )
        assert alert2.details["failed_attempts"] == 4

    async def test_data_exfiltration_second_transfer_after_batch_eviction_still_sums(
        self,
    ):
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 10
        svc.thresholds.large_data_export_mb = 10

        victim_user = "victim-user"
        now = datetime.now(timezone.utc)
        mb = 1024 * 1024
        svc._data_transfers[victim_user] = [
            (15 * mb, now - timedelta(minutes=10)),
            (15 * mb, now - timedelta(minutes=7)),
            (15 * mb, now - timedelta(minutes=5)),
        ]

        for i in range(20):
            svc._data_transfers[f"filler-user-{i}"] = [(1, now)]

        assert len(svc._data_transfers) > svc._MAX_TRACKING_KEYS

        # Call 1: victim_user is the batch-eviction target. 45MB prior +
        # 10MB this call = 55MB, correctly over the 50MB cumulative
        # threshold -- the alert fires.
        alert1 = await svc.detect_data_exfiltration(
            db=_db(),
            user_id=victim_user,
            data_size_bytes=10 * mb,
            endpoint="/api/v1/some/export",
            ip_address="203.0.113.5",
        )
        assert alert1 is not None
        assert alert1.details["total_24h_mb"] == pytest.approx(55.0)
        assert len(svc._data_transfers) <= svc._MAX_TRACKING_KEYS

        # Call 2: another 10MB transfer from the same user, asserting the
        # 24h total keeps accumulating rather than resetting. Passes against
        # 95db016b too -- detect_data_exfiltration already writes
        # victim_user's filtered window back to the dict in the same
        # statement block that reads it, *before* calling
        # _enforce_key_caps(), so this call's own entry is always the
        # freshest in the tracker and cannot be evicted by its own call's
        # eviction pass. Kept as a regression guard: the fix below moves the
        # write to run after cap enforcement so this holds by construction,
        # not by that ordering coincidence.
        alert2 = await svc.detect_data_exfiltration(
            db=_db(),
            user_id=victim_user,
            data_size_bytes=10 * mb,
            endpoint="/api/v1/some/export",
            ip_address="203.0.113.5",
        )
        assert alert2 is not None, (
            "cumulative data-exfiltration alert did not fire on the second "
            "call -- the tracker lost the victim user's transfer history "
            "after the first call's alert fired"
        )
        assert alert2.details["total_24h_mb"] == pytest.approx(65.0)
        assert alert2.details["transfer_count"] == 5

    async def test_rate_limit_second_call_after_batch_eviction_still_counts(self):
        svc = _svc()
        svc._MAX_TRACKING_KEYS = 10
        svc.thresholds.api_calls_per_minute = 2

        victim_ip = "203.0.113.9"
        now = datetime.now(timezone.utc)
        svc._api_calls[victim_ip] = [
            now - timedelta(seconds=30),
            now - timedelta(seconds=20),
        ]

        for i in range(20):
            svc._api_calls[f"filler-ip-{i}"] = [datetime.now(timezone.utc)]

        assert len(svc._api_calls) > svc._MAX_TRACKING_KEYS

        # Call 1 (3rd call): victim_ip is the batch-eviction target. The
        # alert correctly fires: 3 calls > the threshold of 2.
        alert1 = await svc._check_rate_limit(_db(), victim_ip, "u1")
        assert alert1 is not None
        assert alert1.details["calls_per_minute"] == 3
        assert len(svc._api_calls) <= svc._MAX_TRACKING_KEYS

        # Call 2 (4th call, same ip), asserting the count keeps accumulating
        # rather than resetting. Passes against 95db016b too --
        # _check_rate_limit already writes victim_ip's filtered window back
        # to the dict in the same statement block that reads it, *before*
        # calling _evict_stale_tracking_keys() -> _enforce_key_caps(), so
        # this call's own entry is always the freshest in the tracker and
        # cannot be evicted by its own call's eviction pass. Kept as a
        # regression guard: the fix below moves the write to run after
        # eviction so this holds by construction, not by that ordering
        # coincidence.
        alert2 = await svc._check_rate_limit(_db(), victim_ip, "u1")
        assert alert2 is not None, (
            "rate-limit alert did not fire on the second call -- the "
            "tracker lost the victim ip's call history after the first "
            "call's alert fired"
        )
        assert alert2.details["calls_per_minute"] == 4
        assert alert2.details["threshold"] == 2


class TestReportPrivilegeEscalation:
    """The convenience wrapper wired into the role/permission grant ceilings."""

    async def test_reports_and_commits_on_blocked_attempt(self):
        from app.services import security_monitoring

        db = _db()
        db.commit = AsyncMock()
        await security_monitoring.report_privilege_escalation_attempt(
            db, "user-1", "role:abc", "1.2.3.4"
        )
        # detect_privilege_escalation fires (action "modify_permissions" is
        # suspicious), so the flushed alert is committed to survive the caller's
        # subsequent 403 rollback.
        db.commit.assert_awaited()

    async def test_never_raises_when_monitoring_fails(self):
        from app.services import security_monitoring

        db = _db()
        db.commit = AsyncMock(side_effect=RuntimeError("boom"))
        # Security monitoring must never break the request it observes.
        await security_monitoring.report_privilege_escalation_attempt(
            db, "user-1", "role:abc", None
        )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
