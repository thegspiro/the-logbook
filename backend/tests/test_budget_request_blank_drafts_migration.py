"""``0136dd6d4144`` lets a budget request draft hold no amount or justification.

Run for real against MySQL/MariaDB, on a uniquely named scratch table, as
``test_budget_requests_migration.py`` does (DDL commits implicitly, so it
cannot ride in the rolled-back ``db_session`` transaction). Pinned:

* an empty database is a no-op both ways (pitfall #26);
* over an installation's rows (pitfall #35) both columns become nullable,
  every row keeps its values, a re-run changes nothing, and a blank draft can
  then be stored;
* the downgrade fills a blank draft with 0.00 and an empty string, so NOT
  NULL can return, and leaves every complete request as it was;
* the model declares both columns nullable, so a table ``create_all`` builds
  matches the migrated one.
"""

import importlib.util
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings
from app.models.finance import BudgetRequest

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261111_1320_0136dd6d4144_budget_request_drafts_may_be_blank.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_blank_drafts", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
def test_the_model_matches_the_migrated_table():
    table = BudgetRequest.__table__
    assert MIGRATION.TABLE == table.name
    assert table.c.requested_amount.nullable is True
    assert table.c.justification.nullable is True


@pytest.fixture
def scratch(monkeypatch):
    table = f"r{uuid.uuid4().hex[:6]}_budget_requests"
    monkeypatch.setattr(MIGRATION, "TABLE", table)
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield engine, table
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{table}`")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _nullable(engine, table: str) -> dict:
    with engine.connect() as conn:
        return {c["name"]: c["nullable"] for c in sa.inspect(conn).get_columns(table)}


def _rows(engine, table: str) -> dict:
    with engine.connect() as conn:
        result = conn.exec_driver_sql(
            f"SELECT id, status, requested_amount, justification FROM `{table}`"
        )
        return {
            row.id: (row.status, row.requested_amount, row.justification)
            for row in result
        }


def _build(engine, table: str) -> None:
    """The table as an installation has it before this revision, with rows."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE `{table}` (id VARCHAR(36) PRIMARY KEY, "
            "status VARCHAR(20) NOT NULL, "
            "requested_amount NUMERIC(12, 2) NOT NULL, "
            "justification TEXT NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO `{table}` VALUES "
            "('draft-1', 'draft', 1200.00, 'Hose'), "
            "('sent-1', 'submitted', 5000.50, 'Turnout gear'), "
            "('done-1', 'approved', 0.00, 'Hold flat')"
        )
        conn.commit()


_BEFORE = {
    "draft-1": ("draft", Decimal("1200.00"), "Hose"),
    "sent-1": ("submitted", Decimal("5000.50"), "Turnout gear"),
    "done-1": ("approved", Decimal("0.00"), "Hold flat"),
}


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        engine, table = scratch
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
        with engine.connect() as conn:
            assert table not in sa.inspect(conn).get_table_names()

    def test_upgrade_keeps_every_row_and_allows_a_blank_draft(self, scratch):
        engine, table = scratch
        _build(engine, table)
        assert _nullable(engine, table)["requested_amount"] is False

        _run(engine, MIGRATION.upgrade)
        nullable = _nullable(engine, table)
        assert nullable["requested_amount"] is True
        assert nullable["justification"] is True
        assert _rows(engine, table) == _BEFORE

        # A re-run finds both columns already nullable and changes nothing.
        _run(engine, MIGRATION.upgrade)
        assert _rows(engine, table) == _BEFORE

        with engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO `{table}` VALUES ('blank-1', 'draft', NULL, NULL)"
            )
            conn.commit()
        assert _rows(engine, table)["blank-1"] == ("draft", None, None)

    def test_downgrade_fills_blank_drafts_and_restores_not_null(self, scratch):
        engine, table = scratch
        _build(engine, table)
        _run(engine, MIGRATION.upgrade)
        with engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO `{table}` VALUES "
                "('blank-1', 'draft', NULL, NULL), "
                "('half-1', 'draft', 300.00, NULL)"
            )
            conn.commit()

        _run(engine, MIGRATION.downgrade)
        nullable = _nullable(engine, table)
        assert nullable["requested_amount"] is False
        assert nullable["justification"] is False
        rows = _rows(engine, table)
        assert rows["blank-1"] == ("draft", Decimal("0.00"), "")
        assert rows["half-1"] == ("draft", Decimal("300.00"), "")
        assert {k: rows[k] for k in _BEFORE} == _BEFORE

        # And a second downgrade, with nothing left to do, changes nothing.
        _run(engine, MIGRATION.downgrade)
        assert _rows(engine, table) == rows
