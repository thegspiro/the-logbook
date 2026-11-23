"""``5a41041e328b`` lets a request hold no email and records how it arrived.

Run for real against MySQL/MariaDB on a uniquely named scratch table, as
``test_budget_request_blank_drafts_migration.py`` does (DDL commits implicitly,
so it cannot ride in the rolled-back ``db_session`` transaction). Pinned:

* an empty database is a no-op both ways (pitfall #26);
* over an installation's rows (pitfall #35) every request keeps its email and
  reads ``web`` — the public form was the only way in before this revision — a
  re-run changes nothing, and a request with no email can then be stored;
* the downgrade fills a missing email with an empty string so NOT NULL can
  return, drops ``source``, and leaves every other row as it was.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261120_2300_5a41041e328b_staff_entered_event_requests.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_staff_entered", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
def test_the_migration_targets_the_event_requests_table():
    assert MIGRATION.TABLE == "event_requests"


@pytest.fixture
def scratch(monkeypatch):
    table = f"r{uuid.uuid4().hex[:6]}_event_requests"
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


def _columns(engine, table: str) -> dict:
    with engine.connect() as conn:
        return {c["name"]: c["nullable"] for c in sa.inspect(conn).get_columns(table)}


def _rows(engine, table: str, with_source: bool) -> dict:
    extra = ", source" if with_source else ""
    with engine.connect() as conn:
        result = conn.exec_driver_sql(
            f"SELECT id, contact_name, contact_email{extra} FROM `{table}`"
        )
        return {row[0]: tuple(row[1:]) for row in result}


def _build(engine, table: str) -> None:
    """The table as an installation has it before this revision, with rows."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE `{table}` (id VARCHAR(36) PRIMARY KEY, "
            "contact_name VARCHAR(255) NOT NULL, "
            "contact_email TEXT NOT NULL, "
            "contact_phone TEXT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO `{table}` VALUES "
            "('req-1', 'Pat Rivera', 'ciphertext-1', NULL), "
            "('req-2', 'Dana Whitfield', 'ciphertext-2', 'ciphertext-p')"
        )
        conn.commit()


_BEFORE = {
    "req-1": ("Pat Rivera", "ciphertext-1"),
    "req-2": ("Dana Whitfield", "ciphertext-2"),
}


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        engine, table = scratch
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
        with engine.connect() as conn:
            assert table not in sa.inspect(conn).get_table_names()

    def test_upgrade_keeps_every_row_and_reads_them_as_web(self, scratch):
        engine, table = scratch
        _build(engine, table)
        assert _columns(engine, table)["contact_email"] is False

        _run(engine, MIGRATION.upgrade)
        columns = _columns(engine, table)
        assert columns["contact_email"] is True
        assert columns["source"] is False
        after = {k: v + ("web",) for k, v in _BEFORE.items()}
        assert _rows(engine, table, with_source=True) == after

        # A re-run finds the column nullable and `source` present.
        _run(engine, MIGRATION.upgrade)
        assert _rows(engine, table, with_source=True) == after

        with engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO `{table}` (id, contact_name, contact_email, source) "
                "VALUES ('phone-1', 'Caller', NULL, 'phone')"
            )
            conn.commit()
        rows = _rows(engine, table, with_source=True)
        assert rows["phone-1"] == ("Caller", None, "phone")

    def test_downgrade_fills_a_missing_email_and_drops_the_source(self, scratch):
        engine, table = scratch
        _build(engine, table)
        _run(engine, MIGRATION.upgrade)
        with engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO `{table}` (id, contact_name, contact_email, source) "
                "VALUES ('phone-1', 'Caller', NULL, 'phone')"
            )
            conn.commit()

        _run(engine, MIGRATION.downgrade)
        columns = _columns(engine, table)
        assert columns["contact_email"] is False
        assert "source" not in columns
        rows = _rows(engine, table, with_source=False)
        assert rows["phone-1"] == ("Caller", "")
        assert {k: rows[k] for k in _BEFORE} == _BEFORE

        # A second downgrade, with nothing left to do, changes nothing.
        _run(engine, MIGRATION.downgrade)
        assert _rows(engine, table, with_source=False) == rows
