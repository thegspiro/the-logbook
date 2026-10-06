"""Migration b3e8d5a1c947: unescape write-in names stored before S15 (W50-42).

Run against a real (SQLite) connection. Escaped write-ins read as typed;
member candidates and plain names are untouched.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_b3e8d5a1c947_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _run(engine):
    spec = importlib.util.spec_from_file_location("unescape_write_ins", MATCHES[0])
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
                "CREATE TABLE candidates (id TEXT PRIMARY KEY, name VARCHAR(200),"
                " is_write_in BOOLEAN)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO candidates VALUES"
                " ('escaped', 'O&#x27;Brien &lt;Jr&gt;', 1),"
                " ('amp', 'Smith &amp; Sons', 1),"
                " ('plain', 'Jordan Avery', 1),"
                " ('member', 'Pat &amp; Lee', 0)"
            )
        )
    yield database
    database.dispose()


def _names(engine):
    with engine.connect() as connection:
        rows = connection.execute(sa.text("SELECT id, name FROM candidates"))
        return {row[0]: row[1] for row in rows}


def test_escaped_write_ins_read_as_typed(engine):
    _run(engine)
    assert _names(engine) == {
        "escaped": "O'Brien <Jr>",
        "amp": "Smith & Sons",
        "plain": "Jordan Avery",
        # Not a write-in: member names were never escaped by the vote path.
        "member": "Pat &amp; Lee",
    }


def test_a_second_run_changes_nothing(engine):
    _run(engine)
    before = _names(engine)
    _run(engine)
    assert _names(engine) == before


def test_a_database_without_the_table_is_skipped():
    _run(sa.create_engine("sqlite://"))
