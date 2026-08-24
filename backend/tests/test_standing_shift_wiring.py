"""
The standing-claim readers stay wired.

A standing shift only means something because two things read it: creating a
claim seats the member on the matching shifts already on record, and creating
a *shift* seats every member whose active claim matches it. The second is the
one that can be lost silently — nothing about a refactor that drops the call
looks broken, and the symptom is members quietly not being seated on next
month's schedule, weeks later, in a code path nobody was looking at.

These assert the call sites exist. They are deliberately structural: a
behavioural test of `create_shift` needs a database, and the failure being
guarded against is "somebody deleted the line", which reads perfectly well
from the source.
"""

import inspect

from app.api.v1.endpoints import scheduling as scheduling_endpoints
from app.services.scheduling_service import SchedulingService
from app.services.standing_shift_service import StandingShiftService


class TestShiftCreationSeatsStandingClaims:
    def test_create_shift_applies_standing_claims(self):
        source = inspect.getsource(SchedulingService.create_shift)
        assert "apply_standing_claims" in source, (
            "create_shift no longer applies standing claims — a member's "
            "series will not pick up shifts created one at a time."
        )

    def test_pattern_generation_applies_standing_claims(self):
        source = inspect.getsource(SchedulingService.generate_shifts_from_pattern)
        assert "apply_standing_claims" in source, (
            "Pattern generation no longer applies standing claims — a series "
            "goes quiet the month the department generates its schedule, "
            "which is the month it was set up for."
        )

    def test_apply_standing_claims_delegates_to_the_standing_service(self):
        source = inspect.getsource(SchedulingService.apply_standing_claims)
        assert "StandingShiftService" in source
        assert "apply_to_shift" in source

    def test_the_reader_cannot_take_down_the_write_it_follows(self):
        # It runs after the shifts are committed. A claim that cannot be
        # honoured leaves an open seat an officer can see; a claim that raised
        # here would lose the whole generation run that already succeeded.
        source = inspect.getsource(SchedulingService.apply_standing_claims)
        assert "except Exception" in source


class TestSeatingGoesThroughSelfSignup:
    """A standing claim stands in for the member tapping the calendar."""

    def test_the_seating_callable_pins_self_signup(self):
        source = inspect.getsource(SchedulingService.seat_member_self_service)
        assert "self_signup=True" in source, (
            "Standing claims would seat members on shifts they are not "
            "eligible for, on past dates, and past the crew size."
        )

    def test_both_callers_use_it_rather_than_create_assignment(self):
        # create_assignment defaults self_signup to False, so handing it over
        # directly is the silent way to lose every self-service check.
        endpoint = inspect.getsource(scheduling_endpoints.create_standing_shift)
        assert "seat_member_self_service" in endpoint
        assert "assign=service.create_assignment" not in endpoint

        applier = inspect.getsource(SchedulingService.apply_standing_claims)
        assert "seat_member_self_service" in applier

    def test_the_standing_service_never_seats_anyone_itself(self):
        # It takes the seating callable as an argument precisely so the rules
        # live in one place. A direct ShiftAssignment write here would bypass
        # all of them.
        source = inspect.getsource(StandingShiftService)
        assert "ShiftAssignment(" not in source
