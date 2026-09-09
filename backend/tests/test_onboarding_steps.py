"""Unit tests for the onboarding step definitions.

``OnboardingService.STEPS`` drives ``total_steps`` in the status response and
the step numbers recorded in ``steps_completed``. It has drifted from the real
flow before, so these tests pin the invariants that matter: ids are sequential,
names are unique, and the two steps ``complete_onboarding`` requires are
actually present.
"""

import re
from pathlib import Path

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


@pytest.mark.unit
def test_step_number_resolves_every_declared_step():
    for step in STEPS:
        assert OnboardingService.step_number(step["name"]) == step["id"]


@pytest.mark.unit
def test_step_number_refuses_a_step_that_does_not_exist():
    with pytest.raises(ValueError, match="Unknown onboarding step"):
        OnboardingService.step_number("notifications")


@pytest.mark.unit
def test_every_marked_step_is_a_declared_step():
    """No caller may record a step number of its own.

    Three did, and every one had been left behind by a step inserted since:
    the System Owner was recorded as 7 against a list where it is 9, the
    module step as 10 against 12, and the notifications endpoint recorded a
    "notifications" step that appears nowhere in ``STEPS``. Since
    ``current_step`` is derived from the number, a resumed setup was sent
    back to a step the administrator had already finished.

    Read from source, because the failure is a literal reappearing in an
    argument list — there is no runtime moment at which to observe it.
    """
    names = {step["name"] for step in STEPS}
    pattern = re.compile(r"_mark_step_completed\(\s*([^)]*?)\s*\)", re.S)
    checked = 0
    for path in (
        Path(__file__).resolve().parents[1] / "app" / "services" / "onboarding.py",
        Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "onboarding.py",
    ):
        for call in pattern.findall(path.read_text()):
            args = [arg.strip() for arg in call.split(",")]
            if len(args) != 2 or not args[1].startswith('"'):
                continue  # the definition itself, or a mock
            assert args[1].strip('"') in names, (
                f"{path.name} marks '{args[1]}' completed, which is not a step "
                f"in STEPS. Step numbers come from STEPS; do not pass one."
            )
            assert not args[0].isdigit(), (
                f"{path.name} passes a literal step number to "
                "_mark_step_completed; the number comes from STEPS."
            )
            checked += 1
    # A regex that matches nothing passes silently, which is the one way this
    # test could stop protecting anything without failing.
    assert checked >= 6, f"only {checked} _mark_step_completed calls were read"
