"""Migration 9a4c1e7b5d22: a stored eligible_voters = [] becomes NULL (W50-41).

Run against a real (SQLite) connection. Only an empty list changes; NULL, a
non-empty list and a JSON null stay as they are.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_9a4c1e7b5d22_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _run(engine):
    spec = importlib.util.spec_from_file_location("empty_voters", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    with database.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE elections (id TEXT PRIMARY KEY, eligible_voters TEXT)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO elections VALUES"
                " ('empty', '[]'), ('spaced', ' [ ] '), ('listed', '[\"u1\"]'),"
                " ('open', NULL), ('json-null', 'null')"
            )
        )
    yield database
    database.dispose()


def _values(engine):
    with engine.connect() as connection:
        rows = connection.execute(sa.text("SELECT id, eligible_voters FROM elections"))
        return {row[0]: row[1] for row in rows}


def test_an_empty_list_becomes_null_and_nothing_else_moves(engine):
    _run(engine)
    assert _values(engine) == {
        "empty": None,
        "spaced": None,
        "listed": '["u1"]',
        "open": None,
        "json-null": "null",
    }


def test_a_second_run_changes_nothing(engine):
    _run(engine)
    before = _values(engine)
    _run(engine)
    assert _values(engine) == before


def test_a_database_without_the_table_is_skipped():
    _run(sa.create_engine("sqlite://"))
