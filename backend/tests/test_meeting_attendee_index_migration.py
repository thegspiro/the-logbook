"""``b37218495d33``: drop the redundant ``idx_meeting_attendees_meeting``.

Run for real against MySQL/MariaDB on uniquely named scratch tables (DDL cannot
ride in a rolled-back transaction), with rows in place (CLAUDE.md pitfall #35):

* with the unique (meeting_id, user_id) index present, the single-column index
  is dropped, the foreign key still holds, and downgrade puts it back;
* without another index leading on meeting_id it is kept, since MySQL will not
  drop the last index backing a foreign key;
* a missing table, and a re-run of either step, are no-ops (pitfall #26).
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings
from app.models.meeting import MeetingAttendee

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261123_0600_b37218495d33_drop_redundant_meeting_attendees_.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_attendee_index", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
def test_the_model_no_longer_declares_it_and_keeps_the_unique_index():
    assert MIGRATION.TABLE == MeetingAttendee.__tablename__
    indexes = {i.name: i for i in MeetingAttendee.__table__.indexes}
    assert MIGRATION.INDEX not in indexes
    unique = indexes["uq_meeting_attendees_meeting_user"]
    assert [c.name for c in unique.columns][0] == MIGRATION.COLUMN


def _scratch(monkeypatch, with_unique: bool):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    meetings = f"{prefix}meetings"
    monkeypatch.setattr(MIGRATION, "TABLE", f"{prefix}meeting_attendees")
    unique = (
        ", UNIQUE INDEX uq_meeting_user (meeting_id, user_id)" if with_unique else ""
    )
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {meetings} (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {MIGRATION.TABLE} ("
            "id VARCHAR(36) PRIMARY KEY, meeting_id VARCHAR(36) NOT NULL, "
            "user_id VARCHAR(36) NOT NULL, "
            f"INDEX {MIGRATION.INDEX} (meeting_id){unique}, "
            f"CONSTRAINT {prefix}fk FOREIGN KEY (meeting_id) REFERENCES {meetings} (id) "
            "ON DELETE CASCADE) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {meetings} (id) VALUES ('m1')")
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.TABLE} (id, meeting_id, user_id) "
            "VALUES ('a1', 'm1', 'u1'), ('a2', 'm1', 'u2')"
        )
        conn.commit()
    return engine, meetings


def _drop(engine, *tables) -> None:
    with engine.connect() as conn:
        for table in tables:
            conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{table}`")
        conn.commit()
    engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _index_names(engine) -> set:
    return {ix["name"] for ix in sa.inspect(engine).get_indexes(MIGRATION.TABLE)}


def _count(engine) -> int:
    with engine.connect() as conn:
        return conn.exec_driver_sql(f"SELECT COUNT(*) FROM {MIGRATION.TABLE}").scalar()


@pytest.mark.integration
def test_dropped_when_the_unique_index_covers_it_and_restored_on_downgrade(
    monkeypatch,
):
    engine, meetings = _scratch(monkeypatch, with_unique=True)
    try:
        _run(engine, MIGRATION.upgrade)
        assert MIGRATION.INDEX not in _index_names(engine)
        assert "uq_meeting_user" in _index_names(engine)
        assert _count(engine) == 2
        with engine.connect() as conn, pytest.raises(sa.exc.IntegrityError):
            conn.exec_driver_sql(
                f"INSERT INTO {MIGRATION.TABLE} (id, meeting_id, user_id) "
                "VALUES ('a3', 'no-such-meeting', 'u3')"
            )
        _run(engine, MIGRATION.upgrade)

        _run(engine, MIGRATION.downgrade)
        assert MIGRATION.INDEX in _index_names(engine)
        _run(engine, MIGRATION.downgrade)
        assert _count(engine) == 2
    finally:
        _drop(engine, MIGRATION.TABLE, meetings)


@pytest.mark.integration
def test_kept_when_it_is_the_only_index_backing_the_foreign_key(monkeypatch):
    engine, meetings = _scratch(monkeypatch, with_unique=False)
    try:
        _run(engine, MIGRATION.upgrade)
        assert MIGRATION.INDEX in _index_names(engine)
    finally:
        _drop(engine, MIGRATION.TABLE, meetings)


@pytest.mark.integration
def test_a_missing_table_is_a_no_op(monkeypatch):
    monkeypatch.setattr(MIGRATION, "TABLE", f"t{uuid.uuid4().hex[:6]}_absent")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
    finally:
        engine.dispose()
