"""``b65eaef983b9`` carries the evaluation setup grants to the stored Chief.

``OPERATIONAL_RANKS["fire_chief"]`` is the list the system ``fire_chief``
position was seeded with, so the registry edit reaches only departments
onboarded after it; every existing Chief row keeps its old copy until a
migration rewrites it (CLAUDE.md pitfall #23).
"""

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261031_2054_b65eaef983b9_grant_evaluation_setup_to_chief.py"
)
_GRANTS = ("evaluations.configure", "evaluations.manage")


def _migration():
    spec = importlib.util.spec_from_file_location("_grant_evaluation_setup", _PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.unit
class TestWhatItTargets:
    def test_exactly_the_seeded_positions_that_hold_the_grants(self):
        seeded = {
            slug
            for slug, spec in DEFAULT_POSITIONS.items()
            if any(g in spec["permissions"] for g in _GRANTS)
        }
        assert set(_migration()._SLUGS) == seeded == {"fire_chief"}

    def test_the_chief_rank_holds_them_at_runtime(self):
        granted = OPERATIONAL_RANKS["fire_chief"]["default_permissions"]
        assert all(g in granted for g in _GRANTS)

    def test_no_other_rank_is_given_them(self):
        for rank, spec in OPERATIONAL_RANKS.items():
            if rank == "fire_chief":
                continue
            assert not any(g in spec["default_permissions"] for g in _GRANTS), rank

    def test_it_adds_once_and_only_what_is_missing(self):
        module = _migration()
        added = module._add(["events.view", "evaluations.manage"])

        assert added == ["events.view", "evaluations.manage", "evaluations.configure"]
        assert module._add(added) is None

    def test_downgrade_removes_only_the_grants(self):
        module = _migration()

        assert module._remove(["events.view", *_GRANTS]) == ["events.view"]
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
async def test_it_grants_the_seeded_chief_idempotently_and_reverses(db_session):
    migration = _migration()
    org_id = await _org(db_session)
    chief = await _position(
        db_session, org_id, "fire_chief", ["events.view"], is_system=True
    )
    deputy = await _position(
        db_session, org_id, "deputy_chief", ["events.view"], is_system=True
    )
    # Slugs are unique per org, so the department-created one lives in another.
    custom = await _position(
        db_session,
        await _org(db_session),
        "fire_chief",
        ["events.view"],
        is_system=False,
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
    assert await perms(chief) == ["events.view", *_GRANTS]
    assert await perms(deputy) == ["events.view"]
    assert await perms(custom) == ["events.view"]

    await db_session.run_sync(
        lambda s: migration._rewrite(s.connection(), migration._remove)
    )
    assert await perms(chief) == ["events.view"]
