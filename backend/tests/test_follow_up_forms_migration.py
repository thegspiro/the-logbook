"""Migration f34e25e2c820 adds Follow-up Form stages without touching rows.

Run against throwaway tables in the suite's own database; the real tables are
never altered. Rows are inserted first, because what matters is what happens
to stages and fields that already exist: every stage keeps its type, and no
field starts pre-filling. The downgrade is driven with a Follow-up Form stage
present, because that is the case it must refuse rather than blank.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "f34e25e2c820"
_STEPS = "x_follow_up_steps"
_FIELDS = "x_follow_up_fields"
_REQUESTS = "x_follow_up_requests"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("follow_up_forms", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop(conn):
    for table in (_REQUESTS, _FIELDS, _STEPS):
        conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    migration = _load_migration()
    old_types = ", ".join(f"'{v}'" for v in migration._PREVIOUS_STEP_TYPES)
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        _drop(conn)
        conn.execute(
            text(
                f"CREATE TABLE {_STEPS} (id VARCHAR(36) PRIMARY KEY, "
                f"step_type ENUM({old_types}) NOT NULL DEFAULT 'checkbox')"
            )
        )
        conn.execute(text(f"CREATE TABLE {_FIELDS} (id VARCHAR(36) PRIMARY KEY)"))
        conn.execute(
            text(
                f"INSERT INTO {_STEPS} (id, step_type) VALUES "
                "('s1', 'form_submission'), ('s2', 'medical_screening'), "
                "('s3', 'checkbox')"
            )
        )
        conn.execute(text(f"INSERT INTO {_FIELDS} (id) VALUES ('f1'), ('f2')"))
    yield engine
    with engine.begin() as conn:
        _drop(conn)
    engine.dispose()


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.STEPS = _STEPS
    module.FIELDS = _FIELDS
    module.REQUESTS = _REQUESTS
    module._TEMPLATE_COLUMNS = ()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _step_types(engine) -> str:
    """The column's full ENUM(...) definition; the inspector prints only ENUM."""
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t "
                "AND COLUMN_NAME = 'step_type'"
            ),
            {"t": _STEPS},
        ).scalar_one()


class TestFollowUpFormsMigration:
    def test_existing_rows_keep_what_they_held(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")  # a re-run changes nothing

        assert "follow_up_form" in _step_types(scratch_engine)
        with scratch_engine.connect() as conn:
            steps = dict(
                conn.execute(text(f"SELECT id, step_type FROM {_STEPS}")).all()
            )
            fields = dict(
                conn.execute(text(f"SELECT id, applicant_field FROM {_FIELDS}")).all()
            )
        assert steps == {
            "s1": "form_submission",
            "s2": "medical_screening",
            "s3": "checkbox",
        }
        assert fields == {"f1": None, "f2": None}
        assert _REQUESTS in sa.inspect(scratch_engine).get_table_names()

    def test_downgrade_restores_the_old_shape(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")

        assert "'medical_screening'" in _step_types(scratch_engine)
        assert "follow_up_form" not in _step_types(scratch_engine)
        inspector = sa.inspect(scratch_engine)
        assert _REQUESTS not in inspector.get_table_names()
        assert "applicant_field" not in {
            c["name"] for c in inspector.get_columns(_FIELDS)
        }

    def test_downgrade_refuses_while_a_follow_up_stage_exists(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO {_STEPS} (id, step_type) VALUES ('s4', 'follow_up_form')"
                )
            )

        with pytest.raises(RuntimeError, match="1 pipeline stage"):
            _run(scratch_engine, "downgrade")

        assert "follow_up_form" in _step_types(scratch_engine)
