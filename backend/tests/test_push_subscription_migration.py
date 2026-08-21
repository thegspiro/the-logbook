"""Regression tests for the duplicated 20260807_0001 revision id."""

import importlib.util
from pathlib import Path
from unittest.mock import Mock

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic/versions/20260807_0002_add_push_subscriptions.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "push_subscription_migration", MIGRATION
    )
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_repairs_officers_table_for_legacy_push_revision(monkeypatch) -> None:
    migration = _load_migration()
    migration.op = Mock()
    inspector = Mock()
    inspector.get_table_names.return_value = ["push_subscriptions"]
    monkeypatch.setattr(migration.sa, "inspect", lambda _bind: inspector)

    migration.upgrade()

    assert migration.op.create_table.call_count == 1
    assert migration.op.create_table.call_args.args[0] == "organization_officers"
    migration.op.create_index.assert_not_called()


def test_upgrade_is_noop_when_both_colliding_tables_exist(monkeypatch) -> None:
    migration = _load_migration()
    migration.op = Mock()
    inspector = Mock()
    inspector.get_table_names.return_value = [
        "push_subscriptions",
        "organization_officers",
    ]
    monkeypatch.setattr(migration.sa, "inspect", lambda _bind: inspector)

    migration.upgrade()

    migration.op.create_table.assert_not_called()
    migration.op.create_index.assert_not_called()
