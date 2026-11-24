"""Migration 9c41e7b2d5a3: anonymised members' names as instructors read
"Former member", against tables that already hold rows (pitfall #35).

Runs against throwaway copies of the four tables under a prefix in the
suite's own database; the real tables are never touched.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "9c41e7b2d5a3"
_USERS = "instrmig_users"
_TEMPLATES = "instrmig_event_templates"
_SESSIONS = "instrmig_training_sessions"
_RECORDS = "instrmig_training_records"
_TABLES = (_USERS, _TEMPLATES, _SESSIONS, _RECORDS)
_CHARSET = " DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
FORMER = "Former member"


def _details(instructor_id, name):
    return {
        "course_name": "Ladders",
        "instructor_id": instructor_id,
        "instructor": name,
    }


def _load():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("mig_instr", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop(conn):
    for table in _TABLES:
        conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


@pytest.fixture
def scratch():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        _drop(conn)
        conn.execute(
            text(
                f"CREATE TABLE {_USERS} (id VARCHAR(36) PRIMARY KEY, "
                "anonymized_at DATETIME NULL)" + _CHARSET
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {_TEMPLATES} (id VARCHAR(36) PRIMARY KEY, "
                "training_details JSON NULL)" + _CHARSET
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {_SESSIONS} (id VARCHAR(36) PRIMARY KEY, "
                "event_id VARCHAR(36), instructor VARCHAR(255) NULL, "
                "instructor_id VARCHAR(36) NULL)" + _CHARSET
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {_RECORDS} (id VARCHAR(36) PRIMARY KEY, "
                "source_event_id VARCHAR(36) NULL, instructor VARCHAR(255) NULL)"
                + _CHARSET
            )
        )
        conn.execute(
            text(f"INSERT INTO {_USERS} VALUES (:id, :at)"),
            [
                {"id": "anon", "at": "2026-11-01 00:00:00"},
                {"id": "live", "at": None},
            ],
        )
        conn.execute(
            text(f"INSERT INTO {_TEMPLATES} VALUES (:id, :value)"),
            [
                {"id": "t-anon", "value": json.dumps(_details("anon", "Pat F"))},
                {"id": "t-live", "value": json.dumps(_details("live", "Sam C"))},
                {"id": "t-none", "value": json.dumps(_details(None, None))},
                {"id": "t-null", "value": None},
                {"id": "t-list", "value": "[]"},
            ],
        )
        conn.execute(
            text(f"INSERT INTO {_SESSIONS} VALUES (:id, :event, :name, :who)"),
            [
                {"id": "s-anon", "event": "e-1", "name": "Pat F", "who": "anon"},
                {"id": "s-blank", "event": "e-2", "name": None, "who": "anon"},
                {"id": "s-live", "event": "e-3", "name": "Sam C", "who": "live"},
                {"id": "s-gone", "event": "e-4", "name": "Old Name", "who": None},
            ],
        )
        conn.execute(
            text(f"INSERT INTO {_RECORDS} VALUES (:id, :event, :name)"),
            [
                {"id": "r-copy", "event": "e-1", "name": "Pat F"},
                {"id": "r-edited", "event": "e-1", "name": "Sam C"},
                {"id": "r-other-event", "event": "e-9", "name": "Pat F"},
                {"id": "r-live", "event": "e-3", "name": "Sam C"},
                {"id": "r-gone", "event": "e-4", "name": "Old Name"},
            ],
        )
    yield engine
    with engine.begin() as conn:
        _drop(conn)
    engine.dispose()


def _upgrade(engine, *, batch=None):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load()
    module.USERS_TABLE = _USERS
    module.TEMPLATES_TABLE = _TEMPLATES
    module.SESSIONS_TABLE = _SESSIONS
    module.RECORDS_TABLE = _RECORDS
    if batch is not None:
        module._BATCH = batch
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()


def _column(engine, table, column):
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT id, {column} FROM {table}")).all()
    return {r[0]: r[1] for r in rows}


def _templates(engine):
    return {
        k: (None if v is None else json.loads(v))
        for k, v in _column(engine, _TEMPLATES, "training_details").items()
    }


_EXPECTED_TEMPLATES = {
    "t-anon": _details(None, FORMER),
    "t-live": _details("live", "Sam C"),
    "t-none": _details(None, None),
    "t-null": None,
    "t-list": [],
}
_EXPECTED_SESSIONS = {
    "s-anon": FORMER,
    "s-blank": FORMER,
    "s-live": "Sam C",
    "s-gone": "Old Name",
}
_EXPECTED_RECORDS = {
    "r-copy": FORMER,
    "r-edited": "Sam C",
    "r-other-event": "Pat F",
    "r-live": "Sam C",
    "r-gone": "Old Name",
}


def _assert_expected(engine):
    assert _templates(engine) == _EXPECTED_TEMPLATES
    assert _column(engine, _SESSIONS, "instructor") == _EXPECTED_SESSIONS
    assert _column(engine, _RECORDS, "instructor") == _EXPECTED_RECORDS


@pytest.mark.parametrize("batch", [None, 1])
def test_upgrade_rewrites_only_anonymised_instructors(scratch, batch):
    _upgrade(scratch, batch=batch)

    _assert_expected(scratch)


def test_a_second_run_changes_nothing(scratch):
    _upgrade(scratch)
    _upgrade(scratch)

    _assert_expected(scratch)
