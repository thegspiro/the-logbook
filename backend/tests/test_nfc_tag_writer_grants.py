"""Who writes NFC tags: apparatus tags, room tags and member ID cards.

The owner's decision of 2026-10-02. Two halves, because a grant reaches a
department two ways: the registry seeds it at onboarding, and migration
``5bed4c485d2f`` writes it onto the seeded rows already stored (CLAUDE.md
pitfall #23). The migration is exercised both as a pure function and against a
real (SQLite) ``positions`` table, because the rows that matter most are the
ones it must leave alone.
"""

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.core.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_POSITIONS,
    OPERATIONAL_RANKS,
    is_read_only_permission,
)

pytestmark = pytest.mark.unit

APPARATUS_TAGS = "apparatus.manage_nfc_tags"
ROOM_TAGS = "locations.manage_nfc_tags"
ID_CARDS = "members.manage_id_cards"

LEADERSHIP = {
    "president",
    "vice_president",
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
}

_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261002_2303_5bed4c485d2f_grant_nfc_tag_writers.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("nfc_tag_writers", _MIGRATION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = _load_migration()


def _holders(permission: str) -> set[str]:
    return {
        slug
        for slug, position in DEFAULT_POSITIONS.items()
        if permission in position["permissions"]
    }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class TestRegistry:
    def test_both_tag_permissions_are_catalogued_as_writes(self):
        catalogued = {p.name for p in ALL_PERMISSIONS}
        for permission in (APPARATUS_TAGS, ROOM_TAGS):
            assert permission in catalogued
            assert is_read_only_permission(permission) is False

    def test_apparatus_tags_go_to_leadership_and_the_apparatus_officer(self):
        assert _holders(APPARATUS_TAGS) == LEADERSHIP | {"apparatus_officer"}

    def test_room_tags_go_to_leadership_and_the_facilities_manager(self):
        assert _holders(ROOM_TAGS) == LEADERSHIP | {"facilities_manager"}

    def test_the_assistant_membership_coordinator_issues_id_cards(self):
        assert "assistant_membership_coordinator" in _holders(ID_CARDS)

    def test_id_cards_keep_every_holder_the_owner_kept(self):
        # Nobody lost ID cards: leadership, both coordinators, and the captain
        # and deputy chief the owner chose to keep.
        assert LEADERSHIP | {
            "membership_coordinator",
            "assistant_membership_coordinator",
            "captain",
        } <= _holders(ID_CARDS)

    @pytest.mark.parametrize("rank", ["fire_chief", "deputy_chief", "assistant_chief"])
    def test_chief_ranks_carry_both_tag_grants_at_runtime(self, rank):
        # Rank defaults resolve at runtime, independently of the stored row.
        defaults = OPERATIONAL_RANKS[rank]["default_permissions"]
        assert APPARATUS_TAGS in defaults
        assert ROOM_TAGS in defaults

    @pytest.mark.parametrize("rank", ["captain", "lieutenant", "engineer"])
    def test_company_officers_do_not_write_place_tags(self, rank):
        defaults = OPERATIONAL_RANKS[rank]["default_permissions"]
        assert APPARATUS_TAGS not in defaults
        assert ROOM_TAGS not in defaults

    def test_the_migration_matches_the_registry(self):
        # Frozen in the migration, so a registry edit that moves a grant must
        # come with its own revision rather than silently diverging.
        for slug, grants in migration._GRANTS.items():
            for permission in grants:
                assert permission in DEFAULT_POSITIONS[slug]["permissions"], (
                    slug,
                    permission,
                )
        for permission in (APPARATUS_TAGS, ROOM_TAGS):
            assert {
                slug
                for slug, grants in migration._GRANTS.items()
                if permission in grants
            } == _holders(permission)


# ---------------------------------------------------------------------------
# Migration — the decision
# ---------------------------------------------------------------------------


class TestGrant:
    def test_a_leadership_row_gains_both_tag_grants(self):
        row = ["members.view", "apparatus.view"]
        assert migration.grant("vice_president", row) == row + [
            APPARATUS_TAGS,
            ROOM_TAGS,
        ]

    def test_the_apparatus_officer_gains_only_apparatus_tags(self):
        assert migration.grant("apparatus_officer", ["apparatus.view"]) == [
            "apparatus.view",
            APPARATUS_TAGS,
        ]

    def test_the_facilities_manager_gains_only_room_tags(self):
        assert migration.grant("facilities_manager", ["facilities.manage"]) == [
            "facilities.manage",
            ROOM_TAGS,
        ]

    def test_an_unnamed_position_is_left_alone(self):
        assert migration.grant("captain", ["members.manage"]) is None

    def test_an_empty_row_is_left_alone(self):
        assert migration.grant("president", []) is None

    @pytest.mark.parametrize("covering", ["apparatus.*", "*", APPARATUS_TAGS])
    def test_a_row_already_covering_a_grant_is_not_given_it_twice(self, covering):
        assert migration.grant("apparatus_officer", [covering]) is None

    def test_only_the_uncovered_grant_is_added(self):
        assert migration.grant("president", ["apparatus.*"]) == [
            "apparatus.*",
            ROOM_TAGS,
        ]

    def test_the_assistant_coordinator_running_the_pipeline_gains_id_cards(self):
        row = ["members.view", "prospective_members.manage"]
        assert migration.grant("assistant_membership_coordinator", row) == row + [
            ID_CARDS
        ]

    def test_an_assistant_coordinator_without_the_pipeline_is_left_alone(self):
        # A department that moved the pipeline elsewhere keeps its choice.
        assert (
            migration.grant("assistant_membership_coordinator", ["members.view"])
            is None
        )

    @pytest.mark.parametrize("covering", [ID_CARDS, "members.*", "*"])
    def test_an_assistant_coordinator_already_issuing_cards_is_left_alone(
        self, covering
    ):
        row = ["prospective_members.manage", covering]
        assert migration.grant("assistant_membership_coordinator", row) is None


class TestRevoke:
    def test_downgrade_removes_only_this_revisions_grants(self):
        row = ["apparatus.view", APPARATUS_TAGS, ROOM_TAGS, ID_CARDS]
        assert migration.revoke("president", row) == ["apparatus.view", ID_CARDS]

    def test_downgrade_leaves_a_row_without_them(self):
        assert migration.revoke("president", ["apparatus.view"]) is None

    def test_upgrade_then_downgrade_is_the_original_row(self):
        row = ["members.view", "prospective_members.manage"]
        slug = "assistant_membership_coordinator"
        assert migration.revoke(slug, migration.grant(slug, row)) == row


# ---------------------------------------------------------------------------
# Migration — against a real table
# ---------------------------------------------------------------------------


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "positions",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("slug", sa.String),
        sa.Column("permissions", sa.Text),
        sa.Column("is_system", sa.Boolean),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(migration, direction)()


def _insert(engine, slug, permissions, is_system=True):
    position_id = str(uuid.uuid4())
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO positions (id, organization_id, slug, permissions, "
                "is_system) VALUES (:i, 'org', :s, :p, :sys)"
            ),
            {
                "i": position_id,
                "s": slug,
                "p": json.dumps(permissions),
                "sys": is_system,
            },
        )
    return position_id


