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


def _load_migration():
    spec = importlib.util.spec_from_file_location("_backfill_storefront", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _registry_grants(slug: str) -> tuple[str, ...]:
    permissions = DEFAULT_POSITIONS[slug].get("permissions") or []
    return tuple(g for g in _STOREFRONT_GRANTS if g in permissions)


def _seeded_slugs_with_storefront() -> set[str]:
    return {
        slug
        for slug, entry in DEFAULT_POSITIONS.items()
        # A wildcard position already covers every storefront grant, so the
        # migration deliberately leaves it out rather than cluttering it.
        if "*" not in (entry.get("permissions") or []) and _registry_grants(slug)
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


class TestCoverageHelper:
    """``_covered`` decides what the migration skips, so it is worth pinning."""

    def test_exact_grant_is_covered(self):
        covered = _load_migration()._covered
        assert covered(["storefront.view"], "storefront.view")

    def test_global_and_module_wildcards_are_covered(self):
        covered = _load_migration()._covered
        assert covered(["*"], "storefront.view")
        assert covered(["storefront.*"], "storefront.manage")

    def test_an_unrelated_grant_is_not_covered(self):
        covered = _load_migration()._covered
        assert not covered(["inventory.view", "events.view"], "storefront.view")

    def test_a_sibling_grant_does_not_cover(self):
        covered = _load_migration()._covered
        assert not covered(["storefront.view"], "storefront.manage")
