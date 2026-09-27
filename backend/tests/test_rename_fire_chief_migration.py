"""Migration d4e1a7c93b58: the seeded "Fire Chief" becomes "Chief".

Run against a real (SQLite) connection. What matters is which rows it leaves
alone: a title a department chose, a position a department created, and an
EMS-only department that was already seeded "Chief".
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_d4e1a7c93b58_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

FIRE = "org-fire"
EMS = "org-ems"


def _migration():
    spec = importlib.util.spec_from_file_location("rename_fire_chief", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "organizations",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_type", sa.String),
    )
    sa.Table(
        "positions",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("name", sa.String),
        sa.Column("slug", sa.String),
        sa.Column("is_system", sa.Boolean),
    )
    sa.Table(
        "operational_ranks",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("rank_code", sa.String),
        sa.Column("display_name", sa.String),
    )
    metadata.create_all(database)
    with database.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO organizations VALUES (:a, 'fire_department')"),
            {"a": FIRE},
        )
        connection.execute(
            sa.text("INSERT INTO organizations VALUES (:a, 'ems_only')"), {"a": EMS}
        )
    try:
        yield database
    finally:
        database.dispose()


def _position(engine, pid, org, name, slug="fire_chief", is_system=True):
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO positions VALUES (:id, :org, :name, :slug, :sys)"),
            {"id": pid, "org": org, "name": name, "slug": slug, "sys": is_system},
        )


def _rank(engine, rid, org, name, code="fire_chief"):
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO operational_ranks VALUES (:id, :org, :code, :name)"),
            {"id": rid, "org": org, "code": code, "name": name},
        )


def _position_name(engine, pid):
    with engine.connect() as connection:
        return connection.execute(
            sa.text("SELECT name FROM positions WHERE id = :id"), {"id": pid}
        ).scalar_one()


def _rank_name(engine, rid):
    with engine.connect() as connection:
        return connection.execute(
            sa.text("SELECT display_name FROM operational_ranks WHERE id = :id"),
            {"id": rid},
        ).scalar_one()


class TestUpgrade:
    def test_the_seeded_position_and_rank_are_renamed(self, engine):
        _position(engine, "p1", FIRE, "Fire Chief")
        _rank(engine, "r1", FIRE, "Fire Chief")
        _run(engine)
        assert _position_name(engine, "p1") == "Chief"
        assert _rank_name(engine, "r1") == "Chief"

    def test_a_title_the_department_chose_is_kept(self, engine):
        _position(engine, "p1", FIRE, "Chief of Department")
        _rank(engine, "r1", FIRE, "Chief of Department")
        _run(engine)
        assert _position_name(engine, "p1") == "Chief of Department"
        assert _rank_name(engine, "r1") == "Chief of Department"

    def test_a_department_created_position_is_not_touched(self, engine):
        _position(engine, "p1", FIRE, "Fire Chief", is_system=False)
        _run(engine)
        assert _position_name(engine, "p1") == "Fire Chief"

    def test_other_codes_are_not_touched(self, engine):
        _position(engine, "p1", FIRE, "Fire Chief", slug="fire_chief_ems")
        _rank(engine, "r1", FIRE, "Fire Chief", code="discipline_chief")
        _run(engine)
        assert _position_name(engine, "p1") == "Fire Chief"
        assert _rank_name(engine, "r1") == "Fire Chief"

    def test_a_second_run_changes_nothing(self, engine):
        _position(engine, "p1", FIRE, "Fire Chief")
        _run(engine)
        _run(engine)
        assert _position_name(engine, "p1") == "Chief"

    def test_a_missing_table_is_skipped(self):
        # operational_ranks may be one only create_all builds (pitfall #26).
        database = sa.create_engine("sqlite://")
        try:
            _run(database)
            _run(database, "downgrade")
        finally:
            database.dispose()


class TestDowngrade:
    def test_a_fire_department_gets_its_old_wording_back(self, engine):
        _position(engine, "p1", FIRE, "Fire Chief")
        _rank(engine, "r1", FIRE, "Fire Chief")
        _run(engine)
        _run(engine, "downgrade")
        assert _position_name(engine, "p1") == "Fire Chief"
        assert _rank_name(engine, "r1") == "Fire Chief"

    def test_an_ems_service_keeps_the_chief_it_was_seeded(self, engine):
        _position(engine, "p1", EMS, "Chief")
        _rank(engine, "r1", EMS, "Chief")
        _run(engine, "downgrade")
        assert _position_name(engine, "p1") == "Chief"
        assert _rank_name(engine, "r1") == "Chief"
