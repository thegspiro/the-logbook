"""Migration a6c3e8d17f42 adds evaluation_steps.assignee_id.

Run against a throwaway table in the suite's own database, with rows in it
before the upgrade (CLAUDE.md pitfall #35); the real table is never altered.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "a6c3e8d17f42"
_TABLE = "x_assignee_evaluation_steps"
_INDEX = "ix_x_assignee_evaluation_steps_assignee_id"
_FOREIGN_KEY = "fk_x_assignee_evaluation_steps_assignee_id"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("step_assignee", matches[0])
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


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.TABLE = _TABLE
    module.INDEX = _INDEX
    module.FOREIGN_KEY = _FOREIGN_KEY
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _with_rows(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_TABLE} (id VARCHAR(36) PRIMARY KEY, "
                "step_type VARCHAR(30) NOT NULL) "
                "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {_TABLE} (id, step_type) VALUES "
                "('a', 'approval'), ('b', 'calibration')"
            )
        )


class TestEvaluationStepAssigneeMigration:
    def test_existing_steps_keep_the_workflows_actor(self, scratch_engine):
        _with_rows(scratch_engine)

        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")  # a re-run changes nothing

        inspector = sa.inspect(scratch_engine)
        column = {c["name"]: c for c in inspector.get_columns(_TABLE)}["assignee_id"]
        assert column["nullable"] is True
        (fk,) = inspector.get_foreign_keys(_TABLE)
        assert fk["referred_table"] == "users"
        assert fk["constrained_columns"] == ["assignee_id"]
        assert (fk.get("options") or {}).get("ondelete") == "SET NULL"
        assert _INDEX in {ix["name"] for ix in inspector.get_indexes(_TABLE)}
        with scratch_engine.connect() as conn:
            rows = conn.execute(
                text(f"SELECT id, assignee_id FROM {_TABLE} ORDER BY id")
            ).all()
        # NULL is "the workflow's actor decides": how every step resolved before.
        assert [tuple(r) for r in rows] == [("a", None), ("b", None)]

    def test_downgrade_drops_the_column_and_keeps_the_rows(self, scratch_engine):
        _with_rows(scratch_engine)
        _run(scratch_engine, "upgrade")

        _run(scratch_engine, "downgrade")

        inspector = sa.inspect(scratch_engine)
        assert {c["name"] for c in inspector.get_columns(_TABLE)} == {
            "id",
            "step_type",
        }
        assert inspector.get_foreign_keys(_TABLE) == []
        with scratch_engine.connect() as conn:
            assert conn.execute(text(f"SELECT COUNT(*) FROM {_TABLE}")).scalar() == 2

    def test_without_the_table_nothing_happens(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
        assert _TABLE not in sa.inspect(scratch_engine).get_table_names()
