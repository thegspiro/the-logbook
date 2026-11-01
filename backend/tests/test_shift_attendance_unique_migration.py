"""Migration 1740b4886e52: one shift_attendance row per member per shift.

Run against a real (SQLite) connection with duplicate rows present, because a
unique key that holds on an empty table proves nothing (CLAUDE.md Pitfall #35).
SQLite cannot add a constraint by ALTER, so the constraint step is recorded
rather than executed; what is checked is that the duplicates are settled before
it runs, and how they are merged.
"""

import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.models.training import ShiftAttendance

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_1740b4886e52_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _migration():
    spec = importlib.util.spec_from_file_location("attendance_unique", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    with database.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE shift_attendance (id TEXT PRIMARY KEY, shift_id TEXT, "
                "user_id TEXT, checked_in_at TEXT, checked_out_at TEXT, "
                "duration_minutes INTEGER, call_count INTEGER, created_at TEXT)"
            )
        )
    try:
        yield database
    finally:
        database.dispose()


def _row(engine, row_id, shift, user, created, ci, co, minutes, calls):
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO shift_attendance VALUES "
                "(:id, :s, :u, :ci, :co, :m, :c, :created)"
            ),
            {
                "id": row_id,
                "s": shift,
                "u": user,
                "ci": ci,
                "co": co,
                "m": minutes,
                "c": calls,
                "created": created,
            },
        )


def _rows(engine):
    with engine.begin() as connection:
        return connection.execute(
            sa.text(
                "SELECT id, shift_id, user_id, checked_in_at, checked_out_at, "
                "duration_minutes, call_count FROM shift_attendance ORDER BY id"
            )
        ).fetchall()


def _upgrade(engine):
    seen = []
    module = _migration()

    def record(name, table, columns):
        seen.append((name, table, columns, len(_rows_in(connection))))

    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            with patch.object(module.op, "create_unique_constraint", record):
                module.upgrade()
    return seen


def _rows_in(connection):
    return connection.execute(sa.text("SELECT id FROM shift_attendance")).fetchall()


class TestShiftAttendanceUniqueMigration:
    def test_duplicates_merge_into_the_earliest_row_before_the_key(self, engine):
        _row(
            engine,
            "a",
            "s1",
            "u1",
            "2026-01-01 08:00",
            "2026-01-01 08:05",
            None,
            60,
            None,
        )
        _row(
            engine,
            "b",
            "s1",
            "u1",
            "2026-01-01 09:00",
            "2026-01-01 07:55",
            "2026-01-01 20:00",
            600,
            3,
        )
        _row(
            engine,
            "c",
            "s1",
            "u2",
            "2026-01-01 08:00",
            "2026-01-01 08:00",
            "2026-01-01 20:00",
            720,
            2,
        )

        seen = _upgrade(engine)

        assert seen == [
            (
                "uq_shift_attendance_shift_user",
                "shift_attendance",
                ["shift_id", "user_id"],
                2,
            )
        ]
        assert _rows(engine) == [
            ("a", "s1", "u1", "2026-01-01 07:55", "2026-01-01 20:00", 600, 3),
            ("c", "s1", "u2", "2026-01-01 08:00", "2026-01-01 20:00", 720, 2),
        ]

    def test_a_second_run_changes_nothing(self, engine):
        _row(engine, "a", "s1", "u1", "2026-01-01 08:00", None, None, 30, None)
        _row(engine, "b", "s1", "u1", "2026-01-01 09:00", None, None, 45, None)
        _upgrade(engine)
        first = _rows(engine)

        _upgrade(engine)

        assert _rows(engine) == first == [("a", "s1", "u1", None, None, 45, None)]


def test_the_model_declares_the_key():
    keys = {
        tuple(c.name for c in con.columns)
        for con in ShiftAttendance.__table__.constraints
        if isinstance(con, sa.UniqueConstraint)
    }
    assert ("shift_id", "user_id") in keys
