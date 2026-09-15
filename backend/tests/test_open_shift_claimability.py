"""The open-shift board offers seats the signup validator will actually give.

A member was shown a shift on the open-shift board, chose their position, and
was refused with "Position was filled after this request was submitted" — a
message about a race, for a seat that had been full for days. Two checks were
answering two different questions and never intersecting them:
``filter_shifts_with_open_positions`` asked whether the *shift* still had an
unfilled required seat, and the eligibility filter asked whether the *member*
was cleared for any position on it. A shift with an empty driver's seat and a
full firefighter seat passed both for a firefighter.

These pin the seat-level answer, and pin it to the validator's rules rather
than the listing's: every seat counts, not only ``required`` ones, and a seat
is held by any assignment that is not declined or cancelled.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api.v1.endpoints import scheduling
from app.models.training import AssignmentStatus
from app.services import scheduling_service as scheduling_service_module
from app.services.scheduling_service import SchedulingService

ORG = "org-1"
MEMBER = "member-1"


def _shift(shift_id, positions=None, min_staffing=None, is_outreach=False):
    return SimpleNamespace(
        id=shift_id,
        positions=positions,
        min_staffing=min_staffing,
        apparatus_id=None,
        is_outreach=is_outreach,
    )


def _seat(position, required=True):
    return {"position": position, "required": required}


class _Session:
    """Answers the query sequence these paths issue, in order.

    ``open_positions_by_shift`` issues exactly one statement (the assignment
    scan); ``_open_shift_candidates`` issues one before it. Anything further is
    a change in the code under test and should fail loudly rather than be
    absorbed by a permissive stub.
    """

    def __init__(self, *responses):
        self._responses = list(responses)
        self.calls = 0

    async def execute(self, _statement):
        self.calls += 1
        if not self._responses:
            raise AssertionError(f"unexpected query #{self.calls}")
        return self._responses.pop(0)


def _assignments(*rows):
    """A result standing in for the (shift_id, user_id, position) scan."""
    return SimpleNamespace(all=lambda: list(rows))


def _shift_rows(shifts):
    return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: list(shifts)))


@pytest.fixture(autouse=True)
def _no_apparatus_lookup(monkeypatch):
    """No shift here carries an apparatus, so the fallback map is always empty."""
    monkeypatch.setattr(
        scheduling_service_module,
        "resolve_apparatus_display_map",
        AsyncMock(return_value={}),
    )


@pytest.mark.unit
class TestOpenPositionsByShift:
    async def test_a_full_position_is_not_reported_open(self):
        shift = _shift("s1", [_seat("driver"), _seat("firefighter")])
        session = _Session(_assignments(("s1", "other", "firefighter")))

        seats = await SchedulingService(session).open_positions_by_shift(ORG, [shift])

        assert seats["s1"].positions == {"driver"}
        assert seats["s1"].has_named_seats is True

    async def test_duplicate_seats_are_counted_one_by_one(self):
        # Two firefighter seats, one taken: the position is still open.
        shift = _shift("s1", [_seat("firefighter"), _seat("firefighter")])
        session = _Session(_assignments(("s1", "other", "firefighter")))

        seats = await SchedulingService(session).open_positions_by_shift(ORG, [shift])

        assert seats["s1"].positions == {"firefighter"}

    async def test_an_optional_seat_counts_as_open(self):
        # The validator caps a position at every seat named for it, required or
        # not, so an unclaimed optional seat is one a member can genuinely take.
        # The staffing-gap listing drops these on purpose; this must not.
        shift = _shift("s1", [_seat("driver"), _seat("firefighter", required=False)])
        session = _Session(_assignments(("s1", "other", "driver")))

        seats = await SchedulingService(session).open_positions_by_shift(ORG, [shift])

        assert seats["s1"].positions == {"firefighter"}

    async def test_names_are_matched_casefolded(self):
        shift = _shift("s1", [_seat("Firefighter")])
        session = _Session(_assignments(("s1", "other", "firefighter")))

        seats = await SchedulingService(session).open_positions_by_shift(ORG, [shift])

        assert seats["s1"].positions == set()

    async def test_a_legacy_bare_string_seat_list_is_understood(self):
        shift = _shift("s1", ["driver", "firefighter"])
        session = _Session(_assignments(("s1", "other", "driver")))

        seats = await SchedulingService(session).open_positions_by_shift(ORG, [shift])

        assert seats["s1"].positions == {"firefighter"}

    async def test_a_shift_the_member_already_holds_offers_nothing(self):
        shift = _shift("s1", [_seat("driver"), _seat("firefighter")])
        session = _Session(_assignments(("s1", MEMBER, "driver")))

        seats = await SchedulingService(session).open_positions_by_shift(
            ORG, [shift], exclude_user_id=MEMBER
        )

        assert seats["s1"].member_already_assigned is True
        assert seats["s1"].positions == set()

    async def test_an_unnamed_seat_shift_reports_headroom_against_min_staffing(self):
        shift = _shift("s1", min_staffing=2)
        session = _Session(_assignments(("s1", "other", "firefighter")))

        seats = await SchedulingService(session).open_positions_by_shift(ORG, [shift])

        assert seats["s1"].has_named_seats is False
        assert seats["s1"].unnamed_headroom is True

    async def test_an_unnamed_seat_shift_at_capacity_reports_no_headroom(self):
        shift = _shift("s1", min_staffing=1)
        session = _Session(_assignments(("s1", "other", "firefighter")))

        seats = await SchedulingService(session).open_positions_by_shift(ORG, [shift])

        assert seats["s1"].unnamed_headroom is False

    async def test_a_shift_that_states_no_size_is_left_uncapped(self):
        # The validator caps such a shift at nothing at all. Inventing a crew of
        # one here would hide a shift a member could join because nobody had
        # finished configuring it.
        shift = _shift("s1")
        session = _Session(_assignments(("s1", "a", "ems"), ("s1", "b", "ems")))

        seats = await SchedulingService(session).open_positions_by_shift(ORG, [shift])

        assert seats["s1"].unnamed_headroom is None

    async def test_no_shifts_issues_no_query(self):
        session = _Session()

        assert await SchedulingService(session).open_positions_by_shift(ORG, []) == {}
        assert session.calls == 0


@pytest.mark.unit
class TestWhichAssignmentsHoldASeat:
    """The validator's set, not the listing's.

    ``_validate_assignment_candidate`` counts every assignment that is not
    declined or cancelled. The staffing listing counts only assigned/confirmed,
    which left ``pending`` and ``no_show`` holding a seat against the validator
    and not against the board — the same mismatch one status further along.
    """

    @pytest.mark.parametrize(
        "status",
        [
            AssignmentStatus.ASSIGNED,
            AssignmentStatus.CONFIRMED,
            AssignmentStatus.PENDING,
            AssignmentStatus.NO_SHOW,
        ],
    )
    def test_the_status_is_not_excluded_from_the_scan(self, status):
        assert status not in SchedulingService.INACTIVE_ASSIGNMENT_STATUSES

    @pytest.mark.parametrize(
        "status", [AssignmentStatus.DECLINED, AssignmentStatus.CANCELLED]
    )
    def test_a_released_seat_is_excluded(self, status):
        assert status in SchedulingService.INACTIVE_ASSIGNMENT_STATUSES


@pytest.mark.unit
class TestGetClaimableShifts:
    """The board, as one member sees it."""

    @staticmethod
    def _service(shifts, assignments, eligible, monkeypatch):
        session = _Session(_shift_rows(shifts), _assignments(*assignments))
        monkeypatch.setattr(
            "app.services.shift_eligibility_service.ShiftEligibilityService"
            ".get_eligible_positions_bulk",
            AsyncMock(return_value=eligible),
        )
        return SchedulingService(session)

    @staticmethod
    async def _run(service):
        today = date.today()
        return await service.get_claimable_shifts(
            SimpleNamespace(id=MEMBER, organization_id=ORG),
            ORG,
            today,
            today + timedelta(days=30),
        )

    async def test_the_reported_bug_a_full_position_hides_the_shift(self, monkeypatch):
        # Driver open, firefighter taken; the member is cleared for firefighter
        # only. Before this change the shift was listed and signup returned 400.
        shift = _shift("s1", [_seat("driver"), _seat("firefighter")])
        service = self._service(
            [shift],
            [("s1", "other", "firefighter")],
            {"s1": ["firefighter"]},
            monkeypatch,
        )

        assert await self._run(service) == []

    async def test_the_same_shift_is_still_offered_to_a_driver(self, monkeypatch):
        shift = _shift("s1", [_seat("driver"), _seat("firefighter")])
        service = self._service(
            [shift],
            [("s1", "other", "firefighter")],
            {"s1": ["driver"]},
            monkeypatch,
        )

        assert await self._run(service) == [shift]

    async def test_a_member_cleared_for_both_keeps_the_shift(self, monkeypatch):
        shift = _shift("s1", [_seat("driver"), _seat("firefighter")])
        service = self._service(
            [shift],
            [("s1", "other", "firefighter")],
            {"s1": ["driver", "firefighter"]},
            monkeypatch,
        )

        assert await self._run(service) == [shift]

    async def test_a_free_optional_seat_makes_the_shift_claimable(self, monkeypatch):
        shift = _shift("s1", [_seat("driver"), _seat("ems", required=False)])
        service = self._service(
            [shift], [("s1", "other", "driver")], {"s1": ["ems"]}, monkeypatch
        )

        assert await self._run(service) == [shift]

    async def test_a_pending_signup_holds_the_seat(self, monkeypatch):
        # The scan excludes only declined/cancelled rows, so a pending row
        # arrives here and must consume its seat — the validator counts it.
        shift = _shift("s1", [_seat("firefighter")])
        service = self._service(
            [shift],
            [("s1", "other", "firefighter")],
            {"s1": ["firefighter"]},
            monkeypatch,
        )

        assert await self._run(service) == []

    async def test_an_ineligible_member_still_sees_nothing(self, monkeypatch):
        shift = _shift("s1", [_seat("driver")])
        service = self._service([shift], [], {"s1": []}, monkeypatch)

        assert await self._run(service) == []

    async def test_an_unnamed_seat_shift_with_room_is_offered(self, monkeypatch):
        shift = _shift("s1", min_staffing=3)
        service = self._service(
            [shift], [("s1", "other", "ems")], {"s1": ["ems"]}, monkeypatch
        )

        assert await self._run(service) == [shift]

    async def test_an_unnamed_seat_shift_at_capacity_is_hidden(self, monkeypatch):
        shift = _shift("s1", min_staffing=1)
        service = self._service(
            [shift], [("s1", "other", "ems")], {"s1": ["ems"]}, monkeypatch
        )

        assert await self._run(service) == []

    async def test_a_shift_with_no_stated_size_stays_claimable(self, monkeypatch):
        shift = _shift("s1")
        service = self._service(
            [shift], [("s1", "other", "ems")], {"s1": ["ems"]}, monkeypatch
        )

        assert await self._run(service) == [shift]

    async def test_a_shift_the_member_is_already_on_is_dropped(self, monkeypatch):
        shift = _shift("s1", [_seat("driver"), _seat("firefighter")])
        service = self._service(
            [shift], [("s1", MEMBER, "driver")], {"s1": ["firefighter"]}, monkeypatch
        )

        assert await self._run(service) == []

    async def test_an_empty_window_asks_nothing_further(self, monkeypatch):
        session = _Session(_shift_rows([]))
        bulk = AsyncMock(side_effect=AssertionError("eligibility must not run"))
        monkeypatch.setattr(
            "app.services.shift_eligibility_service.ShiftEligibilityService"
            ".get_eligible_positions_bulk",
            bulk,
        )

        assert await self._run(SchedulingService(session)) == []
        bulk.assert_not_awaited()


@pytest.mark.unit
class TestOutreachSheetsKeepTheShiftLevelRule:
    """Their seats are roles, not positions.

    Signup rewrites an outreach position to a single placeholder seat and the
    endpoint reports per-role ``remaining`` counts the client filters on, so
    intersecting an outreach sheet's positions would be a second, wrong rule.
    """

    async def test_an_outreach_sheet_is_judged_by_the_shift_level_check(
        self, monkeypatch
    ):
        shift = _shift("s1", [_seat("volunteer")], is_outreach=True)
        session = _Session(_shift_rows([shift]))
        monkeypatch.setattr(
            "app.services.shift_eligibility_service.ShiftEligibilityService"
            ".get_eligible_positions_bulk",
            AsyncMock(return_value={"s1": ["volunteer"]}),
        )
        # The outreach branch goes through filter_shifts_with_open_positions,
        # which is left exactly as the staffing report and the MCP tool read it.
        monkeypatch.setattr(
            SchedulingService,
            "filter_shifts_with_open_positions",
            AsyncMock(return_value=[shift]),
        )
        service = SchedulingService(session)
        today = date.today()

        kept = await service.get_claimable_shifts(
            SimpleNamespace(id=MEMBER, organization_id=ORG),
            ORG,
            today,
            today + timedelta(days=30),
        )

        assert kept == [shift]

    async def test_a_full_outreach_sheet_is_dropped(self, monkeypatch):
        shift = _shift("s1", [_seat("volunteer")], is_outreach=True)
        session = _Session(_shift_rows([shift]))
        monkeypatch.setattr(
            "app.services.shift_eligibility_service.ShiftEligibilityService"
            ".get_eligible_positions_bulk",
            AsyncMock(return_value={"s1": ["volunteer"]}),
        )
        monkeypatch.setattr(
            SchedulingService,
            "filter_shifts_with_open_positions",
            AsyncMock(return_value=[]),
        )

        kept = await SchedulingService(session).get_claimable_shifts(
            SimpleNamespace(id=MEMBER, organization_id=ORG),
            ORG,
            date.today(),
            date.today() + timedelta(days=30),
        )

        assert kept == []


@pytest.mark.unit
class TestTheEndpointKeepsTheManagerView:
    """`scheduling.manage` still gets the department-wide staffing-gap list.

    This tab is also how a scheduling admin finds the gaps, so narrowing it to
    the seats they personally could ride would take a tool away.
    """

    @staticmethod
    def _request(monkeypatch, is_manager):
        monkeypatch.setattr(scheduling, "user_has_permission", lambda *_a: is_manager)
        open_shifts = AsyncMock(return_value=[])
        claimable = AsyncMock(return_value=[])
        monkeypatch.setattr(SchedulingService, "get_open_shifts", open_shifts)
        monkeypatch.setattr(SchedulingService, "get_claimable_shifts", claimable)
        monkeypatch.setattr(scheduling, "_enrich_shifts", AsyncMock(return_value=[]))
        return open_shifts, claimable

    async def test_a_manager_gets_the_department_wide_list(self, monkeypatch):
        open_shifts, claimable = self._request(monkeypatch, is_manager=True)

        await scheduling.get_open_shifts(
            db=SimpleNamespace(),
            current_user=SimpleNamespace(id=MEMBER, organization_id=ORG),
        )

        open_shifts.assert_awaited_once()
        claimable.assert_not_awaited()

    async def test_a_member_gets_the_seat_level_list(self, monkeypatch):
        open_shifts, claimable = self._request(monkeypatch, is_manager=False)

        await scheduling.get_open_shifts(
            db=SimpleNamespace(),
            current_user=SimpleNamespace(id=MEMBER, organization_id=ORG),
        )

        claimable.assert_awaited_once()
        open_shifts.assert_not_awaited()
