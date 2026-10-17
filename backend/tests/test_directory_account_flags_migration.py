"""Migration d3bb8f81ed07 adds license_pending and managed_on_premises.

Run against a throwaway table in the suite's own database; the real table is
never altered.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "d3bb8f81ed07"
_TABLE = "x_flags_directory_account_provisions"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("directory_flags", matches[0])
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


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.TABLE = _TABLE
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _columns(engine) -> dict:
    return {c["name"]: c for c in sa.inspect(engine).get_columns(_TABLE)}


class TestDirectoryAccountFlagsMigration:
    def test_upgrade_adds_both_flags_false_for_existing_rows(self, scratch_engine):
        with scratch_engine.begin() as conn:
            conn.execute(text(f"CREATE TABLE {_TABLE} (id VARCHAR(36) PRIMARY KEY)"))
            conn.execute(text(f"INSERT INTO {_TABLE} (id) VALUES ('a')"))

        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")  # a re-run changes nothing

        columns = _columns(scratch_engine)
        for name in ("license_pending", "managed_on_premises"):
            assert columns[name]["nullable"] is False
        with scratch_engine.connect() as conn:
            row = conn.execute(
                text(f"SELECT license_pending, managed_on_premises FROM {_TABLE}")
            ).one()
        assert tuple(row) == (0, 0)

    def test_downgrade_drops_them(self, scratch_engine):
        with scratch_engine.begin() as conn:
            conn.execute(text(f"CREATE TABLE {_TABLE} (id VARCHAR(36) PRIMARY KEY)"))
        _run(scratch_engine, "upgrade")

        _run(scratch_engine, "downgrade")

        assert set(_columns(scratch_engine)) == {"id"}

    def test_without_the_table_nothing_happens(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
        assert _TABLE not in sa.inspect(scratch_engine).get_table_names()
