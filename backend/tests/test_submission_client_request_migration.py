"""Migration e9bfa68963ce: a per-member key for resent training submissions.

Run against a real (SQLite) connection with rows already present, because a
unique key that holds on an empty table proves nothing (CLAUDE.md Pitfall #35).
SQLite cannot add a constraint by ALTER, so the constraint step is carried out
as the unique index MySQL builds for it. Both treat NULLs as distinct in a
unique index, which is what lets the existing rows, all NULL, satisfy it.
"""

import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_e9bfa68963ce_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _migration():
    spec = importlib.util.spec_from_file_location("submission_client_id", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    with database.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE training_submissions (id TEXT PRIMARY KEY, "
                "submitted_by TEXT NOT NULL, course_name TEXT NOT NULL)"
            )
        )
        # Several submissions by one member, as every installation has.
        for row_id, member in (("s1", "u1"), ("s2", "u1"), ("s3", "u2")):
            connection.execute(
                sa.text("INSERT INTO training_submissions VALUES (:i, :m, 'Drill')"),
                {"i": row_id, "m": member},
            )
    try:
        yield database
    finally:
        database.dispose()


def _run(engine, step):
    module = _migration()

    def create_unique(name, table, columns):
        module.op.execute(
            f"CREATE UNIQUE INDEX {name} ON {table} ({', '.join(columns)})"
        )

    def drop_unique(name, table, type_=None):
        module.op.execute(f"DROP INDEX {name}")

    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            with (
                patch.object(module.op, "create_unique_constraint", create_unique),
                patch.object(module.op, "drop_constraint", drop_unique),
            ):
                getattr(module, step)()


def _insert(engine, row_id, member, client_request_id):
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO training_submissions "
                "(id, submitted_by, course_name, client_request_id) "
                "VALUES (:i, :m, 'Drill', :c)"
            ),
            {"i": row_id, "m": member, "c": client_request_id},
        )


class TestSubmissionClientRequestMigration:
    def test_existing_rows_keep_their_data_and_satisfy_the_key(self, engine):
        _run(engine, "upgrade")

        with engine.begin() as connection:
            rows = connection.execute(
                sa.text(
                    "SELECT id, submitted_by, client_request_id "
                    "FROM training_submissions ORDER BY id"
                )
            ).fetchall()
        assert [tuple(r) for r in rows] == [
            ("s1", "u1", None),
            ("s2", "u1", None),
            ("s3", "u2", None),
        ]

    def test_a_repeated_request_id_is_refused_for_the_same_member_only(self, engine):
        _run(engine, "upgrade")

        _insert(engine, "n1", "u1", "req-1")
        _insert(engine, "n2", "u2", "req-1")  # another member may reuse it
        _insert(engine, "n3", "u1", None)  # and submissions without one still go
        with pytest.raises(sa.exc.IntegrityError):
            _insert(engine, "n4", "u1", "req-1")

    def test_running_it_twice_changes_nothing(self, engine):
        _run(engine, "upgrade")
        _run(engine, "upgrade")

        columns = [
            c["name"] for c in sa.inspect(engine).get_columns("training_submissions")
        ]
        assert columns.count("client_request_id") == 1

    def test_downgrade_removes_the_key_and_the_column(self, engine):
        _run(engine, "upgrade")
        _run(engine, "downgrade")

        inspector = sa.inspect(engine)
        assert "client_request_id" not in [
            c["name"] for c in inspector.get_columns("training_submissions")
        ]
        assert inspector.get_indexes("training_submissions") == []

    def test_a_database_without_the_table_is_left_alone(self):
        empty = sa.create_engine("sqlite://")
        try:
            _run(empty, "upgrade")
            assert sa.inspect(empty).get_table_names() == []
        finally:
            empty.dispose()
