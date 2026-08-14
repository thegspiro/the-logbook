"""The facilities.view_sensitive backfill, driven through a real Alembic context.

The upgrade only ADDS a permission to positions.permissions, and it records
nothing about which rows it touched. That makes the downgrade the interesting
half: a blanket removal would revoke grants the migration never created —
positions that already held the permission before the upgrade (which the
upgrade skips) and grants an administrator added afterwards through the
position editor. The downgrade is therefore a documented no-op, and these
tests pin that so a later "let's make it reversible" change has to argue with
a failing test rather than silently revoking tenant-managed access.

SQLite is enough: the migration inspects table names and issues plain
SELECT/UPDATE, nothing dialect-specific.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

# Located by suffix, not by full filename: the date prefix gets renumbered
# whenever main lands a migration claiming this one's revision id or parent.
_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_backfill_facilities_view_sensitive.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"
MIGRATION = _MATCHES[0]

PERMISSION = "facilities.view_sensitive"


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "backfill_facilities_view_sensitive", MIGRATION
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _positions_table(metadata: sa.MetaData) -> sa.Table:
    """The subset of the real table the migration touches."""
    return sa.Table(
        "positions",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("slug", sa.String(100)),
        sa.Column("is_system", sa.Boolean()),
        sa.Column("permissions", sa.Text()),
    )


@pytest.fixture
def engine():
    return sa.create_engine("sqlite://")


@pytest.fixture
def positions(engine):
    metadata = sa.MetaData()
    table = _positions_table(metadata)
    table.create(engine)
    return table


def _seed(engine, table, rows):
    with engine.begin() as conn:
        for row in rows:
            conn.execute(
                table.insert().values(
                    id=row["id"],
                    slug=row["slug"],
                    is_system=row.get("is_system", True),
                    permissions=json.dumps(row["permissions"]),
                )
            )


def _run(engine, direction: str):
    module = _load_migration()
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(module, direction)()
        conn.commit()


def _permissions(engine, position_id: str) -> list[str]:
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT permissions FROM positions WHERE id = :id"),
            {"id": position_id},
        ).scalar_one()
    return json.loads(raw)


class TestUpgrade:
    def test_is_a_no_op_when_the_table_does_not_exist(self, engine):
        """positions is model-only on fresh installs; create_all runs later."""
        _run(engine, "upgrade")

        assert not sa.inspect(engine).has_table("positions")

    def test_grants_to_the_default_system_positions(self, engine, positions):
        _seed(
            engine,
            positions,
            [{"id": "p1", "slug": "treasurer", "permissions": ["facilities.view"]}],
        )

        _run(engine, "upgrade")

        assert PERMISSION in _permissions(engine, "p1")

    def test_does_not_grant_to_station_scoped_captain(self, engine, positions):
        """Sensitive reads are organization-wide, while Captain is station-scoped."""
        _seed(
            engine,
            positions,
            [{"id": "p1", "slug": "captain", "permissions": ["facilities.view"]}],
        )

        _run(engine, "upgrade")

        assert _permissions(engine, "p1") == ["facilities.view"]

    def test_grants_to_any_position_holding_facilities_manage(self, engine, positions):
        _seed(
            engine,
            positions,
            [
                {
                    "id": "p1",
                    "slug": "facilities_officer",
                    "is_system": False,
                    "permissions": ["facilities.manage"],
                }
            ],
        )

        _run(engine, "upgrade")

        assert PERMISSION in _permissions(engine, "p1")

    def test_leaves_unrelated_positions_alone(self, engine, positions):
        _seed(
            engine,
            positions,
            [
                {
                    "id": "p1",
                    "slug": "firefighter",
                    "permissions": ["facilities.view"],
                },
                {"id": "p2", "slug": "admin", "permissions": ["*"]},
            ],
        )

        _run(engine, "upgrade")

        assert _permissions(engine, "p1") == ["facilities.view"]
        assert _permissions(engine, "p2") == ["*"]


class TestDowngrade:
    def test_is_a_no_op_when_the_table_does_not_exist(self, engine):
        _run(engine, "downgrade")

        assert not sa.inspect(engine).has_table("positions")

    def test_keeps_a_grant_the_upgrade_added(self, engine, positions):
        """Not reversed: it is indistinguishable from the two cases below."""
        _seed(
            engine,
            positions,
            [{"id": "p1", "slug": "treasurer", "permissions": ["facilities.view"]}],
        )
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert PERMISSION in _permissions(engine, "p1")

    def test_keeps_a_grant_that_predates_the_upgrade(self, engine, positions):
        """The upgrade skipped this row; a rollback must not revoke it."""
        _seed(
            engine,
            positions,
            [
                {
                    "id": "p1",
                    "slug": "records_clerk",
                    "is_system": False,
                    "permissions": ["facilities.view", PERMISSION],
                }
            ],
        )
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert _permissions(engine, "p1") == ["facilities.view", PERMISSION]

    def test_keeps_a_grant_an_administrator_added_after_the_upgrade(
        self, engine, positions
    ):
        _seed(
            engine,
            positions,
            [
                {
                    "id": "p1",
                    "slug": "station_manager",
                    "is_system": False,
                    "permissions": ["facilities.view"],
                }
            ],
        )
        _run(engine, "upgrade")
        with engine.begin() as conn:
            conn.execute(
                sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
                {
                    "perms": json.dumps(["facilities.view", PERMISSION]),
                    "id": "p1",
                },
            )

        _run(engine, "downgrade")

        assert PERMISSION in _permissions(engine, "p1")
