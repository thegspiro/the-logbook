"""Capacity checks lock the row everyone contends for.

A limit — seats on a shift, `max_attendees` on an event, a role on an outreach
signup sheet — is enforced by counting what is there and then inserting. Two
requests arriving together both read the count before either commits, both
decide there is room, and the cap is exceeded by however many people tapped at
once. One request never races itself, so it survives every test that is not
this one (CLAUDE.md pitfall #24).

`event_service` locks the event row before counting "going" RSVPs and says so
in a comment. Shift seat capacity had the same read-then-write shape with no
lock from the day it was written. These pin both, plus the outreach-role seat
claim, so a refactor cannot quietly drop the FOR UPDATE and leave a check that
still reads correct.
"""

import inspect

from app.services import event_request_service, event_service, scheduling_service


def _source_of(obj) -> str:
    return inspect.getsource(obj)


class TestShiftSeatCapacity:
    def test_get_shift_by_id_can_lock(self):
        signature = inspect.signature(
            scheduling_service.SchedulingService.get_shift_by_id
        )
        assert "for_update" in signature.parameters

    def test_self_signup_takes_the_lock(self):
        """Self-signup is the path that enforces capacity, so it is the path
        that must serialize."""
        source = _source_of(scheduling_service.SchedulingService.create_assignment)

        assert "for_update=self_signup" in source, (
            "create_assignment must lock the shift row when the caller is a "
            "member signing themselves up — that is the path where "
            "enforce_capacity is True and the count-then-insert races."
        )

    def test_an_officer_assignment_is_not_serialized(self):
        """An officer overfilling a crew is a decision they are allowed to
        make; locking those buys nothing and costs concurrency."""
        source = _source_of(scheduling_service.SchedulingService.create_assignment)

        assert (
            "for_update=True" not in source
        ), "The lock is conditional on self_signup, not unconditional."


class TestEventRsvpCapacity:
    def test_the_event_row_is_locked_before_counting(self):
        source = _source_of(event_service.EventService.create_or_update_rsvp)
        assert "with_for_update()" in source

    def test_waitlist_promotion_is_locked_too(self):
        """Promotion reads capacity and inserts a going RSVP — same shape."""
        source = _source_of(event_service.EventService.promote_from_waitlist)
        assert "with_for_update()" in source


class TestOutreachRoleSeats:
    def test_the_request_row_is_locked_before_counting_a_role(self):
        source = _source_of(event_request_service.resolve_outreach_signup_role)
        assert "with_for_update()" in source, (
            "Two members claiming the last Educator seat both read '0 taken' "
            "unless the request row serializes them."
        )
