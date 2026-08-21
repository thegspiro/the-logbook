"""Regression tests for the ambiguous 20260811_0001 upgrade path."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic/versions/20260811_0002_add_skill_test_return_trail.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "skill_test_return_migration", MIGRATION
    )
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_repairs_optional_column_skipped_by_colliding_revision() -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("equipment_kit_items", metadata, sa.Column("id", sa.Integer))
    metadata.create_all(engine)

    with engine.begin() as connection:
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("equipment_kit_items")
        }

    assert columns == {"id", "optional"}


def test_upgrade_keeps_existing_optional_column() -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "equipment_kit_items",
        metadata,
        sa.Column("id", sa.Integer),
        sa.Column("optional", sa.Boolean, nullable=False, server_default=sa.text("0")),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        columns = [
            column["name"]
            for column in sa.inspect(connection).get_columns("equipment_kit_items")
        ]

    assert columns.count("optional") == 1
