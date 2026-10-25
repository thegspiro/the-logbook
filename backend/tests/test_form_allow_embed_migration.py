"""Migration 0a8d11fcada1 adds forms.allow_embed, false for every existing form.

Run against a throwaway table in the suite's own database; the real table is
never altered. The rows are inserted first because the point of the step is
what happens to forms that already exist: none may become embeddable by
upgrading.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "0a8d11fcada1"
_TABLE = "x_allow_embed_forms"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("form_allow_embed", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
        conn.execute(
            text(
                f"CREATE TABLE {_TABLE} "
                "(id VARCHAR(36) PRIMARY KEY, is_public TINYINT(1))"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {_TABLE} (id, is_public) "
                "VALUES ('public', 1), ('private', 0), ('unset', NULL)"
            )
        )
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


class TestAllowEmbedMigration:
    def test_existing_forms_are_not_embeddable(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")  # a re-run changes nothing

        assert _columns(scratch_engine)["allow_embed"]["nullable"] is False
        with scratch_engine.connect() as conn:
            rows = dict(
                conn.execute(text(f"SELECT id, allow_embed FROM {_TABLE}")).all()
            )
        assert rows == {"public": 0, "private": 0, "unset": 0}

    def test_a_new_row_defaults_to_not_embeddable(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(text(f"INSERT INTO {_TABLE} (id) VALUES ('new')"))
            value = conn.execute(
                text(f"SELECT allow_embed FROM {_TABLE} WHERE id = 'new'")
            ).scalar_one()
        assert value == 0

    def test_downgrade_drops_it(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
        _run(scratch_engine, "downgrade")  # and is safe to repeat

        assert "allow_embed" not in _columns(scratch_engine)
        with scratch_engine.connect() as conn:
            count = conn.execute(text(f"SELECT COUNT(*) FROM {_TABLE}")).scalar_one()
        assert count == 3