def _permissions(engine, position_id):
    with engine.begin() as connection:
        raw = connection.execute(
            sa.text("SELECT permissions FROM positions WHERE id = :i"),
            {"i": position_id},
        ).scalar_one()
    return json.loads(raw)


class TestAgainstATable:
    def test_writes_seeded_rows_and_leaves_the_rest(self, engine):
        president = _insert(engine, "president", ["members.manage"])
        officer = _insert(engine, "apparatus_officer", ["apparatus.view"])
        captain = _insert(engine, "captain", ["members.manage"])
        custom = _insert(engine, "president", ["members.manage"], is_system=False)
        stripped = _insert(engine, "vice_president", [])

        _run(engine)

        assert _permissions(engine, president) == [
            "members.manage",
            APPARATUS_TAGS,
            ROOM_TAGS,
        ]
        assert _permissions(engine, officer) == ["apparatus.view", APPARATUS_TAGS]
        assert _permissions(engine, captain) == ["members.manage"]
        assert _permissions(engine, custom) == ["members.manage"]
        assert _permissions(engine, stripped) == []

    def test_is_idempotent(self, engine):
        president = _insert(engine, "president", ["members.manage"])
        _run(engine)
        once = _permissions(engine, president)
        _run(engine)
        assert _permissions(engine, president) == once

    def test_downgrade_restores_the_row(self, engine):
        coordinator = _insert(
            engine,
            "assistant_membership_coordinator",
            ["members.view", "prospective_members.manage"],
        )
        _run(engine)
        assert ID_CARDS in _permissions(engine, coordinator)
        _run(engine, "downgrade")
        assert _permissions(engine, coordinator) == [
            "members.view",
            "prospective_members.manage",
        ]

    def test_without_the_table_it_does_nothing(self):
        database = sa.create_engine("sqlite://")
        try:
            _run(database)
        finally:
            database.dispose()
