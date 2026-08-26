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

#: Permissions the frozen ``_PRIOR_DEFAULTS`` still carries because they were
#: in the registry when ``a4f8c1b92d17`` was written, and which a later
#: revision has since removed. The snapshot is right to keep them: a pristine
#: stored row still has them at the moment this migration runs, because the
#: revision that revokes them runs afterwards.
#:
#: ``notifications.view`` — revoked from the baseline member and junior ranks
#: by ``a1f7c34e9b02`` (#1829), which is downstream of this migration.
_EXPECTED_DRIFT: dict[str, set[str]] = {
    "member": {"notifications.view"},
    "firefighter": {"notifications.view"},
    "engineer": {"notifications.view"},
}


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
    def test_snapshot_matches_the_registry_but_for_documented_drift(self, slug):
        """The snapshot describes a pristine row *when this migration runs*.

        It cannot stay equal to the live registry forever, and it is not
        supposed to: later revisions change what a fresh install seeds, which
        is the whole reason the snapshot is frozen. What must stay true is that
        every difference is one somebody decided on, so the allowance below is
        explicit and a new, unexplained divergence still fails here.
        """
        module = _load_migration()
        registry = set(DEFAULT_POSITIONS[slug]["permissions"])
        expected = registry - set(module._BACKFILL[slug])
        snapshot = module._PRIOR_DEFAULTS[slug]

        assert snapshot - expected == _EXPECTED_DRIFT.get(slug, set()), (
            f"{slug}: snapshot carries a permission the registry no longer "
            "seeds, and it is not in _EXPECTED_DRIFT"
        )
        assert expected - snapshot == set(), (
            f"{slug}: the registry seeds a permission the snapshot omits, so a "
            "pristine row would no longer match and the backfill would skip it"
        )

    def test_the_snapshot_never_already_carries_a_grant(self):
        # If it did, a pristine row would never match and nothing would be
        # backfilled — the silent-no-op failure this guard exists to catch.
        module = _load_migration()
        for slug, grants in module._BACKFILL.items():
            assert not (module._PRIOR_DEFAULTS[slug] & set(grants)), slug
