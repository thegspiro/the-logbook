"""A position the registry seeds gets the registry's grants on either branch.

``save_session_roles`` updates a seeded row through ``_merge_default_permissions``
and, until now, created a missing one from ``expand_module_checkboxes`` alone.
The two disagreeing is what made ``emt`` a live disclosure: the wizard offered
it, no row had been seeded, so the create branch stored a role-type heuristic's
checkbox output — ``reports.view`` among it — as an ``is_system`` row.

Registering ``emt`` does not close that on its own. An organization created
before the entry shipped has no seeded EMT row, so a session resuming after the
upgrade still lands on the create branch. And the checkboxes cannot express an
action grant at all, so a row built from them alone loses ``scheduling.swap``
and the rest however the branch is reached.

These assert the merge itself rather than a stored row: the branch is a few
lines inside a long endpoint, and what matters is that both paths answer with
the registry's list.
"""

import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.api.v1.onboarding import _merge_default_permissions, expand_module_checkboxes
from app.core.permissions import DEFAULT_ROLES, OPERATIONAL_RANKS

_SEEDED_GRANTS_TS = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "config"
    / "seededPositionGrants.ts"
)

#: Modules the old heuristic ticked that the registry seeds to no line member.
#: Present so the fixture is the row the wizard actually submitted, not a
#: sanitized one.
_HEURISTIC_EXTRAS = (
    "reports",
    "integrations",
    "medical_supplies",
    "mobile",
    "prospective_members",
    "facilities",
    "notifications",
)


def _checkbox_view_list(slug):
    source = _SEEDED_GRANTS_TS.read_text()
    block = re.search(rf"\n  {slug}: \{{\s*view: \[(.*?)\],", source, re.S)
    assert block, f"no {slug} entry in {_SEEDED_GRANTS_TS.name}"
    return set(re.findall(r"'([^']+)'", block.group(1)))


def _submitted(slug):
    """What the editor sends: its own boxes, plus the heuristic's extras."""
    ticked = _checkbox_view_list(slug)
    modules = sorted(ticked | set(_HEURISTIC_EXTRAS))
    return {
        module: SimpleNamespace(view=module in ticked, manage=False)
        for module in modules
    }


@pytest.mark.parametrize("slug", ["emt", "firefighter", "engineer"])
def test_the_merge_answers_with_the_registry_list(slug):
    defaults = DEFAULT_ROLES.get(slug, {}).get("permissions", [])
    assert defaults, f"{slug} is not seeded; this test is about slugs that are"

    merged = _merge_default_permissions(_submitted(slug), defaults)

    assert sorted(merged) == sorted(defaults)


def test_an_emt_built_this_way_carries_no_reporting_grant():
    """The grant this whole line of work exists to keep off a member row."""
    defaults = DEFAULT_ROLES["emt"]["permissions"]

    merged = _merge_default_permissions(_submitted("emt"), defaults)

    assert not [p for p in merged if p.startswith("reports")]


def test_an_emt_built_this_way_keeps_the_action_grants():
    """``scheduling.swap`` has no checkbox, so only the merge can supply it."""
    merged = _merge_default_permissions(
        _submitted("emt"), DEFAULT_ROLES["emt"]["permissions"]
    )

    for permission in (
        "scheduling.swap",
        "organization.view",
        "locations.view",
        "meetings.view",
    ):
        assert permission in merged, permission


def test_the_checkboxes_alone_would_lose_them():
    """The control: what the create branch stored before this change.

    Ticked across the board, which is what the old role-type heuristic did for
    a member-grade position — every module whose category is not System. That
    is the submission the create branch used to store verbatim.
    """
    heuristic = {
        module: SimpleNamespace(view=True, manage=False)
        for module in sorted(_checkbox_view_list("emt") | set(_HEURISTIC_EXTRAS))
    }

    expansion = set(expand_module_checkboxes(heuristic))

    assert "reports.view" in expansion
    assert "scheduling.swap" not in expansion
    assert expansion != set(OPERATIONAL_RANKS["emt"]["default_permissions"])
