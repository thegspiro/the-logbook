"""Who may record CRR activities, and who sees a resident's details.

The owner's decisions of 2026-11-22: the Community Outreach Team and everyone
who manages events record activities; the Community Outreach Manager and above
(the chiefs and the president) see resident details. The registry carries both
for departments onboarded from now on, and migration 5c2e8a417d90 carries them
to the positions departments already have (pitfall #23).
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints.crr import router as crr_router
from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = VERSIONS / "20261122_1613_5c2e8a417d90_crr_activities_and_grants.py"

CONTACT_HOLDERS = {
    "public_outreach",
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "president",
}


def _migration():
    spec = importlib.util.spec_from_file_location("crr_grants", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestRegistry:
    def test_every_seeded_events_manager_records_activities(self):
        for slug, definition in DEFAULT_POSITIONS.items():
            if "events.manage" in definition["permissions"]:
                assert "crr.record" in definition["permissions"], slug
        for code, rank in OPERATIONAL_RANKS.items():
            if "events.manage" in rank.get("default_permissions", []):
                assert "crr.record" in rank["default_permissions"], code

    def test_the_outreach_team_records_activities(self):
        assert (
            "crr.record" in DEFAULT_POSITIONS["community_outreach_team"]["permissions"]
        )

    def test_a_plain_member_does_not(self):
        assert "crr.record" not in DEFAULT_POSITIONS["member"]["permissions"]

    def test_resident_details_reach_only_the_manager_and_above(self):
        holders = {
            slug
            for slug, definition in DEFAULT_POSITIONS.items()
            if "crr.view_contact" in definition["permissions"]
        }
        assert holders == CONTACT_HOLDERS


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    with database.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE positions (id TEXT PRIMARY KEY, slug TEXT, "
                "is_system BOOLEAN, permissions TEXT)"
            )
        )
    try:
        yield database
    finally:
        database.dispose()


def _position(engine, pid, slug, permissions, is_system=True):
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO positions VALUES (:id, :slug, :sys, :perms)"),
            {
                "id": pid,
                "slug": slug,
                "sys": is_system,
                "perms": json.dumps(permissions),
            },
        )


def _permissions(engine, pid):
    with engine.connect() as connection:
        raw = connection.execute(
            sa.text("SELECT permissions FROM positions WHERE id = :id"), {"id": pid}
        ).scalar_one()
    return json.loads(raw)


def _run(engine, direction):
    module = _migration()
    with engine.begin() as connection:
        module._rewrite(
            connection, module._grant if direction == "grant" else module._revoke
        )


class TestMigrationGrants:
    def test_the_stored_positions_receive_the_owners_grants(self, engine):
        _position(engine, "sec", "secretary", ["events.view", "events.manage"])
        _position(engine, "team", "community_outreach_team", ["events.view"])
        _position(engine, "mgr", "public_outreach", ["events.manage"])
        _position(engine, "chief", "fire_chief", ["events.*"])
        _position(engine, "member", "member", ["events.view"])

        _run(engine, "grant")

        assert "crr.record" in _permissions(engine, "sec")
        assert "crr.view_contact" not in _permissions(engine, "sec")
        assert _permissions(engine, "team") == ["events.view", "crr.record"]
        assert {"crr.record", "crr.view_contact"} <= set(_permissions(engine, "mgr"))
        assert {"crr.record", "crr.view_contact"} <= set(_permissions(engine, "chief"))
        assert _permissions(engine, "member") == ["events.view"]

    def test_a_position_the_department_created_is_left_alone(self, engine):
        _position(engine, "own", "outreach_lead", ["events.manage"], is_system=False)
        _run(engine, "grant")
        assert _permissions(engine, "own") == ["events.manage"]

    def test_a_second_run_adds_nothing(self, engine):
        _position(engine, "mgr", "public_outreach", ["events.manage"])
        _run(engine, "grant")
        once = _permissions(engine, "mgr")
        _run(engine, "grant")
        assert _permissions(engine, "mgr") == once
        assert once.count("crr.record") == 1

    def test_the_downgrade_takes_both_back(self, engine):
        _position(engine, "mgr", "public_outreach", ["events.manage"])
        _run(engine, "grant")
        _run(engine, "revoke")
        assert _permissions(engine, "mgr") == ["events.manage"]


def _route_permissions(path: str, method: str) -> set[str]:
    route = next(
        r
        for r in crr_router.routes
        if getattr(r, "path", None) == path and method in getattr(r, "methods", ())
    )
    checkers = [
        d.call
        for d in route.dependant.dependencies
        if isinstance(d.call, PermissionChecker)
    ]
    assert len(checkers) == 1
    return set(checkers[0].required_permissions)


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/form-options", "GET"),
        ("/activities", "GET"),
        ("/activities", "POST"),
        ("/activities/{activity_id}", "GET"),
        ("/activities/{activity_id}", "PATCH"),
        ("/activities/{activity_id}", "DELETE"),
        # The recording form fills city and state from it, so a recorder who
        # does not manage events must reach it too.
        ("/zip-lookup/{zip_code}", "GET"),
    ],
)
def test_every_route_the_recording_screens_call_admits_a_recorder(path, method):
    assert _route_permissions(path, method) == {"crr.record", "events.manage"}
