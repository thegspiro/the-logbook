"""Contract tests for the equipment_check.* -> inventory.check_* rename.

CLAUDE.md pitfall #23 says to verify a permission migration by running it
against a real table rather than by reading it, which is what these do.

The rename differs from a grant *removal* in one way that matters and is easy
to get backwards: a removal scopes to ``is_system = 1`` because a department's
customized position is theirs, whereas a rename must rewrite custom rows too —
the old string stops resolving, so leaving it revokes a grant the department
deliberately gave. ``test_upgrade_rewrites_custom_positions_too`` is the guard
on that.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_rename_equipment_check_permissions.py"))
assert len(MATCHES) == 1, f"expected exactly one rename migration, found {MATCHES}"
MIGRATION = MATCHES[0]


def _migration_module():
    spec = importlib.util.spec_from_file_location("rename_equipment_check", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            getattr(_migration_module(), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    try:
        yield database
    finally:
        database.dispose()


def _positions_table(engine):
    metadata = sa.MetaData()
    positions = sa.Table(
        "positions",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("slug", sa.String),
        sa.Column("is_system", sa.Boolean),
        sa.Column("permissions", sa.Text),
    )
    metadata.create_all(engine)
    return positions


def _seed(engine, positions, rows):
    with engine.begin() as connection:
        for pid, slug, is_system, perms in rows:
            connection.execute(
                positions.insert().values(
                    id=pid,
                    slug=slug,
                    is_system=is_system,
                    permissions=json.dumps(perms),
                )
            )


def _read(engine):
    with engine.begin() as connection:
        return {
            row.id: json.loads(row.permissions)
            for row in connection.execute(
                sa.text("SELECT id, permissions FROM positions")
            )
        }


def test_upgrade_renames_the_three_grants(engine):
    positions = _positions_table(engine)
    _seed(
        engine,
        positions,
        [
            (
                "officer",
                "apparatus_officer",
                True,
                [
                    "equipment_check.view",
                    "equipment_check.manage",
                    "equipment_check.submit",
                ],
            )
        ],
    )
    _run(engine)
    assert _read(engine)["officer"] == [
        "inventory.check_view",
        "inventory.check_manage",
        "inventory.check_submit",
    ]


def test_upgrade_rewrites_custom_positions_too(engine):
    """The whole point of a rename vs. a revocation.

    A department's own position is not scoped out here: the string it holds
    ceases to exist, so skipping the row would silently strip the grant.
    """
    positions = _positions_table(engine)
    _seed(
        engine,
        positions,
        [("custom", "quartermaster", False, ["equipment_check.manage"])],
    )
    _run(engine)
    assert _read(engine)["custom"] == ["inventory.check_manage"]


def test_upgrade_preserves_unrelated_grants_and_order(engine):
    positions = _positions_table(engine)
    _seed(
        engine,
        positions,
        [("member", "member", True, ["events.view", "equipment_check.submit"])],
    )
    _run(engine)
    assert _read(engine)["member"] == ["events.view", "inventory.check_submit"]


def test_upgrade_expands_the_retired_module_wildcard(engine):
    """``equipment_check.*`` cannot survive: its module segment is gone."""
    positions = _positions_table(engine)
    _seed(engine, positions, [("wild", "custom", False, ["equipment_check.*"])])
    _run(engine)
    assert _read(engine)["wild"] == [
        "inventory.check_view",
        "inventory.check_manage",
        "inventory.check_submit",
    ]


def test_wildcard_expansion_does_not_duplicate_an_explicit_grant(engine):
    positions = _positions_table(engine)
    _seed(
        engine,
        positions,
        [("both", "custom", False, ["equipment_check.*", "equipment_check.view"])],
    )
    _run(engine)
    assert _read(engine)["both"] == [
        "inventory.check_view",
        "inventory.check_manage",
        "inventory.check_submit",
    ]


def test_upgrade_leaves_untouched_rows_alone(engine):
    positions = _positions_table(engine)
    _seed(
        engine,
        positions,
        [
            ("admin", "admin", True, ["*"]),
            ("other", "trainer", False, ["training.view"]),
            ("empty", "guest", False, []),
        ],
    )
    _run(engine)
    result = _read(engine)
    assert result["admin"] == ["*"]
    assert result["other"] == ["training.view"]
    assert result["empty"] == []


def test_downgrade_restores_the_old_names(engine):
    positions = _positions_table(engine)
    _seed(
        engine,
        positions,
        [("member", "member", True, ["events.view", "equipment_check.submit"])],
    )
    _run(engine)
    _run(engine, "downgrade")
    assert _read(engine)["member"] == ["events.view", "equipment_check.submit"]


def test_upgrade_skips_a_database_without_positions(engine):
    """``positions`` is built by startup create_all, not by any migration.

    CI runs ``alembic upgrade head`` against an empty database before anything
    calls create_all, so reflecting the table unguarded would raise
    NoSuchTableError and take the whole upgrade down, not just this step
    (CLAUDE.md pitfall #26).
    """
    _run(engine)  # no positions table at all
    _run(engine, "downgrade")
