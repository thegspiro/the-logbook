"""The seeded Quartermaster may add rooms (workflow review W38-1).

The inventory setup wizard's first step adds rooms, and ``POST /locations``
wants ``locations.create``. Two halves, because the grant reaches a department
two ways: the registry seeds it at onboarding, and migration ``9e8b0b6f3fe8``
writes it onto the quartermaster rows already stored (CLAUDE.md pitfall #23).
The migration's decision is a pure function, tested here row shape by row
shape; ``TestAgainstARealTable`` runs the migration's own upgrade/downgrade
against a throwaway ``positions``-shaped table.
"""

import importlib.util
import json
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
import sqlalchemy as sa

from app.core.permissions import DEFAULT_POSITIONS

_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261011_2305_9e8b0b6f3fe8_grant_quartermaster_locations_create.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("qm_locations_create", _MIGRATION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = _load_migration()


@pytest.mark.unit
class TestRegistry:
    def test_the_registry_seeds_the_quartermaster_with_locations_create(self):
        assert "locations.create" in DEFAULT_POSITIONS["quartermaster"]["permissions"]

    def test_creating_rooms_does_not_bring_editing_or_deleting(self):
        granted = DEFAULT_POSITIONS["quartermaster"]["permissions"]
        for withheld in (
            "locations.edit",
            "locations.delete",
            "locations.manage",
            "locations.*",
        ):
            assert withheld not in granted


@pytest.mark.unit
class TestGrant:
    def test_a_stock_quartermaster_gains_the_grant(self):
        row = ["inventory.view", "inventory.manage", "storefront.manage"]
        assert migration.grant(row) == row + ["locations.create"]

    def test_a_quartermaster_without_inventory_manage_is_left_alone(self):
        # A department that split the role and took the stock away from it.
        assert migration.grant(["inventory.view", "storefront.manage"]) is None

    @pytest.mark.parametrize(
        "covering", ["locations.create", "locations.manage", "locations.*", "*"]
    )
    def test_a_row_already_covering_it_is_left_alone(self, covering):
        assert migration.grant(["inventory.manage", covering]) is None

    def test_an_empty_row_is_left_alone(self):
        assert migration.grant([]) is None


@pytest.mark.unit
class TestRevoke:
    def test_downgrade_removes_only_this_grant(self):
        assert migration.revoke(
            ["inventory.manage", "locations.create", "locations.view"]
        ) == ["inventory.manage", "locations.view"]

    def test_downgrade_leaves_a_row_without_it(self):
        assert migration.revoke(["inventory.manage"]) is None

    def test_upgrade_then_downgrade_is_the_original_row(self):
        row = ["inventory.view", "inventory.manage"]
        assert migration.revoke(migration.grant(row)) == row


@pytest.mark.integration
class TestAgainstARealTable:
    """Runs upgrade()/downgrade() on a prefixed throwaway table rather than the
    shared ``positions``, by pointing the migration's SQL at it. TEMPORARY, so
    MySQL does not implicitly commit the test's outer transaction."""

    @pytest.fixture
    async def table(self, db_session):
        name = f"tmp_positions_{uuid.uuid4().hex[:8]}"
        conn = await db_session.connection()
        await conn.execute(
            sa.text(
                f"CREATE TEMPORARY TABLE {name} (id VARCHAR(36) PRIMARY KEY, "
                "slug VARCHAR(100), is_system BOOLEAN, permissions JSON)"
            )
        )
        try:
            yield name, conn
        finally:
            await conn.execute(sa.text(f"DROP TEMPORARY TABLE IF EXISTS {name}"))

    async def _run(self, conn, name, step):
        def go(sync_conn):
            original_text = sa.text

            def retarget(sql, *args, **kwargs):
                return original_text(sql.replace("positions", name), *args, **kwargs)

            class _Inspector:
                # The temporary table is invisible to reflection; the guard
                # only needs to see that "positions" exists.
                def get_table_names(self):
                    return ["positions"]

            with (
                patch.object(migration.op, "get_bind", return_value=sync_conn),
                patch.object(migration.sa, "text", side_effect=retarget),
                patch.object(migration.sa, "inspect", return_value=_Inspector()),
            ):
                step()

        await conn.run_sync(go)

    async def _rows(self, conn, name):
        result = await conn.execute(sa.text(f"SELECT id, permissions FROM {name}"))
        return {
            row.id: (
                json.loads(row.permissions)
                if isinstance(row.permissions, str)
                else row.permissions
            )
            for row in result
        }

    async def test_upgrade_writes_only_eligible_rows_and_downgrade_reverts(self, table):
        name, conn = table
        seeds = {
            "qm": ("quartermaster", True, ["inventory.view", "inventory.manage"]),
            "qm-split": ("quartermaster", True, ["inventory.view"]),
            "qm-custom": ("quartermaster", False, ["inventory.manage"]),
            "qm-manage": (
                "quartermaster",
                True,
                ["inventory.manage", "locations.manage"],
            ),
            "other": ("secretary", True, ["inventory.manage"]),
        }
        for row_id, (slug, is_system, perms) in seeds.items():
            await conn.execute(
                sa.text(
                    f"INSERT INTO {name} (id, slug, is_system, permissions) "
                    "VALUES (:id, :slug, :is_system, :permissions)"
                ),
                {
                    "id": row_id,
                    "slug": slug,
                    "is_system": is_system,
                    "permissions": json.dumps(perms),
                },
            )

        await self._run(conn, name, migration.upgrade)
        after = await self._rows(conn, name)
        assert after["qm"] == ["inventory.view", "inventory.manage", "locations.create"]
        for untouched in ("qm-split", "qm-custom", "qm-manage", "other"):
            assert after[untouched] == seeds[untouched][2]

        # Idempotent: a second run changes nothing.
        await self._run(conn, name, migration.upgrade)
        assert await self._rows(conn, name) == after

        await self._run(conn, name, migration.downgrade)
        reverted = await self._rows(conn, name)
        assert reverted == {row_id: seed[2] for row_id, seed in seeds.items()}
