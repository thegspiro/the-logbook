"""``1c6632035ccd``: waiver template types, template position CC, send log.

Run for real against MySQL/MariaDB on uniquely prefixed scratch tables (DDL
cannot ride in a rolled-back transaction; the pattern of
``test_attendance_waiver_migration.py``). The template tables are seeded with
rows before upgrading, because CI's empty database cannot show what an
existing department's rows do (CLAUDE.md pitfall #35). Pinned:

* existing template and scheduled-email rows keep their type through the
  upgrade, and every existing template reads NULL for the new column;
* a waiver type can be stored afterwards, in both tables;
* the send log admits one row per (action, recipient) and refuses a second;
* a second upgrade changes nothing;
* the downgrade deletes only the new types' rows, drops the column and the
  send log, and leaves every other row as it was;
* every step is skipped when its table is not there (pitfall #26).
"""

import importlib.util
import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models.attendance_waiver import AttendanceWaiverEmailSend
from app.models.email_template import EmailTemplate, EmailTemplateType

_PATH = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_1c6632035ccd_*.py"
    )
)


def _migration():
    spec = importlib.util.spec_from_file_location("_waiver_emails", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_PREFIXED = ("TEMPLATES", "SCHEDULED", "SENDS", "ORGANIZATIONS", "REQUESTS", "ACTIONS")


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_names(self):
        assert MIGRATION.TEMPLATES == EmailTemplate.__tablename__
        assert MIGRATION.SENDS == AttendanceWaiverEmailSend.__tablename__
        assert MIGRATION.POSITION_CC in EmailTemplate.__table__.columns
        assert {i.name for i in AttendanceWaiverEmailSend.__table__.indexes} == {
            MIGRATION.IX_SENDS_ORG_REQUEST
        }
        assert MIGRATION.UQ_SENDS in {
            c.name for c in AttendanceWaiverEmailSend.__table__.constraints
        }

    def test_the_widened_enum_is_in_the_models(self):
        # A subset, not equality: ALL_TYPES is frozen at this revision, and a
        # later revision may widen the enum again (as 533f8aba187e does), so
        # the models can only grow past it. What must hold is that this
        # revision adds its own types, keeps every one it found, and names
        # nothing the models do not have.
        models = {t.value for t in EmailTemplateType}
        assert set(MIGRATION.ALL_TYPES) <= models
        assert set(MIGRATION._NEW_TEMPLATE_TYPES) <= set(MIGRATION.ALL_TYPES)
        assert set(MIGRATION._EXISTING_TEMPLATE_TYPES) <= set(MIGRATION.ALL_TYPES)
        assert len(MIGRATION.ALL_TYPES) == len(set(MIGRATION.ALL_TYPES))
        assert MIGRATION.ALL_TYPES[-1] == "custom"


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for attr in _PREFIXED:
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine)
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


def _enum_sql(values) -> str:
    return "ENUM(" + ", ".join(f"'{v}'" for v in values) + ")"


def _build(engine) -> None:
    """The tables as the previous revision leaves them, with rows in them."""
    old = _enum_sql(MIGRATION._EXISTING_TEMPLATE_TYPES)
    with engine.connect() as conn:
        for attr in ("ORGANIZATIONS", "REQUESTS", "ACTIONS"):
            conn.exec_driver_sql(
                f"CREATE TABLE {getattr(MIGRATION, attr)} "
                "(id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
            )
        conn.exec_driver_sql(
            f"CREATE TABLE {MIGRATION.TEMPLATES} (id VARCHAR(36) PRIMARY KEY, "
            f"template_type {old} NOT NULL, default_cc JSON NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {MIGRATION.SCHEDULED} (id VARCHAR(36) PRIMARY KEY, "
            f"template_type {old} NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {MIGRATION.ORGANIZATIONS} VALUES ('org')")
        conn.exec_driver_sql(f"INSERT INTO {MIGRATION.REQUESTS} VALUES ('req')")
        conn.exec_driver_sql(f"INSERT INTO {MIGRATION.ACTIONS} VALUES ('act')")
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.TEMPLATES} VALUES "
            "('t-reset', 'password_reset', NULL), "
            "('t-cancel', 'event_cancellation', %s), "
            "('t-custom', 'custom', NULL)",
            (json.dumps(["secretary@dept.example"]),),
        )
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.SCHEDULED} VALUES ('s-1', 'event_reminder')"
        )
        conn.commit()


