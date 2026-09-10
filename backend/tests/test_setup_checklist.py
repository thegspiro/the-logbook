"""Unit tests for the department setup checklist.

Covers the acknowledgment mechanism added for *review* items — checklist steps
like "review your organization settings" that no entity count can measure. The
guard matters: without it, any checklist key could be marked complete by
asserting it was done, which is exactly what the old hardcoded
``is_complete=True`` on ``org_settings`` amounted to.
"""

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.organizations import (
    MODULES_WITHOUT_SETUP_CHECKLIST_ITEM,
    REVIEW_CHECKLIST_KEYS,
)
from app.schemas.organization import (
    OrganizationSettings,
    SetupChecklistItem,
    SetupProgressSettings,
)
from app.services.onboarding import (
    ONBOARDING_CORE_MODULES,
    ONBOARDING_OFFERED_MODULES,
)


@pytest.mark.unit
def test_setup_progress_defaults_to_nothing_acknowledged():
    assert SetupProgressSettings().acknowledged == []


@pytest.mark.unit
def test_organization_settings_carries_setup_section():
    settings = OrganizationSettings()
    assert settings.setup.acknowledged == []

    settings = OrganizationSettings(
        setup=SetupProgressSettings(acknowledged=["org_settings"])
    )
    assert settings.setup.acknowledged == ["org_settings"]


@pytest.mark.unit
def test_checklist_item_defaults_to_auto_kind():
    item = SetupChecklistItem(
        key="members",
        title="Add Department Members",
        description="Import or manually add your roster.",
        path="/members/admin",
        category="essential",
    )
    assert item.kind == "auto"


@pytest.mark.unit
def test_checklist_item_rejects_unknown_kind():
    with pytest.raises(ValidationError, match="kind"):
        SetupChecklistItem(
            key="members",
            title="Add Department Members",
            description="Import or manually add your roster.",
            path="/members/admin",
            category="essential",
            kind="manual",
        )


@pytest.mark.unit
def test_only_review_items_are_acknowledgeable():
    # These have no derivable completion signal, so the admin confirms them.
    assert REVIEW_CHECKLIST_KEYS == {"org_settings", "modules"}

    # Everything else is measured. If any of these ever became
    # acknowledgeable, a department could mark itself set up without a single
    # member, station, or document.
    for measured in (
        "members",
        "members_signed_in",
        "roles",
        "apparatus",
        "locations",
        "documents",
        "events",
        "mfa",
        "email",
    ):
        assert measured not in REVIEW_CHECKLIST_KEYS


@pytest.mark.unit
def test_every_offered_module_either_has_a_checklist_item_or_says_why_not():
    """A module a department can enable must say what it still needs.

    Turning a module on during setup does not make it usable: the Department
    Store needs a catalog before anyone can order, and Medical Supplies needs
    categories before stock can be received. Both shipped enableable and then
    silently empty, with nothing anywhere telling the department that was the
    problem — the checklist had stopped being extended around the time
    Prospective Members was added.

    Read from source, because a checklist item is a branch in a function, not
    a value this test could import.
    """
    source = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "endpoints"
        / "organizations.py"
    ).read_text()
    gated = set(re.findall(r'if "(\w+)" in enabled_modules:', source))

    offered = set(ONBOARDING_CORE_MODULES) | set(ONBOARDING_OFFERED_MODULES)
    unexplained = sorted(offered - gated - set(MODULES_WITHOUT_SETUP_CHECKLIST_ITEM))
    assert not unexplained, (
        "Setup offers these modules, and the department setup checklist "
        "neither adds an item for them nor records why they need none: "
        f"{unexplained}"
    )


@pytest.mark.unit
def test_the_no_item_list_does_not_excuse_a_module_that_has_one():
    """The two halves must be a partition, not overlapping opinions."""
    source = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "endpoints"
        / "organizations.py"
    ).read_text()
    gated = set(re.findall(r'if "(\w+)" in enabled_modules:', source))
    both = sorted(gated & set(MODULES_WITHOUT_SETUP_CHECKLIST_ITEM))
    assert not both, (
        "These modules have a checklist item and are also listed as needing "
        f"none: {both}"
    )
