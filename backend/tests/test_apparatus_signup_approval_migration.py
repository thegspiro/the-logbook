"""Migration 5c8e1f3a9d27: coordinator approval of apparatus self sign-ups.

Run against a real (SQLite) connection with templates and nights already
stored, because a column that adds cleanly to an empty table proves nothing
about the rows a department already holds (CLAUDE.md Pitfall #35). Existing
rows must read "approval off", so every night keeps taking seats at once.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_5c8e1f3a9d27_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"
FLAGGED = ("apparatus_event_templates", "event_apparatus_plans")


def _migration():
    spec = importlib.util.spec_from_file_location("signup_approval", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    yield database
    database.dispose()


def _existing(engine):
    with engine.begin() as connection:
        for table in FLAGGED:
            connection.execute(
                sa.text(
                    f"CREATE TABLE {table} (id TEXT PRIMARY KEY, "
                    "allow_self_signup BOOLEAN NOT NULL DEFAULT 1)"
                )
            )
            connection.execute(
                sa.text(f"INSERT INTO {table} VALUES ('open', 1), ('assigned', 0)")
            )


def _run(engine, step):
    module = _migration()
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(module, step)()


def _flags(engine, table):
    with engine.begin() as connection:
        return dict(
            connection.execute(
                sa.text(f"SELECT id, require_signup_approval FROM {table}")
            ).fetchall()
        )


class TestSignupApprovalMigration:
    def test_existing_templates_and_nights_read_approval_off(self, engine):
        _existing(engine)
        _run(engine, "upgrade")
        for table in FLAGGED:
            assert _flags(engine, table) == {"open": 0, "assigned": 0}
        assert "apparatus_event_seat_requests" in sa.inspect(engine).get_table_names()

    def test_running_twice_is_a_no_op(self, engine):
        _existing(engine)
        _run(engine, "upgrade")
        _run(engine, "upgrade")
        for table in FLAGGED:
            assert _flags(engine, table) == {"open": 0, "assigned": 0}

    def test_a_table_only_create_all_builds_is_skipped(self, engine):
        # Neither apparatus table exists (pitfall #26): the upgrade still runs.
        _run(engine, "upgrade")
        assert sa.inspect(engine).get_table_names() == ["apparatus_event_seat_requests"]

    def test_downgrade_removes_only_what_it_added(self, engine):
        _existing(engine)
        _run(engine, "upgrade")
        _run(engine, "downgrade")
        inspector = sa.inspect(engine)
        assert "apparatus_event_seat_requests" not in inspector.get_table_names()
        for table in FLAGGED:
            columns = {c["name"] for c in inspector.get_columns(table)}
            assert columns == {"id", "allow_self_signup"}
