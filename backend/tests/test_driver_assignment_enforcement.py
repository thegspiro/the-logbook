"""
Driver qualification is enforced in the service, not at the endpoints.

`SchedulingService.create_assignment` is the one call both member self-signup
and officer assignment reach, so the block lives there. Enforcing at the two
endpoints instead would leave the rule written twice and free to diverge — and
would miss `update_assignment`, where an officer blocked at create time could
otherwise assign a member as a firefighter and PATCH the position to driver.

These are source- and unit-level assertions on the chokepoint; the decision
logic itself is covered in test_shift_eligibility_service.py. DB mocked; no
MySQL.
"""

import inspect
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.scheduling_service import SchedulingService


class TestDriverPositionDetection:
    """Whatever shape the position arrives in, the driver seat is recognised."""

    def test_plain_string(self):
        assert SchedulingService._is_driver_position("driver") is True

    def test_enum_like_value(self):
        assert SchedulingService._is_driver_position(MagicMock(value="driver")) is True

    def test_case_and_whitespace_insensitive(self):
        assert SchedulingService._is_driver_position("  Driver ") is True
        assert SchedulingService._is_driver_position("DRIVER") is True

    def test_other_positions_are_not_the_driver_seat(self):
        for position in ("firefighter", "officer", "ems", "captain", ""):
            assert SchedulingService._is_driver_position(position) is False

    def test_missing_position_is_not_the_driver_seat(self):
        assert SchedulingService._is_driver_position(None) is False


class TestCheckDriverQualification:
    def _svc(self, monkeypatch, outcome):
        svc = SchedulingService(MagicMock())
        monkeypatch.setattr(
            "app.services.shift_eligibility_service.ShiftEligibilityService",
            lambda _db: MagicMock(
                evaluate_driver_assignment=AsyncMock(return_value=outcome)
            ),
        )
        return svc

    async def test_non_driver_position_skips_the_check_entirely(self, monkeypatch):
        # No evaluation, no query — assigning a firefighter must not pay for
        # the EVOC lookup.
        called = False

        def _boom(_db):
            nonlocal called
            called = True
            raise AssertionError("should not evaluate for a non-driver position")

        monkeypatch.setattr(
            "app.services.shift_eligibility_service.ShiftEligibilityService", _boom
        )
        svc = SchedulingService(MagicMock())
        assert (
            await svc._check_driver_qualification(
                "u1", "sh1", "org-1", position="firefighter"
            )
            is None
        )
        assert called is False

    async def test_allowed_assignment_returns_no_error(self, monkeypatch):
        svc = self._svc(
            monkeypatch, {"allowed": True, "blocked_reason": None, "warnings": []}
        )
        assert (
            await svc._check_driver_qualification(
                "u1", "sh1", "org-1", position="driver"
            )
            is None
        )

    async def test_blocked_assignment_returns_the_reason(self, monkeypatch):
        svc = self._svc(
            monkeypatch,
            {
                "allowed": False,
                "blocked_reason": "Requires EVOC Level 3.",
                "warnings": [],
            },
        )
        assert (
            await svc._check_driver_qualification(
                "u1", "sh1", "org-1", position="driver"
            )
            == "Requires EVOC Level 3."
        )


class TestEnforcementIsWiredIntoBothWritePaths:
    """Both paths that can seat a driver must consult the check.

    Source assertions: a future edit that drops the call from either path is
    the failure this catches, and it cannot be caught by exercising one path.
    """

    def test_create_assignment_checks_qualification(self):
        source = inspect.getsource(SchedulingService.create_assignment)
        assert "_check_driver_qualification" in source

    def test_create_assignment_returns_before_persisting(self):
        # The check must gate the insert, not merely annotate it.
        source = inspect.getsource(SchedulingService.create_assignment)
        check_at = source.index("_check_driver_qualification")
        insert_at = source.index("assignment = ShiftAssignment(")
        assert check_at < insert_at

    def test_update_assignment_rechecks_on_position_change(self):
        source = inspect.getsource(SchedulingService.update_assignment)
        assert "_check_driver_qualification" in source

    def test_update_assignment_checks_before_applying_the_change(self):
        source = inspect.getsource(SchedulingService.update_assignment)
        check_at = source.index("_check_driver_qualification")
        apply_at = source.index("for key, value in update_data.items()")
        assert check_at < apply_at


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
