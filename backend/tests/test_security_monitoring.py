"""
Tests for the security monitoring service
(app/services/security_monitoring.py).

Covers the in-memory threat detection that has no external deps: injection
pattern matching (SQLi / XSS / path traversal), per-IP API rate limiting,
and brute-force login detection. The audit-log call is stubbed. DB mocked.
"""

from datetime import datetime, timezone
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
