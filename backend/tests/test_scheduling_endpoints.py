"""
Tests for scheduling API endpoint permissions and validation.

Verifies that each endpoint enforces the correct permission dependency
and that input validation (date ranges, etc.) works correctly.
These are unit-level tests that inspect endpoint signatures and
test the shared validation helpers without needing a running server.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.scheduling import (
    MAX_REPORT_DAYS,
    _can_view_platoon_roster,
    _parse_and_validate_report_dates,
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
                            # PermissionChecker instances store permissions in
                            # required_permissions; include those in the name
                            perms = getattr(call, "required_permissions", None)
                            if perms:
                                name = f"PermissionChecker({','.join(perms)})"
                            else:
                                name = getattr(call, "__name__", str(call))
                            dep_names.append(name)
                        return dep_names
        return None

    def test_list_shifts_admits_both_scheduling_grants(self):
        """Either grant reads the list, and the assertion names both.

        `permission_matches` is literal — an exact name, `scheduling.*`, or
        `*` — so `scheduling.manage` does not imply `scheduling.view`. With
        only `view` here, a position granted `scheduling.manage` alone was
        admitted to every page in Scheduling Administration and then refused
        the shifts those pages exist to list, so the close-out queue and the
        staffing-gaps list could show nothing but their load-failure state.

        Pinned exactly rather than as "some permission is required", because
        the looser assertion this replaces would have passed throughout.
        """
        deps = self._get_route_deps("/shifts", "GET")
        assert deps is not None, "Route /shifts GET not found"
        assert "PermissionChecker(scheduling.view,scheduling.manage)" in deps

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
        for path in [
            "/reports/member-hours",
            "/reports/coverage",
            "/reports/call-volume",
            "/reports/compliance",
        ]:
            deps = self._get_route_deps(path, "GET")
            assert deps is not None, f"Route {path} GET not found"
            assert any("require_permission" in d or "scheduling" in d for d in deps)

    def test_swap_review_requires_scheduling_manage(self):
        deps = self._get_route_deps("/swap-requests/{request_id}/review", "POST")
        assert (
            deps is not None
        ), "Route /swap-requests/{request_id}/review POST not found"
        assert any("require_permission" in d or "scheduling" in d for d in deps)

    def test_qualification_roster_requires_scheduling_manage(self):
        """Baseline scheduling viewers must not see members' training records.

        Narrowed from ``scheduling.manage`` OR either training grant when the
        page moved into Scheduling Administration and locked to the one grant.
        Pinned exactly, and not merely "some permission is required", because a
        client gate is not a gate: with the endpoint left wider, a training
        officer refused by the page could still pull the whole roster — member
        eligibility and EVOC standing — straight from the API.
        """
        deps = self._get_route_deps("/eligibility/roster", "GET")

        assert deps is not None, "Route /eligibility/roster GET not found"
        assert deps == ["get_db", "PermissionChecker(scheduling.manage)"]


class TestPlatoonRosterPermissions:
    """The hold-over roster must not disclose member availability broadly."""

    @staticmethod
    def _user(user_id: str, permissions: list[str]):
        position = SimpleNamespace(permissions=permissions)
        return SimpleNamespace(id=user_id, positions=[position], rank=None)

    def test_view_only_member_cannot_view_roster(self):
        shift = SimpleNamespace(shift_officer_id="officer-id")
        user = self._user("member-id", ["scheduling.view"])

        assert _can_view_platoon_roster(shift, user) is False

    @pytest.mark.parametrize("permission", ["scheduling.assign", "scheduling.manage"])
    def test_scheduler_can_view_roster(self, permission):
        shift = SimpleNamespace(shift_officer_id="officer-id")
        user = self._user("scheduler-id", [permission])

        assert _can_view_platoon_roster(shift, user) is True

    def test_shift_officer_can_view_roster(self):
        shift = SimpleNamespace(shift_officer_id="officer-id")
        user = self._user("officer-id", ["scheduling.view"])

        assert _can_view_platoon_roster(shift, user) is True


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
