"""``c62a98b47406`` links a reversing budget amendment to the one it cancels.

Run for real against MySQL/MariaDB -- the DDL cannot ride in the rolled-back
``db_session`` transaction, because MySQL commits implicitly around it. CI's
database user may create tables only inside the test database, so each test
points the migration at a uniquely prefixed scratch table there and drops it
afterwards (the shape of ``test_budget_amendments_migration.py``). Pinned:

* an empty database (CI's ``alembic upgrade head`` before ``create_all``) is a
  no-op both ways: ``budget_amendments`` is not there to alter;
* over an installation's table the column arrives nullable, with a SET NULL
  self-key and a unique key, and a re-run changes nothing;
* the unique key admits any number of ordinary amendments (NULL) and refuses
  a second reversal of one amendment;
* deleting the line still removes an amendment and its reversal together;
* the downgrade drops key, constraint and column and keeps every row, the
  reversal's negative amount included;
* the column, key and constraint names are the ones ``create_all`` gives the
  model.
"""

import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models.finance import BudgetAmendment

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261009_0120_c62a98b47406_budget_amendment_reversals.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_amendment_reversals", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
class TestNamesMatchTheModel:
    def test_column_key_and_constraint_names_are_create_alls(self):
        table = BudgetAmendment.__table__
        assert MIGRATION.TABLE == table.name
        column = table.c[MIGRATION.COLUMN]
        assert column.nullable is True
        (foreign_key,) = column.foreign_keys
        assert foreign_key.constraint.name == MIGRATION.FK_REVERSES
        assert foreign_key.column.table.name == MIGRATION.TABLE
        assert foreign_key.ondelete == "SET NULL"
        uniques = {
            c.name: [col.name for col in c.columns]
            for c in table.constraints
            if isinstance(c, sa.UniqueConstraint)
        }
        assert uniques == {MIGRATION.UQ_REVERSES: [MIGRATION.COLUMN]}


@pytest.fixture
def scratch(monkeypatch):
    """The migration aimed at a scratch table of the test's own.

    Key names must be unique across the schema, so they are prefixed too --
    and shortened, since the model's key name plus a prefix passes MySQL's
    64-character limit.
    """
    prefix = f"r{uuid.uuid4().hex[:6]}_"
    monkeypatch.setattr(MIGRATION, "TABLE", f"{prefix}budget_amendments")
    monkeypatch.setattr(MIGRATION, "FK_REVERSES", f"{prefix}fk_reverses")
    monkeypatch.setattr(MIGRATION, "UQ_REVERSES", f"{prefix}uq_reverses")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for table in ("budget_amendments", "budgets"):
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{prefix}{table}`")
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _build_existing(engine, prefix: str) -> None:
    """``budget_amendments`` as ``ca564ba5a9ad`` left it, with two rows."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}budgets (id VARCHAR(36) PRIMARY KEY, "
            "amount_budgeted NUMERIC(12, 2) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}budget_amendments ("
            "id VARCHAR(36) PRIMARY KEY, budget_id VARCHAR(36) NOT NULL, "
            "amount NUMERIC(12, 2) NOT NULL, "
            f"CONSTRAINT {prefix}fk_budget FOREIGN KEY (budget_id) "
            f"REFERENCES {prefix}budgets (id) ON DELETE CASCADE"
            ") ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {prefix}budgets VALUES ('b-1', 800.00)")
        conn.exec_driver_sql(
            f"INSERT INTO {prefix}budget_amendments VALUES "
            "('am-1', 'b-1', 250.00), ('am-2', 'b-1', 50.00)"
        )
        conn.commit()


def _shape(engine, table: str):
    with engine.connect() as conn:
        inspector = sa.inspect(conn)
        columns = {c["name"]: c for c in inspector.get_columns(table)}
        keys = {fk["name"]: fk for fk in inspector.get_foreign_keys(table)}
        indexes = {ix["name"]: ix for ix in inspector.get_indexes(table)}
    return columns, keys, indexes


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.downgrade)
        with scratch.engine.connect() as conn:
            assert not [
                t
                for t in sa.inspect(conn).get_table_names()
                if t.startswith(scratch.prefix)
            ]

    def test_upgrade_then_downgrade(self, scratch):
        engine = scratch.engine
        p = scratch.prefix
        table = f"{p}budget_amendments"
        _build_existing(engine, p)

        for _ in range(2):  # the second run must change nothing
            _run(engine, MIGRATION.upgrade)
            columns, keys, indexes = _shape(engine, table)
            column = columns["reverses_amendment_id"]
            assert column["nullable"] is True
            key = keys[f"{p}fk_reverses"]
            assert key["constrained_columns"] == ["reverses_amendment_id"]
            assert key["referred_table"] == table
            assert key["options"].get("ondelete") == "SET NULL"
            unique = indexes[f"{p}uq_reverses"]
            assert unique["unique"] in (True, 1)
            assert unique["column_names"] == ["reverses_amendment_id"]
            # The unique key serves the foreign key: nothing else indexes it.
            assert [
                name
                for name, ix in indexes.items()
                if ix["column_names"] == ["reverses_amendment_id"]
            ] == [f"{p}uq_reverses"]

        with engine.connect() as conn:
            # Existing amendments are untouched and unlinked.
            assert (
                conn.exec_driver_sql(
                    f"SELECT COUNT(*) FROM {table} "
                    "WHERE reverses_amendment_id IS NULL"
                ).scalar()
                == 2
            )
            conn.exec_driver_sql(
                f"INSERT INTO {table} VALUES ('rev-1', 'b-1', -250.00, 'am-1')"
            )
            conn.commit()
            # A second reversal of the same amendment is refused by the key.
            with pytest.raises(IntegrityError):
                conn.exec_driver_sql(
                    f"INSERT INTO {table} VALUES ('rev-2', 'b-1', -250.00, 'am-1')"
                )
            conn.rollback()

        _run(engine, MIGRATION.downgrade)
        columns, keys, indexes = _shape(engine, table)
        assert "reverses_amendment_id" not in columns
        assert f"{p}fk_reverses" not in keys
        assert f"{p}uq_reverses" not in indexes
        with engine.connect() as conn:
            # The reversal row and its negative amount survive the downgrade.
            total, count = conn.exec_driver_sql(
                f"SELECT SUM(amount), COUNT(*) FROM {table}"
            ).one()
        assert float(total) == 50.0
        assert count == 3
        # And a second downgrade has nothing left to do.
        _run(engine, MIGRATION.downgrade)

    def test_deleting_the_line_removes_an_amendment_and_its_reversal(self, scratch):
        engine = scratch.engine
        p = scratch.prefix
        table = f"{p}budget_amendments"
        _build_existing(engine, p)
        _run(engine, MIGRATION.upgrade)
        with engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {table} VALUES ('rev-1', 'b-1', -250.00, 'am-1')"
            )
            conn.exec_driver_sql(f"DELETE FROM {p}budgets WHERE id = 'b-1'")
            assert conn.exec_driver_sql(f"SELECT COUNT(*) FROM {table}").scalar() == 0
            conn.commit()
