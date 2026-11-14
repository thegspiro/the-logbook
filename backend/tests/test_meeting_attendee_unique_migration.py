"""``7b6db9dd8e4f``: the waiver request link and one attendee row per member.

Run for real against MySQL/MariaDB on uniquely prefixed scratch tables (DDL
cannot ride in a rolled-back transaction), with the awkward rows in place
before the upgrade (CLAUDE.md pitfall #35):

* duplicate (meeting, member) rows are settled: the row with a waiver is kept
  over a newer one without, otherwise the newest; a check-in on a removed row
  carries over to the kept one; unrelated rows are untouched;
* the unique index then refuses a second row, and the new column takes a
  request id and is cleared when that request is deleted (SET NULL);
* upgrade, downgrade, upgrade and a re-run of each are harmless; the
  downgrade cannot bring the removed rows back.
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
from app.models.meeting import MeetingAttendee

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261111_1321_7b6db9dd8e4f_meeting_attendee_waiver_request_link_.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_attendee_unique", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_names_match_the_model(self):
        assert MIGRATION.ATTENDEES == MeetingAttendee.__tablename__
        names = {i.name for i in MeetingAttendee.__table__.indexes}
        assert MIGRATION.UQ_MEETING_USER in names
        assert MIGRATION.IX_REQUEST in names
        unique = next(
            i
            for i in MeetingAttendee.__table__.indexes
            if i.name == MIGRATION.UQ_MEETING_USER
        )
        assert unique.unique
        assert [c.name for c in unique.columns] == ["meeting_id", "user_id"]
        column = MeetingAttendee.__table__.c[MIGRATION.COLUMN]
        assert column.nullable
        (fk,) = column.foreign_keys
        assert fk.ondelete == "SET NULL"


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for attr in ("ATTENDEES", "REQUESTS", "FK_NAME"):
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {MIGRATION.REQUESTS} (id VARCHAR(36) PRIMARY KEY) "
            "ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {MIGRATION.ATTENDEES} ("
            "id VARCHAR(36) PRIMARY KEY, organization_id VARCHAR(36) NOT NULL, "
            "meeting_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, "
            "present TINYINT(1), excused TINYINT(1), waiver_reason TEXT, "
            "created_at DATETIME NULL, INDEX ix_meeting (meeting_id)) ENGINE=InnoDB"
        )
        conn.commit()
    try:
        yield SimpleNamespace(engine=engine)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for attr in ("ATTENDEES", "REQUESTS"):
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


def _row(conn, row_id, meeting, user, present, waiver=None, created=None):
    conn.exec_driver_sql(
        f"INSERT INTO {MIGRATION.ATTENDEES} (id, organization_id, meeting_id, "
        "user_id, present, excused, waiver_reason, created_at) "
        "VALUES (%s, 'org', %s, %s, %s, %s, %s, %s)",
        (row_id, meeting, user, present, bool(waiver), waiver, created),
    )


def _rows(engine) -> dict:
    with engine.connect() as conn:
        result = conn.exec_driver_sql(
            f"SELECT id, meeting_id, user_id, present, excused, waiver_reason "
            f"FROM {MIGRATION.ATTENDEES}"
        )
        return {r.id: r for r in result}


def _seed(engine) -> None:
    with engine.connect() as conn:
        # m1/u1: an older row with a waiver and a newer present one.
        _row(conn, "a-old-waived", "m1", "u1", 0, "Out of town", "2026-01-01 10:00")
        _row(conn, "a-new-present", "m1", "u1", 1, None, "2026-02-01 10:00")
        # m1/u2: two plain rows; the newest wins.
        _row(conn, "b-old", "m1", "u2", 1, None, "2026-01-01 10:00")
        _row(conn, "b-new", "m1", "u2", 0, None, "2026-03-01 10:00")
        # m1/u3: three rows, two with waivers; the newer waiver wins.
        _row(conn, "c-1", "m1", "u3", 0, "First", "2026-01-01 10:00")
        _row(conn, "c-2", "m1", "u3", 0, "Second", "2026-01-02 10:00")
        _row(conn, "c-3", "m1", "u3", 0, None, "2026-01-03 10:00")
        # Unrelated: one row each, and the same member on another meeting.
        _row(conn, "d-only", "m2", "u1", 1, None, "2026-01-01 10:00")
        _row(conn, "e-only", "m1", "u4", 0, None, None)
        conn.commit()


@pytest.mark.integration
class TestWithRowsPresent:
    def test_duplicates_are_settled(self, scratch):
        engine = scratch.engine
        _seed(engine)
        _run(engine, MIGRATION.upgrade)
        rows = _rows(engine)
        assert set(rows) == {"a-old-waived", "b-new", "c-2", "d-only", "e-only"}
        # The waiver row is kept and takes the check-in from the removed row.
        assert rows["a-old-waived"].present == 1
        assert rows["a-old-waived"].waiver_reason == "Out of town"
        # The newest plain row is kept; the older one recorded a check-in,
        # which carries over.
        assert rows["b-new"].present == 1
        assert rows["c-2"].waiver_reason == "Second"
        assert rows["d-only"].present == 1

    def test_the_index_and_column_then_hold(self, scratch):
        engine = scratch.engine
        _seed(engine)
        _run(engine, MIGRATION.upgrade)
        with engine.connect() as conn:
            with pytest.raises(sa.exc.IntegrityError):
                _row(conn, "dup", "m1", "u1", 1)
            conn.rollback()
            conn.exec_driver_sql(f"INSERT INTO {MIGRATION.REQUESTS} VALUES ('req')")
            conn.exec_driver_sql(
                f"UPDATE {MIGRATION.ATTENDEES} SET {MIGRATION.COLUMN} = 'req' "
                "WHERE id = 'e-only'"
            )
            conn.exec_driver_sql(f"DELETE FROM {MIGRATION.REQUESTS}")
            conn.commit()
            left = conn.exec_driver_sql(
                f"SELECT {MIGRATION.COLUMN} FROM {MIGRATION.ATTENDEES} "
                "WHERE id = 'e-only'"
            ).scalar_one()
        assert left is None

    def test_upgrade_downgrade_upgrade_and_reruns(self, scratch):
        engine = scratch.engine
        _seed(engine)
        for _ in range(2):
            _run(engine, MIGRATION.upgrade)
        kept = set(_rows(engine))
        for _ in range(2):
            _run(engine, MIGRATION.downgrade)
        with engine.connect() as conn:
            inspector = sa.inspect(conn)
            columns = {c["name"] for c in inspector.get_columns(MIGRATION.ATTENDEES)}
            indexes = {i["name"] for i in inspector.get_indexes(MIGRATION.ATTENDEES)}
        assert MIGRATION.COLUMN not in columns
        assert MIGRATION.UQ_MEETING_USER not in indexes
        # The removed duplicates do not come back.
        assert set(_rows(engine)) == kept
        _run(engine, MIGRATION.upgrade)
        assert set(_rows(engine)) == kept

    def test_a_missing_table_is_skipped(self, scratch, monkeypatch):
        monkeypatch.setattr(MIGRATION, "ATTENDEES", "t_no_such_attendees")
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.downgrade)
