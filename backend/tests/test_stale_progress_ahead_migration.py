"""Migration 99b16109d44c: stale in-progress rows ahead of the current stage.

Run against a real (SQLite) connection. Only an ``in_progress`` row on a stage
that sorts after the applicant's current stage, in the same pipeline, is reset
to ``pending``; the current stage, the stages behind it and other pipelines
are left alone.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_99b16109d44c_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _run(engine):
    spec = importlib.util.spec_from_file_location("stale_progress", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    with database.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE membership_pipeline_steps"
                " (id TEXT PRIMARY KEY, pipeline_id TEXT, sort_order INTEGER)"
            )
        )
        connection.execute(
            sa.text(
                "CREATE TABLE prospective_members"
                " (id TEXT PRIMARY KEY, current_step_id TEXT)"
            )
        )
        connection.execute(
            sa.text(
                "CREATE TABLE prospect_step_progress (id TEXT PRIMARY KEY,"
                " prospect_id TEXT, step_id TEXT, status TEXT,"
                " completed_at TEXT, completed_by TEXT)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO membership_pipeline_steps VALUES"
                " ('s1', 'p1', 1), ('s2', 'p1', 2), ('s3', 'p1', 3),"
                " ('s4', 'p1', 4), ('other', 'p2', 9)"
            )
        )
        # Pat is on stage 2; Lee has no current stage.
        connection.execute(
            sa.text(
                "INSERT INTO prospective_members VALUES ('pat', 's2'), ('lee', NULL)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO prospect_step_progress VALUES"
                " ('behind', 'pat', 's1', 'completed', '2026-01-01', 'u1'),"
                " ('current', 'pat', 's2', 'in_progress', NULL, NULL),"
                " ('stale', 'pat', 's3', 'in_progress', NULL, NULL),"
                " ('ahead-done', 'pat', 's4', 'completed', '2026-01-02', 'u1'),"
                " ('foreign', 'pat', 'other', 'in_progress', NULL, NULL),"
                " ('no-current', 'lee', 's3', 'in_progress', NULL, NULL)"
            )
        )
    yield database
    database.dispose()


def _statuses(engine):
    with engine.connect() as connection:
        rows = connection.execute(
            sa.text("SELECT id, status, completed_at FROM prospect_step_progress")
        )
        return {row[0]: (row[1], row[2]) for row in rows}


def test_only_an_in_progress_row_ahead_of_the_current_stage_is_reset(engine):
    _run(engine)
    assert _statuses(engine) == {
        "behind": ("completed", "2026-01-01"),
        "current": ("in_progress", None),
        "stale": ("pending", None),
        "ahead-done": ("completed", "2026-01-02"),
        "foreign": ("in_progress", None),
        "no-current": ("in_progress", None),
    }


def test_a_second_run_changes_nothing(engine):
    _run(engine)
    before = _statuses(engine)
    _run(engine)
    assert _statuses(engine) == before


def test_a_database_without_the_tables_is_skipped():
    _run(sa.create_engine("sqlite://"))
