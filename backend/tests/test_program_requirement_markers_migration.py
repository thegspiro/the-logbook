"""Migration 5372d41aaf3e adds the per-requirement notice markers.

Run against a throwaway copy of ``requirement_progress`` under a prefix in the
suite's own database; the real table is never altered, and no database is
created (CI's database user cannot).
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "5372d41aaf3e"
_TABLE = "reqmarkmig_requirement_progress"
_MARKERS = {
    "due_warning_sent_for",
    "due_warning_days_before",
    "overdue_notice_sent_for",
    "completion_notice_sent_at",
}


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("req_markers", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
    yield engine
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
    engine.dispose()


def _make_table(engine, rows):
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_TABLE} (id VARCHAR(36) PRIMARY KEY, "
                "status VARCHAR(20) NOT NULL, completed_at DATETIME NULL)"
            )
        )
        for row_id, status, completed_at in rows:
            conn.execute(
                text(
                    f"INSERT INTO {_TABLE} (id, status, completed_at) "
                    "VALUES (:id, :s, :c)"
                ),
                {"id": row_id, "s": status, "c": completed_at},
            )


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module._TABLE = _TABLE
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _columns(engine):
    return {c["name"]: c for c in sa.inspect(engine).get_columns(_TABLE)}


def _stamps(engine):
    with engine.connect() as conn:
        return {
            r[0]: r[1]
            for r in conn.execute(
                text(f"SELECT id, completion_notice_sent_at FROM {_TABLE}")
            ).all()
        }


class TestRequirementMarkersMigration:
    def test_adds_nullable_markers_and_stamps_only_past_completions(
        self, scratch_engine
    ):
        _make_table(
            scratch_engine,
            [
                ("done", "completed", "2024-05-01 10:00:00"),
                ("verified", "verified", None),
                ("open", "in_progress", None),
                ("waived", "waived", "2024-05-01 10:00:00"),
            ],
        )

        _run(scratch_engine, "upgrade")

        columns = _columns(scratch_engine)
        assert _MARKERS <= set(columns)
        assert all(columns[name]["nullable"] for name in _MARKERS)
        stamps = _stamps(scratch_engine)
        # A completion from before the upgrade is not announced afterwards.
        assert str(stamps["done"]).startswith("2024-05-01 10:00:00")
        assert stamps["verified"] is not None
        # Nothing else is: an open row is owed its message when it completes,
        # and a waiver never carries one.
        assert stamps["open"] is None
        assert stamps["waived"] is None

    def test_a_second_upgrade_leaves_live_stamps_alone(self, scratch_engine):
        _make_table(scratch_engine, [("a", "in_progress", None)])
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(text(f"UPDATE {_TABLE} SET status = 'completed'"))

        _run(scratch_engine, "upgrade")

        # Still unannounced: the backfill ran with the column, not again.
        assert _stamps(scratch_engine) == {"a": None}

    def test_downgrade_drops_the_markers(self, scratch_engine):
        _make_table(scratch_engine, [("a", "completed", None)])
        _run(scratch_engine, "upgrade")

        _run(scratch_engine, "downgrade")

        assert not (_MARKERS & set(_columns(scratch_engine)))

    def test_a_database_without_the_table_is_skipped(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
