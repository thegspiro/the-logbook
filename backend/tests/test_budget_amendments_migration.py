"""``ca564ba5a9ad`` adds the ``budget_amendments`` table.

Run for real against MySQL/MariaDB — the DDL cannot ride in the rolled-back
``db_session`` transaction, because MySQL commits implicitly around it. CI's
database user may create tables only inside the test database, not a database
of its own, so each test points the migration at uniquely prefixed scratch
tables there and drops them afterwards. Pinned:

* an empty database (CI's ``alembic upgrade head`` before ``create_all``) is
  a no-op both ways: ``budgets`` is built by no migration, and a key to a
  table that is not there cannot be created, so ``create_all`` builds both;
* over an installation's tables the new one arrives with its keys (cascade
  from the line and the organization, SET NULL from the member) and one index
  per key column, and a re-run changes nothing;
* the downgrade drops it and leaves the budget lines alone;
* the table, key and index names are the ones ``create_all`` gives the model.
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
from app.models.finance import BudgetAmendment

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261008_1518_ca564ba5a9ad_budget_amendments.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_budget_amendments", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_KEYS = {
    "organization_id": ("organizations", "CASCADE"),
    "budget_id": ("budgets", "CASCADE"),
    "created_by": ("users", "SET NULL"),
}


_NAMES = (
    "TABLE",
    "BUDGETS",
    "ORGANIZATIONS",
    "USERS",
    "FK_ORGANIZATION",
    "FK_BUDGET",
    "FK_CREATED_BY",
    "IX_ORGANIZATION",
    "IX_BUDGET",
)


@pytest.mark.unit
class TestNamesMatchTheModel:
    def test_table_key_and_index_names_are_create_alls(self):
        table = BudgetAmendment.__table__
        assert MIGRATION.TABLE == table.name
        key_names = {
            "organization_id": MIGRATION.FK_ORGANIZATION,
            "budget_id": MIGRATION.FK_BUDGET,
            "created_by": MIGRATION.FK_CREATED_BY,
        }
        for column, (referred, ondelete) in _KEYS.items():
            (foreign_key,) = table.c[column].foreign_keys
            assert foreign_key.constraint.name == key_names[column]
            assert foreign_key.column.table.name == referred
            assert foreign_key.ondelete == ondelete
        assert table.c.created_by.nullable is True
        assert {index.name for index in table.indexes} == {
            MIGRATION.IX_ORGANIZATION,
            MIGRATION.IX_BUDGET,
        }


@pytest.fixture
def scratch(monkeypatch):
    """The migration aimed at scratch tables of the test's own.

    Prefixed so they can collide with neither the suite's real tables nor a
    concurrent run, and dropped afterwards whatever happens. The key and
    index names derive from the table name, so they are prefixed too: MySQL
    requires a key name to be unique across the whole schema.
    """
    prefix = f"a{uuid.uuid4().hex[:6]}_"
    for attr in _NAMES:
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for table in ("budget_amendments", "budgets", "users", "organizations"):
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


def _build_existing(engine, prefix: str) -> None:
    """The referenced tables as an installation has them before this revision."""
    with engine.connect() as conn:
        for table in ("organizations", "users"):
            conn.exec_driver_sql(
                f"CREATE TABLE {prefix}{table} (id VARCHAR(36) PRIMARY KEY) "
                "ENGINE=InnoDB"
            )
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}budgets (id VARCHAR(36) PRIMARY KEY, "
            "amount_budgeted NUMERIC(12, 2) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {prefix}organizations VALUES ('org-1')")
        conn.exec_driver_sql(f"INSERT INTO {prefix}users VALUES ('u-1')")
        conn.exec_driver_sql(f"INSERT INTO {prefix}budgets VALUES ('b-1', 800.00)")
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
        table = f"{p}budget_amendments"
        _build_existing(engine, p)

        for _ in range(2):  # the second run must change nothing
            _run(engine, MIGRATION.upgrade)
            with engine.connect() as conn:
                inspector = sa.inspect(conn)
                columns = {c["name"]: c for c in inspector.get_columns(table)}
                keys = {
                    fk["constrained_columns"][0]: fk
                    for fk in inspector.get_foreign_keys(table)
                }
                indexed = sorted(
                    i["column_names"][0] for i in inspector.get_indexes(table)
                )
            assert set(columns) == {
                "id",
                "organization_id",
                "budget_id",
                "amount",
                "reason",
                "approved_by",
                "approved_on",
                "created_by",
                "created_at",
            }
            assert columns["created_by"]["nullable"] is True
            assert columns["amount"]["nullable"] is False
            assert columns["approved_on"]["nullable"] is False
            for column, (referred, ondelete) in _KEYS.items():
                assert keys[column]["referred_table"] == f"{p}{referred}"
                assert keys[column]["options"].get("ondelete") == ondelete
            # One index per key column. MySQL indexes each key as the table
            # is created and drops its own once the migration's named index
            # can serve the key instead, so nothing is indexed twice; for
            # created_by, which has no named index, MySQL's stays -- exactly
            # what create_all builds.
            assert indexed == ["budget_id", "created_by", "organization_id"]

        with engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {table} (id, organization_id, budget_id, amount, "
                "reason, approved_by, approved_on, created_by) VALUES "
                "('am-1', 'org-1', 'b-1', 50.00, 'r', 'Board', '2026-10-07', 'u-1')"
            )
            # Removing the member keeps the record and forgets who entered it.
            conn.exec_driver_sql(f"DELETE FROM {p}users WHERE id = 'u-1'")
            assert (
                conn.exec_driver_sql(
                    f"SELECT created_by FROM {table} WHERE id = 'am-1'"
                ).scalar_one()
                is None
            )
            conn.commit()

        _run(engine, MIGRATION.downgrade)
        assert sorted(_tables(engine, p)) == sorted(
            f"{p}{t}" for t in ("budgets", "organizations", "users")
        )
        with engine.connect() as conn:
            assert (
                conn.exec_driver_sql(f"SELECT COUNT(*) FROM {p}budgets").scalar() == 1
            )
        # And a second downgrade has nothing left to do.
        _run(engine, MIGRATION.downgrade)
