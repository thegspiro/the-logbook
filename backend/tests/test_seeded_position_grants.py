"""Contract test: the wizard's checkbox defaults vs what the backend seeds.

The onboarding position editor saves whatever its boxes say, so the *presented
default* is a real grant. It used to come from the position's role type — "a
member views every module whose category is not System" — which had no
relationship to ``DEFAULT_POSITIONS``. The two disagreed on every seeded
position, in both directions:

* `member` is preselected and its matrix is collapsed, so nearly every
  department pressed Continue without seeing a box. That wrote `facilities.view`
  and `notifications.view` back onto the `member` row on every fresh install —
  undoing migrations e4f5a6b7c8d9 and c7e2b9a41f83 and the registry decision
  behind them, and handing every member the department's notification rules.
* `board_of_directors` was ticked Manage on eighteen modules the registry does
  not seed it with.
* `fire_chief` lost `positions.create` / `positions.delete` /
  `positions.manage_permissions`, which live outside the two checkboxes.

`seededPositionGrants.ts` is generated from the registry to end that. This
regenerates it and compares, so the file cannot drift.
"""

import re
import subprocess
import sys
from pathlib import Path

import pytest

from app.core.permissions import DEFAULT_POSITIONS

pytestmark = pytest.mark.unit

_BACKEND = Path(__file__).resolve().parents[1]
_GENERATOR = _BACKEND / "scripts" / "generate_seeded_position_grants.py"
_TARGET = (
    _BACKEND.parent
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "config"
    / "seededPositionGrants.ts"
)
# The wizard's position templates, extracted out of RoleSetup.tsx when the
# builder grew its own module. The list is what the test reads; the screen
# that renders it is not.
_ROLE_SETUP = (
    _BACKEND.parent
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "pages"
    / "positionTemplates.ts"
)


def _parse(source: str) -> dict:
    """slug -> {"view": [...], "manage": [...]} out of the generated module.

    Parsed rather than compared as text: the file goes through Prettier on the
    way into a commit, so its line breaks are not ours to predict. The data is.
    """
    body = re.search(r"SEEDED_POSITION_GRANTS[^=]*=\s*\{(.*)\n\};", source, re.S)
    assert body, f"SEEDED_POSITION_GRANTS not found in {_TARGET.name}"
    parsed = {}
    for slug, entry in re.findall(r"\n  (\w+): \{(.*?)\n  \},", body.group(1), re.S):
        parsed[slug] = {
            key: re.findall(r"'([\w]+)'", value)
            for key, value in re.findall(r"(view|manage): \[(.*?)\]", entry, re.S)
        }
    assert parsed, f"no position entries parsed from {_TARGET.name}"
    return parsed


def _expected() -> dict:
    sys.path.insert(0, str(_BACKEND / "scripts"))
    from generate_seeded_position_grants import registry_module_ids

    modules = registry_module_ids()
    expected = {}
    for slug, definition in DEFAULT_POSITIONS.items():
        granted = set(definition.get("permissions", []))
        everything = "*" in granted

        def held(module_id: str, action: str, granted=granted, everything=everything):
            return (
                everything
                or f"{module_id}.*" in granted
                or f"{module_id}.{action}" in granted
            )

        expected[slug] = {
            "view": [m for m in modules if held(m, "view")],
            "manage": [m for m in modules if held(m, "manage")],
        }
    return expected


def test_the_generated_defaults_match_the_registry():
    actual = _parse(_TARGET.read_text())
    expected = _expected()

    assert actual == expected, (
        "seededPositionGrants.ts no longer matches DEFAULT_POSITIONS. Run:\n"
        "  cd backend && python3 scripts/generate_seeded_position_grants.py"
    )


def test_the_generator_is_idempotent():
    """Running it must not change a file that is already current."""
    before = _TARGET.read_text()
    try:
        subprocess.run(
            [sys.executable, str(_GENERATOR)], check=True, capture_output=True
        )
        assert _parse(_TARGET.read_text()) == _parse(before)
    finally:
        _TARGET.write_text(before)


def test_every_seeded_position_the_wizard_offers_has_an_entry():
    """A wizard template for a seeded slug must take its defaults from here."""
    offered = set(re.findall(r"id: '([\w]+)',\s*\n\s*name:", _ROLE_SETUP.read_text()))
    assert offered, f"no position templates parsed from {_ROLE_SETUP.name}"
    seeded_and_offered = offered & set(DEFAULT_POSITIONS)
    assert seeded_and_offered <= set(_parse(_TARGET.read_text()))


def test_the_member_position_is_not_granted_the_two_withheld_views():
    """The grants the registry withholds by name, and the wizard re-granted.

    `facilities.view` was revoked from the baseline member positions on
    2026-08-26; `notifications.view` opens the department's notification rules
    and is withheld from `member` with a comment saying so. (It also opened
    the org-wide send log until that endpoint was scoped to the caller by
    default — see `test_notification_log_scope.py`.)
    """
    member = _parse(_TARGET.read_text())["member"]

    assert "facilities" not in member["view"]
    assert "notifications" not in member["view"]
    assert member["manage"] == []
