"""The storefront backfill migration must mirror the permission registry.

``DEFAULT_POSITIONS`` is materialized into ``positions`` only at onboarding, so
a grant added to the registry afterwards reaches fresh installs and nobody
else. Migration ``a4f8c1b92d17`` writes the storefront grants onto the rows
already stored — and it carries a hand-transcribed copy of the registry's
slug-to-grant map, which is exactly the kind of copy that goes stale silently.

If this test fails, the registry and the migration disagree: either a position
gained or lost a storefront grant and the migration was not updated, or the
migration lists a slug the registry does not seed.
"""

import importlib.util
from pathlib import Path

import pytest

from app.core.permissions import DEFAULT_POSITIONS

_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260825_1500_a4f8c1b92d17_backfill_storefront_member_grants.py"
)

_STOREFRONT_GRANTS = ("storefront.view", "storefront.order", "storefront.manage")

# A migration that runs *after* the backfill and takes a permission back off
# some of the same slugs. See ``_pristine_registry_set``.
_LATER_REVOCATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260825_2015_a1f7c34e9b02_revoke_baseline_notifications_view.py"
)


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_migration():
    return _load_module(_MIGRATION, "_backfill_storefront")


def _pristine_registry_set(slug: str) -> set[str]:
    """The registry as the backfill meets it, not as it stands today.

    ``_PRIOR_DEFAULTS`` freezes what a pristine pre-storefront row looks like
    at the point ``a4f8c1b92d17`` runs, and it is matched against real stored
    rows — so it must keep describing them exactly. ``a1f7c34e9b02`` runs later
    in the chain and revokes ``notifications.view`` from three of the same
    slugs, which leaves today's registry one permission short of the row the
    backfill actually encounters. Add it back rather than editing the frozen
    snapshot: the snapshot is right, and trimming it to match a registry that
    moved on afterwards is what would stop it matching a pristine row and quietly
    turn the backfill into a no-op that still reports success.
    """
    permissions = set(DEFAULT_POSITIONS[slug].get("permissions") or [])
    revocation = _load_module(_LATER_REVOCATION, "_revoke_notifications_view")
    if slug in revocation._SLUGS:
        permissions.add(revocation._PERMISSION)
    return permissions


def _registry_grants(slug: str) -> tuple[str, ...]:
    permissions = DEFAULT_POSITIONS[slug].get("permissions") or []
    return tuple(g for g in _STOREFRONT_GRANTS if g in permissions)


# A migration that runs *after* this backfill and gives the storefront grants
# to thirteen more positions. Those slugs belong to it, not to this one.
_LATER_CORPORATE_GRANT = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260826_0345_b3e8d1f45a27_grant_corporate_storefront_access.py"
)


def _granted_later() -> set[str]:
    """Slugs whose storefront grants arrive in a later revision."""
    return set(_load_module(_LATER_CORPORATE_GRANT, "_corp_storefront")._PRIOR_DEFAULTS)


def _seeded_slugs_with_storefront() -> set[str]:
    later = _granted_later()
    return {
        slug
        for slug, entry in DEFAULT_POSITIONS.items()
        if slug not in later
        # A wildcard position already covers every storefront grant, so the
        # migration deliberately leaves it out rather than cluttering it.
        and "*" not in (entry.get("permissions") or []) and _registry_grants(slug)
    }


def test_migration_file_exists():
    assert _MIGRATION.exists(), f"missing migration: {_MIGRATION.name}"


def test_backfill_covers_every_position_the_registry_seeds():
    backfill = _load_migration()._BACKFILL
    assert set(backfill) == _seeded_slugs_with_storefront()


@pytest.mark.parametrize("slug", sorted(_seeded_slugs_with_storefront()))
def test_backfill_grants_match_the_registry(slug):
    backfill = _load_migration()._BACKFILL
    assert backfill[slug] == _registry_grants(slug)


def test_wildcard_positions_are_left_out():
    backfill = _load_migration()._BACKFILL
    for slug, entry in DEFAULT_POSITIONS.items():
        if "*" in (entry.get("permissions") or []):
            assert slug not in backfill


def test_plain_member_is_backfilled_with_browsing_but_not_management():
    backfill = _load_migration()._BACKFILL
    assert backfill["member"] == ("storefront.view", "storefront.order")


class TestFrozenPriorDefaults:
    """The snapshot must describe a pristine row at the moment this runs.

    ``_PRIOR_DEFAULTS`` is frozen rather than imported, so it can drift from
    the registry silently — and a drifted snapshot matches nothing, which makes
    the backfill a no-op that still reports success. These assertions are the
    thing that notices.
    """

    def test_snapshot_covers_exactly_the_backfilled_slugs(self):
        module = _load_migration()
        assert set(module._PRIOR_DEFAULTS) == set(module._BACKFILL)

    @pytest.mark.parametrize("slug", sorted(_seeded_slugs_with_storefront()))
    def test_snapshot_is_the_registry_set_minus_the_added_grants(self, slug):
        module = _load_migration()
        registry = _pristine_registry_set(slug)
        assert module._PRIOR_DEFAULTS[slug] == registry - set(module._BACKFILL[slug])

    def test_the_snapshot_never_already_carries_a_grant(self):
        # If it did, a pristine row would never match and nothing would be
        # backfilled — the silent-no-op failure this guard exists to catch.
        module = _load_migration()
        for slug, grants in module._BACKFILL.items():
            assert not (module._PRIOR_DEFAULTS[slug] & set(grants)), slug
