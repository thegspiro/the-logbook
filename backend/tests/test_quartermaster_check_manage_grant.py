"""The seeded Quartermaster builds equipment checklists (workflow review W46-5).

Two halves, because the grant reaches a department two ways: the registry
seeds it at onboarding, and migration ``f73b449bdb8b`` writes it onto the
quartermaster rows already stored (CLAUDE.md pitfall #23). The migration's
decision is a pure function, tested here row shape by row shape.
"""

import importlib.util
from pathlib import Path

import pytest

from app.core.permissions import DEFAULT_POSITIONS

pytestmark = pytest.mark.unit

_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260930_0327_f73b449bdb8b_add_quartermaster_check_manage.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("qm_check_manage", _MIGRATION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = _load_migration()


def test_the_registry_seeds_the_quartermaster_with_check_manage():
    assert "inventory.check_manage" in DEFAULT_POSITIONS["quartermaster"]["permissions"]


def test_authoring_does_not_bring_reading_results_with_it():
    # The owner granted authoring; check results stay with check_view.
    assert (
        "inventory.check_view" not in DEFAULT_POSITIONS["quartermaster"]["permissions"]
    )


class TestGrant:
    def test_a_stock_quartermaster_gains_the_grant(self):
        row = ["inventory.view", "inventory.manage", "storefront.manage"]
        assert migration.grant(row) == row + ["inventory.check_manage"]

    def test_a_quartermaster_without_inventory_manage_is_left_alone(self):
        # A department that split the role and took the stock away from it.
        assert migration.grant(["inventory.view", "storefront.manage"]) is None

    @pytest.mark.parametrize(
        "covering",
        [
            "inventory.check_manage",
            "equipment_check.manage",
            "equipment_check.*",
            "inventory.*",
            "*",
        ],
    )
    def test_a_row_already_covering_it_is_left_alone(self, covering):
        assert migration.grant(["inventory.manage", covering]) is None

    def test_an_empty_row_is_left_alone(self):
        assert migration.grant([]) is None


class TestRevoke:
    def test_downgrade_removes_only_this_grant(self):
        assert migration.revoke(
            ["inventory.manage", "inventory.check_manage", "storefront.view"]
        ) == ["inventory.manage", "storefront.view"]

    def test_downgrade_leaves_a_row_without_it(self):
        assert migration.revoke(["inventory.manage"]) is None

    def test_upgrade_then_downgrade_is_the_original_row(self):
        row = ["inventory.view", "inventory.manage"]
        assert migration.revoke(migration.grant(row)) == row