def _rows(engine, table: str) -> dict:
    with engine.connect() as conn:
        return {
            r[0]: r[1]
            for r in conn.exec_driver_sql(f"SELECT id, template_type FROM {table}")
        }


def _columns(engine, table: str) -> set:
    with engine.connect() as conn:
        return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _tables(engine) -> set:
    with engine.connect() as conn:
        return set(sa.inspect(conn).get_table_names())


def _send(conn, key: str) -> None:
    conn.exec_driver_sql(
        f"INSERT INTO {MIGRATION.SENDS} (id, organization_id, request_id, "
        "action_id, recipient_key) VALUES (%s, 'org', 'req', 'act', %s)",
        (str(uuid.uuid4()), key),
    )


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_existing_rows_survive_and_the_new_types_store(self, scratch):
        engine = scratch.engine
        _build(engine)
        before_templates = _rows(engine, MIGRATION.TEMPLATES)
        before_scheduled = _rows(engine, MIGRATION.SCHEDULED)

        _run(engine, MIGRATION.upgrade)

        assert _rows(engine, MIGRATION.TEMPLATES) == before_templates
        assert _rows(engine, MIGRATION.SCHEDULED) == before_scheduled
        with engine.connect() as conn:
            assert {
                r[0]: r[1]
                for r in conn.exec_driver_sql(
                    f"SELECT id, {MIGRATION.POSITION_CC} FROM {MIGRATION.TEMPLATES}"
                )
            } == {"t-reset": None, "t-cancel": None, "t-custom": None}
            conn.exec_driver_sql(
                f"INSERT INTO {MIGRATION.TEMPLATES} (id, template_type) "
                "VALUES ('t-waiver', 'session_waiver_requested')"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {MIGRATION.SCHEDULED} VALUES "
                "('s-waiver', 'meeting_waiver_decided')"
            )
            conn.commit()

    def test_the_send_log_refuses_a_second_send_of_one_notice(self, scratch):
        engine = scratch.engine
        _build(engine)
        _run(engine, MIGRATION.upgrade)

        with engine.connect() as conn:
            _send(conn, "user:u-1")
            _send(conn, "user:u-2")
            conn.commit()
            with pytest.raises(IntegrityError):
                _send(conn, "user:u-1")
            conn.rollback()

    def test_a_second_upgrade_changes_nothing(self, scratch):
        engine = scratch.engine
        _build(engine)
        _run(engine, MIGRATION.upgrade)
        with engine.connect() as conn:
            _send(conn, "user:u-1")
            conn.commit()

        _run(engine, MIGRATION.upgrade)

        with engine.connect() as conn:
            assert (
                conn.exec_driver_sql(f"SELECT COUNT(*) FROM {MIGRATION.SENDS}").scalar()
                == 1
            )

    def test_downgrade_removes_only_what_the_upgrade_added(self, scratch):
        engine = scratch.engine
        _build(engine)
        before = _rows(engine, MIGRATION.TEMPLATES)
        _run(engine, MIGRATION.upgrade)
        with engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {MIGRATION.TEMPLATES} (id, template_type) "
                "VALUES ('t-waiver', 'session_waiver_decided')"
            )
            conn.commit()

        _run(engine, MIGRATION.downgrade)

        assert _rows(engine, MIGRATION.TEMPLATES) == before
        assert MIGRATION.POSITION_CC not in _columns(engine, MIGRATION.TEMPLATES)
        assert MIGRATION.SENDS not in _tables(engine)
        with engine.connect() as conn:
            assert (
                conn.exec_driver_sql(
                    f"SELECT default_cc FROM {MIGRATION.TEMPLATES} "
                    "WHERE id = 't-cancel'"
                ).scalar()
                is not None
            )

        _run(engine, MIGRATION.upgrade)
        assert MIGRATION.SENDS in _tables(engine)

    def test_absent_tables_are_skipped(self, scratch):
        engine = scratch.engine

        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)

        assert not {getattr(MIGRATION, a) for a in _PREFIXED} & _tables(engine)
