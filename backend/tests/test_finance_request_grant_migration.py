"""``7db20aa49329`` carries ``finance.request`` to departments already onboarded.

The registry edit reaches fresh installs only: ``DEFAULT_POSITIONS`` is copied
into the ``positions`` table at onboarding, so every existing department's
Member row keeps the list it was seeded with until a migration rewrites it
(CLAUDE.md pitfall #23).
"""

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core.permissions import DEFAULT_POSITIONS

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261007_2305_7db20aa49329_grant_finance_request_to_members.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_grant_finance_request", _PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.unit
class TestWhatItTargets:
    def test_exactly_the_seeded_positions_that_hold_the_grant(self):
        """The registry and the migration name the same rows — a slug added to
        one and not the other is a department left without the grant, or
        handed one it was never meant to have."""
        seeded = {
            slug
            for slug, spec in DEFAULT_POSITIONS.items()
            if "finance.request" in spec["permissions"]
        }
        assert set(_migration()._SLUGS) == seeded

    def test_it_adds_once(self):
        module = _migration()
        added = module._add(["events.view"])

        assert added == ["events.view", "finance.request"]
        assert module._add(added) is None

    def test_downgrade_removes_only_the_grant(self):
        module = _migration()

        assert module._remove(["events.view", "finance.request"]) == ["events.view"]
        assert module._remove(["events.view"]) is None


async def _org(db) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Grant Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"grant-{org_id[:8]}"},
    )
    return org_id


async def _position(db, org_id, slug, permissions, *, is_system) -> str:
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, is_system, "
            "permissions) VALUES (:id, :org, :name, :slug, :sys, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": slug.title(),
            "slug": slug,
            "sys": is_system,
            "perms": json.dumps(permissions),
        },
    )
    return position_id


@pytest.mark.integration
async def test_it_grants_seeded_rows_idempotently_and_reverses(db_session):
    migration = _migration()
    org_id = await _org(db_session)
    member = await _position(
        db_session, org_id, "member", ["events.view"], is_system=True
    )
    firefighter = await _position(
        db_session, org_id, "firefighter", ["events.view"], is_system=True
    )
    emt = await _position(db_session, org_id, "emt", ["events.view"], is_system=True)
    treasurer = await _position(
        db_session, org_id, "treasurer", ["finance.view"], is_system=True
    )
    # Slugs are unique per org, so the department-created one lives in another.
    custom = await _position(
        db_session, await _org(db_session), "member", ["events.view"], is_system=False
    )
    await db_session.flush()

    async def perms(position_id):
        raw = await db_session.scalar(
            text("SELECT permissions FROM positions WHERE id = :id"),
            {"id": position_id},
        )
        return migration._load_permissions(raw)

    for _ in range(2):  # idempotent
        await db_session.run_sync(
            lambda s: migration._rewrite(s.connection(), migration._add)
        )
    assert await perms(member) == ["events.view", "finance.request"]
    # The rank-mirroring positions are left alone: the grant is the Member
    # position's, so a department can withdraw it in one place.
    assert await perms(firefighter) == ["events.view"]
    assert await perms(emt) == ["events.view"]
    assert await perms(treasurer) == ["finance.view"]
    assert await perms(custom) == ["events.view"]

    await db_session.run_sync(
        lambda s: migration._rewrite(s.connection(), migration._remove)
    )
    assert await perms(member) == ["events.view"]
