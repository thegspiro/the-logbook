"""``1be4fbbc235d`` adds ``owner_position_id`` to budget categories and lines.

Run for real against MySQL/MariaDB in a scratch database of its own — the DDL
cannot ride in the rolled-back ``db_session`` transaction, because MySQL
commits implicitly around it. Pinned:

* an empty database (CI's ``alembic upgrade head`` before ``create_all``) is
  a no-op both ways, since neither table is built by any migration;
* over existing rows the column arrives nullable and empty, keyed to
  ``positions`` with ``ON DELETE SET NULL`` and indexed once, and a re-run
  changes nothing;
* the downgrade removes exactly what the upgrade added and keeps the rows;
* the names the migration uses are the ones ``create_all`` gives the model's
  column, so the downgrade finds them however the table was built.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings
from app.models.finance import Budget, BudgetCategory

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261008_1336_1be4fbbc235d_budget_owner_positions.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_budget_owner_positions", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
class TestNamesMatchTheModels:
    @pytest.mark.parametrize(
        ("model", "table"),
        [(BudgetCategory, "budget_categories"), (Budget, "budgets")],
    )
    def test_key_and_index_names_are_create_alls(self, model, table):
        _table, fk_name, index_name = next(
            entry for entry in MIGRATION.TABLES if entry[0] == table
        )
        column = model.__table__.c.owner_position_id
        (foreign_key,) = column.foreign_keys
        assert foreign_key.constraint.name == fk_name
        assert foreign_key.ondelete == "SET NULL"
        assert column.nullable is True
        assert index_name in {
            index.name
            for index in model.__table__.indexes
            if [c.name for c in index.columns] == ["owner_position_id"]
        }


@pytest.fixture
def scratch_engine():
    """A database of the test's own, dropped afterwards whatever happens."""
    name = f"{settings.DB_NAME}_mig_{uuid.uuid4().hex[:8]}"
    server = sa.create_engine(settings.SYNC_DATABASE_URL)
    with server.connect() as conn:
        conn.exec_driver_sql(f"CREATE DATABASE `{name}`")
    engine = sa.create_engine(server.url.set(database=name))
    try:
        yield engine
    finally:
        engine.dispose()
        with server.connect() as conn:
            conn.exec_driver_sql(f"DROP DATABASE IF EXISTS `{name}`")
        server.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _shape(engine, table: str) -> dict:
    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        columns = {c["name"]: c for c in inspector.get_columns(table)}
        keys = [
            fk
            for fk in inspector.get_foreign_keys(table)
            if fk["constrained_columns"] == ["owner_position_id"]
        ]
        indexes = [
            i["name"]
            for i in inspector.get_indexes(table)
            if i["column_names"] == ["owner_position_id"]
        ]
    return {"column": columns.get("owner_position_id"), "keys": keys, "idx": indexes}


def _build_existing(engine) -> None:
    """The three tables as an installation has them before this revision."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE positions (id VARCHAR(36) PRIMARY KEY, "
            "name VARCHAR(100) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            "CREATE TABLE budget_categories (id VARCHAR(36) PRIMARY KEY, "
            "name VARCHAR(200) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            "CREATE TABLE budgets (id VARCHAR(36) PRIMARY KEY, "
            "category_id VARCHAR(36) NOT NULL, "
            "amount_budgeted NUMERIC(12, 2) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql("INSERT INTO positions VALUES ('pos-1', 'Treasurer')")
        conn.exec_driver_sql("INSERT INTO budget_categories VALUES ('cat-1', 'Gear')")
        conn.exec_driver_sql("INSERT INTO budgets VALUES ('b-1', 'cat-1', 1000.00)")
        conn.commit()


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch_engine):
        _run(scratch_engine, MIGRATION.upgrade)
        _run(scratch_engine, MIGRATION.downgrade)

        with scratch_engine.connect() as conn:
            assert sa.inspect(conn).get_table_names() == []

    def test_upgrade_over_existing_rows_then_downgrade(self, scratch_engine):
        _build_existing(scratch_engine)

        for _ in range(2):  # the second run must change nothing
            _run(scratch_engine, MIGRATION.upgrade)
            for table, fk_name, index_name in MIGRATION.TABLES:
                shape = _shape(scratch_engine, table)
                assert shape["column"] is not None
                assert shape["column"]["nullable"] is True
                assert [k["name"] for k in shape["keys"]] == [fk_name]
                assert shape["keys"][0]["referred_table"] == "positions"
                assert shape["keys"][0]["options"].get("ondelete") == "SET NULL"
                # One index: created before the key, so MySQL adds none.
                assert shape["idx"] == [index_name]

        with scratch_engine.connect() as conn:
            assert (
                conn.exec_driver_sql(
                    "SELECT owner_position_id FROM budgets WHERE id = 'b-1'"
                ).scalar_one()
                is None
            )
            # Deleting the position unowns the line rather than refusing.
            conn.exec_driver_sql(
                "UPDATE budgets SET owner_position_id = 'pos-1' WHERE id = 'b-1'"
            )
            conn.exec_driver_sql("DELETE FROM positions WHERE id = 'pos-1'")
            assert (
                conn.exec_driver_sql(
                    "SELECT owner_position_id FROM budgets WHERE id = 'b-1'"
                ).scalar_one()
                is None
            )
            conn.commit()

        _run(scratch_engine, MIGRATION.downgrade)
        for table, _fk, _idx in MIGRATION.TABLES:
            shape = _shape(scratch_engine, table)
            assert shape == {"column": None, "keys": [], "idx": []}
        with scratch_engine.connect() as conn:
            assert conn.exec_driver_sql("SELECT COUNT(*) FROM budgets").scalar() == 1
            assert (
                conn.exec_driver_sql("SELECT COUNT(*) FROM budget_categories").scalar()
                == 1
            )

        # And a second downgrade has nothing left to do.
        _run(scratch_engine, MIGRATION.downgrade)
