"""
Self-service signup respects how many people the shift holds.

Two shapes of shift, two rules. A shift with named positions was already
capped seat by seat ("Position was filled after this request was submitted").
A shift that names no positions has only ``min_staffing`` to say how big the
crew is, and nothing was reading it — so the calendar could show "Full 4/4"
while the server kept accepting a fifth, a sixth, a seventh.

Officer assignment is deliberately *not* capped: adding a fifth body to a
four-seat shift is something an officer does on purpose, and refusing it would
make the roster disagree with who is actually turning up.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from app.services.scheduling_service import SchedulingService

ORG = uuid4()
USER = uuid4()


class _ValidationSession:
    """Replays the query sequence `_validate_assignment_candidate` issues.

    In order: the member is active, they are not already on the shift, they
    have no overlapping shift, and then the seat counts. Only the counts vary
    between these tests, so the first three are fixed and every later query
    answers with `filled`.
    """

    def __init__(self, filled):
        self._filled = filled
        self.calls = 0

    async def execute(self, _statement):
        self.calls += 1
        if self.calls == 1:  # member is active and in-org
            return SimpleNamespace(scalar_one_or_none=lambda: str(USER))
        if self.calls == 2:  # not already assigned
            return SimpleNamespace(scalar_one_or_none=lambda: None)
        if self.calls == 3:  # no overlapping shift
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))
        return SimpleNamespace(scalar=lambda: self._filled)


def _shift(min_staffing, positions=None):
    return SimpleNamespace(
        id="shift-1",
        shift_date=date.today() + timedelta(days=3),
        start_time=datetime.now(timezone.utc) + timedelta(days=3),
        end_time=None,
        status="scheduled",
        is_finalized=False,
        min_staffing=min_staffing,
        positions=positions,
    )


def _service(filled):
    service = SchedulingService(_ValidationSession(filled))
    service._check_driver_qualification = AsyncMock(return_value=None)
    return service


async def _validate(service, shift, **kwargs):
    from app.services.member_leave_service import MemberLeaveService

    original = MemberLeaveService.get_active_leaves_for_user
    MemberLeaveService.get_active_leaves_for_user = AsyncMock(return_value=[])
    try:
        return await service._validate_assignment_candidate(
            organization_id=ORG,
            shift=shift,
            user_id=USER,
            position="firefighter",
            enforce_position_eligibility=False,
            **kwargs,
        )
    finally:
        MemberLeaveService.get_active_leaves_for_user = original


class TestUnnamedSeatShiftCapacity:
    async def test_a_full_crew_is_refused_for_self_signup(self):
        error = await _validate(_service(filled=4), _shift(4), enforce_capacity=True)
        assert error == "The last seat on this shift was just claimed"

    async def test_an_over_full_crew_is_also_refused(self):
        # The cap is >=, not ==: a shift that already slipped past its size
        # must not keep accepting people.
        error = await _validate(_service(filled=7), _shift(4), enforce_capacity=True)
        assert error is not None

    async def test_a_shift_with_room_is_allowed(self):
        assert (
            await _validate(_service(filled=2), _shift(4), enforce_capacity=True)
            is None
        )

    async def test_an_officer_may_still_overfill(self):
        # Not an oversight: the officer is recording who is actually coming.
        assert await _validate(_service(filled=9), _shift(4)) is None

    async def test_a_shift_with_no_stated_size_is_not_capped(self):
        # Nothing says how many seats it has, so refusing would be inventing a
        # limit the department never set.
        assert (
            await _validate(_service(filled=99), _shift(None), enforce_capacity=True)
            is None
        )

    async def test_named_positions_keep_their_own_per_seat_cap(self):
        # The headcount cap deliberately does not run here — the seat-by-seat
        # check below it is stricter and gives a better message.
        service = _service(filled=1)
        shift = _shift(4, positions=[{"position": "firefighter", "required": True}])
        error = await _validate(service, shift, enforce_capacity=True)
        assert error == "Position was filled after this request was submitted"


class TestSignupPassesTheGate:
    def test_self_signup_enforces_capacity_and_officer_assignment_does_not(self):
        import inspect

        source = inspect.getsource(SchedulingService.create_assignment)
        assert "enforce_capacity=self_signup" in source
