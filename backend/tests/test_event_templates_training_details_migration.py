"""Migration 56377b666eb3 adds event_templates.training_details.

Run against a throwaway copy of the table in the suite's own database; the
real table is never altered.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "56377b666eb3"
_TABLE = "x_training_details_event_templates"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("template_training", matches[0])
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
    assert module.TABLE == "event_templates"
    assert module.COLUMN == "training_details"
    module.TABLE = _TABLE
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _create_with_rows(engine):
    # The columns the existing rows are read back by, in the real table's
    # types: two templates, one Training and one not.
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_TABLE} ("
                " id VARCHAR(36) PRIMARY KEY,"
                " name VARCHAR(200) NOT NULL,"
                " event_type VARCHAR(40) NOT NULL,"
                " custom_fields_template JSON NULL)"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {_TABLE} (id, name, event_type, custom_fields_template)"
                " VALUES ('t', 'Drill', 'training', '{\"a\": 1}'),"
                " ('m', 'Meeting', 'business_meeting', NULL)"
            )
        )


def _rows(engine, columns: str):
    with engine.connect() as conn:
        return [
            tuple(r)
            for r in conn.execute(text(f"SELECT {columns} FROM {_TABLE} ORDER BY id"))
        ]


def _columns(engine) -> dict:
    return {c["name"]: c for c in sa.inspect(engine).get_columns(_TABLE)}


class TestEventTemplatesTrainingDetailsMigration:
    def test_upgrade_adds_a_nullable_column_null_on_every_row(self, scratch_engine):
        _create_with_rows(scratch_engine)
        before = _rows(scratch_engine, "id, name, event_type, custom_fields_template")

        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")  # a re-run changes nothing

        column = _columns(scratch_engine)["training_details"]
        assert column["nullable"] is True
        assert _rows(scratch_engine, "training_details") == [(None,), (None,)]
        after = _rows(scratch_engine, "id, name, event_type, custom_fields_template")
        assert after == before

    def test_downgrade_drops_it_and_keeps_the_rows(self, scratch_engine):
        _create_with_rows(scratch_engine)
        before = _rows(scratch_engine, "id, name, event_type, custom_fields_template")
        _run(scratch_engine, "upgrade")

        _run(scratch_engine, "downgrade")
        assert "training_details" not in _columns(scratch_engine)
        assert (
            _rows(scratch_engine, "id, name, event_type, custom_fields_template")
            == before
        )

        _run(scratch_engine, "upgrade")
        assert "training_details" in _columns(scratch_engine)

    def test_without_the_table_nothing_happens(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
        assert _TABLE not in sa.inspect(scratch_engine).get_table_names()
