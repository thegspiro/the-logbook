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

from app.core.permissions import (  # noqa: E402
    DEFAULT_POSITIONS,
    module_checkbox_conferred_by,
    module_checkbox_is_held,
    module_checkbox_offered,
)

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
/**
 * Which of a module's two checkboxes the app has a permission for.
 *
 * A tier the app cannot grant is not rendered. Three rows had one, and each
 * wrote a permission no endpoint reads: Mobile App Access has no gate at all
 * (it is a PWA), Integrations has no read-only console, and Medical Supplies
 * is gated by `inventory.view_medical` / `inventory.manage_medical` rather
 * than by its own name — that last one is why an EMS supply officer given
 * "Manage" during setup could not open the module.
 */
export interface ModuleCheckboxTiers {
  view: boolean;
  manage: boolean;
}

export const MODULE_CHECKBOX_TIERS: Readonly<Record<string, ModuleCheckboxTiers>> = {"""

_CONFERRED_HEADER = """/**
 * A checkbox tier some *other* module's checkbox also confers.
 *
 * Medical Supplies is the only one. Its routes are gated
 * `require_permission('inventory.view_medical', 'inventory.view')` — an OR — so
 * the broad Inventory grant opens the module on its own, and every seeded
 * position down to `member` carries `inventory.view`. The editor used to show
 * those positions an unticked Medical Supplies box, which was a claim they
 * could not reach the module.
 *
 * The pair names the checkbox that confers it, so the editor reads the grid it
 * is already rendering rather than a stored answer: unticking Inventory here
 * releases Medical Supplies in the same breath. Ticking is display only —
 * nothing is written, because unticking could not revoke the access without
 * taking Inventory away.
 */
export type ConferringCheckbox = readonly [module: string, action: 'view' | 'manage'];

export interface ModuleCheckboxConferredBy {
  view?: ConferringCheckbox;
  manage?: ConferringCheckbox;
}

export const MODULE_CHECKBOX_CONFERRED_BY: Readonly<Record<string, ModuleCheckboxConferredBy>> = {"""

_GRANTS_HEADER = """export interface SeededPositionGrant {
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
    for module_id in modules:
        view = "true" if module_checkbox_offered(module_id, "view") else "false"
        manage = "true" if module_checkbox_offered(module_id, "manage") else "false"
        lines.append(f"  {module_id}: {{ view: {view}, manage: {manage} }},")
    lines.append("};")
    lines.append("")
    lines.append(_CONFERRED_HEADER)
    for module_id in modules:
        pairs = [
            (action, module_checkbox_conferred_by(module_id, action))
            for action in ("view", "manage")
        ]
        rendered = [
            f"{action}: ['{other[0]}', '{other[1]}']"
            for action, other in pairs
            if other is not None
        ]
        if rendered:
            lines.append(f"  {module_id}: {{ {', '.join(rendered)} }},")
    lines.append("};")
    lines.append("")
    lines.append(_GRANTS_HEADER)
    for slug in sorted(DEFAULT_POSITIONS):
        granted = set(DEFAULT_POSITIONS[slug].get("permissions", []))

        # Read through the checkbox model rather than by prefix: a registry id
        # is a module *settings* key, and for Medical Supplies the grants live
        # under ``inventory.*_medical``. A tier the app has no permission for
        # is never ticked, because the wizard does not render it.
        view = [m for m in modules if module_checkbox_is_held(m, "view", granted)]
        manage = [m for m in modules if module_checkbox_is_held(m, "manage", granted)]
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
