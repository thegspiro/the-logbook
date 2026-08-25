"""Who can read the photo-use consent roster, asserted by name.

The roster lists every member's answer to a privacy question. Which seeded
positions reach it is a decision worth failing a build over, not something to
infer from a permission list months later — the first version of this endpoint
shipped gated on ``users.view`` on exactly that kind of inference, and 25 of
the 30 default positions turned out to hold it.
"""

import importlib.util
from pathlib import Path

from app.core.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_POSITIONS,
    get_all_permissions,
    permission_matches,
)

PERMISSION = "users.view_consents"

# The endpoint's accepted set, restated here so a change to it has to be made
# twice, on purpose.
ROSTER_ACCEPTS = {
    "users.view_consents",
    "notifications.manage",
    "members.manage",
    "users.edit",
}

# Seeded positions whose job touches publication or the photo archive.
EXPECTED_HOLDERS = {"communications_officer", "historian", "public_outreach"}

# Named individually rather than derived: these are the positions the 2026-08-25
# review found reaching the roster through users.view, and the point of the
# change was that they stop.
MUST_NOT_REACH = (
    "ems_supply_officer",
    "apparatus_officer",
    "quartermaster",
    "safety_officer",
    "training_officer",
    "member",
    "firefighter",
)


def _reaches_roster(slug: str) -> bool:
    granted = set(DEFAULT_POSITIONS[slug]["permissions"])
    return any(permission_matches(required, granted) for required in ROSTER_ACCEPTS)


def test_permission_is_registered():
    assert PERMISSION in get_all_permissions()
    assert any(p.name == PERMISSION for p in ALL_PERMISSIONS)


def test_exactly_the_publication_positions_are_seeded_with_it():
    holders = {
        slug
        for slug, position in DEFAULT_POSITIONS.items()
        if PERMISSION in position["permissions"]
    }
    assert holders == EXPECTED_HOLDERS


def test_publication_positions_reach_the_roster():
    for slug in sorted(EXPECTED_HOLDERS):
        assert _reaches_roster(slug), slug


def test_broad_view_grants_do_not_reach_the_roster():
    for slug in MUST_NOT_REACH:
        assert not _reaches_roster(slug), (
            f"{slug} reaches the photo-use consent roster. users.view is held by "
            "most default positions and must never be an accepted permission on it."
        )


def test_migration_backfills_every_position_the_registry_seeds():
    """A registry grant reaches only *new* departments (CLAUDE.md pitfall 23).

    The backfill migration has to cover the same slugs, or the Historian on
    every existing installation silently never gets the page.
    """
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic/versions/20260825_1900_c4a91b7e2f08_grant_users_view_consents.py"
    )
    spec = importlib.util.spec_from_file_location("grant_view_consents", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    assert migration._PERMISSION == PERMISSION
    assert set(migration._SLUGS) == EXPECTED_HOLDERS
