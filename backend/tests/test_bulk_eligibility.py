"""
Eligible positions for many shifts, computed once.

The member-side half of the answer — membership type, rank, completed
training, the org's open positions — does not vary by shift. Asking per shift
re-ran all of it each time; a station running six apparatus paid six times for
one answer.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from app.services.shift_eligibility_service import ShiftEligibilityService

ORG = str(uuid4())


def _shift(shift_id, positions=None, open_to_all=False):
    return SimpleNamespace(
        id=shift_id, positions=positions, open_to_all_members=open_to_all
    )


class _Session:
    def __init__(self, shifts):
        self._shifts = shifts

    async def execute(self, _statement):
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: list(self._shifts))
        )


def _service(shifts, *, rank=(), training=(), open_positions=(), excluded=()):
    service = ShiftEligibilityService(_Session(shifts))
    service._get_org = AsyncMock(return_value=SimpleNamespace(id=ORG, settings={}))
    service.get_excluded_membership_types = lambda _org: list(excluded)
    service.get_open_positions = lambda _org: list(open_positions)
    service._get_rank_positions = AsyncMock(return_value=list(rank))
    service._get_training_positions = AsyncMock(return_value=list(training))
    return service


USER = SimpleNamespace(id=uuid4(), rank="ff", membership_type="active")


class TestBulkEligibility:
    async def test_computes_the_member_side_once_for_every_shift(self):
        shifts = [_shift("s1"), _shift("s2"), _shift("s3")]
        service = _service(shifts, rank=["firefighter"])

        answers = await service.get_eligible_positions_bulk(
            USER, ORG, ["s1", "s2", "s3"]
        )

        assert answers == {
            "s1": ["firefighter"],
            "s2": ["firefighter"],
            "s3": ["firefighter"],
        }
        # The expensive lookups run once, not once per shift.
        assert service._get_rank_positions.await_count == 1
        assert service._get_training_positions.await_count == 1

    async def test_narrows_to_each_shift_s_own_seats(self):
        shifts = [
            _shift("s1", positions=[{"position": "driver"}]),
            _shift("s2", positions=[{"position": "officer"}]),
        ]
        service = _service(shifts, rank=["driver", "firefighter"])

        answers = await service.get_eligible_positions_bulk(USER, ORG, ["s1", "s2"])

        assert answers["s1"] == ["driver"]
        assert answers["s2"] == []

    async def test_a_shift_naming_no_seats_does_not_narrow(self):
        service = _service([_shift("s1")], rank=["driver"], training=["officer"])
        answers = await service.get_eligible_positions_bulk(USER, ORG, ["s1"])
        assert answers["s1"] == ["driver", "officer"]

    async def test_open_to_all_bypasses_the_member_checks(self):
        shifts = [_shift("s1", positions=[{"position": "ems"}], open_to_all=True)]
        service = _service(shifts, excluded=["social"])
        blocked = SimpleNamespace(id=USER.id, rank="ff", membership_type="social")
        answers = await service.get_eligible_positions_bulk(blocked, ORG, ["s1"])
        assert answers["s1"] == ["ems"]

    async def test_an_excluded_membership_type_gets_nothing(self):
        service = _service([_shift("s1")], rank=["driver"], excluded=["social"])
        blocked = SimpleNamespace(id=USER.id, rank="ff", membership_type="social")
        answers = await service.get_eligible_positions_bulk(blocked, ORG, ["s1"])
        assert answers["s1"] == []

    async def test_an_unknown_shift_answers_empty_rather_than_absent(self):
        # A missing key would read as "not answered yet" and leave the claim
        # button waiting on a reply that already arrived.
        service = _service([], rank=["driver"])
        answers = await service.get_eligible_positions_bulk(USER, ORG, ["gone"])
        assert answers == {"gone": []}

    async def test_no_ids_asks_nothing(self):
        service = _service([])
        service._get_org = AsyncMock(side_effect=AssertionError("should not load org"))
        assert await service.get_eligible_positions_bulk(USER, ORG, []) == {}
