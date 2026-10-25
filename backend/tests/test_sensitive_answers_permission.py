"""Who may read answers to Sensitive form fields: administrators, by default.

The owner's decision of 2026-10-25. ``sensitive_answers.view`` lives outside
the ``forms.`` namespace so that a Forms manager — whose onboarding checkbox
writes ``forms.*`` — does not receive it through the module wildcard. These
tests pin both halves: nothing short of the global wildcard confers it, and no
seeded position or rank carries it.
"""

import pytest

from app.core.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_POSITIONS,
    OPERATIONAL_RANKS,
    SENSITIVE_ANSWERS_VIEW,
    is_read_only_permission,
    module_checkbox_grants,
    permission_matches,
)

pytestmark = pytest.mark.unit

PERMISSION = SENSITIVE_ANSWERS_VIEW.name


def test_it_is_catalogued_as_a_read():
    assert PERMISSION in {p.name for p in ALL_PERMISSIONS}
    assert is_read_only_permission(PERMISSION) is True


def test_the_forms_wildcard_does_not_confer_it():
    forms_manager = set(module_checkbox_grants("forms", "manage"))

    assert "forms.*" in forms_manager
    assert permission_matches(PERMISSION, forms_manager) is False


def test_only_the_global_wildcard_confers_it_without_a_grant():
    assert permission_matches(PERMISSION, {"*"}) is True
    assert permission_matches(PERMISSION, {PERMISSION}) is True
    assert permission_matches(PERMISSION, {"forms.view", "forms.manage"}) is False


def test_no_seeded_position_holds_it_except_through_the_global_wildcard():
    holders = {
        slug
        for slug, position in DEFAULT_POSITIONS.items()
        if permission_matches(PERMISSION, set(position["permissions"]))
    }

    assert holders == {
        slug
        for slug, position in DEFAULT_POSITIONS.items()
        if "*" in position["permissions"]
    }
    assert holders == {"it_manager"}


def test_no_rank_holds_it():
    for slug, rank in OPERATIONAL_RANKS.items():
        assert not permission_matches(
            PERMISSION, set(rank["default_permissions"])
        ), slug
