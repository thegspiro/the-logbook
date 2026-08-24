"""Contract test: the position editor's defaults vs the seeded position grants.

The onboarding position editor presents two checkboxes per module and saves
whatever they say. `_merge_default_permissions` deliberately does *not* carry a
`module.manage` default through a submission that leaves Manage unticked — an
admin who clears the box means it.

That makes the editor's *presented default* load-bearing. If it shows Manage
unticked for a module the backend seeds that position with, the first save
silently revokes a grant nobody chose to remove, and the position quietly loses
a console it is meant to run.

That is not hypothetical: adding the Department Store to the frontend registry
moved `storefront` from "module the editor does not know about" (whose defaults
were carried over wholesale) to "submitted module", and the quartermaster —
the person who runs the store — would have lost `storefront.manage` on the
first position save.

Reads RoleSetup.tsx as text, like test_storefront_api_contract.py: it only
needs the specialty lists, and a node round-trip would buy accuracy this does
not need.
"""

import re
from pathlib import Path

import pytest

from app.core.permissions import DEFAULT_POSITIONS

pytestmark = pytest.mark.unit

_ROLE_SETUP = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "pages"
    / "RoleSetup.tsx"
)

# Role types the editor defaults to Manage across the board, so a seeded
# manage grant survives without being named as a specialty.
_MANAGE_EVERYTHING = {"full_access", "leadership"}


def _template_defaults() -> dict:
    """position id -> (role type, specialties) as the editor builds it."""
    source = _ROLE_SETUP.read_text()
    entries = re.findall(
        r"id: '([\w]+)',.*?generateRolePermissions\(\s*modules,\s*'(\w+)'"
        r"(?:,\s*\[([^\]]*)\])?",
        source,
        re.S,
    )
    assert entries, f"No position templates found in {_ROLE_SETUP.name}"
    return {
        pos_id: (role_type, set(re.findall(r"'([\w]+)'", specialties or "")))
        for pos_id, role_type, specialties in entries
    }


def _positions_seeded_with(permission: str) -> set:
    module = permission.partition(".")[0]
    return {
        pos_id
        for pos_id, definition in DEFAULT_POSITIONS.items()
        if permission in definition.get("permissions", [])
        or f"{module}.*" in definition.get("permissions", [])
    }


@pytest.mark.parametrize(
    "permission",
    ["storefront.manage", "inventory.manage", "scheduling.manage", "training.manage"],
)
def test_the_editor_defaults_do_not_silently_revoke_a_seeded_manage_grant(permission):
    module = permission.partition(".")[0]
    templates = _template_defaults()

    revoked = sorted(
        pos_id
        for pos_id in _positions_seeded_with(permission)
        if pos_id in templates
        and templates[pos_id][0] not in _MANAGE_EVERYTHING
        and module not in templates[pos_id][1]
    )
    assert not revoked, (
        f"These positions are seeded with {permission}, but the onboarding "
        f"position editor presents Manage unticked for '{module}', so the "
        f"first save strips it: {revoked}. Add '{module}' to the position's "
        "specialties in RoleSetup.tsx."
    )
