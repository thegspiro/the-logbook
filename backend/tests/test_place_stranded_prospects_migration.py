"""Migration e1a5bfe7a2ed: place applicants stranded with no pipeline (W23-1).

Run against a real (SQLite) connection with minimal copies of the five
tables. An open applicant with no pipeline is placed on the department's
default pipeline, else its first active non-template one, at the first stage
with a progress row per stage; closed applications, departments with no
usable pipeline and already-placed applicants are left alone; the downgrade
takes back exactly what was placed.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_e1a5bfe7a2ed_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _migration():
    spec = importlib.util.spec_from_file_location("stranded_prospects", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(), direction)()


def _engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "membership_pipelines",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("is_default", sa.Boolean),
        sa.Column("is_active", sa.Boolean),
        sa.Column("is_template", sa.Boolean),
        sa.Column("created_at", sa.DateTime),
    )
    sa.Table(
        "membership_pipeline_steps",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("pipeline_id", sa.String),
        sa.Column("sort_order", sa.Integer),
    )
    sa.Table(
        "prospective_members",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("pipeline_id", sa.String),
        sa.Column("current_step_id", sa.String),
        sa.Column("status", sa.String),
    )
    sa.Table(
        "prospect_step_progress",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("prospect_id", sa.String),
        sa.Column("step_id", sa.String),
        sa.Column("status", sa.String),
        sa.Column("completed_at", sa.DateTime),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )
    sa.Table(
        "prospect_activity_log",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("prospect_id", sa.String),
        sa.Column("action", sa.String),
        sa.Column("details", sa.Text),
        sa.Column("created_at", sa.DateTime),
    )
    metadata.create_all(database)
    return database


def _exec(engine, sql):
    with engine.begin() as connection:
        connection.execute(sa.text(sql))


def _all(engine, sql):
    with engine.connect() as connection:
        return connection.execute(sa.text(sql)).all()


def _seed(engine):
    # org-a: two active pipelines, none default -> the older one wins.
    # org-b: a default pipeline and an older active one -> the default wins.
    # org-c: only a template and an inactive pipeline -> nothing to place on.
    _exec(
        engine,
        "INSERT INTO membership_pipelines VALUES"
        " ('pa-old', 'org-a', 0, 1, 0, '2026-01-01'),"
        " ('pa-new', 'org-a', 0, 1, 0, '2026-02-01'),"
        " ('pa-tpl', 'org-a', 0, 1, 1, '2025-01-01'),"
        " ('pb-old', 'org-b', 0, 1, 0, '2025-01-01'),"
        " ('pb-def', 'org-b', 1, 1, 0, '2026-01-01'),"
        " ('pc-tpl', 'org-c', 0, 1, 1, '2026-01-01'),"
        " ('pc-off', 'org-c', 0, 0, 0, '2026-01-01')",
    )
    _exec(
        engine,
        "INSERT INTO membership_pipeline_steps VALUES"
        " ('a2', 'pa-old', 2), ('a1', 'pa-old', 1), ('a3', 'pa-old', 3),"
        " ('b1', 'pb-def', 1)",
    )
    _exec(
        engine,
        "INSERT INTO prospective_members VALUES"
        " ('guest-a', 'org-a', NULL, NULL, 'active'),"
        " ('held-a', 'org-a', NULL, NULL, 'on_hold'),"
        " ('closed-a', 'org-a', NULL, NULL, 'withdrawn'),"
        " ('placed-a', 'org-a', 'pa-new', NULL, 'active'),"
        " ('guest-b', 'org-b', NULL, NULL, 'active'),"
        " ('guest-c', 'org-c', NULL, NULL, 'active')",
    )


def _prospects(engine):
    return {
        row[0]: (row[1], row[2])
        for row in _all(
            engine, "SELECT id, pipeline_id, current_step_id FROM prospective_members"
        )
    }


def test_open_applicants_are_placed_on_the_department_s_pipeline():
    engine = _engine()
    _seed(engine)

    _run(engine)

    placed = _prospects(engine)
    assert placed["guest-a"] == ("pa-old", "a1")
    assert placed["held-a"] == ("pa-old", "a1")
    assert placed["guest-b"] == ("pb-def", "b1")
    assert placed["closed-a"] == (None, None)
    assert placed["guest-c"] == (None, None)
    assert placed["placed-a"] == ("pa-new", None)

    progress = sorted(
        _all(
            engine,
            "SELECT step_id, status FROM prospect_step_progress"
            " WHERE prospect_id = 'guest-a'",
        )
    )
    assert progress == [("a1", "in_progress"), ("a2", "pending"), ("a3", "pending")]
    logged = _all(
        engine,
        "SELECT prospect_id FROM prospect_activity_log"
        " WHERE action = 'pipeline_assigned_by_backfill' ORDER BY prospect_id",
    )
    assert [row[0] for row in logged] == ["guest-a", "guest-b", "held-a"]


def test_it_is_idempotent():
    engine = _engine()
    _seed(engine)

    _run(engine)
    _run(engine)

    assert len(_all(engine, "SELECT id FROM prospect_step_progress")) == 7
    assert len(_all(engine, "SELECT id FROM prospect_activity_log")) == 3


def test_downgrade_takes_back_exactly_what_was_placed():
    engine = _engine()
    _seed(engine)
    _run(engine)
    # A coordinator has since moved guest-b elsewhere; that stays.
    _exec(
        engine,
        "UPDATE prospective_members SET pipeline_id = 'pb-old' WHERE id = 'guest-b'",
    )

    _run(engine, "downgrade")

    after = _prospects(engine)
    assert after["guest-a"] == (None, None)
    assert after["held-a"] == (None, None)
    assert after["guest-b"][0] == "pb-old"
    assert after["placed-a"] == ("pa-new", None)
    remaining = _all(engine, "SELECT prospect_id FROM prospect_step_progress")
    assert [row[0] for row in remaining] == ["guest-b"]
    assert _all(engine, "SELECT id FROM prospect_activity_log") == []


def test_a_database_without_the_tables_is_skipped():
    engine = sa.create_engine("sqlite://")
    _run(engine)
    _run(engine, "downgrade")
