"""Unit tests for the onboarding step definitions.

``OnboardingService.STEPS`` drives ``total_steps`` in the status response and
the step numbers recorded in ``steps_completed``. It has drifted from the real
flow before, so these tests pin the invariants that matter: ids are sequential,
names are unique, and the two steps ``complete_onboarding`` requires are
actually present.
"""

import pytest

from app.services.onboarding import OnboardingService

STEPS = OnboardingService.STEPS


@pytest.mark.unit
def test_step_ids_are_sequential_from_one():
    assert [step["id"] for step in STEPS] == list(range(1, len(STEPS) + 1))


@pytest.mark.unit
def test_step_names_are_unique():
    names = [step["name"] for step in STEPS]
    assert len(names) == len(set(names))


@pytest.mark.unit
def test_required_steps_exist():
    # complete_onboarding() hard-fails if either of these is missing from
    # steps_completed, so they must be steps that can actually be completed.
    names = {step["name"] for step in STEPS}
    assert "organization" in names
    assert "admin_user" in names


@pytest.mark.unit
def test_only_organization_and_admin_user_are_required():
    required = {step["name"] for step in STEPS if step["required"]}
    assert required == {"organization", "admin_user"}


@pytest.mark.unit
def test_stations_and_apparatus_follow_organization():
    # Both need the organization to exist — they write Facility, Location and
    # BasicApparatus rows stamped with its id.
    order = [step["name"] for step in STEPS]
    assert order.index("stations") > order.index("organization")
    assert order.index("apparatus") > order.index("organization")


@pytest.mark.unit
def test_stations_and_apparatus_are_skippable():
    by_name = {step["name"]: step for step in STEPS}
    assert by_name["stations"]["required"] is False
    assert by_name["apparatus"]["required"] is False
