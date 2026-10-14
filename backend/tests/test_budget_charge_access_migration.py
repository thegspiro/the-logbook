"""``252c7517d80a`` adds who may charge a budget category's lines.

Run for real against MySQL/MariaDB, against uniquely prefixed scratch tables,
as ``test_budget_requests_migration.py`` does. Pinned:

* an empty database (CI's ``alembic upgrade head`` before ``create_all``) is
  a no-op both ways — ``budget_categories`` is built by no migration;
* over an installation's tables the column arrives nullable with every
  existing category NULL (open, today's behaviour), the positions table with
  both keys cascading; a re-run changes nothing;
* the downgrade drops both and keeps the categories;
* the names are the ones ``create_all`` gives the models.
"""

import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateTable

from app.core.config import settings
from app.models.finance import BudgetCategory, BudgetCategoryChargePosition

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261014_1005_252c7517d80a_budget_category_charge_access.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_charge_access", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_KEYS = {
    "organization_id": ("organizations", "FK_ORGANIZATION"),
    "category_id": ("budget_categories", "FK_CATEGORY"),
    "position_id": ("positions", "FK_POSITION"),
}
_TABLE_NAMES = ("TABLE", "CATEGORIES", "POSITIONS", "ORGANIZATIONS")
_CONSTRAINT_NAMES = (
    "FK_ORGANIZATION",
    "FK_CATEGORY",
    "FK_POSITION",
    "UQ_CATEGORY_POSITION",
    "IX_ORGANIZATION",
    "IX_POSITION",
)
_REFERENCED = ("organizations", "positions", "budget_categories")


@pytest.mark.unit
class TestNamesMatchTheModel:
    def test_table_key_and_index_names_are_create_alls(self):
        table = BudgetCategoryChargePosition.__table__
        assert MIGRATION.TABLE == table.name
        # Two key names pass 64 characters, so compare what MySQL is sent:
        # the DDL shortens them, as it does when create_all builds the table.
        ddl = str(CreateTable(table).compile(dialect=mysql.dialect()))
        for column, (referred, attr) in _KEYS.items():
            (foreign_key,) = table.c[column].foreign_keys
            assert f"CONSTRAINT {getattr(MIGRATION, attr)} FOREIGN KEY" in ddl
            assert foreign_key.column.table.name == referred
            assert foreign_key.ondelete == "CASCADE"
            assert table.c[column].nullable is False
        assert {index.name for index in table.indexes} == {
            MIGRATION.IX_ORGANIZATION,
            MIGRATION.IX_POSITION,
        }
        (unique,) = [c for c in table.constraints if isinstance(c, sa.UniqueConstraint)]
        assert unique.name == MIGRATION.UQ_CATEGORY_POSITION

    def test_the_column_is_a_nullable_enum_of_the_models_values(self):
        column = BudgetCategory.__table__.c[MIGRATION.COLUMN]
        assert column.nullable is True
        assert tuple(column.type.enums) == MIGRATION.VALUES


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"c{uuid.uuid4().hex[:6]}_"
    for attr in _TABLE_NAMES:
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    # The real constraint names are already at MySQL's 64-character limit, so
    # the scratch copies get short ones rather than a prefix.
    for attr in _CONSTRAINT_NAMES:
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{attr.lower()}")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for table in ("budget_category_charge_positions",) + _REFERENCED:
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{prefix}{table}`")
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _tables(engine, prefix: str) -> list:
    with engine.connect() as conn:
        return [t for t in sa.inspect(conn).get_table_names() if t.startswith(prefix)]


def _columns(engine, table: str) -> dict:
    with engine.connect() as conn:
        return {c["name"]: c for c in sa.inspect(conn).get_columns(table)}


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _build(engine, prefix: str) -> None:
    with engine.connect() as conn:
        for table in _REFERENCED:
            conn.exec_driver_sql(
                f"CREATE TABLE {prefix}{table} (id VARCHAR(36) PRIMARY KEY) "
                "ENGINE=InnoDB"
            )
            conn.exec_driver_sql(f"INSERT INTO {prefix}{table} VALUES ('x-1')")
        conn.commit()


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        _run(scratch.engine, MIGRATION.upgrade)
        assert _tables(scratch.engine, scratch.prefix) == []
        _run(scratch.engine, MIGRATION.downgrade)
        assert _tables(scratch.engine, scratch.prefix) == []

    def test_upgrade_over_existing_tables_then_downgrade(self, scratch):
        engine = scratch.engine
        p = scratch.prefix
        table = f"{p}budget_category_charge_positions"
        categories = f"{p}budget_categories"
        _build(engine, p)

        for _ in range(2):  # the second run must change nothing
            _run(engine, MIGRATION.upgrade)
            column = _columns(engine, categories)["charge_access"]
            assert column["nullable"] is True
            with engine.connect() as conn:
                inspector = sa.inspect(conn)
                keys = {
                    fk["constrained_columns"][0]: fk
                    for fk in inspector.get_foreign_keys(table)
                }
                existing = conn.exec_driver_sql(
                    f"SELECT charge_access FROM {categories}"
                ).scalar()
            assert existing is None  # inherits, i.e. open: nothing changes
            assert set(_columns(engine, table)) == {
                c.name for c in BudgetCategoryChargePosition.__table__.columns
            }
            for column_name, (referred, _attr) in _KEYS.items():
                assert keys[column_name]["referred_table"] == f"{p}{referred}"
                assert keys[column_name]["options"].get("ondelete") == "CASCADE"

        with engine.connect() as conn:
            conn.exec_driver_sql(
                f"UPDATE {categories} SET charge_access = 'restricted'"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {table} (id, organization_id, category_id, "
                "position_id) VALUES ('cp-1', 'x-1', 'x-1', 'x-1')"
            )
            with pytest.raises(sa.exc.IntegrityError):
                conn.exec_driver_sql(
                    f"INSERT INTO {table} (id, organization_id, category_id, "
                    "position_id) VALUES ('cp-2', 'x-1', 'x-1', 'x-1')"
                )
            conn.rollback()
            conn.exec_driver_sql(
                f"INSERT INTO {table} (id, organization_id, category_id, "
                "position_id) VALUES ('cp-1', 'x-1', 'x-1', 'x-1')"
            )
            # Losing the position removes the grant rather than leaving a stub.
            conn.exec_driver_sql(f"DELETE FROM {p}positions")
            assert conn.exec_driver_sql(f"SELECT COUNT(*) FROM {table}").scalar() == 0
            conn.commit()

        _run(engine, MIGRATION.downgrade)
        assert sorted(_tables(engine, p)) == sorted(f"{p}{t}" for t in _REFERENCED)
        assert "charge_access" not in _columns(engine, categories)
        _run(engine, MIGRATION.downgrade)
