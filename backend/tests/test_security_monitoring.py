"""
Tests for the security monitoring service
(app/services/security_monitoring.py).

Covers the in-memory threat detection that has no external deps: injection
pattern matching (SQLi / XSS / path traversal), per-IP API rate limiting,
and brute-force login detection. The audit-log call is stubbed. DB mocked.
"""

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


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
