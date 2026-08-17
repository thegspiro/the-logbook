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
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.error_codes import CodedValueError, ErrorCode
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

    async def test_allowed_assignment_returns_the_verdict(self, monkeypatch):
        # Returned rather than discarded so callers can surface the operating
        # restrictions an approved exception was granted under.
        verdict = {"allowed": True, "blocked_reason": None, "warnings": [{"m": 1}]}
        svc = self._svc(monkeypatch, verdict)
        assert (
            await svc._check_driver_qualification(
                "u1", "sh1", "org-1", position="driver"
            )
            == verdict
        )

    async def test_blocked_assignment_raises_with_the_reason(self, monkeypatch):
        svc = self._svc(
            monkeypatch,
            {
                "allowed": False,
                "blocked_reason": "Requires EVOC Level 3.",
                "warnings": [],
            },
        )
        with pytest.raises(CodedValueError, match="Requires EVOC Level 3."):
            await svc._check_driver_qualification(
                "u1", "sh1", "org-1", position="driver"
            )

    async def test_the_refusal_carries_its_support_code(self, monkeypatch):
        # The UI keys its "request an exception" offer off this code; matching
        # on the message text would break the moment the wording changed.
        svc = self._svc(
            monkeypatch,
            {"allowed": False, "blocked_reason": "Nope.", "warnings": []},
        )
        with pytest.raises(CodedValueError) as caught:
            await svc._check_driver_qualification(
                "u1", "sh1", "org-1", position="driver"
            )
        assert caught.value.error_code is ErrorCode.SCHED_DRIVER_NOT_QUALIFIED


class TestEnforcementIsWiredIntoBothWritePaths:
    """Both paths that can seat a driver must consult the check.

    Source assertions: a future edit that drops the call from either path is
    the failure this catches, and it cannot be caught by exercising one path.
    """

    def test_create_assignment_checks_qualification(self):
        source = inspect.getsource(SchedulingService.create_assignment)
        assert "_check_driver_qualification" in source

    def test_create_assignment_does_not_swallow_the_refusal(self):
        # A bare `except Exception` would flatten the coded refusal into an
        # anonymous 400 and the UI would lose its cue to offer help.
        source = inspect.getsource(SchedulingService.create_assignment)
        assert "except CodedValueError" in source
        assert source.index("except CodedValueError") < source.index(
            "except Exception as e"
        )

    def test_update_assignment_does_not_swallow_the_refusal(self):
        source = inspect.getsource(SchedulingService.update_assignment)
        assert "except CodedValueError" in source

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


class TestEveryWritePathIsCovered:
    """The block is only as good as the narrowest gap left around it.

    Source assertions on the three remaining ways a driver reaches a seat:
    pattern generation writes assignments directly, and a shift edit can move
    the apparatus or date out from under an assignment that was fine when it
    was made.
    """

    def test_pattern_generation_checks_each_driver(self):
        source = inspect.getsource(SchedulingService.generate_shifts_from_pattern)
        assert "_check_driver_qualification_message" in source

    def test_pattern_generation_skips_rather_than_aborting(self):
        # One unqualified member must not fail the whole generation run; the
        # occurrence is created with that seat empty and the skip reported.
        source = inspect.getsource(SchedulingService.generate_shifts_from_pattern)
        check_at = source.index("_check_driver_qualification_message")
        insert_at = source.index("assignment = ShiftAssignment(")
        assert check_at < insert_at
        assert "skipped_drivers.append" in source

    def test_shift_edits_revalidate_drivers(self):
        source = inspect.getsource(SchedulingService.update_shift)
        assert "_requalify_drivers_for_shift_change" in source

    def test_revalidation_gates_the_write(self):
        source = inspect.getsource(SchedulingService.update_shift)
        check_at = source.index("_requalify_drivers_for_shift_change")
        apply_at = source.index("for key, value in update_data.items()")
        assert check_at < apply_at

    def test_revalidation_watches_apparatus_and_date(self):
        source = inspect.getsource(
            SchedulingService._requalify_drivers_for_shift_change
        )
        assert '"apparatus_id", "shift_date"' in source


class TestRequalifyOnShiftChange:
    def _shift(self, apparatus_id="ap1", shift_date="2026-09-04"):
        return SimpleNamespace(
            id="sh1", apparatus_id=apparatus_id, shift_date=shift_date
        )

    def _db(self, assignments):
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = assignments
        db.execute = AsyncMock(return_value=result)
        db.flush = AsyncMock()
        db.add = MagicMock()
        return db

    async def test_unrelated_edit_costs_nothing(self):
        # Renaming a shift must not pay for a driver re-check.
        db = self._db([])
        db.execute = AsyncMock(side_effect=AssertionError("should not query"))
        svc = SchedulingService(db)
        assert (
            await svc._requalify_drivers_for_shift_change(
                self._shift(), "org-1", {"notes": "hi"}
            )
            is None
        )

    async def test_no_drivers_on_the_shift_is_allowed(self):
        svc = SchedulingService(self._db([]))
        assert (
            await svc._requalify_drivers_for_shift_change(
                self._shift(), "org-1", {"apparatus_id": "ap2"}
            )
            is None
        )

    async def test_blocks_when_a_seated_driver_would_not_qualify(self, monkeypatch):
        assignment = SimpleNamespace(user_id="u1", position="driver")
        db = self._db([assignment])
        svc = SchedulingService(db)

        async def _blocked(**kwargs):
            return "Requires EVOC Level 3."

        monkeypatch.setattr(svc, "_check_driver_qualification_message", _blocked)
        error = await svc._requalify_drivers_for_shift_change(
            self._shift(), "org-1", {"apparatus_id": "ap2"}
        )
        assert error is not None
        assert "Requires EVOC Level 3." in error

    async def test_restores_the_shift_after_evaluating(self, monkeypatch):
        # The pending values are applied so the check sees the shift as it
        # would be, then rolled back — a rejected edit must not leave the
        # in-memory shift mutated.
        assignment = SimpleNamespace(user_id="u1", position="driver")
        shift = self._shift(apparatus_id="ap1")
        svc = SchedulingService(self._db([assignment]))

        async def _blocked(**kwargs):
            return "nope"

        monkeypatch.setattr(svc, "_check_driver_qualification_message", _blocked)
        await svc._requalify_drivers_for_shift_change(
            shift, "org-1", {"apparatus_id": "ap2"}
        )
        assert shift.apparatus_id == "ap1"


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
