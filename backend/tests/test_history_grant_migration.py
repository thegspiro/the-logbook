"""Migration 02c94bb742d6: the history permissions reach the seeded Historian.

Run against a real (SQLite) connection. What matters is which rows it leaves
alone — a position the department created, and a seeded position that is not
the Historian — and that running it twice adds nothing twice.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.core.permissions import DEFAULT_POSITIONS

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_02c94bb742d6_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _migration():
    spec = importlib.util.spec_from_file_location("history_grants", MATCHES[0])
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
        "positions",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("slug", sa.String),
        sa.Column("is_system", sa.Boolean),
        sa.Column("permissions", sa.Text),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _position(engine, position_id, slug, permissions, *, is_system=True):
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO positions (id, slug, is_system, permissions) "
                "VALUES (:id, :slug, :is_system, :permissions)"
            ),
            {
                "id": position_id,
                "slug": slug,
                "is_system": is_system,
                "permissions": json.dumps(permissions),
            },
        )


def _permissions(engine, position_id):
    with engine.connect() as connection:
        raw = connection.execute(
            sa.text("SELECT permissions FROM positions WHERE id = :id"),
            {"id": position_id},
        ).scalar_one()
    return json.loads(raw)


def test_the_frozen_grants_are_what_the_registry_gives_the_historian():
    granted = set(DEFAULT_POSITIONS["historian"]["permissions"])
    assert set(_migration()._PERMISSIONS) <= granted


def test_adds_the_grants_to_the_seeded_historian_once(engine):
    _position(engine, "seeded", "historian", ["documents.view"])

    _run(engine)
    _run(engine)

    assert _permissions(engine, "seeded") == [
        "documents.view",
        "history.view",
        "history.manage",
        "history.publish",
    ]


def test_keeps_a_grant_already_present_and_adds_the_rest(engine):
    _position(engine, "partial", "historian", ["history.view"])

    _run(engine)

    assert _permissions(engine, "partial") == [
        "history.view",
        "history.manage",
        "history.publish",
    ]


def test_leaves_department_created_and_other_seeded_positions_alone(engine):
    _position(engine, "custom", "historian", ["documents.view"], is_system=False)
    _position(engine, "captain", "captain", ["documents.view"])

    _run(engine)

    assert _permissions(engine, "custom") == ["documents.view"]
    assert _permissions(engine, "captain") == ["documents.view"]


def test_downgrade_takes_back_only_the_history_grants(engine):
    _position(engine, "seeded", "historian", ["documents.view"])

    _run(engine)
    _run(engine, "downgrade")

    assert _permissions(engine, "seeded") == ["documents.view"]
