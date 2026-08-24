"""
The member an offer was made to answers it themselves.

Manager review (`review_swap_request`) refuses participants by design and
reads a set `target_user_id` as "there must be a shift coming back" — so a
one-way targeted offer, which is the shape the scheduling board creates, could
never be completed by anybody before this path existed.

Accepting grants no authority: it is the offerer withdrawing and the accepter
signing up, in one step, both of which are already unprivileged self-service.
A two-way exchange moves two rosters and stays with the manager workflow.
"""

import inspect
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from app.api.v1.endpoints.scheduling import router
from app.models.training import SwapRequestStatus
from app.services.scheduling_service import SchedulingService

ORG = uuid4()
OFFERER = uuid4()
TARGET = uuid4()
STRANGER = uuid4()


def _offer(**overrides):
    base = dict(
        id="sw1",
        organization_id=str(ORG),
        requesting_user_id=str(OFFERER),
        target_user_id=str(TARGET),
        offering_shift_id="shift-1",
        requesting_shift_id=None,
        status=SwapRequestStatus.PENDING,
        reviewed_by=None,
        reviewed_at=None,
        reviewer_notes=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _shift():
    return SimpleNamespace(
        id="shift-1",
        shift_date=date.today() + timedelta(days=4),
        start_time=datetime.now(timezone.utc) + timedelta(days=4),
        end_time=None,
        status="scheduled",
        is_finalized=False,
        min_staffing=4,
        positions=None,
    )


class _Session:
    """Hands back the offer, then the shift, then the assignment."""

    def __init__(self, offer, shift=None, assignment=None):
        self._queue = [offer, shift, assignment]
        self.committed = 0

    async def execute(self, _statement):
        value = self._queue.pop(0) if self._queue else None
        return SimpleNamespace(scalar_one_or_none=lambda: value)

    async def commit(self):
        self.committed += 1

    async def refresh(self, _obj):
        return None

    async def rollback(self):
        return None

    def add(self, _obj):
        return None


def _service(offer, shift=None, assignment=None, validation_error=None):
    service = SchedulingService(_Session(offer, shift, assignment))
    service._validate_assignment_candidate = AsyncMock(return_value=validation_error)
    service._notify_offer_answered = AsyncMock()
    return service


class TestAcceptance:
    async def test_the_seat_moves_to_the_member_who_accepted(self):
        offer, shift = _offer(), _shift()
        assignment = SimpleNamespace(
            id="a1", user_id=str(OFFERER), position="firefighter"
        )
        service = _service(offer, shift, assignment)

        result, error = await service.respond_to_swap_offer(
            "sw1", ORG, TARGET, accept=True
        )

        assert error is None
        assert result is offer
        assert assignment.user_id == str(TARGET)
        assert offer.status == SwapRequestStatus.APPROVED

    async def test_the_offerer_is_told_their_roster_changed(self):
        offer, shift = _offer(), _shift()
        assignment = SimpleNamespace(
            id="a1", user_id=str(OFFERER), position="firefighter"
        )
        service = _service(offer, shift, assignment)
        await service.respond_to_swap_offer("sw1", ORG, TARGET, accept=True)
        service._notify_offer_answered.assert_awaited_once()
        assert service._notify_offer_answered.await_args.kwargs["accepted"] is True

    async def test_the_seat_being_handed_over_is_excluded_from_the_checks(self):
        # Counting it would refuse every acceptance on a full crew — which is
        # every crew a member is likely to be offered a seat on.
        offer, shift = _offer(), _shift()
        assignment = SimpleNamespace(
            id="a1", user_id=str(OFFERER), position="firefighter"
        )
        service = _service(offer, shift, assignment)
        await service.respond_to_swap_offer("sw1", ORG, TARGET, accept=True)
        kwargs = service._validate_assignment_candidate.await_args.kwargs
        assert kwargs["exclude_assignment_ids"] == {"a1"}
        assert kwargs["enforce_capacity"] is True
        assert kwargs["enforce_position_eligibility"] is True

    async def test_an_ineligible_accepter_is_refused_and_the_seat_stays_put(self):
        offer, shift = _offer(), _shift()
        assignment = SimpleNamespace(id="a1", user_id=str(OFFERER), position="driver")
        service = _service(
            offer, shift, assignment, validation_error="Member is no longer eligible"
        )

        result, error = await service.respond_to_swap_offer(
            "sw1", ORG, TARGET, accept=True
        )

        assert result is None
        assert error == "Member is no longer eligible"
        assert assignment.user_id == str(OFFERER)
        assert offer.status == SwapRequestStatus.PENDING

    async def test_an_offerer_who_already_left_the_shift_is_reported(self):
        service = _service(_offer(), _shift(), assignment=None)
        result, error = await service.respond_to_swap_offer(
            "sw1", ORG, TARGET, accept=True
        )
        assert result is None
        assert "no longer on it" in (error or "")


class TestDecline:
    async def test_declining_leaves_the_shift_with_the_offerer(self):
        offer = _offer()
        assignment = SimpleNamespace(
            id="a1", user_id=str(OFFERER), position="firefighter"
        )
        service = _service(offer, _shift(), assignment)

        result, error = await service.respond_to_swap_offer(
            "sw1", ORG, TARGET, accept=False
        )

        assert error is None
        assert result.status == SwapRequestStatus.DENIED
        assert assignment.user_id == str(OFFERER)
        assert service._notify_offer_answered.await_args.kwargs["accepted"] is False


class TestWhoMayAnswer:
    async def test_only_the_member_it_was_offered_to(self):
        service = _service(_offer(), _shift())
        result, error = await service.respond_to_swap_offer(
            "sw1", ORG, STRANGER, accept=True
        )
        assert result is None
        assert error == "This offer was not made to you"

    async def test_not_the_offerer_themselves(self):
        service = _service(_offer(), _shift())
        _result, error = await service.respond_to_swap_offer(
            "sw1", ORG, OFFERER, accept=True
        )
        assert error == "This offer was not made to you"

    async def test_an_already_answered_offer_cannot_be_answered_again(self):
        service = _service(_offer(status=SwapRequestStatus.APPROVED), _shift())
        _result, error = await service.respond_to_swap_offer(
            "sw1", ORG, TARGET, accept=True
        )
        assert error == "This offer is no longer open"

    async def test_a_two_way_swap_still_goes_to_a_duty_officer(self):
        # It moves two rosters; the manager workflow exists for exactly that.
        service = _service(_offer(requesting_shift_id="shift-2"), _shift())
        _result, error = await service.respond_to_swap_offer(
            "sw1", ORG, TARGET, accept=True
        )
        assert "duty officer" in (error or "")

    async def test_a_missing_offer_is_reported(self):
        service = _service(None)
        _result, error = await service.respond_to_swap_offer(
            "sw1", ORG, TARGET, accept=True
        )
        assert error == "Swap request not found"


class TestSeparationOfDuties:
    """The two workflows must not collapse into each other."""

    def test_manager_review_still_refuses_participants(self):
        source = inspect.getsource(SchedulingService.review_swap_request)
        assert "Requesters cannot review their own swap requests" in source
        assert "Target participants cannot manager-review swap requests" in source

    def test_participant_acceptance_is_open_to_any_member(self):
        for route in router.routes:
            if getattr(route, "path", None) == "/swap-requests/{request_id}/respond":
                deps = [
                    getattr(d.call, "__name__", str(d.call))
                    for d in route.dependant.dependencies
                ]
                assert any("get_current_user" in d for d in deps)
                return
        raise AssertionError("respond route not registered")

    def test_manager_review_still_requires_the_permission(self):
        for route in router.routes:
            if getattr(route, "path", None) == "/swap-requests/{request_id}/review":
                deps = [
                    getattr(d.call, "required_permissions", None)
                    for d in route.dependant.dependencies
                ]
                assert any(p and "scheduling.manage" in p for p in deps)
                return
        raise AssertionError("review route not registered")
