"""
Tests for the trade-candidate list and the roster carried on shift responses.

The candidate list exists so a member never sends an offer that cannot be
accepted, so the exclusions are the behaviour worth pinning: already on the
shift, not cleared for the seat, or already working a shift that abuts this
one.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.api.v1.endpoints.scheduling import _enum_value, router
from app.models.training import ShiftPosition, SwapRequestStatus
from app.services.scheduling_service import SchedulingService

ORG = uuid4()
ME = uuid4()

SHIFT = SimpleNamespace(
    id="shift-1",
    shift_date=date(2026, 8, 27),
    start_time=datetime(2026, 8, 27, 22, tzinfo=timezone.utc),
    end_time=datetime(2026, 8, 28, 10, tzinfo=timezone.utc),
)


class _ScriptedSession:
    """Returns the queued results in order, one per ``execute``."""

    def __init__(self, results):
        self._results = list(results)
        self.calls = 0

    async def execute(self, _statement):
        self.calls += 1
        if not self._results:
            return _rows([])
        return self._results.pop(0)


def _rows(values):
    return SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=lambda: list(values)),
        all=lambda: list(values),
    )


def _member(user_id, name):
    return {"user_id": user_id, "user_name": name, "rank": "ff"}


def _service(*, roster, unavailable, busy, load_rows, owed_rows):
    service = SchedulingService(
        _ScriptedSession([_rows(busy), _rows(load_rows), _rows(owed_rows)])
    )
    service.get_shift_by_id = AsyncMock(return_value=SHIFT)
    service.get_unavailable_user_ids = AsyncMock(return_value=unavailable)
    eligibility = SimpleNamespace(
        get_position_roster=AsyncMock(return_value={"members": roster})
    )
    return service, eligibility


async def _run(**kwargs):
    service, eligibility = _service(**kwargs)
    with patch(
        "app.services.shift_eligibility_service.ShiftEligibilityService",
        return_value=eligibility,
    ):
        return await service.get_trade_candidates(
            ORG, "shift-1", ME, ShiftPosition.FIREFIGHTER.value
        )


class TestTradeCandidates:
    async def test_lists_a_qualified_available_member(self):
        result = await _run(
            roster=[_member("u1", "T. Nguyen")],
            unavailable=[],
            busy=[],
            load_rows=[("u1", 6)],
            owed_rows=[],
        )
        assert [c["user_id"] for c in result] == ["u1"]
        assert result[0]["shifts_this_month"] == 6
        assert result[0]["position"] == ShiftPosition.FIREFIGHTER.value

    async def test_excludes_the_offerer(self):
        result = await _run(
            roster=[_member(str(ME), "Me"), _member("u1", "T. Nguyen")],
            unavailable=[],
            busy=[],
            load_rows=[],
            owed_rows=[],
        )
        assert [c["user_id"] for c in result] == ["u1"]

    async def test_excludes_members_already_on_the_shift_or_on_leave(self):
        result = await _run(
            roster=[_member("u1", "A"), _member("u2", "B")],
            unavailable=["u1"],
            busy=[],
            load_rows=[],
            owed_rows=[],
        )
        assert [c["user_id"] for c in result] == ["u2"]

    async def test_excludes_members_working_an_abutting_shift(self):
        # Accepting would put them on a 24-hour tour.
        result = await _run(
            roster=[_member("u1", "A"), _member("u2", "B")],
            unavailable=[],
            busy=["u2"],
            load_rows=[],
            owed_rows=[],
        )
        assert [c["user_id"] for c in result] == ["u1"]

    async def test_flags_a_member_who_owes_the_offerer_a_trade(self):
        result = await _run(
            roster=[_member("u1", "A")],
            unavailable=[],
            busy=[],
            load_rows=[],
            owed_rows=["u1"],
        )
        assert result[0]["owes_trade"] is True

    async def test_sorts_least_loaded_first(self):
        result = await _run(
            roster=[_member("u1", "A"), _member("u2", "B"), _member("u3", "C")],
            unavailable=[],
            busy=[],
            load_rows=[("u1", 9), ("u2", 2)],
            owed_rows=[],
        )
        # u3 has no rows at all, so zero shifts, and leads.
        assert [c["user_id"] for c in result] == ["u3", "u2", "u1"]

    async def test_no_eligible_members_short_circuits_before_querying(self):
        service, eligibility = _service(
            roster=[], unavailable=[], busy=[], load_rows=[], owed_rows=[]
        )
        with patch(
            "app.services.shift_eligibility_service.ShiftEligibilityService",
            return_value=eligibility,
        ):
            result = await service.get_trade_candidates(
                ORG, "shift-1", ME, ShiftPosition.FIREFIGHTER.value
            )
        assert result == []
        assert service.db.calls == 0

    async def test_unknown_shift_returns_nothing(self):
        service, eligibility = _service(
            roster=[_member("u1", "A")],
            unavailable=[],
            busy=[],
            load_rows=[],
            owed_rows=[],
        )
        service.get_shift_by_id = AsyncMock(return_value=None)
        with patch(
            "app.services.shift_eligibility_service.ShiftEligibilityService",
            return_value=eligibility,
        ):
            assert (
                await service.get_trade_candidates(
                    ORG, "missing", ME, ShiftPosition.FIREFIGHTER.value
                )
                == []
            )

    async def test_month_window_covers_a_december_shift(self):
        # Rolling the month forward has to roll the year too, or a December
        # shift would compute a January-of-the-same-year window and report
        # every candidate as having no shifts at all.
        december = SimpleNamespace(
            id="shift-x",
            shift_date=date(2026, 12, 15),
            start_time=datetime(2026, 12, 15, 22, tzinfo=timezone.utc),
            end_time=datetime(2026, 12, 16, 10, tzinfo=timezone.utc),
        )
        service, eligibility = _service(
            roster=[_member("u1", "A")],
            unavailable=[],
            busy=[],
            load_rows=[("u1", 4)],
            owed_rows=[],
        )
        service.get_shift_by_id = AsyncMock(return_value=december)
        with patch(
            "app.services.shift_eligibility_service.ShiftEligibilityService",
            return_value=eligibility,
        ):
            result = await service.get_trade_candidates(
                ORG, "shift-x", ME, ShiftPosition.FIREFIGHTER.value
            )
        assert result[0]["shifts_this_month"] == 4


class TestEnumValue:
    """Enum columns hand back a member on a fresh row and a string on a load."""

    def test_unwraps_an_enum_member(self):
        assert _enum_value(ShiftPosition.DRIVER) == "driver"

    def test_passes_a_plain_string_through(self):
        assert _enum_value("driver") == "driver"

    def test_none_stays_none(self):
        assert _enum_value(None) is None


class TestRouteAuth:
    """Member self-service, like signup — not an officer permission."""

    def _deps(self, path, method):
        for route in router.routes:
            if getattr(route, "path", None) == path and method in getattr(
                route, "methods", set()
            ):
                return [
                    getattr(d.call, "__name__", str(d.call))
                    for d in route.dependant.dependencies
                ]
        return None

    def test_trade_candidates_is_open_to_any_member(self):
        deps = self._deps("/shifts/{shift_id}/trade-candidates", "GET")
        assert deps is not None
        assert any("get_current_user" in d for d in deps)

    def test_standing_shift_routes_are_open_to_any_member(self):
        for path, method in [
            ("/standing-shifts", "GET"),
            ("/standing-shifts", "POST"),
            ("/standing-shifts/preview", "GET"),
            ("/standing-shifts/{claim_id}", "DELETE"),
        ]:
            deps = self._deps(path, method)
            assert deps is not None, f"{method} {path} not registered"
            assert any("get_current_user" in d for d in deps), f"{method} {path}"


class TestSwapOfferExpiry:
    """An offer nobody accepted must not survive the shift in silence."""

    def _service(self, rows):
        service = SchedulingService(_ScriptedSession([_ExpiryRows(rows)]))
        service.db.add = lambda _obj: None
        service.db.commit = AsyncMock()
        service._notify_swap_expired = AsyncMock()
        return service

    async def test_expires_a_pending_offer_and_notifies(self):
        swap = SimpleNamespace(
            id="sw1",
            status=SwapRequestStatus.PENDING,
            reviewer_notes=None,
            requesting_user_id=str(ME),
            target_user_id="u9",
        )
        service = self._service([(swap, SHIFT)])

        count = await service.expire_stale_swap_offers(ORG, today=date(2026, 8, 26))

        assert count == 1
        assert swap.status == SwapRequestStatus.CANCELLED
        assert "Expired" in (swap.reviewer_notes or "")
        service._notify_swap_expired.assert_awaited_once()

    async def test_nothing_to_expire_does_not_write(self):
        service = self._service([])
        assert await service.expire_stale_swap_offers(ORG, today=date(2026, 8, 1)) == 0
        service.db.commit.assert_not_awaited()


class _ExpiryRows:
    """A result whose `.all()` yields (swap_request, shift) pairs."""

    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)
