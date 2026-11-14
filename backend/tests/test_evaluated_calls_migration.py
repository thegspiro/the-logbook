"""``9d044fc1d81b`` widens ``training_requirements.requirement_type`` with
``evaluated_calls``.

Run for real against MySQL/MariaDB on a uniquely prefixed scratch table (DDL
cannot ride in a rolled-back transaction). The table is seeded with rows
before upgrading, because CI's empty database cannot show what an existing
department's requirements do (CLAUDE.md pitfall #35). Pinned:

* existing requirements keep their type, and the column keeps its
  nullability and default;
* the new type can be stored afterwards, and a second upgrade changes nothing;
* the downgrade turns requirements of the new type into ``checklist``, leaves
  every other row alone and narrows the ENUM again;
* every step is skipped when the table is not there (pitfall #26).
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import DBAPIError

from app.core.config import settings
from app.models.training import RequirementType, TrainingRequirement

_PATH = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_9d044fc1d81b_*.py"
    )
)


def _migration():
    spec = importlib.util.spec_from_file_location("_evaluated_calls", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
class TestTheShapeIsTheModel:
    def test_the_table_is_the_models(self):
        assert MIGRATION.REQUIREMENTS == TrainingRequirement.__tablename__

    def test_the_widened_enum_is_the_models(self):
        # Equality while this is the newest revision to widen the column; a
        # later one that widens it again should loosen this to a subset, as
        # test_attendance_waiver_email_migration.py does.
        assert set(MIGRATION._OLD_TYPES) | {MIGRATION._NEW_TYPE} == {
            t.value for t in RequirementType
        }
        assert MIGRATION._NEW_TYPE not in MIGRATION._OLD_TYPES


@pytest.fixture
def engine(monkeypatch):
    table = f"t{uuid.uuid4().hex[:6]}_{MIGRATION.REQUIREMENTS}"
    monkeypatch.setattr(MIGRATION, "REQUIREMENTS", table)
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield engine
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{table}`")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _build(engine) -> None:
    """The column as the previous revision leaves it, with rows in it."""
    old = "ENUM(" + ", ".join(f"'{v}'" for v in MIGRATION._OLD_TYPES) + ")"
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {MIGRATION.REQUIREMENTS} (id VARCHAR(36) PRIMARY KEY, "
            f"requirement_type {old} NOT NULL DEFAULT 'hours') ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.REQUIREMENTS} VALUES "
            "('r-calls', 'calls'), ('r-transports', 'transports'), "
            "('r-attendance', 'session_attendance')"
        )
        conn.commit()


def _types(engine) -> dict:
    with engine.connect() as conn:
        return dict(
            conn.exec_driver_sql(
                f"SELECT id, requirement_type FROM {MIGRATION.REQUIREMENTS}"
            ).all()
        )


def _column(engine):
    with engine.connect() as conn:
        return conn.exec_driver_sql(
            "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT "
            "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
            f"AND TABLE_NAME = '{MIGRATION.REQUIREMENTS}' "
            "AND COLUMN_NAME = 'requirement_type'"
        ).first()


def _insert(engine, row_id: str, requirement_type: str) -> None:
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.REQUIREMENTS} VALUES (%s, %s)",
            (row_id, requirement_type),
        )
        conn.commit()


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_up_keeps_every_row_and_stores_the_new_type(self, engine):
        _build(engine)
        before = _types(engine)
        _, nullable, default = _column(engine)

        _run(engine, MIGRATION.upgrade)
        _insert(engine, "r-evaluated", "evaluated_calls")

        assert _types(engine) == {**before, "r-evaluated": "evaluated_calls"}
        column_type, after_nullable, after_default = _column(engine)
        assert "'evaluated_calls'" in column_type
        assert (after_nullable, after_default) == (nullable, default)

        _run(engine, MIGRATION.upgrade)

        assert _column(engine)[0] == column_type

    def test_down_turns_the_new_type_into_a_checklist(self, engine):
        _build(engine)
        _run(engine, MIGRATION.upgrade)
        _insert(engine, "r-evaluated", "evaluated_calls")

        _run(engine, MIGRATION.downgrade)

        assert _types(engine) == {
            "r-calls": "calls",
            "r-transports": "transports",
            "r-attendance": "session_attendance",
            "r-evaluated": "checklist",
        }
        assert "'evaluated_calls'" not in _column(engine)[0]
        with pytest.raises(DBAPIError):
            _insert(engine, "r-again", "evaluated_calls")

        _run(engine, MIGRATION.upgrade)

        assert "'evaluated_calls'" in _column(engine)[0]

    def test_a_missing_table_is_skipped(self, engine):
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)

        assert _column(engine) is None
