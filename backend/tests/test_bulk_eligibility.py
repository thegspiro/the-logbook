"""
Eligible positions for many shifts, computed once.

The member-side half of the answer — membership type, rank, held positions,
completed training, the org's open positions — does not vary by shift. Asking per shift
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


def _service(
    shifts,
    *,
    rank=(),
    held=(),
    grants=None,
    training=(),
    qualifications=(),
    open_positions=(),
    excluded=(),
):
    """``rank`` is what USER's rank code ("ff") grants; ``grants`` adds slugs."""
    service = ShiftEligibilityService(_Session(shifts))
    service._get_org = AsyncMock(return_value=SimpleNamespace(id=ORG, settings={}))
    service.get_excluded_membership_types = lambda _org: list(excluded)
    service.get_open_positions = lambda _org: list(open_positions)
    slug_map = {"ff": list(rank)}
    slug_map.update(grants or {})
    service._get_slug_eligibility_map = AsyncMock(return_value=slug_map)
    service._get_held_position_slugs = AsyncMock(return_value=list(held))
    service._get_training_positions = AsyncMock(return_value=list(training))
    # Qualifications are the one source resolved per shift *date* rather than
    # once per member, because a certification can lapse between two shifts in
    # the same query.
    service._get_qualification_positions = AsyncMock(return_value=set(qualifications))
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
        assert service._get_slug_eligibility_map.await_count == 1
        assert service._get_held_position_slugs.await_count == 1
        assert service._get_training_positions.await_count == 1

    async def test_a_held_position_does_not_count_as_a_rank(self):
        # RBAC role assignment must not unlock an operational shift seat.
        service = _service(
            [_shift("s1", positions=[{"position": "ems"}])],
            held=["emt"],
            grants={"emt": ["ems", "firefighter"]},
        )
        answers = await service.get_eligible_positions_bulk(USER, ORG, ["s1"])
        assert answers["s1"] == []

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

    async def test_open_to_all_does_not_bypass_non_operational_class(self):
        shifts = [_shift("s1", positions=[{"position": "ems"}], open_to_all=True)]
        service = _service(shifts, excluded=["social"])
        blocked = SimpleNamespace(id=USER.id, rank="ff", membership_type="social")
        answers = await service.get_eligible_positions_bulk(blocked, ORG, ["s1"])
        assert answers["s1"] == []

    async def test_an_excluded_membership_type_gets_nothing(self):
        service = _service([_shift("s1")], rank=["driver"], excluded=["social"])
        blocked = SimpleNamespace(id=USER.id, rank="ff", membership_type="social")
        answers = await service.get_eligible_positions_bulk(blocked, ORG, ["s1"])
        assert answers["s1"] == []

    async def test_administrative_member_sees_only_explicit_positions(self):
        service = _service(
            [
                _shift(
                    "s1",
                    positions=[
                        {"position": "driver"},
                        {
                            "position": "support",
                            "allow_administrative_members": True,
                        },
                    ],
                    open_to_all=True,
                ),
                _shift("s2", positions=[{"position": "firefighter"}]),
            ],
            rank=["driver"],
            training=["firefighter"],
            qualifications=["ems"],
            excluded=["administrative"],
        )
        administrative = SimpleNamespace(
            id=USER.id,
            rank="ff",
            member_class="administrative",
            membership_type="administrative",
        )

        answers = await service.get_eligible_positions_bulk(
            administrative, ORG, ["s1", "s2"]
        )

        assert answers == {"s1": ["support"], "s2": []}
        service._get_slug_eligibility_map.assert_not_awaited()
        service._get_training_positions.assert_not_awaited()
        service._get_qualification_positions.assert_not_awaited()

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


class TestTheRouteExists:
    """The service method is only reachable if a route serves it.

    This is the gap that shipped: `get_eligible_positions_bulk` was written
    and unit-tested, the board's client called
    `/scheduling/eligibility/positions/bulk`, and no route was registered.
    The board caught the 404, cached an empty list for every shift on the
    selected day, and told every member they were not cleared for any seat —
    a total loss of the page's one function, with nothing in the logs but a
    404 and nothing failing in the suite.
    """

    def test_the_bulk_route_is_registered(self):
        from app.api.v1.endpoints.scheduling import router

        paths = {route.path for route in router.routes}
        assert "/eligibility/positions/bulk" in paths, (
            "The board's bulk eligibility lookup has no route; every claim "
            "button will read 'you are not cleared for any seat'."
        )

    def test_the_frontend_calls_the_path_that_is_registered(self):
        from pathlib import Path

        from app.api.v1.endpoints.scheduling import router

        client = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "modules"
            / "scheduling"
            / "services"
            / "api.ts"
        )
        source = client.read_text()
        for route in router.routes:
            if route.path == "/eligibility/positions/bulk":
                assert f"/scheduling{route.path}" in source
                break
        else:  # pragma: no cover - the assertion above already failed
            raise AssertionError("bulk eligibility route missing")
