"""``bbb6eac6ae34`` adds ``is_essential`` to apparatus event seats.

Run for real on uniquely named scratch tables (DDL commits implicitly, so it
cannot ride in the rolled-back ``db_session``). Pinned (pitfall #35): over
existing rows every seat becomes essential, as all of them counted before; a
re-run changes nothing; an empty database is a no-op; the downgrade drops it.
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
    / "20261123_0400_bbb6eac6ae34_essential_apparatus_event_seats.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_essential_seats", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
def test_it_targets_both_seat_tables():
    assert MIGRATION.TABLES == (
        "apparatus_event_template_seats",
        "event_apparatus_seats",
    )


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"r{uuid.uuid4().hex[:6]}"
    tables = (f"{prefix}_template_seats", f"{prefix}_event_seats")
    monkeypatch.setattr(MIGRATION, "TABLES", tables)
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield engine, tables
    finally:
        with engine.connect() as conn:
            for table in tables:
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{table}`")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _build(engine, tables) -> None:
    """The seat tables as an installation has them, each with seats in it."""
    with engine.connect() as conn:
        for table in tables:
            conn.exec_driver_sql(
                f"CREATE TABLE `{table}` (id VARCHAR(36) PRIMARY KEY, "
                "name VARCHAR(100) NOT NULL) ENGINE=InnoDB"
            )
            conn.exec_driver_sql(
                f"INSERT INTO `{table}` VALUES ('s1', 'Driver'), ('s2', 'Elf')"
            )
        conn.commit()


def _rows(engine, table):
    with engine.connect() as conn:
        result = conn.exec_driver_sql(
            f"SELECT id, name, is_essential FROM `{table}` ORDER BY id"
        )
        return [tuple(row) for row in result]


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_existing_seats_become_essential_and_a_rerun_changes_nothing(self, scratch):
        engine, tables = scratch
        _build(engine, tables)

        _run(engine, MIGRATION.upgrade)
        for table in tables:
            assert _rows(engine, table) == [("s1", "Driver", 1), ("s2", "Elf", 1)]

        _run(engine, MIGRATION.upgrade)
        for table in tables:
            assert _rows(engine, table) == [("s1", "Driver", 1), ("s2", "Elf", 1)]

    def test_the_downgrade_drops_the_column(self, scratch):
        engine, tables = scratch
        _build(engine, tables)
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
        with engine.connect() as conn:
            for table in tables:
                columns = {c["name"] for c in sa.inspect(conn).get_columns(table)}
                assert columns == {"id", "name"}

    def test_an_empty_database_is_a_no_op(self, scratch):
        engine, tables = scratch
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
        with engine.connect() as conn:
            existing = set(sa.inspect(conn).get_table_names())
        assert not existing & set(tables)
