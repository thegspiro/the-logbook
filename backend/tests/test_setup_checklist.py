"""Unit tests for the department setup checklist.

Covers the acknowledgment mechanism added for *review* items — checklist steps
like "review your organization settings" that no entity count can measure. The
guard matters: without it, any checklist key could be marked complete by
asserting it was done, which is exactly what the old hardcoded
``is_complete=True`` on ``org_settings`` amounted to.
"""

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.organizations import REVIEW_CHECKLIST_KEYS
from app.schemas.organization import (
    OrganizationSettings,
    SetupChecklistItem,
    SetupProgressSettings,
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
