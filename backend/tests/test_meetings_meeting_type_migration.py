"""Migration 2cfc5a75105e widens meetings.meeting_type (W51-4).

CI's database user may not CREATE DATABASE, so the migration runs against a
throwaway copy of ``meetings`` under a prefix in the suite's own database: the
suite's real table is never altered.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "2cfc5a75105e"
_PREFIX = "mtgtypemig_"
_TABLE = _PREFIX + "meetings"
_OLD = "'business','special','committee','board','other'"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("widen_meeting_type", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
    yield engine
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
    engine.dispose()


def _make_table(engine, rows):
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_TABLE} (id VARCHAR(36) PRIMARY KEY, "
                f"meeting_type ENUM({_OLD}) NOT NULL DEFAULT 'business')"
            )
        )
        for row_id, value in rows:
            conn.execute(
                text(f"INSERT INTO {_TABLE} VALUES (:id, :v)"),
                {"id": row_id, "v": value},
            )


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module._TABLES = (_TABLE,)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _column(engine):
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT COLUMN_TYPE, COLUMN_DEFAULT, IS_NULLABLE "
                "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = :t AND COLUMN_NAME = 'meeting_type'"
            ),
            {"t": _TABLE},
        ).one()


def _values(engine):
    with engine.connect() as conn:
        return dict(conn.execute(text(f"SELECT id, meeting_type FROM {_TABLE}")).all())


class TestWidenMeetingType:
    def test_upgrade_accepts_the_three_new_types_and_keeps_rows(self, scratch_engine):
        _make_table(scratch_engine, [("a", "board"), ("b", "other")])

        _run(scratch_engine, "upgrade")

        column_type, default, nullable = _column(scratch_engine)
        for value in ("trustee", "executive", "annual", "business", "other"):
            assert f"'{value}'" in column_type
        assert default.strip("'") == "business"
        assert nullable == "NO"
        with scratch_engine.begin() as conn:
            conn.execute(text(f"INSERT INTO {_TABLE} VALUES ('c', 'executive')"))
        assert _values(scratch_engine) == {"a": "board", "b": "other", "c": "executive"}

    def test_a_second_upgrade_changes_nothing(self, scratch_engine):
        _make_table(scratch_engine, [("a", "special")])
        _run(scratch_engine, "upgrade")
        first = _column(scratch_engine)

        _run(scratch_engine, "upgrade")

        assert _column(scratch_engine) == first
        assert _values(scratch_engine) == {"a": "special"}

    def test_downgrade_folds_new_types_into_other_and_narrows(self, scratch_engine):
        _make_table(scratch_engine, [("a", "business")])
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(text(f"INSERT INTO {_TABLE} VALUES ('b', 'executive')"))
            conn.execute(text(f"INSERT INTO {_TABLE} VALUES ('c', 'annual')"))

        _run(scratch_engine, "downgrade")

        column_type, default, _ = _column(scratch_engine)
        assert "'executive'" not in column_type
        assert default.strip("'") == "business"
        assert _values(scratch_engine) == {"a": "business", "b": "other", "c": "other"}

    def test_a_database_without_the_table_is_skipped(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
