"""Migration 0c22a95b94b8: bare-string training attachment entries become
``{"file_name": ...}``, against tables that already hold rows (pitfall #35).

Runs against throwaway copies of the two tables under a prefix in the suite's
own database; the real tables are never touched. The module's table names are
pointed at the scratch copies.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "0c22a95b94b8"
_RECORDS = "attshapemig_training_records"
_SUBMISSIONS = "attshapemig_training_submissions"

_SIX_KEYS = {
    "file_name": "b.pdf",
    "file_path": "/uploads/org/self-reports/s/b.pdf",
    "file_type": "application/pdf",
    "file_size": 10,
    "uploaded_at": "2026-01-01T00:00:00+00:00",
    "uploaded_by": "u",
}
_D = {**_SIX_KEYS, "file_name": "d.pdf"}

# id -> stored JSON text (None is SQL NULL)
_ROWS = {
    "r-sql-null": None,
    "r-json-null": "null",
    "r-empty": "[]",
    "r-strings": json.dumps(["a.pdf"]),
    "r-dicts": json.dumps([_SIX_KEYS]),
    "r-mixed": json.dumps(["c.pdf", _D]),
    "r-object": json.dumps({"file_name": "not a list"}),
    "r-string": json.dumps("just text"),
}
_UPGRADED = {
    **{k: (None if v is None else json.loads(v)) for k, v in _ROWS.items()},
    "r-strings": [{"file_name": "a.pdf"}],
    "r-mixed": [{"file_name": "c.pdf"}, _D],
}


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("attachment_shape", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop(conn) -> None:
    conn.execute(text(f"DROP TABLE IF EXISTS {_RECORDS}"))
    conn.execute(text(f"DROP TABLE IF EXISTS {_SUBMISSIONS}"))


@pytest.fixture
def engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        _drop(conn)
    yield engine
    with engine.begin() as conn:
        _drop(conn)
    engine.dispose()


@pytest.fixture
def scratch(engine):
    with engine.begin() as conn:
        for table in (_RECORDS, _SUBMISSIONS):
            conn.execute(
                text(
                    f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, "
                    "attachments JSON NULL) "
                    "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                )
            )
            conn.execute(
                text(f"INSERT INTO {table} (id, attachments) VALUES (:id, :value)"),
                [{"id": i, "value": v} for i, v in _ROWS.items()],
            )
    return engine


def _run(engine, step: str, *, batch: int | None = None) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.RECORDS_TABLE = _RECORDS
    module.SUBMISSIONS_TABLE = _SUBMISSIONS
    if batch is not None:
        module._BATCH = batch
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _stored(engine, table: str) -> dict:
    """Each row's value as JSON, keeping SQL NULL apart from a JSON null."""
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT id, attachments FROM {table}")).all()
    return {
        r.id: ("SQL NULL" if r.attachments is None else json.loads(r.attachments))
        for r in rows
    }


def _expected(values: dict) -> dict:
    return {k: ("SQL NULL" if k == "r-sql-null" else v) for k, v in values.items()}


def test_the_revision_targets_the_real_tables():
    module = _load_migration()
    assert module.RECORDS_TABLE == "training_records"
    assert module.SUBMISSIONS_TABLE == "training_submissions"


@pytest.mark.parametrize("table", [_RECORDS, _SUBMISSIONS])
def test_upgrade_settles_strings_and_leaves_the_rest(scratch, table):
    # A batch smaller than the row count, so the keyset walk is exercised.
    _run(scratch, "upgrade", batch=3)
    assert _stored(scratch, table) == _expected(_UPGRADED)


@pytest.mark.parametrize("table", [_RECORDS, _SUBMISSIONS])
def test_a_second_upgrade_changes_nothing(scratch, table):
    _run(scratch, "upgrade")
    _run(scratch, "upgrade")
    assert _stored(scratch, table) == _expected(_UPGRADED)


@pytest.mark.parametrize("table", [_RECORDS, _SUBMISSIONS])
def test_downgrade_restores_the_originals(scratch, table):
    _run(scratch, "upgrade")
    _run(scratch, "downgrade")
    original = {k: (None if v is None else json.loads(v)) for k, v in _ROWS.items()}
    assert _stored(scratch, table) == _expected(original)


def test_a_missing_table_is_skipped(engine):
    """Neither scratch table exists: both steps return without raising."""
    _run(engine, "upgrade")
    _run(engine, "downgrade")
