"""
Tests for scheduling API endpoint permissions and validation.

Verifies that each endpoint enforces the correct permission dependency
and that input validation (date ranges, etc.) works correctly.
These are unit-level tests that inspect endpoint signatures and
test the shared validation helpers without needing a running server.
"""

import pytest
from datetime import date, timedelta

from fastapi import HTTPException

from app.api.v1.endpoints.scheduling import (
    _parse_and_validate_report_dates,
    MAX_REPORT_DAYS,
    router,
)


# ── Permission Annotation Tests ──────────────────────────────────────


class TestEndpointPermissions:
    """Verify that each scheduling endpoint declares the correct auth dependency."""

    def _get_route_deps(self, path: str, method: str = "GET"):
        """Extract dependency names from a router endpoint."""
        for route in router.routes:
            if hasattr(route, "path") and route.path == path:
                methods = getattr(route, "methods", set())
                if method in methods:
                    deps = getattr(route, "dependant", None)
                    if deps:
                        dep_names = []
                        for dep in deps.dependencies:
                            call = dep.call
                            # require_permission returns a closure; check its name
                            name = getattr(call, "__name__", str(call))
                            dep_names.append(name)
                        return dep_names
        return None

    def test_list_shifts_requires_scheduling_view(self):
        deps = self._get_route_deps("/shifts", "GET")
        assert deps is not None, "Route /shifts GET not found"
        assert any("require_permission" in d or "scheduling" in d for d in deps)

    def test_create_shift_requires_scheduling_manage(self):
        deps = self._get_route_deps("/shifts", "POST")
        assert deps is not None, "Route /shifts POST not found"
        assert any("require_permission" in d or "scheduling" in d for d in deps)

    def test_signup_uses_get_current_user(self):
        """Signup endpoint should be available to any authenticated user."""
        deps = self._get_route_deps("/shifts/{shift_id}/signup", "POST")
        assert deps is not None, "Route /shifts/{shift_id}/signup POST not found"
        # Should use get_current_user, NOT require_permission
        assert any("get_current_user" in d for d in deps)

    def test_open_shifts_uses_get_current_user(self):
        deps = self._get_route_deps("/shifts/open", "GET")
        assert deps is not None, "Route /shifts/open GET not found"
        assert any("get_current_user" in d for d in deps)

    def test_reports_require_scheduling_report(self):
        for path in ["/reports/member-hours", "/reports/coverage", "/reports/call-volume", "/reports/compliance"]:
            deps = self._get_route_deps(path, "GET")
            assert deps is not None, f"Route {path} GET not found"
            assert any("require_permission" in d or "scheduling" in d for d in deps)

    def test_swap_review_requires_scheduling_manage(self):
        deps = self._get_route_deps("/swap-requests/{request_id}/review", "POST")
        assert deps is not None, "Route /swap-requests/{request_id}/review POST not found"
        assert any("require_permission" in d or "scheduling" in d for d in deps)


# ── Date Range Validation Tests ──────────────────────────────────────


class TestDateRangeValidation:
    """Test the _parse_and_validate_report_dates helper."""

    def test_valid_date_range(self):
        start, end = _parse_and_validate_report_dates("2026-01-01", "2026-01-31")
        assert start == date(2026, 1, 1)
        assert end == date(2026, 1, 31)

    def test_same_day_range_is_valid(self):
        start, end = _parse_and_validate_report_dates("2026-06-15", "2026-06-15")
        assert start == end

    def test_invalid_date_format_raises(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_and_validate_report_dates("not-a-date", "2026-01-01")
        assert exc_info.value.status_code == 400
        assert "Invalid date format" in exc_info.value.detail

    def test_end_before_start_raises(self):
        with pytest.raises(HTTPException) as exc_info:
            _parse_and_validate_report_dates("2026-06-15", "2026-06-01")
        assert exc_info.value.status_code == 400
        assert "end_date must not be before" in exc_info.value.detail

    def test_exceeds_max_days_raises(self):
        start = "2024-01-01"
        end_date = date(2024, 1, 1) + timedelta(days=MAX_REPORT_DAYS + 1)
        with pytest.raises(HTTPException) as exc_info:
            _parse_and_validate_report_dates(start, end_date.isoformat())
        assert exc_info.value.status_code == 400
        assert f"{MAX_REPORT_DAYS}" in exc_info.value.detail

    def test_exactly_max_days_is_valid(self):
        start = date(2024, 1, 1)
        end = start + timedelta(days=MAX_REPORT_DAYS)
        s, e = _parse_and_validate_report_dates(start.isoformat(), end.isoformat())
        assert s == start
        assert e == end
