"""Contract test: the wizard's module checkboxes against permissions that exist.

The setup wizard's Positions step renders one row per module in the frontend
registry, and expands each row's two checkboxes into permissions. The
registry's ids are *module settings* keys — the strings
``Organization.settings.modules`` stores — and only usually the permission
prefix as well. When they differ, the expansion writes grants no endpoint
reads, and nothing anywhere says so: the save succeeds, the position looks
configured, and the member takes a 403 or simply never sees the navigation
entry.

That is not hypothetical. ``medical_supplies`` is gated by
``inventory.view_medical`` / ``inventory.manage_medical``, so a position given
"Medical Supplies -> Manage" during setup held ``medical_supplies.*`` and could
not open the module the department had just enabled. ``mobile`` and
``integrations.view`` had no permission behind them at all.

If this fails, either the module's real grants belong in
``_MODULE_CHECKBOX_GRANTS`` or the tier does not exist and should say so.
Do not loosen the comparison.
"""

import re
from pathlib import Path

import pytest

from app.api.v1.onboarding import (
    RolePermission,
    expand_module_checkboxes,
    registry_checkboxes,
)
from app.core.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_POSITIONS,
    module_checkbox_grants,
    module_checkbox_is_held,
    module_checkbox_offered,
    module_for_permission,
)

pytestmark = pytest.mark.unit

_REGISTRY = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "config"
    / "moduleRegistry.ts"
)

_PERMISSION_NAMES = {p.name for p in ALL_PERMISSIONS}
_PERMISSION_PREFIXES = {name.partition(".")[0] for name in _PERMISSION_NAMES}


def _registry_module_ids() -> list[str]:
    """Every module row the editor renders, System entries included.

    RoleSetup passes the whole MODULE_REGISTRY to ``buildPermissionCategories``
    rather than the user-facing subset, so Positions and Settings are rows too.
    """
    ids = re.findall(
        r"id:\s*'([\w]+)'[^}]*?category:\s*'[\w /]+'", _REGISTRY.read_text(), re.S
    )
    assert ids, f"no module ids parsed from {_REGISTRY.name}"
    return ids


def _grant_exists(permission: str) -> bool:
    if permission.endswith(".*"):
        return permission.partition(".")[0] in _PERMISSION_PREFIXES
    return permission in _PERMISSION_NAMES


@pytest.mark.parametrize("action", ["view", "manage"])
def test_every_offered_checkbox_grants_a_permission_that_exists(action):
    unreal = {
        f"{module_id}.{action}": sorted(
            grant
            for grant in module_checkbox_grants(module_id, action)
            if not _grant_exists(grant)
        )
        for module_id in _registry_module_ids()
        if module_checkbox_offered(module_id, action)
    }
    unreal = {row: grants for row, grants in unreal.items() if grants}
    assert not unreal, (
        "These module checkboxes write permissions that do not exist, so "
        "ticking them grants nothing and the member is refused by a route "
        f"that never sees the grant: {unreal}"
    )


def test_a_tier_with_no_permission_is_declared_rather_than_left_to_expand():
    """A checkbox that grants nothing must be marked, not silently inert.

    Both directions are wrong on their own: expanding it writes a dead
    permission, and quietly dropping it leaves a box on screen that promises
    access the app will not give.
    """
    for module_id in _registry_module_ids():
        for action in ("view", "manage"):
            grants = module_checkbox_grants(module_id, action)
            assert bool(grants) == module_checkbox_offered(module_id, action), (
                f"{module_id}.{action} disagrees with itself: it "
                f"{'grants' if grants else 'grants nothing'} but is "
                f"{'offered' if module_checkbox_offered(module_id, action) else 'not offered'}"
            )


def test_an_unoffered_checkbox_expands_to_nothing():
    submitted = {
        module_id: RolePermission(view=True, manage=True)
        for module_id in _registry_module_ids()
        if not module_checkbox_offered(module_id, "view")
        and not module_checkbox_offered(module_id, "manage")
    }
    assert submitted, "expected at least one module with no permissions behind it"
    assert expand_module_checkboxes(submitted) == []


def test_medical_supplies_grants_what_the_module_is_actually_gated_by():
    """The row must produce the grants the routes and the navigation read.

    ``medical_supplies.py`` gates on ``inventory.view_medical`` /
    ``inventory.manage_medical``, and SideNavigation gates the entry on
    ``view_medical`` alone with no manage-implies-view rule — so Manage has to
    grant both, or the officer who can restock cannot find the screen.
    """
    granted = expand_module_checkboxes(
        {"medical_supplies": RolePermission(view=False, manage=True)}
    )
    assert "inventory.manage_medical" in granted
    assert "inventory.view_medical" in granted
    assert not any(g.startswith("medical_supplies.") for g in granted)


def test_medical_grants_belong_to_the_medical_row_not_the_inventory_one():
    """Editing Inventory must not strip a position's medical grants.

    They share the ``inventory`` prefix, so bucketing by prefix attributed them
    to the Inventory checkboxes: an administrator who touched Inventory had the
    module rebuilt from two boxes, and the medical grants went with it.
    """
    assert module_for_permission("inventory.manage_medical") == "medical_supplies"
    assert module_for_permission("inventory.view_medical") == "medical_supplies"
    assert module_for_permission("inventory.manage") == "inventory"


def test_the_ems_supply_officer_reads_as_holding_its_own_module():
    """The seeded officer must present as ticked, or the first save revokes it.

    The editor saves what its boxes say and does not carry a manage default
    through a submission that leaves the box clear, so a seeded grant shown
    unticked is a grant lost on the first Continue.
    """
    granted = set(DEFAULT_POSITIONS["ems_supply_officer"]["permissions"])
    assert module_checkbox_is_held("medical_supplies", "view", granted)
    assert module_checkbox_is_held("medical_supplies", "manage", granted)
    assert registry_checkboxes(granted, "medical_supplies") == (True, True)


def test_a_module_wildcard_still_ticks_both_of_its_boxes():
    """``training.*`` is one grant, and it means both boxes, not neither."""
    assert registry_checkboxes(["training.*"], "training") == (True, True)
    assert registry_checkboxes(["training.view"], "training") == (True, False)
    assert registry_checkboxes(["training.manage"], "training") == (False, True)


def test_the_editor_offers_a_row_for_every_seeded_position():
    """A seeded position the wizard never lists cannot be reviewed during setup.

    ``ems_supply_officer`` was the one gap: the backend seeded it, the module
    registry named it as Medical Supplies' default manager, and the position
    step had no template for it, so no department could see or assign it while
    setting the module up.
    """
    templates = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "modules"
        / "onboarding"
        / "pages"
        / "positionTemplates.ts"
    ).read_text()
    offered = set(re.findall(r"id: '([\w]+)',", templates))
    missing = sorted(set(DEFAULT_POSITIONS) - offered)
    assert not missing, (
        "These positions are seeded by the backend but the setup wizard's "
        f"position step never offers them: {missing}"
    )
