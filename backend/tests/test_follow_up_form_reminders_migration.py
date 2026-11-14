"""Migration 30e5b112ec00 adds the reminder columns without touching rows.

Run against a throwaway table in the suite's own database; the real table is
never altered. Rows are inserted first (CLAUDE.md pitfall #35): the NOT NULL
``reminder_count`` must read 0 on every request already there, which is what
lets the reminder task start counting from the first one.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "30e5b112ec00"
_REQUESTS = "x_follow_up_reminder_requests"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("follow_up_reminders", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_REQUESTS}"))
        conn.execute(
            text(
                f"CREATE TABLE {_REQUESTS} (id VARCHAR(36) PRIMARY KEY, "
                "last_sent_at DATETIME NULL)"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {_REQUESTS} (id, last_sent_at) VALUES "
                "('r1', '2026-10-01 08:00:00'), ('r2', NULL)"
            )
        )
    yield engine
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_REQUESTS}"))
    engine.dispose()


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.REQUESTS = _REQUESTS
    module._TEMPLATE_COLUMNS = ()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _columns(engine) -> set:
    return {c["name"] for c in sa.inspect(engine).get_columns(_REQUESTS)}


class TestFollowUpReminderMigration:
    def test_existing_requests_start_with_no_reminders(self, scratch_engine):
        _run(scratch_engine, "upgrade")

        with scratch_engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"SELECT id, reminder_count, last_reminder_at, last_sent_at "
                    f"FROM {_REQUESTS} ORDER BY id"
                )
            ).all()
        assert [(r.id, r.reminder_count, r.last_reminder_at) for r in rows] == [
            ("r1", 0, None),
            ("r2", 0, None),
        ]
        assert rows[0].last_sent_at is not None

    def test_running_it_twice_is_harmless(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")

        assert {"reminder_count", "last_reminder_at"} <= _columns(scratch_engine)

    def test_downgrade_restores_the_old_shape(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")

        assert _columns(scratch_engine) == {"id", "last_sent_at"}
        with scratch_engine.connect() as conn:
            count = conn.execute(text(f"SELECT COUNT(*) FROM {_REQUESTS}")).scalar()
        assert count == 2

    def test_all_types_keeps_custom_last(self):
        migration = _load_migration()

        assert migration.ALL_TYPES[-1] == "custom"
        assert set(migration._NEW_TEMPLATE_TYPES) <= set(migration.ALL_TYPES)
        assert len(migration.ALL_TYPES) == len(set(migration.ALL_TYPES))
