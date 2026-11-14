"""``8b1cf6f55425`` creates the attendance waiver request tables.

Run for real against MySQL/MariaDB, on uniquely prefixed scratch tables in the
test database (DDL cannot ride in a rolled-back transaction; the pattern of
``test_member_position_terms_migration.py``). Pinned:

* upgrade, downgrade, upgrade: both tables exist after each upgrade and are
  gone after the downgrade, which leaves the tables they point at alone;
* a re-run of either step changes nothing;
* the columns, nullability, keys and indexes are the model's once
  ``5e2b9c7d1a40`` (the 2026-11-13 follow-ups) has run on top, so a database
  built by the migrations and one built by ``create_all`` agree;
* ``live_key`` admits one live request per key and any number of NULLs.

Two new tables hold no existing rows, so there is nothing to settle (pitfall
#35); the uniqueness check is the one constraint with behaviour to prove.
"""

import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings
from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261110_1933_8b1cf6f55425_attendance_waiver_requests.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_attendance_waivers", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_FOLLOWUPS_PATH = _PATH.with_name(
    "20261113_1200_5e2b9c7d1a40_attendance_waiver_followups.py"
)


def _followups():
    spec = importlib.util.spec_from_file_location(
        "_attendance_waiver_followups", _FOLLOWUPS_PATH
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FOLLOWUPS = _followups()

_PREFIXED = ("REQUESTS", "ACTIONS", "ORGANIZATIONS", "USERS", "EVENTS")
_MODELS = {
    "REQUESTS": AttendanceWaiverRequest,
    "ACTIONS": AttendanceWaiverRequestAction,
}


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_table_and_index_names(self):
        assert MIGRATION.REQUESTS == AttendanceWaiverRequest.__tablename__
        assert MIGRATION.ACTIONS == AttendanceWaiverRequestAction.__tablename__
        assert {i.name for i in AttendanceWaiverRequest.__table__.indexes} == {
            MIGRATION.IX_REQUESTS_STATUS,
            MIGRATION.IX_REQUESTS_USER_DATE,
            MIGRATION.IX_REQUESTS_EVENT,
        }
        assert {i.name for i in AttendanceWaiverRequestAction.__table__.indexes} == {
            MIGRATION.IX_ACTIONS_REQUEST,
            MIGRATION.IX_ACTIONS_ORG_REQUEST,
        }

    def test_the_enums_are_frozen_copies_of_the_models(self):
        # The model's enums are this migration's plus what 5e2b9c7d1a40 added;
        # that migration's own "old" tuples must be exactly these.
        assert MIGRATION._WORKFLOWS == tuple(e.value for e in AttendanceWaiverWorkflow)
        assert FOLLOWUPS._OLD_STATUSES == MIGRATION._STATUSES
        assert FOLLOWUPS._OLD_ACTIONS == MIGRATION._ACTIONS
        assert FOLLOWUPS._NEW_STATUSES == tuple(e.value for e in AttendanceWaiverStatus)
        assert FOLLOWUPS._NEW_ACTIONS == tuple(e.value for e in AttendanceWaiverAction)


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for attr in _PREFIXED:
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    for attr in ("REQUESTS", "ACTIONS"):
        monkeypatch.setattr(FOLLOWUPS, attr, getattr(MIGRATION, attr))
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for attr in _PREFIXED:
                conn.exec_driver_sql(
                    f"DROP TABLE IF EXISTS `{getattr(MIGRATION, attr)}`"
                )
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _parents(engine) -> None:
    with engine.connect() as conn:
        for attr in ("ORGANIZATIONS", "USERS", "EVENTS"):
            conn.exec_driver_sql(
                f"CREATE TABLE {getattr(MIGRATION, attr)} "
                "(id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
            )
        conn.exec_driver_sql(f"INSERT INTO {MIGRATION.ORGANIZATIONS} VALUES ('org')")
        conn.exec_driver_sql(f"INSERT INTO {MIGRATION.USERS} VALUES ('u-1')")
        conn.commit()


def _tables(engine) -> set:
    with engine.connect() as conn:
        return set(sa.inspect(conn).get_table_names())


def _insert(conn, request_id: str, live_key) -> None:
    conn.exec_driver_sql(
        f"INSERT INTO {MIGRATION.REQUESTS} (id, organization_id, workflow, user_id, "
        "event_title_snapshot, event_start_snapshot, session_date, live_key) "
        "VALUES (%s, 'org', 'training_session', 'u-1', 'Drill', "
        "'2026-11-20 23:00:00', '2026-11-20', %s)",
        (request_id, live_key),
    )


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_upgrade_downgrade_upgrade(self, scratch):
        engine = scratch.engine
        _parents(engine)
        mine = {MIGRATION.REQUESTS, MIGRATION.ACTIONS}

        for _ in range(2):  # a re-run is a no-op
            _run(engine, MIGRATION.upgrade)
            assert mine <= _tables(engine)
        for _ in range(2):
            _run(engine, MIGRATION.downgrade)
            assert not mine & _tables(engine)
        assert MIGRATION.USERS in _tables(engine)
        _run(engine, MIGRATION.upgrade)
        assert mine <= _tables(engine)

    def test_the_columns_and_keys_are_the_models(self, scratch):
        engine = scratch.engine
        _parents(engine)
        _run(engine, MIGRATION.upgrade)
        _run(engine, FOLLOWUPS.upgrade)
        referred = {
            "organizations": MIGRATION.ORGANIZATIONS,
            "users": MIGRATION.USERS,
            "events": MIGRATION.EVENTS,
            AttendanceWaiverRequest.__tablename__: MIGRATION.REQUESTS,
        }
        with engine.connect() as conn:
            inspector = sa.inspect(conn)
            for attr, model in _MODELS.items():
                table = getattr(MIGRATION, attr)
                built = {c["name"]: c["nullable"] for c in inspector.get_columns(table)}
                expected = {c.name: c.nullable for c in model.__table__.columns}
                assert built == expected, attr

                keys = {
                    (fk["constrained_columns"][0], fk["referred_table"]): (
                        fk.get("options") or {}
                    ).get("ondelete")
                    for fk in inspector.get_foreign_keys(table)
                }
                assert keys == {
                    (
                        next(iter(fk.constraint.columns)).name,
                        referred[fk.column.table.name],
                    ): fk.ondelete
                    for fk in model.__table__.foreign_keys
                }, attr

                indexes = {
                    i["name"]: i["column_names"]
                    for i in inspector.get_indexes(table)
                    if i["name"].startswith("ix_")
                }
                assert indexes == {
                    i.name: [c.name for c in i.columns] for i in model.__table__.indexes
                }, attr

    def test_one_live_request_per_key(self, scratch):
        engine = scratch.engine
        _parents(engine)
        _run(engine, MIGRATION.upgrade)
        with engine.connect() as conn:
            _insert(conn, "r-1", "training_session:e:u-1")
            _insert(conn, "r-2", None)
            _insert(conn, "r-3", None)
            conn.commit()
            with pytest.raises(sa.exc.IntegrityError):
                _insert(conn, "r-4", "training_session:e:u-1")
            conn.rollback()
