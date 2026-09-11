"""Contract test: the wizard's step order, frontend vs backend.

The order is declared twice -- `config/steps.ts` drives what the operator
actually walks through, and `OnboardingService.STEPS` drives the step numbers
`GET /onboarding/status` reports and the `step_number` stamped into
`OnboardingStatus.steps_completed`. Nothing at build time makes them agree, and
the pair has drifted before: three call sites passed literal step numbers that
steps inserted since had left behind, so a resumed setup was told it was
further back than it was.

Like test_onboarding_module_parity.py, this reads the .ts file as text. It only
needs the keys and their order, and a node round-trip from pytest would buy
accuracy this does not need.

If this fails, reorder whichever side is wrong -- do not loosen the mapping.
"""

import re
from pathlib import Path

import pytest

from app.services.onboarding import OnboardingService

pytestmark = pytest.mark.unit

_STEPS_FILE = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "config"
    / "steps.ts"
)

# The two sides name three steps differently, deliberately. The backend names
# are persisted in `steps_completed` and one of them ("admin_user") is
# load-bearing in `complete_onboarding`'s `required_steps`, so they cannot be
# renamed to match the frontend's without a data migration for any install
# part-way through setup.
_FRONTEND_TO_BACKEND = {
    "organization": "organization",
    "system_owner": "admin_user",
    "modules": "modules",
    "positions": "roles",
    "stations": "stations",
    "apparatus": "apparatus",
    "it_team": "it_team",
    "email": "email_platform",
    "file_storage": "file_storage",
    "authentication": "authentication",
    "navigation": "navigation",
}

# Backend-only: the provider-config pages share their parent's progress entry
# on the frontend but are tracked separately server-side.
_BACKEND_ONLY = {"email_config"}


def _frontend_step_keys() -> list[str]:
    source = _STEPS_FILE.read_text(encoding="utf-8")
    block = source[source.index("export const ONBOARDING_STEPS") :]
    block = block[: block.index("] as const")]
    return re.findall(r"^\s*key: '([a-z_]+)',", block, flags=re.MULTILINE)


def _backend_step_names() -> list[str]:
    return [step["name"] for step in OnboardingService.STEPS]


class TestStepOrderParity:
    def test_the_frontend_declares_every_backend_step(self):
        frontend = set(_frontend_step_keys())
        backend = set(_backend_step_names()) - _BACKEND_ONLY

        assert {_FRONTEND_TO_BACKEND[k] for k in frontend} == backend

    def test_the_two_orders_agree(self):
        expected = [_FRONTEND_TO_BACKEND[k] for k in _frontend_step_keys()]
        actual = [n for n in _backend_step_names() if n not in _BACKEND_ONLY]

        assert actual == expected

    def test_backend_ids_are_contiguous_and_one_based(self):
        # `step_number` is derived from position, and `current_step` is
        # reported from it.
        assert [s["id"] for s in OnboardingService.STEPS] == list(
            range(1, len(OnboardingService.STEPS) + 1)
        )

    def test_identity_is_the_second_step(self):
        # Everything after it runs against a real authenticated account rather
        # than an anonymous 30-minute session: create_system_owner sets the
        # auth cookies, which is what makes a lapsed setup recoverable.
        assert _backend_step_names()[:2] == ["organization", "admin_user"]

    def test_email_config_follows_its_platform_step(self):
        names = _backend_step_names()
        assert names.index("email_config") == names.index("email_platform") + 1

    def test_required_steps_are_reachable_first(self):
        # complete_onboarding refuses without these, so a flow that put either
        # late would let an operator walk most of the wizard and then fail.
        names = _backend_step_names()
        for required in ("organization", "admin_user"):
            assert names.index(required) < len(names) / 2
