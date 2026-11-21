"""Migration 7d6769fca85c: every training attachment entry gets a stable id,
against tables that already hold rows (pitfall #35).

Runs against throwaway copies of the two tables under a prefix in the suite's
own database; the real tables are never touched.
"""

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "7d6769fca85c"
_SHAPE_REVISION = "0c22a95b94b8"
_RECORDS = "entryidmig_training_records"
_SUBMISSIONS = "entryidmig_training_submissions"

_UPLOAD = {
    "file_name": "b.pdf",
    "file_path": "/uploads/org/self-reports/s/b.pdf",
    "file_type": "application/pdf",
    "file_size": 10,
    "uploaded_at": "2026-01-01T00:00:00+00:00",
    "uploaded_by": "u",
}
_KEPT_ID = "11111111-2222-3333-4444-555555555555"

# id -> stored JSON text (None is SQL NULL)
_ROWS = {
    "r-sql-null": None,
    "r-json-null": "null",
    "r-empty": "[]",
    "r-upload": json.dumps([_UPLOAD]),
    "r-has-id": json.dumps([{**_UPLOAD, "id": _KEPT_ID}]),
    "r-name-only": json.dumps([{"file_name": "a.pdf"}]),
    "r-mixed": json.dumps([{**_UPLOAD, "id": _KEPT_ID}, {"file_name": "c.pdf"}]),
    "r-string-left": json.dumps(["left.pdf"]),
    "r-object": json.dumps({"file_name": "not a list"}),
    "r-string": json.dumps("just text"),
}
_UNTOUCHED = {
    "r-json-null",
    "r-empty",
    "r-has-id",
    "r-string-left",
    "r-object",
    "r-string",
}


def _load(revision: str):
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{revision}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location(f"mig_{revision}", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop(conn) -> None:
    conn.execute(text(f"DROP TABLE IF EXISTS {_RECORDS}"))
    conn.execute(text(f"DROP TABLE IF EXISTS {_SUBMISSIONS}"))


@pytest.fixture
def scratch():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        _drop(conn)
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
    yield engine
    with engine.begin() as conn:
        _drop(conn)
    engine.dispose()


def _run(engine, revision: str, step: str, *, batch: int | None = None) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load(revision)
    module.RECORDS_TABLE = _RECORDS
    module.SUBMISSIONS_TABLE = _SUBMISSIONS
    if batch is not None:
        module._BATCH = batch
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _stored(engine, table: str) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT id, attachments FROM {table}")).all()
    return {
        r.id: ("SQL NULL" if r.attachments is None else json.loads(r.attachments))
        for r in rows
    }


def _original(key: str):
    value = _ROWS[key]
    return "SQL NULL" if value is None else json.loads(value)


def _is_uuid(value) -> bool:
    try:
        return str(uuid.UUID(value)) == value
    except (TypeError, ValueError):
        return False


def test_the_revision_targets_the_real_tables():
    module = _load(_REVISION)
    assert module.RECORDS_TABLE == "training_records"
    assert module.SUBMISSIONS_TABLE == "training_submissions"


@pytest.mark.parametrize("table", [_RECORDS, _SUBMISSIONS])
def test_upgrade_stamps_exactly_the_dicts_without_an_id(scratch, table):
    # A batch smaller than the row count, so the keyset walk is exercised.
    _run(scratch, _REVISION, "upgrade", batch=3)
    stored = _stored(scratch, table)

    for key in _UNTOUCHED | {"r-sql-null"}:
        assert stored[key] == _original(key), key
    upload = stored["r-upload"][0]
    upload_id = upload.pop("id")
    assert _is_uuid(upload_id)
    assert upload == _UPLOAD
    name_only = stored["r-name-only"][0]
    assert _is_uuid(name_only["id"]) and name_only["file_name"] == "a.pdf"
    kept, stamped = stored["r-mixed"]
    assert kept["id"] == _KEPT_ID
    assert _is_uuid(stamped["id"]) and stamped["file_name"] == "c.pdf"
    assert len({upload_id, name_only["id"], stamped["id"]}) == 3


@pytest.mark.parametrize("table", [_RECORDS, _SUBMISSIONS])
def test_a_second_upgrade_changes_nothing(scratch, table):
    _run(scratch, _REVISION, "upgrade")
    once = _stored(scratch, table)
    _run(scratch, _REVISION, "upgrade")
    assert _stored(scratch, table) == once


@pytest.mark.parametrize("table", [_RECORDS, _SUBMISSIONS])
def test_downgrade_then_the_shape_downgrade_restore_the_originals(scratch, table):
    """Downgrading this revision strips the ids, so the previous revision's
    downgrade still recognises a name-only entry and turns it back into the
    string it was."""
    _run(scratch, _REVISION, "upgrade")
    _run(scratch, _REVISION, "downgrade")
    stored = _stored(scratch, table)
    for key in _ROWS:
        if key in ("r-has-id", "r-mixed"):
            continue
        assert stored[key] == _original(key), key
    # An id that was there before this revision is not this revision's to
    # remember; the downgrade strips every id.
    assert stored["r-has-id"] == [_UPLOAD]

    _run(scratch, _SHAPE_REVISION, "downgrade")
    assert _stored(scratch, table)["r-name-only"] == ["a.pdf"]
