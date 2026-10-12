"""Migration b834afdaffdf adds the delivery retry columns (MSG-12).

Run against a throwaway copy of ``department_message_deliveries`` under a
prefix in the suite's own database; the real table is never altered.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "b834afdaffdf"
_TABLE = "dmdretrymig_department_message_deliveries"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("delivery_retries", matches[0])
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
                "status VARCHAR(16) NOT NULL DEFAULT 'pending')"
            )
        )
        for row_id, status in rows:
            conn.execute(
                text(f"INSERT INTO {_TABLE} (id, status) VALUES (:id, :s)"),
                {"id": row_id, "s": status},
            )


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module._TABLE = _TABLE
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _shape(engine):
    inspector = sa.inspect(engine)
    columns = {c["name"]: c for c in inspector.get_columns(_TABLE)}
    indexes = {i["name"] for i in inspector.get_indexes(_TABLE)}
    return columns, indexes


def _rows(engine, *cols):
    with engine.connect() as conn:
        return {
            r[0]: tuple(r[1:])
            for r in conn.execute(
                text(f"SELECT id, {', '.join(cols)} FROM {_TABLE} ORDER BY id")
            ).all()
        }


class TestDeliveryRetriesMigration:
    def test_upgrade_adds_the_columns_and_index_without_retrying_old_rows(
        self, scratch_engine
    ):
        _make_table(scratch_engine, [("a", "failed"), ("b", "delivered")])

        _run(scratch_engine, "upgrade")

        columns, indexes = _shape(scratch_engine)
        assert "attempt_count" in columns
        assert columns["attempt_count"]["nullable"] is False
        assert columns["next_attempt_at"]["nullable"] is True
        assert "idx_dept_msg_delivery_due" in indexes
        # Existing rows: one attempt each, and nothing scheduled to retry.
        assert _rows(scratch_engine, "status", "attempt_count", "next_attempt_at") == {
            "a": ("failed", 1, None),
            "b": ("delivered", 1, None),
        }

    def test_a_second_upgrade_changes_nothing(self, scratch_engine):
        _make_table(scratch_engine, [("a", "pending")])
        _run(scratch_engine, "upgrade")

        _run(scratch_engine, "upgrade")

        columns, indexes = _shape(scratch_engine)
        assert {"attempt_count", "next_attempt_at"} <= set(columns)
        assert "idx_dept_msg_delivery_due" in indexes

    def test_downgrade_writes_retrying_rows_down_as_failed(self, scratch_engine):
        _make_table(scratch_engine, [("a", "delivered")])
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(
                text(f"INSERT INTO {_TABLE} (id, status) VALUES ('b', 'retrying')")
            )

        _run(scratch_engine, "downgrade")

        columns, indexes = _shape(scratch_engine)
        assert "attempt_count" not in columns
        assert "next_attempt_at" not in columns
        assert "idx_dept_msg_delivery_due" not in indexes
        assert _rows(scratch_engine, "status") == {
            "a": ("delivered",),
            "b": ("failed",),
        }

    def test_a_database_without_the_table_is_skipped(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
