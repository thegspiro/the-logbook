"""Migration a0195b397bf3: ``program_enrollments.completion_reason``.

The DDL autocommits, so the migration runs against a throwaway table under a
prefix in the suite's own database (the shape
``test_attribution_set_null_migration.py`` uses); the real table is never
altered. The module's ``TABLE`` is pointed at the scratch copy.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "a0195b397bf3"
_TABLE = "completionreasonmig_program_enrollments"
_COLUMN = "completion_reason"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("completion_reason", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
    yield engine
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
    engine.dispose()


@pytest.fixture
def scratch(engine):
    """A pre-revision copy of the table, holding one completed row."""
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_TABLE} (id VARCHAR(36) PRIMARY KEY, "
                "status VARCHAR(20) NOT NULL, completed_at DATETIME NULL) "
                "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            )
        )
        conn.execute(text(f"INSERT INTO {_TABLE} VALUES ('row-1', 'completed', NOW())"))
    return engine


def _run(engine, step: str) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.TABLE = _TABLE
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _column(engine):
    columns = {c["name"]: c for c in sa.inspect(engine).get_columns(_TABLE)}
    return columns.get(_COLUMN)


def _has_table(engine) -> bool:
    return _TABLE in sa.inspect(engine).get_table_names()


def test_the_revision_targets_program_enrollments():
    module = _load_migration()
    assert module.TABLE == "program_enrollments"
    assert module.COLUMN == _COLUMN


def test_upgrade_adds_a_nullable_text_column_and_keeps_rows(scratch):
    _run(scratch, "upgrade")

    column = _column(scratch)
    assert column is not None
    assert column["nullable"] is True
    assert isinstance(column["type"], sa.Text)
    with scratch.connect() as conn:
        rows = conn.execute(text(f"SELECT id, {_COLUMN} FROM {_TABLE}")).all()
    assert [tuple(r) for r in rows] == [("row-1", None)]


def test_a_second_upgrade_is_a_no_op(scratch):
    _run(scratch, "upgrade")
    with scratch.begin() as conn:
        conn.execute(text(f"UPDATE {_TABLE} SET {_COLUMN} = 'Chief''s call'"))

    _run(scratch, "upgrade")

    with scratch.connect() as conn:
        stored = conn.execute(text(f"SELECT {_COLUMN} FROM {_TABLE}")).scalar_one()
    assert stored == "Chief's call"


def test_downgrade_drops_the_column_and_is_idempotent(scratch):
    _run(scratch, "upgrade")

    _run(scratch, "downgrade")
    assert _column(scratch) is None

    _run(scratch, "downgrade")
    assert _column(scratch) is None
    with scratch.connect() as conn:
        assert conn.execute(text(f"SELECT COUNT(*) FROM {_TABLE}")).scalar() == 1


def test_a_missing_table_is_skipped_both_ways(engine):
    # A create_all-built database may not have the table yet (pitfall #26);
    # create_all then builds it from the model, column included.
    _run(engine, "upgrade")
    _run(engine, "downgrade")
    assert not _has_table(engine)
