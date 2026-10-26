"""Migration ce541de8d3da adds the sensitive-field columns without touching rows.

Run against throwaway tables in the suite's own database; the real tables are
never altered. Rows are inserted first, because what matters is what happens
to fields and submissions that already exist: none becomes sensitive, and no
answer moves. The downgrade is driven with a sealed answer present, because
that is the case it must refuse rather than destroy.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "ce541de8d3da"
_FIELDS = "x_sensitive_form_fields"
_SUBMISSIONS = "x_sensitive_form_submissions"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("form_sensitive_fields", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        for table in (_FIELDS, _SUBMISSIONS):
            conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
        conn.execute(text(f"CREATE TABLE {_FIELDS} (id VARCHAR(36) PRIMARY KEY)"))
        conn.execute(
            text(
                f"CREATE TABLE {_SUBMISSIONS} "
                "(id VARCHAR(36) PRIMARY KEY, data JSON NOT NULL)"
            )
        )
        conn.execute(text(f"INSERT INTO {_FIELDS} (id) VALUES ('f1'), ('f2')"))
        conn.execute(
            text(
                f"INSERT INTO {_SUBMISSIONS} (id, data) "
                """VALUES ('s1', '{"f1": "answer"}')"""
            )
        )
    yield engine
    with engine.begin() as conn:
        for table in (_FIELDS, _SUBMISSIONS):
            conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
    engine.dispose()


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.FIELDS = _FIELDS
    module.SUBMISSIONS = _SUBMISSIONS
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _columns(engine, table: str) -> dict:
    return {c["name"]: c for c in sa.inspect(engine).get_columns(table)}


class TestSensitiveFieldsMigration:
    def test_existing_rows_are_unchanged(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")  # a re-run changes nothing

        assert _columns(scratch_engine, _FIELDS)["is_sensitive"]["nullable"] is False
        assert _columns(scratch_engine, _SUBMISSIONS)["sensitive_data"]["nullable"]
        with scratch_engine.connect() as conn:
            flags = dict(
                conn.execute(text(f"SELECT id, is_sensitive FROM {_FIELDS}")).all()
            )
            row = conn.execute(
                text(f"SELECT CAST(data AS CHAR), sensitive_data FROM {_SUBMISSIONS}")
            ).one()
        assert flags == {"f1": 0, "f2": 0}
        assert "answer" in row[0]
        assert row[1] is None

    def test_downgrade_drops_both_while_nothing_is_sealed(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
        _run(scratch_engine, "downgrade")  # and is safe to repeat

        assert "is_sensitive" not in _columns(scratch_engine, _FIELDS)
        assert "sensitive_data" not in _columns(scratch_engine, _SUBMISSIONS)

    def test_downgrade_refuses_while_a_sealed_answer_exists(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(
                text(f"UPDATE {_SUBMISSIONS} SET sensitive_data = 'ciphertext'")
            )

        with pytest.raises(RuntimeError, match="1 form submission"):
            _run(scratch_engine, "downgrade")

        assert "sensitive_data" in _columns(scratch_engine, _SUBMISSIONS)
        assert "is_sensitive" in _columns(scratch_engine, _FIELDS)
