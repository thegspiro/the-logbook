"""``1be4fbbc235d`` adds ``owner_position_id`` to budget categories and lines.

Run for real against MySQL/MariaDB — the DDL cannot ride in the rolled-back
``db_session`` transaction, because MySQL commits implicitly around it. CI's
database user may create tables only inside the test database, not a database
of its own, so each test points the migration at uniquely prefixed scratch
tables there and drops them afterwards. Pinned:

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
from types import SimpleNamespace

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
def scratch(monkeypatch):
    """The migration aimed at scratch tables of the test's own.

    Prefixed so they can collide with neither the suite's real tables nor a
    concurrent run, and dropped afterwards whatever happens. Key and index
    names are prefixed too: MySQL requires a key name to be unique across the
    whole schema, not just its table.
    """
    prefix = f"m{uuid.uuid4().hex[:6]}_"
    monkeypatch.setattr(MIGRATION, "POSITIONS", f"{prefix}positions")
    monkeypatch.setattr(
        MIGRATION,
        "TABLES",
        tuple(
            (f"{prefix}{table}", f"{prefix}{fk}", f"{prefix}{idx}")
            for table, fk, idx in MIGRATION.TABLES
        ),
    )
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for table in ("budgets", "budget_categories", "positions"):
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{prefix}{table}`")
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _tables(engine, prefix: str) -> list:
    with engine.connect() as conn:
        return [t for t in sa.inspect(conn).get_table_names() if t.startswith(prefix)]


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


def _build_existing(engine, prefix: str) -> None:
    """The three tables as an installation has them before this revision."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}positions (id VARCHAR(36) PRIMARY KEY, "
            "name VARCHAR(100) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}budget_categories (id VARCHAR(36) PRIMARY KEY, "
            "name VARCHAR(200) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}budgets (id VARCHAR(36) PRIMARY KEY, "
            "category_id VARCHAR(36) NOT NULL, "
            "amount_budgeted NUMERIC(12, 2) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {prefix}positions VALUES ('pos-1', 'Treasurer')"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {prefix}budget_categories VALUES ('cat-1', 'Gear')"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {prefix}budgets VALUES ('b-1', 'cat-1', 1000.00)"
        )
        conn.commit()


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.downgrade)

        assert _tables(scratch.engine, scratch.prefix) == []

    def test_upgrade_over_existing_rows_then_downgrade(self, scratch):
        scratch_engine = scratch.engine
        p = scratch.prefix
        _build_existing(scratch_engine, p)

        for _ in range(2):  # the second run must change nothing
            _run(scratch_engine, MIGRATION.upgrade)
            for table, fk_name, index_name in MIGRATION.TABLES:
                shape = _shape(scratch_engine, table)
                assert shape["column"] is not None
                assert shape["column"]["nullable"] is True
                assert [k["name"] for k in shape["keys"]] == [fk_name]
                assert shape["keys"][0]["referred_table"] == f"{p}positions"
                assert shape["keys"][0]["options"].get("ondelete") == "SET NULL"
                # One index: created before the key, so MySQL adds none.
                assert shape["idx"] == [index_name]

        with scratch_engine.connect() as conn:
            assert (
                conn.exec_driver_sql(
                    f"SELECT owner_position_id FROM {p}budgets WHERE id = 'b-1'"
                ).scalar_one()
                is None
            )
            # Deleting the position unowns the line rather than refusing.
            conn.exec_driver_sql(
                f"UPDATE {p}budgets SET owner_position_id = 'pos-1' WHERE id = 'b-1'"
            )
            conn.exec_driver_sql(f"DELETE FROM {p}positions WHERE id = 'pos-1'")
            assert (
                conn.exec_driver_sql(
                    f"SELECT owner_position_id FROM {p}budgets WHERE id = 'b-1'"
                ).scalar_one()
                is None
            )
            conn.commit()

        _run(scratch_engine, MIGRATION.downgrade)
        for table, _fk, _idx in MIGRATION.TABLES:
            shape = _shape(scratch_engine, table)
            assert shape == {"column": None, "keys": [], "idx": []}
        with scratch_engine.connect() as conn:
            assert (
                conn.exec_driver_sql(f"SELECT COUNT(*) FROM {p}budgets").scalar() == 1
            )
            assert (
                conn.exec_driver_sql(
                    f"SELECT COUNT(*) FROM {p}budget_categories"
                ).scalar()
                == 1
            )

        # And a second downgrade has nothing left to do.
        _run(scratch_engine, MIGRATION.downgrade)
