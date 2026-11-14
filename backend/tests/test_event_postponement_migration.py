"""Migration 09f0171ccf5e adds the postponement columns without touching rows.

Run against a throwaway table in the suite's own database; the real ``events``
table is never altered. Rows are inserted first (CLAUDE.md pitfall #35): every
event already there must read as never postponed, and keep its dates.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "09f0171ccf5e"
_EVENTS = "x_postponement_events"
_NEW = {"postponed_at", "postponed_from_start", "postponement_reason"}


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("events_postponement", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_EVENTS}"))
        conn.execute(
            text(
                f"CREATE TABLE {_EVENTS} (id VARCHAR(36) PRIMARY KEY, "
                "start_datetime DATETIME NOT NULL, is_cancelled BOOL NOT NULL)"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {_EVENTS} (id, start_datetime, is_cancelled) VALUES "
                "('e1', '2026-10-01 19:00:00', 0), ('e2', '2026-10-08 19:00:00', 1)"
            )
        )
    yield engine
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_EVENTS}"))
    engine.dispose()


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.TABLE = _EVENTS
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _columns(engine) -> set:
    return {c["name"] for c in sa.inspect(engine).get_columns(_EVENTS)}


class TestPostponementMigration:
    def test_existing_events_read_as_never_postponed(self, scratch_engine):
        _run(scratch_engine, "upgrade")

        with scratch_engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, start_datetime, postponed_at, postponed_from_start, "
                    f"postponement_reason FROM {_EVENTS} ORDER BY id"
                )
            ).all()
        assert [
            (r.id, r.postponed_at, r.postponed_from_start, r.postponement_reason)
            for r in rows
        ] == [("e1", None, None, None), ("e2", None, None, None)]
        assert str(rows[0].start_datetime) == "2026-10-01 19:00:00"

    def test_running_it_twice_is_harmless(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")

        assert _NEW <= _columns(scratch_engine)

    def test_downgrade_restores_the_old_shape(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")

        assert _columns(scratch_engine) == {"id", "start_datetime", "is_cancelled"}
        with scratch_engine.connect() as conn:
            count = conn.execute(text(f"SELECT COUNT(*) FROM {_EVENTS}")).scalar()
        assert count == 2

    def test_a_table_not_yet_built_is_left_to_create_all(self, scratch_engine):
        with scratch_engine.begin() as conn:
            conn.execute(text(f"DROP TABLE {_EVENTS}"))

        _run(scratch_engine, "upgrade")

        assert _EVENTS not in sa.inspect(scratch_engine).get_table_names()
