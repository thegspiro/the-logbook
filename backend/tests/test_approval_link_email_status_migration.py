"""Migration b2d4f6a8c0e3: emailed approval links' send status and version.

Run against a real (SQLite) connection with rows already in the table, because
a column that adds cleanly to an empty table proves nothing about the ones a
department already holds (CLAUDE.md Pitfall #35).
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_b2d4f6a8c0e3_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"
NEW = {"email_status", "email_status_at", "email_link_version"}


def _migration():
    spec = importlib.util.spec_from_file_location("approval_link_status", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    yield database
    database.dispose()


def _create_table(engine):
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE approval_step_records (id TEXT PRIMARY KEY, "
                "status TEXT, approval_token TEXT, token_expires_at TEXT)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO approval_step_records VALUES "
                "('live', 'pending', 'tok-live', '2026-11-05 00:00:00'), "
                "('done', 'approved', NULL, NULL)"
            )
        )


def _run(engine, step):
    module = _migration()
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(module, step)()


def _columns(engine):
    return {c["name"] for c in sa.inspect(engine).get_columns("approval_step_records")}


def _rows(engine):
    with engine.begin() as connection:
        return connection.execute(
            sa.text(
                "SELECT id, approval_token, email_status, email_status_at, "
                "email_link_version FROM approval_step_records ORDER BY id"
            )
        ).fetchall()


class TestApprovalLinkEmailStatusMigration:
    def test_existing_rows_read_as_not_tracked_and_version_zero(self, engine):
        _create_table(engine)
        _run(engine, "upgrade")
        assert NEW <= _columns(engine)
        rows = {row.id: row for row in _rows(engine)}
        # Nothing recorded whether the old sends worked; NULL says so rather
        # than inventing "sent". The live link keeps working.
        assert rows["live"].approval_token == "tok-live"
        assert rows["live"].email_status is None
        assert rows["live"].email_status_at is None
        assert rows["live"].email_link_version == 0
        assert rows["done"].email_link_version == 0

    def test_running_twice_is_a_no_op(self, engine):
        _create_table(engine)
        _run(engine, "upgrade")
        _run(engine, "upgrade")
        assert NEW <= _columns(engine)
        assert len(_rows(engine)) == 2

    def test_a_table_create_all_has_not_built_is_skipped(self, engine):
        _run(engine, "upgrade")
        assert "approval_step_records" not in sa.inspect(engine).get_table_names()
        _run(engine, "downgrade")

    def test_downgrade_drops_the_columns_and_keeps_the_rows(self, engine):
        _create_table(engine)
        _run(engine, "upgrade")
        _run(engine, "downgrade")
        assert not (NEW & _columns(engine))
        with engine.begin() as connection:
            count = connection.execute(
                sa.text("SELECT COUNT(*) FROM approval_step_records")
            ).scalar()
        assert count == 2
