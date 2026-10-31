"""Migration c588f525fdbb: assignments, and view_all for everyone who saw the pipeline.

Run against throwaway tables in the suite's own database; the real tables are
never altered. Positions are inserted first (CLAUDE.md pitfall #35), because
the grant is the step that matters: every position that held view or manage
this morning must still see every applicant after the upgrade, a position
that held neither must gain nothing, and a wildcard must be left alone.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "c588f525fdbb"
_POSITIONS = "x_assign_positions"
_ASSIGNMENTS = "x_assign_assignments"

ROWS = {
    "coordinator": ["prospective_members.manage", "prospective_members.view"],
    "committee": ["prospective_members.view"],
    "manage_only": ["members.view", "prospective_members.manage"],
    "quartermaster": ["inventory.manage"],
    "admin": ["*"],
    "pipeline_wildcard": ["prospective_members.*"],
    "already": ["prospective_members.view", "prospective_members.view_all"],
}


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("prospect_assignments", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_ASSIGNMENTS}"))
        conn.execute(text(f"DROP TABLE IF EXISTS {_POSITIONS}"))
        conn.execute(
            text(
                f"CREATE TABLE {_POSITIONS} (id VARCHAR(36) PRIMARY KEY, "
                "permissions JSON)"
            )
        )
        for slug, perms in ROWS.items():
            conn.execute(
                text(f"INSERT INTO {_POSITIONS} (id, permissions) VALUES (:id, :p)"),
                {"id": slug, "p": json.dumps(perms)},
            )
    yield engine
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_ASSIGNMENTS}"))
        conn.execute(text(f"DROP TABLE IF EXISTS {_POSITIONS}"))
    engine.dispose()


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.POSITIONS = _POSITIONS
    module.ASSIGNMENTS = _ASSIGNMENTS
    module._TEMPLATE_COLUMNS = ()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _permissions(engine) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT id, permissions FROM {_POSITIONS}")).all()
    return {
        row.id: (
            json.loads(row.permissions)
            if isinstance(row.permissions, str)
            else row.permissions
        )
        for row in rows
    }


class TestViewAllGrant:
    def test_everyone_who_saw_the_pipeline_still_does(self, scratch_engine):
        _run(scratch_engine, "upgrade")

        perms = _permissions(scratch_engine)
        for slug in ("coordinator", "committee", "manage_only"):
            assert "prospective_members.view_all" in perms[slug], slug
            # Added, nothing else changed.
            assert perms[slug][:-1] == ROWS[slug], slug

    def test_nobody_else_gains_it(self, scratch_engine):
        _run(scratch_engine, "upgrade")

        perms = _permissions(scratch_engine)
        assert perms["quartermaster"] == ROWS["quartermaster"]
        assert perms["admin"] == ["*"]
        assert perms["pipeline_wildcard"] == ["prospective_members.*"]
        assert perms["already"] == ROWS["already"]

    def test_running_it_twice_adds_it_once(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")

        perms = _permissions(scratch_engine)
        assert perms["coordinator"].count("prospective_members.view_all") == 1

    def test_downgrade_takes_it_away_and_drops_the_table(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")

        perms = _permissions(scratch_engine)
        assert perms["coordinator"] == ROWS["coordinator"]
        assert perms["already"] == ["prospective_members.view"]
        assert _ASSIGNMENTS not in sa.inspect(scratch_engine).get_table_names()

    def test_the_assignments_table_is_created_with_its_unique_index(
        self, scratch_engine
    ):
        _run(scratch_engine, "upgrade")

        indexes = {
            ix["name"]: ix
            for ix in sa.inspect(scratch_engine).get_indexes(_ASSIGNMENTS)
        }
        assert indexes["uq_prospect_assignment"]["unique"]
        assert indexes["uq_prospect_assignment"]["column_names"] == [
            "prospect_id",
            "user_id",
            "role",
        ]


class TestRegistry:
    """The seeded positions and ranks agree with what the migration grants."""

    def test_every_seeded_grant_of_view_or_manage_carries_view_all(self):
        from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS

        for registry in (DEFAULT_POSITIONS, OPERATIONAL_RANKS):
            for slug, entry in registry.items():
                held = set(
                    entry.get("permissions") or entry.get("default_permissions") or []
                )
                if held & {"prospective_members.view", "prospective_members.manage"}:
                    assert "prospective_members.view_all" in held, slug
