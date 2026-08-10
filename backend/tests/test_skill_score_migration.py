"""The score_pass_fail_criteria migration against a database without the table.

``skill_templates`` is a model-only table on some deployments: create_all()
materializes it with every column already present, so a from-scratch Alembic run
reaches this migration with no such table to alter. An unguarded ``add_column``
therefore fails the whole chain with "Table 'intranet_db.skill_templates'
doesn't exist" — which is exactly what the DB-backed CI jobs hit, and which the
chain-structure tests cannot see because they only read the files.

Driven through a real Alembic operations context so the migration's own code
runs, rather than asserting anything about how it is written. SQLite is enough:
the guard is a schema inspection, not dialect-specific DDL.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

# Located by suffix rather than by full name: the date prefix is renumbered
# whenever main lands a migration that claims this one's revision id or parent,
# which has already happened twice. Pinning the whole filename means the next
# renumber silently breaks this test instead of the collision it guards.
_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_add_score_pass_fail_criteria.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"
MIGRATION = _MATCHES[0]


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "score_pass_fail_migration", MIGRATION
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _skill_templates(metadata: sa.MetaData) -> sa.Table:
    """The subset of the real table the migration touches."""
    return sa.Table(
        "skill_templates",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255)),
    )


@pytest.fixture
def engine():
    return sa.create_engine("sqlite://")


def _run(engine, direction: str):
    module = _load_migration()
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(module, direction)()
        conn.commit()


def _columns(engine, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(engine).get_columns(table)}


class TestUpgrade:
    def test_is_a_no_op_when_the_table_does_not_exist(self, engine):
        """The CI failure: a from-scratch chain run has no skill_templates."""
        _run(engine, "upgrade")

        assert not sa.inspect(engine).has_table("skill_templates")

    def test_adds_the_column_when_the_table_exists(self, engine):
        metadata = sa.MetaData()
        _skill_templates(metadata).create(engine)

        _run(engine, "upgrade")

        assert "score_pass_fail_criteria" in _columns(engine, "skill_templates")

    def test_is_idempotent_when_create_all_already_made_the_column(self, engine):
        metadata = sa.MetaData()
        table = _skill_templates(metadata)
        table.append_column(
            sa.Column(
                "score_pass_fail_criteria",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        table.create(engine)

        _run(engine, "upgrade")

        assert "score_pass_fail_criteria" in _columns(engine, "skill_templates")


class TestDowngrade:
    def test_is_a_no_op_when_the_table_does_not_exist(self, engine):
        _run(engine, "downgrade")

        assert not sa.inspect(engine).has_table("skill_templates")

    def test_is_a_no_op_when_the_column_was_never_added(self, engine):
        metadata = sa.MetaData()
        _skill_templates(metadata).create(engine)

        _run(engine, "downgrade")

        assert "score_pass_fail_criteria" not in _columns(engine, "skill_templates")

    def test_removes_the_column_it_added(self, engine):
        metadata = sa.MetaData()
        _skill_templates(metadata).create(engine)
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert "score_pass_fail_criteria" not in _columns(engine, "skill_templates")
