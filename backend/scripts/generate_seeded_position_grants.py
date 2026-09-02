"""Regenerate the wizard's seeded-position checkbox defaults.

The onboarding position editor shows two checkboxes per module and saves what
they say. Its defaults used to come from a heuristic — "a member views every
module whose category is not System" — which had no relationship to what
``DEFAULT_POSITIONS`` actually seeds. Every fresh install therefore wrote the
heuristic's answer over the seeded rows on the first Continue, re-granting
`facilities.view` to `member` and `notifications.view` with it, and handing
`board_of_directors` manage on eighteen modules it is not seeded with.

This emits the registry's answer instead, as a frontend constant.

    python3 scripts/generate_seeded_position_grants.py

``tests/test_seeded_position_grants.py`` regenerates and compares, so the file
cannot drift from the registry without CI saying so.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.permissions import DEFAULT_POSITIONS  # noqa: E402

_ROOT = Path(__file__).resolve().parents[2]
_REGISTRY = (
    _ROOT
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "config"
    / "moduleRegistry.ts"
)
TARGET = (
    _ROOT
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "config"
    / "seededPositionGrants.ts"
)

_HEADER = """/**
 * What the registry actually seeds each system position with, as the position
 * editor's two checkboxes.
 *
 * GENERATED — do not edit by hand. Run:
 *
 *     cd backend && python3 scripts/generate_seeded_position_grants.py
 *
 * The editor saves whatever its boxes say, so its presented default is
 * load-bearing: a box ticked here that the backend does not seed is a grant
 * every department receives on its first Continue, and one left clear that the
 * backend does seed is a grant silently revoked. Deriving the defaults from
 * module category instead of from the registry did both — see
 * `backend/tests/test_seeded_position_grants.py`, which regenerates this file
 * and fails on any difference.
 *
 * Positions absent from this map are not seeded by the backend
 * (`DEFAULT_POSITIONS`); the editor's role-type heuristics still supply their
 * defaults, and saving one creates the position rather than updating a
 * seeded row.
 */
export interface SeededPositionGrant {
  view: readonly string[];
  manage: readonly string[];
}

export const SEEDED_POSITION_GRANTS: Readonly<Record<string, SeededPositionGrant>> = {"""


def registry_module_ids() -> list:
    """Module ids the wizard shows a checkbox row for, in registry order."""
    source = _REGISTRY.read_text()
    ids = re.findall(r"id:\s*'([\w]+)'[^}]*?category:\s*'[\w /]+'", source, re.S)
    if not ids:
        raise SystemExit(f"no module ids parsed from {_REGISTRY}")
    return ids


def render() -> str:
    modules = registry_module_ids()
    lines = [_HEADER]
    for slug in sorted(DEFAULT_POSITIONS):
        granted = set(DEFAULT_POSITIONS[slug].get("permissions", []))
        everything = "*" in granted

        def held(module_id: str, action: str) -> bool:
            return (
                everything
                or f"{module_id}.*" in granted
                or f"{module_id}.{action}" in granted
            )

        view = [m for m in modules if held(m, "view")]
        manage = [m for m in modules if held(m, "manage")]
        lines.append(f"  {slug}: {{")
        lines.append(f"    view: [{', '.join(repr(m) for m in view)}],")
        lines.append(f"    manage: [{', '.join(repr(m) for m in manage)}],")
        lines.append("  },")
    lines.append("};")
    return "\n".join(lines) + "\n"


def main() -> None:
    TARGET.write_text(render())
    print(f"wrote {TARGET.relative_to(_ROOT)}")


if __name__ == "__main__":
    main()
