"""Migration 611204dcf8d1 adds shifts.evaluation_requirements, NULL for every
existing shift.

Run against a throwaway table in the suite's own database; the real table is
never altered. Rows are inserted first because the point of the step is what
happens to shifts that already exist: each reads NULL ("not stored yet") and
keeps everything else it held.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "611204dcf8d1"
_TABLE = "x_eval_req_shifts"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("eval_requirements", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
        conn.execute(
            text(f"CREATE TABLE {_TABLE} (id VARCHAR(36) PRIMARY KEY, notes TEXT)")
        )
        conn.execute(
            text(f"INSERT INTO {_TABLE} (id, notes) VALUES ('a', 'kept'), ('b', NULL)")
        )
    yield engine
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
    engine.dispose()


def _run(engine, step: str, table: str = _TABLE):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.TABLE = table
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _columns(engine) -> dict:
    return {c["name"]: c for c in sa.inspect(engine).get_columns(_TABLE)}


class TestEvaluationRequirementsMigration:
    def test_existing_shifts_read_not_stored_yet(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")  # a re-run changes nothing

        assert _columns(scratch_engine)["evaluation_requirements"]["nullable"] is True
        with scratch_engine.connect() as conn:
            rows = conn.execute(
                text(f"SELECT id, notes, evaluation_requirements FROM {_TABLE}")
            ).all()
        assert sorted(tuple(r) for r in rows) == [
            ("a", "kept", None),
            ("b", None, None),
        ]

    def test_downgrade_drops_it_and_keeps_the_rows(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
        _run(scratch_engine, "downgrade")  # and is safe to repeat

        assert "evaluation_requirements" not in _columns(scratch_engine)
        with scratch_engine.connect() as conn:
            count = conn.execute(text(f"SELECT COUNT(*) FROM {_TABLE}")).scalar_one()
        assert count == 2

        _run(scratch_engine, "upgrade")
        assert "evaluation_requirements" in _columns(scratch_engine)

    def test_a_missing_table_is_skipped(self, scratch_engine):
        _run(scratch_engine, "upgrade", table="x_eval_req_absent")
        _run(scratch_engine, "downgrade", table="x_eval_req_absent")

        assert "x_eval_req_absent" not in sa.inspect(scratch_engine).get_table_names()
