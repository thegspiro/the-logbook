"""The apparatus event permissions: where the registry grants them, and
migration 3f8a1c6e2b94 carrying them to positions already stored.

The rule is one sentence in both places — whoever holds events.manage can run
apparatus events, and whoever can see events can volunteer for a seat — so
the tests pin the sentence, not a list of slugs.

The migration is run against a real (SQLite) connection with rows present
(CLAUDE.md pitfall #35): what matters is which rows it leaves alone, and that
a second run adds nothing.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.core.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_POSITIONS,
    OPERATIONAL_RANKS,
    permission_matches,
)

pytestmark = pytest.mark.unit

MANAGE = "apparatus_events.manage"
SIGNUP = "apparatus_events.signup"

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_3f8a1c6e2b94_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _seeded_lists():
    for slug, rank in OPERATIONAL_RANKS.items():
        yield f"rank:{slug}", list(rank["default_permissions"])
    for slug, position in DEFAULT_POSITIONS.items():
        yield f"position:{slug}", list(position.get("permissions") or [])


class TestTheRegistry:
    def test_both_permissions_are_registered(self):
        names = {p.name for p in ALL_PERMISSIONS}
        assert {MANAGE, SIGNUP} <= names

    @pytest.mark.parametrize(("label", "permissions"), list(_seeded_lists()))
    def test_manage_follows_events_manage(self, label, permissions):
        assert ("events.manage" in permissions) == (MANAGE in permissions), label

    @pytest.mark.parametrize(("label", "permissions"), list(_seeded_lists()))
    def test_signup_follows_seeing_events(self, label, permissions):
        sees_events = "events.view" in permissions or "events.manage" in permissions
        assert sees_events == (SIGNUP in permissions), label

    def test_the_member_baseline_can_sign_up_but_not_manage(self):
        member = set(DEFAULT_POSITIONS["member"]["permissions"])
        assert SIGNUP in member
        assert MANAGE not in member

    def test_the_events_wildcard_does_not_reach_these(self):
        # A different module prefix: holding events.* is evidence for the
        # migration, not a grant at runtime.
        assert not permission_matches(MANAGE, {"events.*"})
        assert not permission_matches(SIGNUP, {"events.*"})


def _migration():
    spec = importlib.util.spec_from_file_location("apparatus_grants", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def _grant_step(engine, step="_grant"):
    """The migration's row rewrite. ``upgrade()`` also creates six tables
    with foreign keys into the full schema, which an isolated ``positions``
    table cannot host; the table half was verified by a real
    ``alembic upgrade head``/``downgrade`` round trip."""
    module = _migration()
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module._rewrite(connection, getattr(module, step))


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


class TestTheMigration:
    def test_an_events_manager_gains_both(self, engine):
        _position(engine, "p1", "public_outreach", ["events.view", "events.manage"])
        _grant_step(engine)
        assert _permissions(engine, "p1") == [
            "events.view",
            "events.manage",
            MANAGE,
            SIGNUP,
        ]

    def test_a_member_who_sees_events_gains_signup_only(self, engine):
        _position(engine, "p1", "member", ["events.view", "training.view"])
        _grant_step(engine)
        assert _permissions(engine, "p1") == ["events.view", "training.view", SIGNUP]

    def test_the_events_wildcard_is_evidence_for_both(self, engine):
        _position(engine, "p1", "secretary", ["events.*"])
        _grant_step(engine)
        assert _permissions(engine, "p1") == ["events.*", MANAGE, SIGNUP]

    def test_a_position_without_event_access_is_untouched(self, engine):
        _position(engine, "p1", "treasurer", ["finance.view"])
        _grant_step(engine)
        assert _permissions(engine, "p1") == ["finance.view"]

    def test_a_department_created_position_is_left_alone(self, engine):
        _position(
            engine,
            "p1",
            "event_crew",
            ["events.view", "events.manage"],
            is_system=False,
        )
        _grant_step(engine)
        assert _permissions(engine, "p1") == ["events.view", "events.manage"]

    def test_running_twice_adds_nothing_twice(self, engine):
        _position(engine, "p1", "public_outreach", ["events.manage"])
        _grant_step(engine)
        _grant_step(engine)
        assert _permissions(engine, "p1") == ["events.manage", MANAGE, SIGNUP]

    def test_the_downgrade_takes_back_exactly_the_two_grants(self, engine):
        _position(engine, "p1", "public_outreach", ["events.view", "events.manage"])
        _grant_step(engine)
        _grant_step(engine, "_revoke")
        assert _permissions(engine, "p1") == ["events.view", "events.manage"]

    def test_the_rule_matches_the_registry(self):
        """Frozen in the migration, live in the registry; the two must agree
        on every seeded list today or one of them is wrong."""
        grant = _migration()._grant
        for label, permissions in _seeded_lists():
            before = [p for p in permissions if p not in (MANAGE, SIGNUP)]
            if "*" in before:
                continue
            assert set(grant(before)) == set(permissions), label
