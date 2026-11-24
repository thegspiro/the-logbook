"""``241c1cc27313``: two nullable columns recording what retention removed.

Run for real against MySQL/MariaDB on a uniquely named scratch table (DDL
cannot ride in a rolled-back transaction), with rows already in it (CLAUDE.md
pitfall #35):

* the upgrade adds both columns, NULL on every existing row, and touches no
  other value;
* a re-run of either step, and a missing table, are no-ops (pitfall #26);
* the downgrade drops both and keeps the rows.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings
from app.models.attendance_waiver import AttendanceWaiverRequest

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261124_0343_241c1cc27313_waiver_request_retention_removal_record.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_retention_record", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
def test_the_columns_match_the_model():
    assert MIGRATION.TABLE == AttendanceWaiverRequest.__tablename__
    columns = AttendanceWaiverRequest.__table__.c
    assert columns[MIGRATION.COUNT].nullable
    assert columns[MIGRATION.AT].nullable


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _columns(engine) -> set:
    return {c["name"] for c in sa.inspect(engine).get_columns(MIGRATION.TABLE)}


@pytest.fixture
def scratch(monkeypatch):
    monkeypatch.setattr(
        MIGRATION, "TABLE", f"t{uuid.uuid4().hex[:6]}_attendance_waiver_requests"
    )
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {MIGRATION.TABLE} (id VARCHAR(36) PRIMARY KEY, "
            "status VARCHAR(20) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.TABLE} (id, status) "
            "VALUES ('r1', 'approved'), ('r2', 'withdrawn')"
        )
        conn.commit()
    try:
        yield engine
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{MIGRATION.TABLE}`")
            conn.commit()
        engine.dispose()


@pytest.mark.integration
def test_upgrade_adds_both_null_and_downgrade_keeps_the_rows(scratch):
    _run(scratch, MIGRATION.upgrade)
    _run(scratch, MIGRATION.upgrade)
    assert {MIGRATION.COUNT, MIGRATION.AT} <= _columns(scratch)
    with scratch.connect() as conn:
        rows = conn.exec_driver_sql(
            f"SELECT id, status, {MIGRATION.COUNT}, {MIGRATION.AT} "
            f"FROM {MIGRATION.TABLE} ORDER BY id"
        ).all()
    assert [tuple(r) for r in rows] == [
        ("r1", "approved", None, None),
        ("r2", "withdrawn", None, None),
    ]

    _run(scratch, MIGRATION.downgrade)
    _run(scratch, MIGRATION.downgrade)
    assert not {MIGRATION.COUNT, MIGRATION.AT} & _columns(scratch)
    with scratch.connect() as conn:
        count = conn.exec_driver_sql(f"SELECT COUNT(*) FROM {MIGRATION.TABLE}").scalar()
    assert count == 2


@pytest.mark.integration
def test_a_missing_table_is_a_no_op(monkeypatch):
    monkeypatch.setattr(MIGRATION, "TABLE", f"t{uuid.uuid4().hex[:6]}_absent")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
    finally:
        engine.dispose()
