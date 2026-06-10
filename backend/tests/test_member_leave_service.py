"""
Tests for the member leave-of-absence service
(app/services/member_leave_service.py).

The highest-risk logic is ``count_leave_months`` — the pure date math that
decides which calendar months are excluded from rolling-period training
compliance. Also covers the auto-linked training-waiver lifecycle on
create/update/deactivate. The DB session is mocked, so no MySQL is needed.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.member_leave_service import MemberLeaveService


def _leave(start, end, **kw):
    return SimpleNamespace(start_date=start, end_date=end, **kw)


class TestCountLeaveMonths:
    P_START = date(2026, 1, 1)
    P_END = date(2026, 12, 31)

    def count(self, leaves):
        return MemberLeaveService.count_leave_months(leaves, self.P_START, self.P_END)

    def test_no_leaves(self):
        assert self.count([]) == 0

    def test_full_single_month(self):
        assert self.count([_leave(date(2026, 3, 1), date(2026, 3, 31))]) == 1

    def test_partial_month_not_counted(self):
        # Members partially active in a month keep credit for it.
        assert self.count([_leave(date(2026, 3, 5), date(2026, 3, 31))]) == 0
        assert self.count([_leave(date(2026, 3, 1), date(2026, 3, 30))]) == 0

    def test_multi_month_span_counts_only_full_months(self):
        # Jan 15 – Apr 10: only February and March are fully covered.
        assert self.count([_leave(date(2026, 1, 15), date(2026, 4, 10))]) == 2

    def test_year_boundary(self):
        leaves = [_leave(date(2025, 11, 20), date(2026, 2, 15))]
        # Within the 2026 evaluation window only January is fully covered.
        assert self.count(leaves) == 1

    def test_permanent_leave_counts_full_months_to_period_end(self):
        # Permanent leave starting June 1 with the period ending Dec 31:
        # June through December are all fully covered.
        assert self.count([_leave(date(2026, 6, 1), None)]) == 7

    def test_permanent_leave_partial_final_month(self):
        # Period ends mid-month: the in-progress month is not a full month.
        n = MemberLeaveService.count_leave_months(
            [_leave(date(2026, 6, 1), None)], date(2026, 1, 1), date(2026, 8, 15)
        )
        assert n == 2  # June, July — August is partial

    def test_overlapping_leaves_do_not_double_count(self):
        leaves = [
            _leave(date(2026, 3, 1), date(2026, 4, 30)),
            _leave(date(2026, 4, 1), date(2026, 5, 31)),
        ]
        assert self.count(leaves) == 3  # March, April, May

    def test_leave_outside_period(self):
        assert self.count([_leave(date(2025, 1, 1), date(2025, 12, 31))]) == 0


class TestCreateLeave:
    def _service(self):
        db = MagicMock()
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        return MemberLeaveService(db), db

    async def test_creates_linked_waiver_by_default(self):
        service, db = self._service()
        leave = await service.create_leave(
            organization_id="org",
            user_id="u1",
            start_date=date(2026, 6, 1),
            end_date=date(2026, 8, 31),
            leave_type="medical",
            reason="Surgery recovery",
            granted_by="admin",
        )
        # Two adds: the waiver first, then the leave, linked together.
        assert db.add.call_count == 2
        waiver = db.add.call_args_list[0].args[0]
        assert leave.linked_training_waiver_id == str(waiver.id)
        assert waiver.user_id == "u1"
        assert "Surgery recovery" in waiver.reason
        assert waiver.active is True

    async def test_exempt_skips_waiver(self):
        service, db = self._service()
        leave = await service.create_leave(
            organization_id="org",
            user_id="u1",
            start_date=date(2026, 6, 1),
            exempt_from_training_waiver=True,
        )
        assert db.add.call_count == 1  # only the leave
        assert leave.linked_training_waiver_id is None

    async def test_unknown_leave_type_falls_back_to_other(self):
        service, _ = self._service()
        leave = await service.create_leave(
            organization_id="org",
            user_id="u1",
            start_date=date(2026, 6, 1),
            leave_type="sabbatical-on-mars",
            exempt_from_training_waiver=True,
        )
        assert leave.leave_type.value == "other"


class TestUpdateLeaveWaiverSync:
    def _service(self, leave, waiver=None):
        db = MagicMock()
        # First execute: get_leave; later executes: waiver lookups.
        results = [MagicMock(scalar_one_or_none=MagicMock(return_value=leave))]
        if waiver is not None:
            results.append(MagicMock(scalar_one_or_none=MagicMock(return_value=waiver)))
        db.execute = AsyncMock(side_effect=results)
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        return MemberLeaveService(db), db

    def _existing_leave(self, **kw):
        from app.models.user import LeaveType

        return SimpleNamespace(
            id="leave-1",
            user_id="u1",
            organization_id="org",
            leave_type=LeaveType.OTHER,
            reason="r",
            start_date=date(2026, 6, 1),
            end_date=date(2026, 8, 31),
            granted_by=None,
            active=True,
            exempt_from_training_waiver=kw.get("exempt", False),
            linked_training_waiver_id=kw.get("waiver_id"),
            updated_at=None,
        )

    async def test_becoming_exempt_deactivates_linked_waiver(self):
        waiver = SimpleNamespace(active=True, updated_at=None)
        leave = self._existing_leave(exempt=False, waiver_id="w-1")
        service, _ = self._service(leave, waiver)

        updated = await service.update_leave(
            "org", "leave-1", exempt_from_training_waiver=True
        )
        assert updated is leave
        assert waiver.active is False
        assert leave.linked_training_waiver_id is None

    async def test_clearing_exempt_creates_linked_waiver(self):
        leave = self._existing_leave(exempt=True, waiver_id=None)
        service, db = self._service(leave)

        await service.update_leave("org", "leave-1", exempt_from_training_waiver=False)
        assert db.add.call_count == 1  # the new waiver
        assert leave.linked_training_waiver_id is not None

    async def test_date_change_syncs_to_linked_waiver(self):
        waiver = SimpleNamespace(
            start_date=date(2026, 6, 1), end_date=date(2026, 8, 31), updated_at=None
        )
        leave = self._existing_leave(exempt=False, waiver_id="w-1")
        service, _ = self._service(leave, waiver)

        await service.update_leave("org", "leave-1", end_date=date(2026, 9, 30))
        assert leave.end_date == date(2026, 9, 30)
        assert waiver.end_date == date(2026, 9, 30)

    async def test_unknown_leave_returns_none(self):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        )
        service = MemberLeaveService(db)
        assert await service.update_leave("org", "nope", reason="x") is None


class TestDeactivateLeave:
    async def test_deactivates_leave_and_linked_waiver(self):
        waiver = SimpleNamespace(active=True, updated_at=None)
        leave = SimpleNamespace(
            active=True, linked_training_waiver_id="w-1", updated_at=None
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=MagicMock(return_value=leave)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=waiver)),
            ]
        )
        db.commit = AsyncMock()
        service = MemberLeaveService(db)

        assert await service.deactivate_leave("org", "leave-1") is True
        assert leave.active is False
        assert waiver.active is False

    async def test_unknown_leave_returns_false(self):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        )
        assert await MemberLeaveService(db).deactivate_leave("org", "x") is False


class TestBatchedLeaveLookup:
    async def test_empty_user_list_short_circuits(self):
        db = MagicMock()
        db.execute = AsyncMock()
        result = await MemberLeaveService(db).get_active_leaves_for_users(
            "org", [], date(2026, 1, 1), date(2026, 12, 31)
        )
        assert result == {}
        db.execute.assert_not_awaited()
