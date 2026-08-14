"""Contract tests for the Captain sensitive-facilities corrective migration."""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_revoke_captain_facilities_view_sensitive.py"))
assert len(MATCHES) == 1, f"expected exactly one corrective migration, found {MATCHES}"
MIGRATION = MATCHES[0]
PERMISSION = "facilities.view_sensitive"


def _migration_module():
    spec = importlib.util.spec_from_file_location("revoke_captain_sensitive", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            getattr(_migration_module(), direction)()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ('["facilities.view"]', ["facilities.view"]),
        (["facilities.view"], ["facilities.view"]),
        (None, []),
    ],
)
def test_load_permissions_accepts_driver_json_shapes(raw, expected):
    assert _migration_module()._load_permissions(raw) == expected


def test_upgrade_revokes_only_the_system_captain_grant():
    engine = sa.create_engine("sqlite://")
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
    rows = [
        ("captain", "captain", True, ["facilities.view", PERMISSION]),
        ("custom", "captain", False, [PERMISSION]),
        ("treasurer", "treasurer", True, [PERMISSION]),
    ]
    with engine.begin() as connection:
        connection.execute(
            positions.insert(),
            [
                {
                    "id": row_id,
                    "slug": slug,
                    "is_system": is_system,
                    "permissions": json.dumps(permissions),
                }
                for row_id, slug, is_system, permissions in rows
            ],
        )

    _run(engine)
    # Startup can retry migrations after an interrupted deployment. Applying
    # the data correction again must not disturb the remaining permissions.
    _run(engine)

    with engine.connect() as connection:
        result = {
            row.id: json.loads(row.permissions)
            for row in connection.execute(sa.select(positions))
        }
    assert result == {
        "captain": ["facilities.view"],
        "custom": [PERMISSION],
        "treasurer": [PERMISSION],
    }
    engine.dispose()


def test_upgrade_and_downgrade_are_safe_without_positions_table():
    engine = sa.create_engine("sqlite://")

    _run(engine)
    _run(engine, "downgrade")

    assert not sa.inspect(engine).has_table("positions")
    engine.dispose()
