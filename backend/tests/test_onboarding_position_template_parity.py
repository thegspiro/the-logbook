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


# ---------------------------------------------------------------------------
# Agency-type parity
# ---------------------------------------------------------------------------
#
# The wizard carries its own copy of the position list and never fetches one,
# and `save_session_roles` *creates* a system position for any id it does not
# already know. So a discipline template offered for an agency the backend
# declined to seed is not a cosmetic slip: ticking it puts the row back, with
# grants built from two checkboxes rather than from DEFAULT_POSITIONS.
#
# Parsed out of the source text, like the templates above. The rule lives in its
# own small module, `config/agencyPositions.ts`, precisely so it can be read this
# way rather than regexed out of a 1,100-line screen.

from app.core.permissions import (  # noqa: E402
    ALL_DISCIPLINE_CODES,
    LABELS_BY_ORG_TYPE,
    default_positions_for,
)

_ORG_TYPES = ("fire_department", "fire_ems_combined", "ems_only")


_AGENCY_POSITIONS = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "config"
    / "agencyPositions.ts"
)


def _wizard_disciplines() -> dict:
    """org type -> the discipline ids the wizard offers it."""
    source = _AGENCY_POSITIONS.read_text()
    block = re.search(
        r"DISCIPLINE_POSITIONS_BY_ORG_TYPE[^=]*=\s*\{(.*?)\n\};", source, re.S
    )
    assert (
        block
    ), f"DISCIPLINE_POSITIONS_BY_ORG_TYPE not found in {_AGENCY_POSITIONS.name}"

    all_ids = re.search(r"DISCIPLINE_POSITION_IDS = \[([^\]]*)\]", source)
    assert all_ids, f"DISCIPLINE_POSITION_IDS not found in {_AGENCY_POSITIONS.name}"
    every = re.findall(r"'([\w]+)'", all_ids.group(1))

    offered = {}
    for org_type, value in re.findall(
        r"(\w+):\s*(DISCIPLINE_POSITION_IDS|\[[^\]]*\])", block.group(1)
    ):
        offered[org_type] = (
            every
            if value == "DISCIPLINE_POSITION_IDS"
            else re.findall(r"'([\w]+)'", value)
        )
    return offered


def _wizard_labels() -> dict:
    """org type -> {id: name} the wizard renames."""
    source = _AGENCY_POSITIONS.read_text()
    block = re.search(r"POSITION_LABELS_BY_ORG_TYPE[^=]*=\s*\{(.*?)\n\};", source, re.S)
    assert block, f"POSITION_LABELS_BY_ORG_TYPE not found in {_AGENCY_POSITIONS.name}"
    return {
        org_type: dict(re.findall(r"(\w+):\s*'([^']*)'", body))
        for org_type, body in re.findall(r"(\w+):\s*\{(.*?)\}", block.group(1), re.S)
    }


@pytest.mark.parametrize("org_type", _ORG_TYPES)
def test_the_wizard_never_offers_a_position_the_backend_declined_to_seed(org_type):
    """Scoped to the discipline codes, because the lists legitimately differ.

    RoleSetup.tsx deliberately offers ids the registry has no entry for — `emt`
    and the six membership grades — so equality would red-light on day one.
    What must hold is narrower: for a code the agency vocabulary governs, the
    wizard and the seed agree.
    """
    offered = set(_wizard_disciplines()[org_type])
    seeded = set(default_positions_for(org_type))
    stray = sorted(offered & ALL_DISCIPLINE_CODES & set(DEFAULT_POSITIONS) - seeded)
    assert not stray, (
        f"the wizard offers {stray} to a {org_type} organization, which the "
        "backend does not seed. Ticking one re-creates the position the seed "
        "left out — update DISCIPLINE_POSITIONS_BY_ORG_TYPE."
    )


@pytest.mark.parametrize("org_type", _ORG_TYPES)
def test_the_wizard_renames_exactly_what_the_backend_renames(org_type):
    """Same code, same word, on both screens.

    The seed handler updates a known position's permissions and description but
    never its name, so a wizard rename only reaches rows the backend did not
    seed — which makes a disagreement here show up as two departments' worth of
    inconsistent titles rather than as an error.
    """
    seeded = default_positions_for(org_type)
    for code, name in LABELS_BY_ORG_TYPE.get(org_type, {}).items():
        if code not in seeded:
            continue
        assert _wizard_labels().get(org_type, {}).get(code) == name, (
            f"the backend calls {code!r} {name!r} for a {org_type} organization; "
            "POSITION_LABELS_BY_ORG_TYPE in agencyPositions.ts disagrees"
        )
